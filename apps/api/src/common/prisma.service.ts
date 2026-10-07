import { Global, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  createPrismaClient,
  Prisma,
  runInTransaction,
  TransactionExecutorContext,
  withRetryOnConflict,
  type DatabaseClient,
  type TenantScopedDatabaseClient,
  type TransactionClient,
} from '@fee/database';
import { AppConfigModule, AppConfigService } from '../config/env';
import { TenantContextModule, TenantContextService } from './tenancy';
import { createTenantScopedClient, createTenantScopedDatabaseHandle } from './scoped-prisma';
import { AppError } from './errors';
import { fromUnits, toUnits } from './financial';

/** Captured payments remain gross collections after a refund is processed.
 * REFUND_PENDING is included because no completed cash reversal exists yet. */
export const FINANCE_GROSS_PAYMENT_STATUSES = ['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

export interface FinanceAmountTotal {
  currency: string;
  count: number;
  amount: string;
}

/** Builds the only branch predicate accepted by tenant finance raw queries.
 * `undefined` means an organization-wide actor; an empty list means no branch
 * access and must return no rows. IDs are bound as UUID parameters. */
export function financeBranchFilter(branchIds?: readonly string[]): Prisma.Sql {
  if (branchIds === undefined) return Prisma.empty;
  if (branchIds.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND "branchId" IN (${Prisma.join(branchIds.map((branchId) => Prisma.sql`${branchId}::uuid`))})`;
}

const PLATFORM_TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns period cash totals without mutating the original collection facts.
 * Gross collections use payment paidAt; refunds use refund processedAt. */
export function summarizeFinanceCollections(grossRows: FinanceAmountTotal[], refundRows: FinanceAmountTotal[]) {
  const totals = new Map<string, { grossUnits: bigint; paymentCount: number; refundUnits: bigint; refundCount: number }>();
  for (const row of grossRows) {
    const total = totals.get(row.currency) ?? { grossUnits: 0n, paymentCount: 0, refundUnits: 0n, refundCount: 0 };
    total.grossUnits += toUnits(row.amount);
    total.paymentCount += row.count;
    totals.set(row.currency, total);
  }
  for (const row of refundRows) {
    const total = totals.get(row.currency) ?? { grossUnits: 0n, paymentCount: 0, refundUnits: 0n, refundCount: 0 };
    total.refundUnits += toUnits(row.amount);
    total.refundCount += row.count;
    totals.set(row.currency, total);
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, total]) => ({
    currency,
    paymentCount: total.paymentCount,
    refundCount: total.refundCount,
    grossCollected: fromUnits(total.grossUnits),
    refunds: fromUnits(total.refundUnits),
    netAfterRefunds: fromUnits(total.grossUnits - total.refundUnits),
  }));
}

/**
 * The single database handle for the API process.
 *
 * Services receive this rather than constructing their own client, so the
 * connection pool is bounded and the transaction helpers have one implementation.
 *
 * `transaction` and `transactionWithRetry` are on the service (not called
 * directly from `@fee/database`) so that a test can substitute a client and
 * exercise the same code path.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly #client: DatabaseClient;
  readonly #transactionContext: TransactionExecutorContext;
  private readonly databaseHandle: TenantScopedDatabaseClient;

  constructor(
    config: AppConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    this.#transactionContext = new TransactionExecutorContext();
    const baseClient = createPrismaClient({
      databaseUrl: config.databaseUrl,
      logLevel: config.isProduction ? 'error' : 'info',
    });
    this.#client = createTenantScopedClient(baseClient, tenantContext, this.#transactionContext);
    this.databaseHandle = createTenantScopedDatabaseHandle(this.#client);
  }

  async onModuleInit(): Promise<void> {
    await this.#client.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.#client.$disconnect();
  }

  /** Direct access, for simple reads that do not need a transaction. */
  get db(): TenantScopedDatabaseClient {
    return this.databaseHandle;
  }

  /**
   * Runs `work` in a Serializable transaction. Every operation that writes more
   * than one financial row uses this: payment + allocation + demand status +
   * ledger + receipt number must all commit or none may.
   */
  async transaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
    options: { isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable'; timeoutMs?: number } = {},
  ): Promise<T> {
    return runInTransaction(this.#client, (tx) =>
      this.#transactionContext.run(tx, () => work(createTenantScopedDatabaseHandle(tx as unknown as DatabaseClient, { numberingTransactionOperations: true, auditTransactionOperations: true }) as TransactionClient)),
      options,
    );
  }

  /**
   * Same, but retries a genuine concurrency conflict. A unique-constraint
   * violation is never retried: it means the operation already took place.
   */
  async transactionWithRetry<T>(
    work: (tx: TransactionClient) => Promise<T>,
    options: { isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable'; attempts?: number } = {},
  ): Promise<T> {
    return withRetryOnConflict(
      this.#client,
      (tx) =>
        this.#transactionContext.run(tx, () => work(createTenantScopedDatabaseHandle(tx as unknown as DatabaseClient, { numberingTransactionOperations: true, auditTransactionOperations: true }) as TransactionClient)),
      { isolationLevel: options.isolationLevel ?? 'Serializable' },
      {
        attempts: options.attempts ?? 3,
        onRetry: (attempt, error) =>
          this.logger.warn({ attempt, err: error instanceof Error ? error.message : error }, 'Retrying transaction after a concurrency conflict'),
      },
    );
  }

  /** Liveness probe: the connection answers a trivial query. */
  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const startedAt = Date.now();
    try {
      await this.#client.$queryRawUnsafe('SELECT 1');
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch {
      return { ok: false, latencyMs: Date.now() - startedAt };
    }
  }

  /**
   * Narrow control-plane aggregate used by the Super Admin dashboard. This is
   * deliberately a fixed, parameterized query surface: the ordinary Prisma
   * handle remains tenant-scoped and no caller-provided SQL or tenant filter is
   * accepted here.
   */
  async platformDashboardMetrics(platformTenantId: string) {
    const context = this.tenantContext.peek();
    if (!context?.isPlatformAdmin || context.tenantId !== platformTenantId || !PLATFORM_TENANT_UUID.test(platformTenantId)) {
      throw AppError.forbidden('Platform dashboard metrics require the verified platform session.');
    }
    const [plans, subscriptionsByCurrency, invoicesByCurrency, requestedRefundsByCurrency, domains] = await Promise.all([
      this.#client.$queryRaw<Array<{ activePlans: number }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "active")::int AS "activePlans"
        FROM public."plans"`),
      this.#client.$queryRaw<Array<{ currency: string; activeCount: number; trialCount: number; monthlyRecurringRevenue: string }>>(Prisma.sql`
        SELECT "currency"::text AS currency,
          COUNT(*) FILTER (WHERE "isCurrent" AND "status"::text = 'ACTIVE')::int AS "activeCount",
          COUNT(*) FILTER (WHERE "isCurrent" AND "status"::text = 'TRIAL')::int AS "trialCount",
          COALESCE(SUM(CASE
            WHEN "isCurrent" AND "status"::text = 'ACTIVE' AND "billingInterval"::text = 'MONTHLY' THEN "amount"
            WHEN "isCurrent" AND "status"::text = 'ACTIVE' AND "billingInterval"::text = 'YEARLY' THEN "amount" / 12
            ELSE 0
          END), 0)::text AS "monthlyRecurringRevenue"
        FROM public."tenant_subscriptions"
        WHERE "tenantId" <> ${platformTenantId}::uuid AND "isCurrent"
        GROUP BY "currency" ORDER BY "currency"`),
      this.#client.$queryRaw<Array<{ currency: string; openCount: number; overdueCount: number; outstandingAmount: string }>>(Prisma.sql`
        WITH collected AS (
          SELECT "tenantId", "invoiceId", SUM("amount") AS amount
          FROM public."platform_payments"
          WHERE "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
          GROUP BY "tenantId", "invoiceId"
        )
        SELECT invoice."currency"::text AS currency,
          COUNT(*) FILTER (WHERE invoice."status" IN ('OPEN', 'PARTIALLY_PAID', 'PAST_DUE'))::int AS "openCount",
          COUNT(*) FILTER (WHERE invoice."status" = 'PAST_DUE')::int AS "overdueCount",
          COALESCE(SUM(GREATEST(invoice."total" - COALESCE(collected.amount, 0), 0)), 0)::text AS "outstandingAmount"
        FROM public."platform_invoices" AS invoice
        LEFT JOIN collected ON collected."tenantId" = invoice."tenantId" AND collected."invoiceId" = invoice."id"
        WHERE invoice."tenantId" <> ${platformTenantId}::uuid AND invoice."status" IN ('OPEN', 'PARTIALLY_PAID', 'PAST_DUE')
        GROUP BY invoice."currency" ORDER BY invoice."currency"`),
      this.#client.$queryRaw<Array<{ currency: string; count: number; amount: string }>>(Prisma.sql`
        SELECT "currency"::text AS currency, COUNT(*)::int AS count, COALESCE(SUM("amount"), 0)::text AS amount
        FROM public."platform_refunds"
        WHERE "tenantId" <> ${platformTenantId}::uuid AND "status" = 'REQUESTED'
        GROUP BY "currency" ORDER BY "currency"`),
      this.#client.$queryRaw<Array<{ verified: number; pending: number }>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "verifiedAt" IS NOT NULL)::int AS verified,
          COUNT(*) FILTER (WHERE "verifiedAt" IS NULL)::int AS pending
        FROM public."tenant_domains"
        WHERE "tenantId" <> ${platformTenantId}::uuid`),
    ]);
    return {
      activePlans: plans[0]?.activePlans ?? 0,
      subscriptionsByCurrency,
      invoicesByCurrency,
      requestedRefundsByCurrency,
      domains: domains[0] ?? { verified: 0, pending: 0 },
    };
  }

  /** Fixed, parameterized financial report queries. Raw SQL is deliberately
   * unavailable on the tenant-scoped model client. This narrow entry point
   * validates the active tenant and pins that tenant ID into every query. */
  async financeReportData(input: { tenantId: string; from: string; to: string; today: string; timezone: string; branchIds?: string[] }) {
    if (this.tenantContext.requireTenantId() !== input.tenantId) {
      throw AppError.forbidden('The requested tenant does not match the authenticated session.');
    }
    const { tenantId, from, to, today, timezone } = input;
    const branchFilter = financeBranchFilter(input.branchIds);
    const dateWindow = Prisma.sql`"paidAt" >= (${from}::date::timestamp AT TIME ZONE ${timezone}) AND "paidAt" < ((${to}::date + 1)::timestamp AT TIME ZONE ${timezone})`;
    const grossPaymentStatuses = Prisma.sql`"status" IN (${Prisma.join(FINANCE_GROSS_PAYMENT_STATUSES.map((status) => Prisma.sql`${status}`))})`;
    const [dailyCollections, collectionByMethod, collectionByPayer, refunds, outstanding, feeAdjustments, operationalAdjustments] = await Promise.all([
      this.#client.$queryRaw<Array<{ day: string; currency: string; count: number; grossAmount: string }>>(Prisma.sql`
        SELECT to_char(("paidAt" AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS day, "currency",
               COUNT(*)::int AS count, COALESCE(SUM("amount"), 0)::text AS "grossAmount"
        FROM "payments" WHERE "tenantId" = ${tenantId}::uuid AND ${grossPaymentStatuses} AND ${dateWindow} ${branchFilter}
        GROUP BY day, "currency" ORDER BY day, "currency"`),
      this.#client.$queryRaw<Array<{ method: string; channel: string; currency: string; count: number; grossAmount: string }>>(Prisma.sql`
        SELECT "methodKind"::text AS method, "channel"::text AS channel, "currency", COUNT(*)::int AS count,
               COALESCE(SUM("amount"), 0)::text AS "grossAmount"
        FROM "payments" WHERE "tenantId" = ${tenantId}::uuid AND ${grossPaymentStatuses} AND ${dateWindow} ${branchFilter}
        GROUP BY "methodKind", "channel", "currency" ORDER BY "currency", "channel", "methodKind"`),
      this.#client.$queryRaw<Array<{ payerType: string; payerName: string; currency: string; count: number; grossAmount: string }>>(Prisma.sql`
        SELECT "payerType"::text AS "payerType", COALESCE(NULLIF("payerName", ''), "payerType"::text) AS "payerName", "currency",
               COUNT(*)::int AS count, COALESCE(SUM("amount"), 0)::text AS "grossAmount"
        FROM "payments" WHERE "tenantId" = ${tenantId}::uuid AND ${grossPaymentStatuses} AND ${dateWindow} ${branchFilter}
        GROUP BY "payerType", "payerName", "currency" ORDER BY "currency", "payerType", "payerName"`),
      this.#client.$queryRaw<Array<{ currency: string; count: number; amount: string }>>(Prisma.sql`
        SELECT "currency", COUNT(*)::int AS count, COALESCE(SUM("amount"), 0)::text AS amount
        FROM "refunds" WHERE "tenantId" = ${tenantId}::uuid AND "status" = 'COMPLETED'
          AND "processedAt" >= (${from}::date::timestamp AT TIME ZONE ${timezone})
          AND "processedAt" < ((${to}::date + 1)::timestamp AT TIME ZONE ${timezone}) ${branchFilter}
        GROUP BY "currency" ORDER BY "currency"`),
      this.#client.$queryRaw<Array<{ currency: string; openCount: number; overdueCount: number; outstanding: string }>>(Prisma.sql`
        SELECT "currency", COUNT(*) FILTER (WHERE GREATEST("netAmount" + "adjustmentAmount" - "paidAmount" - "waivedAmount", 0) > 0)::int AS "openCount",
               COUNT(*) FILTER (WHERE "dueDate" < ${today}::date AND GREATEST("netAmount" + "adjustmentAmount" - "paidAmount" - "waivedAmount", 0) > 0)::int AS "overdueCount",
               COALESCE(SUM(GREATEST("netAmount" + "adjustmentAmount" - "paidAmount" - "waivedAmount", 0)), 0)::text AS outstanding
        FROM "fee_demands" WHERE "tenantId" = ${tenantId}::uuid AND "status" IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') ${branchFilter}
        GROUP BY "currency" ORDER BY "currency"`),
      this.#client.$queryRaw<Array<{ currency: string; scholarship: string; discount: string; concession: string; waiver: string; override: string; surcharge: string; lateFee: string; tax: string }>>(Prisma.sql`
        SELECT "currency", COALESCE(SUM("scholarshipAmount"),0)::text AS scholarship, COALESCE(SUM("discountAmount"),0)::text AS discount,
               COALESCE(SUM("concessionAmount"),0)::text AS concession, COALESCE(SUM("waiverAmount"),0)::text AS waiver,
               COALESCE(SUM("overrideAmount"),0)::text AS override,
               COALESCE(SUM("surchargeAmount"),0)::text AS surcharge, COALESCE(SUM("lateFeeAmount"),0)::text AS "lateFee",
               COALESCE(SUM("taxAmount"),0)::text AS tax
        FROM "fee_demands" WHERE "tenantId" = ${tenantId}::uuid AND "issueDate" >= ${from}::date AND "issueDate" <= ${to}::date ${branchFilter}
        GROUP BY "currency" ORDER BY "currency"`),
      this.#client.$queryRaw<Array<{ currency: string; kind: string; direction: string; count: number; amount: string }>>(Prisma.sql`
        SELECT "currency", "kind"::text AS kind, "direction"::text AS direction, COUNT(*)::int AS count,
               COALESCE(SUM("amount"), 0)::text AS amount
        FROM "adjustments" WHERE "tenantId" = ${tenantId}::uuid AND "status" IN ('APPLIED', 'REVERSED')
          AND "createdAt" >= (${from}::date::timestamp AT TIME ZONE ${timezone})
          AND "createdAt" < ((${to}::date + 1)::timestamp AT TIME ZONE ${timezone}) ${branchFilter}
        GROUP BY "currency", "kind", "direction" ORDER BY "currency", "kind", "direction"`),
    ]);
    const grossRows = collectionByPayer.map((row) => ({ currency: row.currency, count: row.count, amount: row.grossAmount }));
    const collectionSummary = summarizeFinanceCollections(grossRows, refunds);
    return {
      dailyCollections: dailyCollections.map((row) => ({ ...row, amount: row.grossAmount })),
      collectionByMethod: collectionByMethod.map((row) => ({ ...row, amount: row.grossAmount })),
      collectionByPayer: collectionByPayer.map((row) => ({ ...row, amount: row.grossAmount })),
      collectionSummary,
      refunds,
      outstanding,
      feeAdjustments,
      operationalAdjustments,
    };
  }
}

@Global()
@Module({
  imports: [AppConfigModule, TenantContextModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
