import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Money } from '@fee/money';
import { isUniqueViolation, type TransactionClient } from '@fee/database';
import { ERROR_CODES, PERMISSIONS } from '@fee/types';
import { AppError } from '../common/errors';
import { AuditService, LedgerService, OutboxService } from '../common/financial';
import { ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero.');
const nonNegativeMoney = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => !value.startsWith('-'), 'Amount must not be negative.');
const settlementImportSchema = z.object({
  gatewayConfigId: uuid,
  settlementReference: z.string().trim().min(1).max(120),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grossAmount: money,
  gatewayFee: nonNegativeMoney.default('0'),
  gatewayTax: nonNegativeMoney.default('0'),
  netAmount: nonNegativeMoney,
  currency: z.string().regex(/^[A-Z]{3}$/),
  transactions: z.array(z.object({ providerReference: z.string().trim().min(1).max(200), amount: money })).min(1).max(5000),
});
const resolutionSchema = z.object({ status: z.enum(['RESOLVED', 'IGNORED']), resolution: z.string().trim().min(3).max(1000) });
const releaseCaptureSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
type SettlementImportInput = z.infer<typeof settlementImportSchema>;

@Injectable()
export class SettlementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly ledger: LedgerService, private readonly outbox: OutboxService, private readonly tenantContext: TenantContextService) {}

  async listSettlements(tenantId: string) {
    this.assertTenant(tenantId);
    const settlements = await this.prisma.db.settlement.findMany({ where: { tenantId }, orderBy: [{ settlementDate: 'desc' }, { id: 'desc' }], take: 100 });
    const ids = settlements.map(({ id }) => id);
    const [transactions, records] = ids.length ? await Promise.all([
      this.prisma.db.gatewayTransaction.groupBy({ by: ['settlementId'], where: { tenantId, settlementId: { in: ids } }, _count: { _all: true } }),
      this.prisma.db.reconciliationRecord.groupBy({ by: ['settlementId'], where: { tenantId, settlementId: { in: ids } }, _count: { _all: true } }),
    ]) : [[], []];
    const transactionCount = new Map(transactions.flatMap((row) => row.settlementId ? [[row.settlementId, row._count._all] as const] : []));
    const recordCount = new Map(records.flatMap((row) => row.settlementId ? [[row.settlementId, row._count._all] as const] : []));
    return settlements.map((settlement) => ({ ...settlement, _count: { transactions: transactionCount.get(settlement.id) ?? 0, records: recordCount.get(settlement.id) ?? 0 } }));
  }

  async listGatewayConfigs(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.db.tenantPaymentGateway.findMany({ where: { tenantId }, orderBy: [{ environment: 'asc' }, { displayName: 'asc' }], select: { id: true, provider: true, environment: true, displayName: true, active: true } });
  }

  async listRecords(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const status = typeof raw.status === 'string' && ['OPEN', 'MATCHED', 'MISMATCHED', 'RESOLVED', 'IGNORED'].includes(raw.status) ? raw.status as 'OPEN' | 'MATCHED' | 'MISMATCHED' | 'RESOLVED' | 'IGNORED' : undefined;
    const rows = await this.prisma.db.reconciliationRecord.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
    const settlementIds = [...new Set(rows.flatMap((record) => record.settlementId ? [record.settlementId] : []))];
    const settlements = settlementIds.length ? await this.prisma.db.settlement.findMany({ where: { tenantId, id: { in: settlementIds } }, select: { id: true, settlementReference: true, settlementDate: true } }) : [];
    const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));
    const records = rows.map((record) => ({ ...record, settlement: record.settlementId ? settlementById.get(record.settlementId) ?? null : null }));
    const gatewayTransactionIds = [...new Set(records.flatMap((record) => record.gatewayTransactionId ? [record.gatewayTransactionId] : []))];
    const transactions = gatewayTransactionIds.length ? await this.prisma.db.gatewayTransaction.findMany({
      where: { tenantId, id: { in: gatewayTransactionIds } },
      select: { id: true, provider: true, providerTxnId: true, providerPaymentId: true, amount: true, currency: true, status: true, paymentId: true },
    }) : [];
    const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const paymentIds = [...new Set(records.flatMap((record) => {
      const paymentId = record.paymentId ?? (record.gatewayTransactionId ? transactionsById.get(record.gatewayTransactionId)?.paymentId : null);
      return paymentId ? [paymentId] : [];
    }))];
    const payments = paymentIds.length ? await this.prisma.db.payment.findMany({ where: { tenantId, id: { in: paymentIds } }, select: { id: true, paymentNumber: true, status: true, amount: true, currency: true, allocatedAmount: true, unallocatedAmount: true } }) : [];
    const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));
    const gatewayCredits = paymentIds.length ? await this.prisma.db.credit.findMany({ where: { tenantId, paymentId: { in: paymentIds }, source: 'GATEWAY_UNAPPLIED' }, select: { id: true, paymentId: true, status: true, availableAmount: true } }) : [];
    const creditsByPaymentId = new Map(gatewayCredits.flatMap((credit) => credit.paymentId ? [[credit.paymentId, credit] as const] : []));
    return records.map((record) => {
      const gatewayTransaction = record.gatewayTransactionId ? transactionsById.get(record.gatewayTransactionId) ?? null : null;
      const paymentId = record.paymentId ?? gatewayTransaction?.paymentId ?? null;
      return { ...record, gatewayTransaction, payment: paymentId ? paymentsById.get(paymentId) ?? null : null, gatewayCredit: paymentId ? creditsByPaymentId.get(paymentId) ?? null : null };
    });
  }

  async importSettlement(tenantId: string, input: SettlementImportInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const gross = Money.fromString(input.grossAmount, input.currency);
    const fee = Money.fromString(input.gatewayFee, input.currency);
    const tax = Money.fromString(input.gatewayTax, input.currency);
    const net = Money.fromString(input.netAmount, input.currency);
    if (!gross.subtract(fee).subtract(tax).equals(net)) throw AppError.validation('Net settlement must equal gross amount less gateway fee and gateway tax.');
    const lineTotal = input.transactions.reduce((sum, row) => sum.add(Money.fromString(row.amount, input.currency)), Money.zero(input.currency));
    if (!lineTotal.equals(gross)) throw AppError.validation('Imported transaction amounts must add up to the settlement gross amount.');
    const settlementDay = parseDate(input.settlementDate);
    return this.prisma.transactionWithRetry(async (tx) => {
      const config = await tx.tenantPaymentGateway.findFirst({ where: { tenantId, id: input.gatewayConfigId }, select: { id: true, provider: true, environment: true } });
      if (!config) throw AppError.notFound('Payment gateway configuration');
      const existing = await tx.settlement.findFirst({ where: { tenantId, provider: config.provider, environment: config.environment, settlementReference: input.settlementReference } });
      if (existing) {
        const recordCount = await tx.reconciliationRecord.count({ where: { tenantId, settlementId: existing.id } });
        return { ...existing, _count: { records: recordCount }, alreadyImported: true };
      }
      const settlement = await tx.settlement.create({ data: {
        tenantId, gatewayConfigId: config.id, provider: config.provider, environment: config.environment,
        settlementReference: input.settlementReference, settlementDate: settlementDay,
        grossAmount: gross.toString(), gatewayFee: fee.toString(), gatewayTax: tax.toString(), netAmount: net.toString(),
        currency: input.currency, transactionCount: input.transactions.length, status: 'IMPORTED', importedBy: actorId ?? null,
      } });
      const seen = new Set<string>();
      let matched = 0; let unresolved = 0;
      for (const row of input.transactions) {
        const reference = row.providerReference;
        const amount = Money.fromString(row.amount, input.currency);
        if (seen.has(reference)) {
          unresolved += 1;
          await tx.reconciliationRecord.create({ data: { tenantId, settlementId: settlement.id, status: 'MISMATCHED', mismatchType: 'DUPLICATE_SETTLEMENT_REFERENCE', expectedAmount: null, actualAmount: amount.toString(), difference: null, currency: input.currency, notes: `Duplicate imported provider reference: ${reference}` } });
          continue;
        }
        seen.add(reference);
        const candidates = await tx.gatewayTransaction.findMany({
          where: { tenantId, gatewayConfigId: config.id, provider: config.provider, environment: config.environment, OR: [{ providerTxnId: reference }, { providerPaymentId: reference }, { providerOrderId: reference }] },
          take: 2,
        });
        if (candidates.length !== 1) {
          unresolved += 1;
          await tx.reconciliationRecord.create({ data: { tenantId, settlementId: settlement.id, status: candidates.length > 1 ? 'MISMATCHED' : 'OPEN', mismatchType: candidates.length > 1 ? 'AMBIGUOUS_PROVIDER_REFERENCE' : 'MISSING_IN_SYSTEM', expectedAmount: null, actualAmount: amount.toString(), difference: null, currency: input.currency, notes: `Imported provider reference: ${reference}` } });
          continue;
        }
        const transaction = candidates[0]!;
        const capturedPayment = transaction.paymentId ? await tx.payment.findFirst({ where: { tenantId, id: transaction.paymentId }, select: { id: true, status: true, amount: true, currency: true } }) : null;
        const transactionCurrency = capturedPayment?.currency ?? transaction.currency;
        const transactionAmount = Money.fromString((capturedPayment?.amount ?? transaction.amount).toString(), transactionCurrency);
        const issue = transactionCurrency !== input.currency ? 'SETTLEMENT_CURRENCY_MISMATCH'
          : transaction.status !== 'CAPTURED' ? 'TRANSACTION_NOT_CAPTURED'
          : capturedPayment && capturedPayment.status !== 'SUCCESS' ? 'PAYMENT_NOT_SUCCESSFUL'
          : !transactionAmount.equals(amount) ? 'SETTLEMENT_AMOUNT_MISMATCH'
          : transaction.settlementId ? 'TRANSACTION_ALREADY_SETTLED' : null;
        if (issue) {
          unresolved += 1;
          await tx.reconciliationRecord.create({ data: { tenantId, settlementId: settlement.id, gatewayTransactionId: transaction.id, paymentId: transaction.paymentId, status: 'MISMATCHED', mismatchType: issue, expectedAmount: transactionAmount.toString(), actualAmount: amount.toString(), difference: transactionCurrency === input.currency ? amount.subtract(transactionAmount).toString() : null, currency: input.currency, notes: `Imported provider reference: ${reference}` } });
          continue;
        }
        const changed = await tx.gatewayTransaction.updateMany({ where: { tenantId, id: transaction.id, settlementId: null, status: 'CAPTURED' }, data: { settlementId: settlement.id } });
        if (changed.count !== 1) throw AppError.conflict(ERROR_CODES.CONFLICT, 'A gateway transaction changed while settlement matching was in progress. Retry the import.');
        matched += 1;
        await tx.reconciliationRecord.create({ data: { tenantId, settlementId: settlement.id, gatewayTransactionId: transaction.id, paymentId: transaction.paymentId, status: 'MATCHED', mismatchType: null, expectedAmount: transactionAmount.toString(), actualAmount: amount.toString(), difference: '0', currency: input.currency, notes: `Matched provider reference: ${reference}` } });
      }
      const status = unresolved === 0 ? 'MATCHED' : matched > 0 ? 'PARTIALLY_MATCHED' : 'MISMATCHED';
      const updated = await tx.settlement.update({ where: { tenantId_id: { tenantId, id: settlement.id } }, data: { status, reconciledAt: unresolved === 0 ? new Date() : null } });
      await this.audit.record(tx, { tenantId, actorId, action: 'SETTLEMENT_IMPORTED', entityType: 'Settlement', entityId: settlement.id, after: { settlementReference: settlement.settlementReference, transactionCount: input.transactions.length, matched, unresolved, grossAmount: gross.toString(), netAmount: net.toString(), status } });
      await this.outbox.publish(tx, { tenantId, eventType: 'SETTLEMENT_IMPORTED', aggregateType: 'Settlement', aggregateId: settlement.id, payload: { settlementId: settlement.id, settlementReference: settlement.settlementReference, matched, unresolved, status }, actorId, requestId: this.tenantContext.requestId });
      return { ...updated, matchedCount: matched, unresolvedCount: unresolved, alreadyImported: false };
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw AppError.conflict(ERROR_CODES.CONFLICT, 'This provider settlement reference has already been imported.');
      throw error;
    });
  }

  async resolveRecord(tenantId: string, id: string, input: z.infer<typeof resolutionSchema>) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.reconciliationRecord.findFirst({ where: { tenantId, id } });
      if (!current) throw AppError.notFound('Reconciliation record');
      if (!['OPEN', 'MISMATCHED'].includes(current.status)) throw AppError.conflict('RECONCILIATION_ALREADY_CLOSED', 'Only open or mismatched records can be resolved.');
      if (isCapturedPaymentMismatch(current.mismatchType)) {
        const gatewayTransaction = current.gatewayTransactionId
          ? await tx.gatewayTransaction.findFirst({ where: { tenantId, id: current.gatewayTransactionId }, select: { paymentId: true } })
          : null;
        const paymentId = current.paymentId ?? gatewayTransaction?.paymentId ?? null;
        const payment = paymentId
          ? await tx.payment.findFirst({
              where: { tenantId, id: paymentId, status: { in: ['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
              select: { id: true, currency: true },
            })
          : null;
        const ledgerEntry = payment
          ? await tx.ledgerEntry.findFirst({ where: { tenantId, paymentId: payment.id }, select: { id: true } })
          : null;
        if (!payment || !ledgerEntry) {
          throw AppError.conflict(
            'CAPTURE_NOT_ACCOUNTED',
            'A verified provider capture must be recorded as a payment with ledger evidence before this reconciliation record can be closed.',
          );
        }
        const systemAccounts = await this.ledger.resolveSystemAccounts(tx, tenantId);
        const suspenseAccountId = systemAccounts.get('UNAPPLIED_GATEWAY_RECEIPTS');
        if (suspenseAccountId) {
          const suspenseEntries = await tx.ledgerEntry.findMany({ where: { tenantId, paymentId: payment.id, accountId: suspenseAccountId }, select: { side: true, amount: true, currency: true } });
          let debits = Money.zero(payment.currency);
          let credits = Money.zero(payment.currency);
          for (const entry of suspenseEntries) {
            if (entry.currency !== payment.currency) throw AppError.conflict('CAPTURE_CURRENCY_LEDGER_MISMATCH', 'The capture liability ledger currency does not match the linked payment. Review the currency evidence before closing this record.');
            if (entry.side === 'DEBIT') debits = debits.add(Money.fromString(entry.amount.toString(), payment.currency));
            else credits = credits.add(Money.fromString(entry.amount.toString(), payment.currency));
          }
          if (!debits.equals(credits)) {
            throw AppError.conflict('CAPTURE_LIABILITY_UNRESOLVED', 'The captured amount is still held in unapplied gateway liability. Release it to a verified student credit or complete another audited accounting action before closing reconciliation.');
          }
        }
      }
      const updated = await tx.reconciliationRecord.update({ where: { tenantId_id: { tenantId, id } }, data: { status: input.status, resolution: input.resolution, resolvedBy: actorId ?? null, resolvedAt: new Date() } });
      await this.audit.record(tx, { tenantId, actorId, action: 'RECONCILIATION_RECORD_RESOLVED', entityType: 'ReconciliationRecord', entityId: id, before: { status: current.status }, after: { status: updated.status, resolution: input.resolution, settlementId: current.settlementId } });
      if (current.settlementId) await this.refreshSettlementStatus(tx, tenantId, current.settlementId);
      return updated;
    });
  }

  async releaseCaptureAsStudentCredit(tenantId: string, id: string, input: z.infer<typeof releaseCaptureSchema>) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const record = await tx.reconciliationRecord.findFirst({ where: { tenantId, id } });
      if (!record) throw AppError.notFound('Reconciliation record');
      if (!['OPEN', 'MISMATCHED'].includes(record.status) || !isCapturedPaymentMismatch(record.mismatchType)) throw AppError.conflict('CAPTURE_RELEASE_NOT_ALLOWED', 'Only an open captured-payment reconciliation record can be released as student credit.');
      const transaction = record.gatewayTransactionId ? await tx.gatewayTransaction.findFirst({ where: { tenantId, id: record.gatewayTransactionId }, select: { paymentId: true } }) : null;
      const paymentId = record.paymentId ?? transaction?.paymentId ?? null;
      if (!paymentId) throw AppError.conflict('CAPTURE_NOT_ACCOUNTED', 'This provider event has no confirmed payment to release. Confirm the captured amount and currency first.');
      const payment = await tx.payment.findFirst({ where: { tenantId, id: paymentId } });
      if (!payment || payment.channel !== 'ONLINE' || payment.status !== 'SUCCESS' || !payment.studentId) throw AppError.conflict('CAPTURE_CONTEXT_NOT_RELEASABLE', 'Only a successful online capture with a tenant student record can be assigned as student credit.');
      const existing = await tx.credit.findFirst({ where: { tenantId, paymentId: payment.id, source: 'GATEWAY_UNAPPLIED' } });
      if (existing) return { alreadyReleased: true, credit: existing };
      const amount = Money.fromString(payment.unallocatedAmount.toString(), payment.currency);
      if (!amount.isPositive || Money.fromString(payment.allocatedAmount.toString(), payment.currency).isZero || Money.fromString(payment.refundedAmount.toString(), payment.currency).isZero) {
        throw AppError.conflict('CAPTURE_BALANCE_NOT_RELEASABLE', 'The payment no longer has its full unapplied, unrefunded capture balance. Reconcile its existing allocations or refund first.');
      }
      const systemAccounts = await this.ledger.resolveSystemAccounts(tx, tenantId);
      const suspenseAccountId = systemAccounts.get('UNAPPLIED_GATEWAY_RECEIPTS');
      if (!suspenseAccountId) throw AppError.conflict('CAPTURE_LIABILITY_ACCOUNT_MISSING', 'The tenant unapplied gateway liability account is unavailable.');
      const suspenseEntries = await tx.ledgerEntry.findMany({ where: { tenantId, paymentId: payment.id, accountId: suspenseAccountId }, select: { side: true, amount: true, currency: true } });
      let debitBalance = Money.zero(payment.currency);
      let creditBalance = Money.zero(payment.currency);
      for (const entry of suspenseEntries) {
        if (entry.currency !== payment.currency) throw AppError.conflict('CAPTURE_CURRENCY_LEDGER_MISMATCH', 'The capture liability ledger currency does not match the linked payment.');
        if (entry.side === 'DEBIT') debitBalance = debitBalance.add(Money.fromString(entry.amount.toString(), payment.currency));
        else creditBalance = creditBalance.add(Money.fromString(entry.amount.toString(), payment.currency));
      }
      const remainingLiability = creditBalance.subtract(debitBalance);
      if (!remainingLiability.equals(amount)) throw AppError.conflict('CAPTURE_LIABILITY_MISMATCH', 'The payment balance does not equal its outstanding gateway liability. Review the ledger before assigning ownership.');
      const credit = await tx.credit.create({ data: { tenantId, branchId: payment.branchId, studentId: payment.studentId, source: 'GATEWAY_UNAPPLIED', status: 'AVAILABLE', currency: payment.currency, originalAmount: amount.toString(), allocatedAmount: '0', availableAmount: amount.toString(), paymentId: payment.id, reason: `Verified gateway capture assigned by finance operator: ${input.reason}`, createdBy: actorId ?? null } });
      const posted = await this.ledger.post(tx, { tenantId, branchId: payment.branchId, currency: payment.currency, eventType: 'GATEWAY_CAPTURE_RELEASED_TO_STUDENT_CREDIT', entryDate: new Date().toISOString().slice(0, 10), lines: [
        { accountKey: 'UNAPPLIED_GATEWAY_RECEIPTS', side: 'DEBIT', amount: amount.toString(), narration: `Release held provider capture · ${payment.paymentNumber}` },
        { accountKey: 'STUDENT_CREDIT', side: 'CREDIT', amount: amount.toString(), narration: `Operator-assigned student credit · ${payment.paymentNumber}` },
      ], studentId: payment.studentId, paymentId: payment.id, creditId: credit.id, narration: `Gateway capture release · ${payment.paymentNumber}`, createdBy: actorId ?? null });
      await this.audit.record(tx, { tenantId, actorId, action: 'GATEWAY_CAPTURE_RELEASED_TO_STUDENT_CREDIT', entityType: 'Payment', entityId: payment.id, before: { unallocatedAmount: payment.unallocatedAmount.toString(), reconciliationRecordId: record.id }, after: { creditId: credit.id, studentId: payment.studentId, amount: amount.toString(), currency: payment.currency, ledgerGroupId: posted.transactionGroupId }, reason: input.reason });
      await this.outbox.publish(tx, { tenantId, eventType: 'GATEWAY_CAPTURE_RELEASED_TO_STUDENT_CREDIT', aggregateType: 'Credit', aggregateId: credit.id, payload: { paymentId: payment.id, creditId: credit.id, studentId: payment.studentId, amount: amount.toString(), currency: payment.currency, reconciliationRecordId: record.id }, actorId, requestId: this.tenantContext.requestId });
      return { alreadyReleased: false, credit };
    });
  }

  private async refreshSettlementStatus(tx: TransactionClient, tenantId: string, settlementId: string) {
    const rows = await tx.reconciliationRecord.findMany({ where: { tenantId, settlementId }, select: { status: true } });
    const open = rows.filter((row) => row.status === 'OPEN' || row.status === 'MISMATCHED').length;
    const matched = rows.length - open;
    const status = open === 0 ? 'MATCHED' : matched > 0 ? 'PARTIALLY_MATCHED' : 'MISMATCHED';
    await tx.settlement.updateMany({ where: { tenantId, id: settlementId, status: { not: 'CLOSED' } }, data: { status, reconciledAt: open === 0 ? new Date() : null } });
  }

  private assertTenant(tenantId: string) { if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.'); }
}

