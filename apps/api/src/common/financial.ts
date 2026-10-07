import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_LEDGER_ACCOUNTS, type DomainEventType, type LedgerAccountType, type LedgerSide, type SequenceKind } from '@fee/types';
import { isUniqueViolation, Prisma, type AuditTransactionClient, type NumberingTransactionClient, type TransactionClient } from '@fee/database';
import { Money } from '@fee/money';
import { AppError } from './errors';
import { AuditEnvelopeSigner, type AuditJsonValue } from './audit-signing';
import { TenantContextModule, TenantContextService } from './tenancy';

/** Keep an issued demand invoice's live settlement fields aligned with its demand.
 * The issue-time invoice snapshot and lines remain immutable. */
export async function syncInvoiceSettlement(tx: TransactionClient, input: { tenantId: string; demandId: string; paidAmount: string; dueDate: Date }) {
  const invoices = await tx.invoice.findMany({ where: { tenantId: input.tenantId, demandId: input.demandId, status: { not: 'VOID' } } });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (const invoice of invoices) {
    const total = Money.fromString(invoice.totalAmount.toString(), invoice.currency).add(Money.fromString(invoice.adjustmentAmount.toString(), invoice.currency));
    const paid = Money.fromString(input.paidAmount, invoice.currency);
    if (paid.isNegative || paid.greaterThan(total)) throw AppError.conflict('INVOICE_SETTLEMENT_INVARIANT', 'Invoice paid amount must stay between zero and its issued total.');
    const status = paid.equals(total) ? 'PAID' : paid.isPositive ? 'PARTIALLY_PAID' : input.dueDate < today ? 'OVERDUE' : 'ISSUED';
    const changed = await tx.invoice.updateMany({ where: { tenantId: input.tenantId, id: invoice.id, paidAmount: invoice.paidAmount, status: invoice.status }, data: { paidAmount: paid.toString(), status } });
    if (changed.count !== 1) throw AppError.conflict('INVOICE_SETTLEMENT_CONFLICT', 'An invoice changed while its demand settlement was being recorded. Retry the transaction.');
  }
}

/**
 * Cross-cutting financial primitives.
 *
 * These four services are the machinery that makes "financially consistent"
 * enforceable rather than aspirational:
 *
 *   LedgerService      every movement posts a balanced double entry
 *   SequenceService    receipt and invoice numbers are gapless and allocated
 *                      inside the posting transaction
 *   IdempotencyService a retried request returns its original result instead of
 *                      charging twice
 *   AuditService       every sensitive act is recorded, tamper-evidently
 *   OutboxService      domain events are written transactionally, never lost
 *
 * They are grouped in one module because they are always used together at the
 * boundary of a money-moving operation, and because each of them is meaningless
 * without the transaction it participates in.
 */

// =====================================================================================
// Ledger
// =====================================================================================

export interface LedgerLineInput {
  /** Preferred: a system account key from SYSTEM_LEDGER_ACCOUNTS. */
  accountKey?: keyof typeof SYSTEM_LEDGER_ACCOUNTS;
  /** Or an explicit tenant account id for tenant-defined accounts. */
  accountId?: string;
  side: LedgerSide;
  /** Decimal string. */
  amount: string;
  narration?: string;
}

export interface PostLedgerInput {
  tenantId: string;
  branchId?: string | null;
  /** One currency per balanced posting; defaults to the tenant's configured currency. */
  currency?: string;
  eventType: string;
  entryDate: string;
  lines: LedgerLineInput[];
  studentId?: string | null;
  demandId?: string | null;
  demandItemId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  creditId?: string | null;
  adjustmentId?: string | null;
  narration?: string;
  createdBy?: string | null;
}

export interface PostedGroup {
  transactionGroupId: string;
  entryCount: number;
  debits: string;
  credits: string;
}

export interface LedgerBalanceGroup {
  side: LedgerSide;
  amount: string | null;
}

/** Deliberately has no `status` condition: a later reversal changes the
 * original row's current status, but must not remove that historical posting
 * from balances before the reversal's own entry date. */
