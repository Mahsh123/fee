import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';
import { type TransactionClient } from '@fee/database';
import { AuditService } from '../common/financial';
import { PrismaService } from '../common/prisma.service';
import { TenantContextService } from '../common/tenancy';
import { AppConfigService } from '../config/env';
import { safeOperationalErrorCode } from '../common/diagnostics';

const DAY_MS = 86_400_000;
const OPEN_INVOICE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAST_DUE'];

/**
 * Runs the SaaS subscription clock inside the API's verified tenant-scoped
 * database path. Database predicates make each transition safe to retry across
 * multiple API replicas.
 */
@Injectable()
export class PlatformSubscriptionLifecycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformSubscriptionLifecycleScheduler.name);
  private timer?: NodeJS.Timeout;
  private activeRun?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit() {
    if (this.config.isTest) return;
    this.timer = setInterval(() => { void this.run(); }, this.config.platformSubscriptionLifecycle.pollIntervalMs);
    this.timer.unref();
    void this.run();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.activeRun;
  }

  /** Exposed for deterministic integration and unit tests. */
  async reconcileTenant(tenantId: string, now = new Date()): Promise<void> {
    await this.tenantContext.run({ tenantId, roles: ['SYSTEM'], requestId: `subscription-lifecycle:${randomUUID()}`, isPlatformAdmin: false }, async () => {
      await this.prisma.transactionWithRetry(async (tx) => {
        const subscriptions = await tx.tenantSubscription.findMany({
          where: { tenantId, isCurrent: true, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
          select: {
            id: true, tenantId: true, status: true, billingInterval: true, amount: true, currency: true,
            trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, isCurrent: true,
            plan: { select: { id: true, key: true, name: true } },
          },
        });

        for (const subscription of subscriptions) {
          if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) {
            const changed = await tx.tenantSubscription.updateMany({
              where: { tenantId, id: subscription.id, isCurrent: true, cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now } },
              data: { status: 'CANCELLED', isCurrent: false, cancelledAt: now, cancelAtPeriodEnd: false },
            });
            if (changed.count) {
              await tx.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED', subscriptionStatus: 'CANCELLED' } });
              await this.recordSystemAudit(tx, tenantId, 'platform.subscription.cancelled_at_period_end', 'TenantSubscription', subscription.id, { status: subscription.status }, { status: 'CANCELLED' });
            }
            continue;
          }

          if (subscription.status === 'TRIAL' && subscription.trialEndsAt && subscription.trialEndsAt <= now) {
            const changed = await tx.tenantSubscription.updateMany({
              where: { tenantId, id: subscription.id, isCurrent: true, status: 'TRIAL', trialEndsAt: { lte: now } },
              data: { status: 'EXPIRED', isCurrent: false },
            });
            if (changed.count) {
              await tx.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED', subscriptionStatus: 'EXPIRED' } });
              await this.recordSystemAudit(tx, tenantId, 'platform.subscription.trial_expired', 'TenantSubscription', subscription.id, { status: 'TRIAL' }, { status: 'EXPIRED' });
            }
            continue;
          }

          if (subscription.status === 'ACTIVE' && subscription.billingInterval !== 'MANUAL' && subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) {
            const outstanding = await tx.platformInvoice.findFirst({
              where: { tenantId, subscriptionId: subscription.id, status: { in: OPEN_INVOICE_STATUSES } },
              select: { id: true },
            });
            if (!outstanding) {
              const periodStart = subscription.currentPeriodEnd;
              const periodFinish = nextBillingPeriod(periodStart, subscription.billingInterval);
              const periodKey = periodStart.toISOString().slice(0, 10).replaceAll('-', '');
              const invoiceNumber = `SAAS-${subscription.id}-${periodKey}`;
              const invoice = await tx.platformInvoice.create({
                data: {
                  tenantId,
                  subscriptionId: subscription.id,
                  invoiceNumber,
                  status: 'OPEN',
                  currency: subscription.currency,
                  subtotal: subscription.amount,
                  tax: 0,
                  total: subscription.amount,
                  dueAt: new Date(now.getTime() + this.config.platformSubscriptionLifecycle.invoiceDueDays * DAY_MS),
                  lineSnapshot: {
                    description: `${subscription.plan.name} subscription renewal`,
                    planId: subscription.plan.id,
                    planKey: subscription.plan.key,
                    planName: subscription.plan.name,
                    billingInterval: subscription.billingInterval,
                    periodStart: periodStart.toISOString(),
                    periodEnd: periodFinish.toISOString(),
                    unitAmount: subscription.amount.toString(),
                    tax: '0.0000',
                    total: subscription.amount.toString(),
                  },
                },
              });
              await this.recordSystemAudit(tx, tenantId, 'platform.invoice.renewal_issued', 'PlatformInvoice', invoice.id, undefined, {
                subscriptionId: subscription.id, invoiceNumber, dueAt: invoice.dueAt.toISOString(), periodStart: periodStart.toISOString(), periodEnd: periodFinish.toISOString(),
              });
            }
          }
        }

        const newlyOverdue = await tx.platformInvoice.findMany({
          where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_PAID'] }, dueAt: { lte: now } },
          select: { id: true, subscriptionId: true },
          take: 100,
        });
        for (const invoice of newlyOverdue) {
          const changed = await tx.platformInvoice.updateMany({
            where: { tenantId, id: invoice.id, status: { in: ['OPEN', 'PARTIALLY_PAID'] }, dueAt: { lte: now } },
            data: { status: 'PAST_DUE' },
          });
          if (!changed.count) continue;
          const subscription = await tx.tenantSubscription.updateMany({
            where: { tenantId, id: invoice.subscriptionId, isCurrent: true, status: 'ACTIVE' },
            data: { status: 'PAST_DUE' },
          });
          if (subscription.count) await tx.tenant.update({ where: { id: tenantId }, data: { subscriptionStatus: 'PAST_DUE' } });
          await this.recordSystemAudit(tx, tenantId, 'platform.invoice.past_due', 'PlatformInvoice', invoice.id, { status: 'OPEN_OR_PARTIALLY_PAID' }, { status: 'PAST_DUE' });
        }

        const graceCutoff = new Date(now.getTime() - this.config.platformSubscriptionLifecycle.graceDays * DAY_MS);
        // Keep each root query tenant-scoped and scalar-only. The scoped Prisma
        // boundary intentionally rejects relational filters whose tenant
        // ownership cannot be proven from generated runtime metadata.
        const pastDueSubscriptions = await tx.tenantSubscription.findMany({
          where: { tenantId, isCurrent: true, status: 'PAST_DUE' },
          select: { id: true },
        });
        const graceExpired = pastDueSubscriptions.length
          ? await tx.platformInvoice.findMany({
              where: {
                tenantId,
                subscriptionId: { in: pastDueSubscriptions.map(({ id }) => id) },
                status: 'PAST_DUE',
                dueAt: { lte: graceCutoff },
              },
              select: { id: true, subscriptionId: true },
              take: 100,
            })
          : [];
        for (const invoice of graceExpired) {
          const changed = await tx.tenant.updateMany({ where: { id: tenantId, status: 'ACTIVE' }, data: { status: 'SUSPENDED', subscriptionStatus: 'PAST_DUE' } });
          if (changed.count) {
            await this.recordSystemAudit(tx, tenantId, 'platform.tenant.suspended_for_nonpayment', 'TenantSubscription', invoice.subscriptionId, { tenantStatus: 'ACTIVE' }, { tenantStatus: 'SUSPENDED', invoiceId: invoice.id }, 'WARN');
          }
          break;
        }
      });
    });
  }

  private run(): Promise<void> {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.scan().catch((error: unknown) => {
      this.logger.error({ error: safeLifecycleError(error) }, 'Platform subscription lifecycle scan failed');
    }).finally(() => { this.activeRun = undefined; });
    return this.activeRun;
  }

  private async scan() {
    const tenants = await this.tenantContext.run(
      { requestId: `subscription-lifecycle-directory:${randomUUID()}`, isPlatformAdmin: true },
      async () => await this.prisma.db.tenant.findMany({
        where: { slug: { not: PLATFORM_SYSTEM_TENANT_SLUG }, status: { in: ['ACTIVE', 'TRIAL', 'SUSPENDED'] } },
        select: { id: true },
      }),
    );
    for (const tenant of tenants) {
      try {
        await this.reconcileTenant(tenant.id);
      } catch (error) {
        this.logger.warn({ tenantId: tenant.id, error: safeLifecycleError(error) }, 'Tenant subscription lifecycle reconciliation failed');
      }
    }
  }

  private recordSystemAudit(
    tx: TransactionClient,
    tenantId: string,
    action: string,
    entityType: string,
    entityId: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
    severity: 'INFO' | 'WARN' = 'INFO',
  ) {
    return this.audit.record(tx, { tenantId, actorType: 'SYSTEM', action, entityType, entityId, before, after, severity });
  }
}

function nextBillingPeriod(start: Date, interval: 'MONTHLY' | 'YEARLY' | 'MANUAL' | string): Date {
  const months = interval === 'YEARLY' ? 12 : 1;
  const year = start.getUTCFullYear();
  const targetMonth = start.getUTCMonth() + months;
  const normalizedYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const lastDay = new Date(Date.UTC(normalizedYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(normalizedYear, normalizedMonth, Math.min(start.getUTCDate(), lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

function safeLifecycleError(error: unknown): string {
  return safeOperationalErrorCode(error, 'SUBSCRIPTION_LIFECYCLE_FAILED');
}