@ApiTags('reconciliation and settlements')
@RequireModules('PAYMENTS')
@Controller('reconciliation')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}
  @Get('settlements') @RequirePermissions(PERMISSIONS.RECONCILIATION_READ) listSettlements(@CurrentTenant() tenant: string) { return this.settlements.listSettlements(tenant); }
  @Get('gateways') @RequirePermissions(PERMISSIONS.RECONCILIATION_READ) gateways(@CurrentTenant() tenant: string) { return this.settlements.listGatewayConfigs(tenant); }
  @Get('records') @RequirePermissions(PERMISSIONS.RECONCILIATION_READ) listRecords(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.settlements.listRecords(tenant, query); }
  @Post('settlements/import') @RequirePermissions(PERMISSIONS.SETTLEMENT_IMPORT) @UsePipes(new ZodValidationPipe(settlementImportSchema)) @ApiOperation({ summary: 'Import and match a tenant-scoped gateway settlement against captured transactions' }) import(@CurrentTenant() tenant: string, @Body() body: SettlementImportInput) { return this.settlements.importSettlement(tenant, body); }
  @Post('records/:id/release-capture-as-student-credit') @RequirePermissions(PERMISSIONS.RECONCILIATION_RUN) @UsePipes(new ZodValidationPipe(releaseCaptureSchema)) @ApiOperation({ summary: 'Release a fully accounted same-currency gateway capture to audited student credit after finance review' }) releaseCapture(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: z.infer<typeof releaseCaptureSchema>) { return this.settlements.releaseCaptureAsStudentCredit(tenant, id, body); }
  @Patch('records/:id') @RequirePermissions(PERMISSIONS.RECONCILIATION_RUN) @UsePipes(new ZodValidationPipe(resolutionSchema)) resolve(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: z.infer<typeof resolutionSchema>) { return this.settlements.resolveRecord(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [SettlementsController], providers: [SettlementsService, LedgerService], exports: [SettlementsService] })
export class SettlementsModule {}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw AppError.validation('Settlement date must be a valid calendar date.');
  return date;
}

function isCapturedPaymentMismatch(value: string | null): boolean {
  return value === 'SUCCESS_AFTER_FAILURE'
    || value === 'PAYMENT_AFTER_ORDER_EXPIRY'
    || value === 'GATEWAY_AMOUNT_MISMATCH'
    || value === 'GATEWAY_CURRENCY_MISMATCH'
    || value === 'GATEWAY_AMOUNT_MISSING'
    || value === 'GATEWAY_AMOUNT_INVALID'
    || value === 'PAYMENT_ALLOCATION_REQUIRES_REVIEW';
}