export function ledgerBalanceWhere(input: { tenantId: string; accountId: string; asOfDate?: string }) {
  return {
    tenantId: input.tenantId,
    accountId: input.accountId,
    ...(input.asOfDate ? { entryDate: { lte: new Date(input.asOfDate) } } : {}),
  };
}

/** Sums grouped ledger amounts in exact 1e-4 currency units. */
export function summarizeLedgerBalance(entries: readonly LedgerBalanceGroup[]): { debits: string; credits: string; net: string } {
  let debits = 0n;
  let credits = 0n;
  for (const row of entries) {
    const units = row.amount ? toUnits(row.amount) : 0n;
    if (row.side === 'DEBIT') debits += units;
    else credits += units;
  }
  return { debits: fromUnits(debits), credits: fromUnits(credits), net: fromUnits(debits - credits) };
}

function resolveLedgerCurrency(explicitCurrency: string | undefined, configuredCurrency: string | undefined): string {
  const source = explicitCurrency ?? configuredCurrency;
  if (!source) {
    throw new AppError({
      code: 'TENANT_CURRENCY_NOT_CONFIGURED',
      message: 'Configure the tenant currency before creating or processing financial records.',
      status: 500,
    });
  }
  const currency = source.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError({
      code: 'INVALID_LEDGER_CURRENCY',
      message: 'A ledger operation must use one valid three-letter currency.',
      status: 500,
    });
  }
  return currency;
}

/** Financial writes must use the tenant's configured currency; never infer INR. */
export function requireTenantCurrency(settings: { currency?: string | null } | null | undefined): string {
  return resolveLedgerCurrency(undefined, settings?.currency ?? undefined);
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  /**
   * Posts a balanced journal entry.
   *
   * The balance assertion is the point of this method. An unbalanced posting is
   * rejected before it reaches the database, so the ledger cannot silently
   * accumulate a discrepancy that only surfaces at year end.
   */
  async post(tx: TransactionClient, input: PostLedgerInput): Promise<PostedGroup> {
    if (input.lines.length === 0) {
      throw new AppError({
        code: 'UNBALANCED_LEDGER_POSTING',
        message: 'A ledger posting must contain at least one line.',
        status: 500,
      });
    }

    const tenantSettings = input.currency ? null : await tx.tenantSettings.findUnique({ where: { tenantId: input.tenantId }, select: { currency: true } });
    const currency = resolveLedgerCurrency(input.currency, tenantSettings?.currency);
    const accounts = await this.resolveSystemAccounts(tx, input.tenantId);
    const transactionGroupId = randomUuid();

    let debitUnits = 0n;
    let creditUnits = 0n;
    for (const line of input.lines) {
      const units = toUnits(line.amount);
      if (units < 0n) {
        throw new AppError({
          code: 'UNBALANCED_LEDGER_POSTING',
          message: `Ledger amounts must be positive; use the opposite side instead (received ${line.amount}).`,
          status: 500,
        });
      }
      if (line.side === 'DEBIT') debitUnits += units;
      else creditUnits += units;
    }

    if (debitUnits !== creditUnits) {
      throw new AppError({
        code: 'UNBALANCED_LEDGER_POSTING',
        message:
          `Refusing to post an unbalanced journal entry for ${input.eventType}: ` +
          `debits ${fromUnits(debitUnits)} vs credits ${fromUnits(creditUnits)}.`,
        status: 500,
        context: { eventType: input.eventType, transactionGroupId },
      });
    }
    if (debitUnits === 0n) {
      // A zero-value posting is almost always a bug upstream; it is skipped rather
      // than written so the ledger stays a record of real movements.
      return { transactionGroupId, entryCount: 0, debits: '0.0000', credits: '0.0000' };
    }

    let sequence = 0;
    const branchId = await this.resolveBranchId(tx, input);
    for (const line of input.lines) {
      if (toUnits(line.amount) === 0n) continue;
      const accountId = line.accountId ?? (line.accountKey ? accounts.get(line.accountKey) : undefined);
      if (!accountId) {
        throw new AppError({
          code: 'UNBALANCED_LEDGER_POSTING',
          message: `Ledger line references an unknown account (${line.accountKey ?? line.accountId ?? 'none'}).`,
          status: 500,
        });
      }

      await tx.ledgerEntry.create({
        data: {
          tenantId: input.tenantId,
          branchId,
          accountId,
          transactionGroupId,
          sequence,
          side: line.side,
          amount: line.amount,
          currency,
          eventType: input.eventType,
          entryDate: new Date(input.entryDate),
          studentId: input.studentId ?? null,
          demandId: input.demandId ?? null,
          demandItemId: input.demandItemId ?? null,
          paymentId: input.paymentId ?? null,
          refundId: input.refundId ?? null,
          creditId: input.creditId ?? null,
          adjustmentId: input.adjustmentId ?? null,
          narration: line.narration ?? input.narration ?? null,
          createdBy: input.createdBy ?? null,
        },
      });
      sequence += 1;
    }

    return {
      transactionGroupId,
      entryCount: sequence,
      debits: fromUnits(debitUnits),
      credits: fromUnits(creditUnits),
    };
  }

  /**
   * Reverses a posting by writing mirrored entries.
   *
   * The original rows are marked REVERSED but never deleted or edited: a ledger
   * that can be rewritten is not a ledger.
   */
  async reverse(tx: TransactionClient, input: { tenantId: string; transactionGroupId: string; reason: string; entryDate: string; createdBy?: string | null }): Promise<string> {
    const original = await tx.ledgerEntry.findMany({
      where: { tenantId: input.tenantId, transactionGroupId: input.transactionGroupId },
      orderBy: { sequence: 'asc' },
    });
    if (original.length === 0) {
      throw AppError.notFound('Ledger posting');
    }

    const reversalGroupId = randomUuid();
    for (const entry of original) {
      await tx.ledgerEntry.create({
        data: {
          tenantId: input.tenantId,
          branchId: entry.branchId,
          accountId: entry.accountId,
          transactionGroupId: reversalGroupId,
          sequence: entry.sequence,
          // Mirrored side is what makes the reversal a true compensating entry.
          side: entry.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
          amount: entry.amount,
          currency: entry.currency,
          eventType: `${entry.eventType}:REVERSAL`,
          entryDate: new Date(input.entryDate),
          studentId: entry.studentId,
          demandId: entry.demandId,
          demandItemId: entry.demandItemId,
          paymentId: entry.paymentId,
          refundId: entry.refundId,
          creditId: entry.creditId,
          adjustmentId: entry.adjustmentId,
          narration: `Reversal: ${input.reason}`,
          createdBy: input.createdBy ?? null,
          reversedByGroupId: null,
        },
      });
    }

    await tx.ledgerEntry.updateMany({
      where: { tenantId: input.tenantId, transactionGroupId: input.transactionGroupId },
      data: { status: 'REVERSED', reversedByGroupId: reversalGroupId },
    });

    return reversalGroupId;
  }

  private async resolveBranchId(tx: TransactionClient, input: PostLedgerInput): Promise<string | null> {
    if (input.branchId !== undefined) return input.branchId;
    if (input.paymentId) {
      const payment = await tx.payment.findFirst({ where: { tenantId: input.tenantId, id: input.paymentId }, select: { branchId: true } });
      if (payment?.branchId) return payment.branchId;
    }
    if (input.demandId) {
      const demand = await tx.feeDemand.findFirst({ where: { tenantId: input.tenantId, id: input.demandId }, select: { branchId: true } });
      if (demand?.branchId) return demand.branchId;
    }
    if (input.studentId) {
      const student = await tx.student.findFirst({ where: { tenantId: input.tenantId, id: input.studentId }, select: { branchId: true } });
      if (student?.branchId) return student.branchId;
    }
    return null;
  }

  /** System accounts are provisioned lazily, so a new tenant needs no migration. */
  async resolveSystemAccounts(tx: TransactionClient, tenantId: string): Promise<Map<keyof typeof SYSTEM_LEDGER_ACCOUNTS, string>> {
    const existing = await tx.ledgerAccount.findMany({ where: { tenantId }, select: { id: true, systemKey: true } });
    const byKey = new Map<string, string>();
    for (const account of existing) {
      if (account.systemKey) byKey.set(account.systemKey, account.id);
    }

    const missing = (Object.keys(SYSTEM_LEDGER_ACCOUNTS) as Array<keyof typeof SYSTEM_LEDGER_ACCOUNTS>).filter(
      (key) => !byKey.has(key),
    );

    for (const key of missing) {
      const definition = SYSTEM_LEDGER_ACCOUNTS[key];
      const created = await tx.ledgerAccount.create({
        data: {
          tenantId,
          code: definition.code,
          name: definition.name,
          type: definition.type as LedgerAccountType,
          isSystem: true,
          systemKey: key,
        },
        select: { id: true },
      });
      byKey.set(key, created.id);
    }

    const result = new Map<keyof typeof SYSTEM_LEDGER_ACCOUNTS, string>();
    for (const key of Object.keys(SYSTEM_LEDGER_ACCOUNTS) as Array<keyof typeof SYSTEM_LEDGER_ACCOUNTS>) {
      const id = byKey.get(key);
      if (id) result.set(key, id);
    }
    return result;
  }

  /**
   * Derives an account balance from posted entries. Balances are always derived,
   * never stored: a stored balance is a second source of truth that will
   * eventually disagree with the entries that produced it.
   */
  async accountBalance(
    tx: TransactionClient,
    input: { tenantId: string; accountId: string; asOfDate?: string; currency?: string },
  ): Promise<{ debits: string; credits: string; net: string }> {
    const settings = input.currency ? null : await tx.tenantSettings.findUnique({ where: { tenantId: input.tenantId }, select: { currency: true } });
    const currency = resolveLedgerCurrency(input.currency, settings?.currency);
    const entries = await tx.ledgerEntry.groupBy({
      by: ['side'],
      where: { ...ledgerBalanceWhere(input), currency },
      _sum: { amount: true },
    });
    return summarizeLedgerBalance(entries.map((row) => ({ side: row.side, amount: row._sum.amount?.toString() ?? null })));
  }
}

// =====================================================================================
// Sequences
// =====================================================================================

export interface AllocateNumberInput {
  tenantId: string;
  kind: SequenceKind;
  /** Period scope, e.g. `2026-27`. Null for a continuous sequence. */
  scope?: string | null;
  /** Date used to derive the year segment. */
  asOfDate?: string;
}

@Injectable()
export class SequenceService {
  constructor(private readonly context: TenantContextService) {}

  /**
   * Allocates the next number in a tenant sequence.
   *
   * Called *inside* the transaction that consumes the number, so a receipt number
   * is never issued for a payment that subsequently fails to commit. Reservation
   * and format snapshot selection are serialized by a narrow database function.
   */
  async allocate(tx: TransactionClient, input: AllocateNumberInput): Promise<string> {
    return this.reserve(tx, input, true);
  }

  /** Reads the next number without consuming it, for previewing in the UI. */
  async peek(tx: TransactionClient, input: AllocateNumberInput): Promise<string> {
    return this.reserve(tx, input, false);
  }

  private async reserve(tx: TransactionClient, input: AllocateNumberInput, consume: boolean): Promise<string> {
    const asOf = input.asOfDate ?? new Date().toISOString().slice(0, 10);
    if (this.context.requireTenantId() !== input.tenantId) throw AppError.forbidden('Document numbering is restricted to the authenticated tenant.');
    return (tx as NumberingTransactionClient).reserveDocumentNumber({ tenantId: input.tenantId, kind: input.kind, scope: input.scope ?? null, asOfDate: asOf, consume });
  }
}

/** `2026-04-01` under an April-March year becomes `2026-27`. */
export function financialYearSegment(isoDate: string): string {
  const [yearPart, monthPart] = isoDate.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return String(yearPart ?? '');
  const startYear = month < 4 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

// =====================================================================================
// Idempotency
// =====================================================================================

export interface IdempotencyReservation {
  id: string;
  /** True when this call created the reservation and must do the work. */
  isNew: boolean;
  /** Present when a previous call already completed. */
  cachedResponse?: { code: number; body: unknown; resourceId?: string | null; resourceType?: string | null };
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  /**
   * Reserves a key, or replays the original result.
   *
   * This is what makes double-collection impossible even if the same request
   * arrives twice concurrently: the unique constraint on
   * (tenantId, scope, key) lets exactly one caller proceed, and the other two
   * outcomes are "already completed, here is the answer" and "in progress, retry".
   *
   * The third case matters more than it looks: returning a cached response for a
   * *different* payload is a silent data-loss bug, so the request hash is compared
   * and a mismatch is rejected.
   */
  async reserve(
    tx: TransactionClient,
    input: { tenantId: string; scope: string; key: string; requestHash?: string; ttlSeconds?: number },
  ): Promise<IdempotencyReservation> {
    const ttlSeconds = input.ttlSeconds ?? 86_400;
    try {
      const created = await tx.idempotencyKey.create({
        data: {
          tenantId: input.tenantId,
          scope: input.scope,
          key: input.key,
          requestHash: input.requestHash ?? null,
          status: 'IN_PROGRESS',
          expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
        },
      });
      return { id: created.id, isNew: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await tx.idempotencyKey.findFirst({
      where: { tenantId: input.tenantId, scope: input.scope, key: input.key },
    });
    if (!existing) {
      throw AppError.conflict('IDEMPOTENCY_IN_PROGRESS', 'This request is already being processed. Please retry shortly.');
    }

    if (existing.requestHash && input.requestHash && existing.requestHash !== input.requestHash) {
      throw AppError.conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with a different request payload.',
      );
    }

    if (existing.status === 'COMPLETED') {
      return {
        id: existing.id,
        isNew: false,
        cachedResponse: {
          code: existing.responseCode ?? 200,
          body: existing.responseBody,
          resourceId: existing.resourceId,
          resourceType: existing.resourceType,
        },
      };
    }

    throw AppError.conflict('IDEMPOTENCY_IN_PROGRESS', 'This request is already being processed. Please retry shortly.');
  }

  async complete(
    tx: TransactionClient,
    input: {
      id: string;
      responseCode: number;
      responseBody: unknown;
      resourceId?: string | null;
      resourceType?: string | null;
    },
  ): Promise<void> {
    const hasResourceId = input.resourceId != null;
    const hasResourceType = input.resourceType != null;
    if (hasResourceId !== hasResourceType) {
      throw AppError.validation('A resource ID and its resource type must be supplied together.');
    }
    await tx.idempotencyKey.update({
      where: { id: input.id },
      data: {
        status: 'COMPLETED',
        responseCode: input.responseCode,
        responseBody: input.responseBody as Prisma.InputJsonValue,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Releases a reservation so the caller can retry.
   *
   * Only ever called when the transaction is rolled back, which is why it takes
   * the transaction client: the row and the failed work disappear together.
   */
  async release(tx: TransactionClient, id: string): Promise<void> {
    try {
      await tx.idempotencyKey.delete({ where: { id } });
    } catch {
      this.logger.debug({ id }, 'Idempotency reservation already gone');
    }
  }

  /** Stable hash of a request payload, so a replay with different input is caught. */
  static fingerprint(payload: unknown): string {
    return createHash('sha256').update(canonicalJson(payload)).digest('hex');
  }
}

// =====================================================================================
// Audit
// =====================================================================================

export interface AuditInput {
  tenantId: string;
  actorId?: string | null;
  actorType?: string;
  actorEmail?: string | null;
  actorRoles?: string[];
  action: string;
  entityType: string;
  entityId?: string | null;
  entityRef?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  severity?: 'INFO' | 'WARN' | 'CRITICAL';
}

@Injectable()
export class AuditService {
  constructor(
    private readonly signer: AuditEnvelopeSigner,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Appends an audit record, hash-chained to the previous one for the tenant.
   *
   * The chain is what turns "nobody edited this" from a claim into evidence: an
   * alteration to any earlier row breaks every subsequent hash. It is written in
   * the same transaction as the change it describes, so an action cannot commit
   * without its record.
   */
  async record(tx: TransactionClient, input: AuditInput): Promise<void> {
    const auditTx = tx as AuditTransactionClient;
    const preparation = await auditTx.prepareAuditAppend(input.tenantId);
    if (preparation.mode === 'v2') {
      const current = this.tenantContext.peek();
      if (current?.tenantId && current.tenantId !== input.tenantId) {
        throw AppError.forbidden('Audit records are restricted to the authenticated tenant.');
      }
      if (current?.userId && input.actorId && input.actorId !== current.userId) {
        throw AppError.forbidden('Audit actor does not match the authenticated user.');
      }
      if (current?.requestId && input.requestId && input.requestId !== current.requestId) {
        throw AppError.forbidden('Audit request does not match the current request context.');
      }
      const actorId = input.actorId ?? current?.userId ?? null;
      const requestId = input.requestId ?? current?.requestId ?? null;
      const signed = this.signer.sign({
        tenantId: input.tenantId,
        actorId,
        actorType: input.actorType ?? 'USER',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        requestId,
        context: {
          actorEmail: input.actorEmail ?? null,
          actorRoles: input.actorRoles ?? current?.roles ?? [],
          entityRef: input.entityRef ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          severity: input.severity ?? 'INFO',
        },
        payload: {
          before: auditJsonValue(input.before),
          after: auditJsonValue(input.after),
          diff: null,
        },
      });
      await auditTx.appendSignedAudit({
        tenantId: input.tenantId,
        actorId,
        requestId,
        envelopeJson: JSON.stringify(signed.envelope),
        signature: signed.signature,
      });
      return;
    }
    const recordedAt = preparation.recordedAt;
    const previous = await tx.auditLog.findFirst({
      where: { tenantId: input.tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { hash: true },
    });

    const payload = {
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      recordedAt: recordedAt.toISOString(),
    };

    const prevHash = previous?.hash ?? null;
    const hash = createHash('sha256')
      .update(`${prevHash ?? 'genesis'}:${canonicalJson(payload)}`)
      .digest('hex');

    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorRoles: input.actorRoles ?? [],
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityRef: input.entityRef ?? null,
        before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
        reason: input.reason ?? null,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        severity: input.severity ?? 'INFO',
        prevHash,
        hash,
        createdAt: recordedAt,
      },
    });
  }

  /**
   * Verifies the chain for a tenant. Used by an integrity check that an auditor
   * can run, and by the reconciliation worker.
   */
  async verifyChain(tx: TransactionClient, tenantId: string, limit = 5_000): Promise<{ intact: boolean; checked: number; brokenAt?: string }> {
    const v2 = await (tx as AuditTransactionClient).verifyAuditChain(tenantId, limit);
    if (v2.mode === 'v2') return v2.result;

    const entries = await tx.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, tenantId: true, actorId: true, action: true, entityType: true, entityId: true, before: true, after: true, reason: true, requestId: true, createdAt: true, prevHash: true, hash: true },
    });

    // Follow the hash links instead of timestamps. Legacy timestamp precision
    // can produce ties, and timestamp order cannot reliably recover append order
    // for those rows. The v2 chain stores an explicit sequence.
    const successors = new Map<string | null, typeof entries>();
    const hashOwners = new Map<string, string>();
    for (const entry of entries) {
      const siblings = successors.get(entry.prevHash) ?? [];
      siblings.push(entry);
      successors.set(entry.prevHash, siblings);
      if (entry.hash) {
        const priorOwner = hashOwners.get(entry.hash);
        if (priorOwner) return { intact: false, checked: entries.length, brokenAt: entry.id };
        hashOwners.set(entry.hash, entry.id);
      }
    }

    const roots = successors.get(null) ?? [];
    if (roots.length !== 1) return { intact: false, checked: entries.length, brokenAt: roots[1]?.id ?? entries[0]?.id };

    const visited = new Set<string>();
    let expectedPrev: string | null = null;
    let current: (typeof entries)[number] | undefined = roots[0];
    while (current) {
      if (visited.has(current.id) || current.prevHash !== expectedPrev || current.tenantId !== tenantId || !current.hash) {
        return { intact: false, checked: entries.length, brokenAt: current.id };
      }
      const payload = {
        tenantId: current.tenantId,
        actorId: current.actorId,
        action: current.action,
        entityType: current.entityType,
        entityId: current.entityId,
        before: current.before,
        after: current.after,
        reason: current.reason,
        requestId: current.requestId,
        recordedAt: current.createdAt.toISOString(),
      };
      const expectedHash: string = createHash('sha256')
        .update(`${expectedPrev ?? 'genesis'}:${canonicalJson(payload)}`)
        .digest('hex');
      if (current.hash !== expectedHash) return { intact: false, checked: entries.length, brokenAt: current.id };
      visited.add(current.id);
      expectedPrev = current.hash;
      const next: (typeof entries)[number][] = successors.get(current.hash) ?? [];
      if (next.length > 1) return { intact: false, checked: entries.length, brokenAt: next[1]!.id };
      current = next[0];
    }

    if (visited.size !== entries.length) {
      const orphan = entries.find((entry) => !visited.has(entry.id));
      return { intact: false, checked: entries.length, brokenAt: orphan?.id };
    }
    return { intact: true, checked: entries.length };
  }
}

function auditJsonValue(value: unknown): AuditJsonValue {
  if (value === undefined || value === null) return null;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Audit payload could not be represented as JSON.');
  return JSON.parse(serialized) as AuditJsonValue;
}

// =====================================================================================
// Outbox
// =====================================================================================

export interface OutboxInput {
  tenantId: string;
  eventType: DomainEventType | string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: unknown;
  dedupeKey?: string | null;
  actorId?: string | null;
  requestId?: string | null;
}

@Injectable()
export class OutboxService {
  /**
   * Writes a domain event inside the caller's transaction.
   *
   * The transactional outbox pattern is what makes the rest of the platform
   * demote notifications, receipts and reporting to eventual consistency without
   * ever losing an event: if the transaction rolls back, so does the event, and
   * if it commits, the worker will find it.
   */
  async publish(tx: TransactionClient, input: OutboxInput): Promise<string> {
    const event = await tx.outboxEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey ?? null,
        status: 'PENDING',
      },
      select: { id: true },
    });
    return event.id;
  }
}

// =====================================================================================
// Helpers
// =====================================================================================

/**
 * Stable JSON with sorted keys.
 *
 * `JSON.stringify` key order follows insertion order, so two logically identical
 * payloads can hash differently. That would break both idempotency fingerprints
 * and the audit hash chain.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'bigint') return `"${value.toString()}"`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return 'null';
}

/** Decimal string to integer units of 1e-4, for exact comparison and summing. */
export function toUnits(value: string): bigint {
  const trimmed = String(value).trim();
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace(/^[+-]/, '').split('.');
  const units = BigInt(`${whole}${(fraction + '0000').slice(0, 4)}`);
  return negative ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10_000n;
  const fraction = (abs % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function randomUuid(): string {
  return randomUUID();
}

// =====================================================================================
// Module
// =====================================================================================

/**
 * Global so that any service performing a money movement can inject the ledger,
 * sequence, idempotency, audit and outbox services without ceremony. They are
 * always needed together and never useful in isolation.
 */
@Global()
@Module({
  imports: [TenantContextModule],
  providers: [LedgerService, SequenceService, IdempotencyService, AuditService, AuditEnvelopeSigner, OutboxService],
  exports: [LedgerService, SequenceService, IdempotencyService, AuditService, AuditEnvelopeSigner, OutboxService],
})
export class FinancialModule {}
