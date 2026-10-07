import { Body, Controller, ExecutionContext, HttpCode, Injectable, Logger, Post, UnauthorizedException, UseGuards, UsePipes, type CanActivate, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { isUniqueViolation } from '@fee/database';
import { NOTIFICATION_EVENTS, type NotificationEvent } from '@fee/types';
import { renderTemplate } from '@fee/notifications';
import { PrismaService } from '../common/prisma.service';
import { Public, TenantContextService, TenantOptional } from '../common/tenancy';
import { AppConfigService } from '../config/env';
import { ZodValidationPipe } from '../common/http';
import { AppError } from '../common/errors';
import { safeOperationalErrorCode } from '../common/diagnostics';

type OutboxRow = { id: string; tenantId: string; eventType: string; payload: unknown; attempts: number; aggregateId?: string | null };
type DeliveryJob = {
  tenantId: string; notificationId: string; to: string; subject?: string; body: string;
  from: string; fromName?: string;
};
const QUEUE_NAME = 'tenant-notifications';
const OUTBOX_CLAIM_LEASE_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deliveryResultSchema = z.object({
  tenantId: z.string().uuid(),
  notificationId: z.string().uuid(),
  attempt: z.number().int().min(1).max(1000),
  status: z.enum(['SENT', 'FAILED']),
  providerMessageId: z.string().max(255).optional(),
  errorCode: z.string().regex(/^[A-Z0-9_]{3,80}$/).optional(),
}).strict();
type DeliveryResult = z.infer<typeof deliveryResultSchema>;
const EVENT_MAP: Record<string, NotificationEvent | undefined> = {
  USER_INVITATION: 'USER_INVITATION',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  RECEIPT_GENERATED: 'RECEIPT_GENERATED',
  FEE_DEMAND_ISSUED: 'FEE_DUE',
  FEE_DUE: 'FEE_DUE',
  FEE_OVERDUE: 'FEE_OVERDUE',
  INSTALLMENT_DUE: 'INSTALLMENT_DUE',
  ADMISSION_PAYMENT_RECEIVED: 'ADMISSION_PAYMENT',
  REFUND_COMPLETED: 'REFUND',
  SCHOLARSHIP_APPLIED: 'SCHOLARSHIP_APPLIED',
};

/**
 * The API owns tenant-scoped outbox and reminder orchestration. The standalone
 * worker only receives rendered delivery jobs and has no database credential.
 */
@Injectable()
export class NotificationDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private redis?: IORedis;
  private queue?: Queue<DeliveryJob>;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private schedulingReminders = false;
  private readonly reminderRunDayByTenant = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit() {
    this.redis = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<DeliveryJob>(QUEUE_NAME, { connection: this.redis, prefix: this.config.queuePrefix });
    this.timer = setInterval(() => { void this.pollOutbox(); void this.scheduleReminders(); }, 3_000);
    this.timer.unref();
    await this.pollOutbox();
    await this.scheduleReminders();
    this.logger.log('Tenant-scoped notification outbox dispatcher started');
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.queue?.close();
    await this.redis?.quit();
  }

  private async activeTenantIds(): Promise<Array<{ id: string }>> {
    return this.tenantContext.run(
      { requestId: `notification-directory:${randomUUID()}`, isPlatformAdmin: true },
      async () => await this.prisma.db.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true } }),
    );
  }

  private runTenant<T>(tenantId: string, work: () => T): T {
    return this.tenantContext.run({ tenantId, requestId: `notification-job:${randomUUID()}` }, work);
  }

  async applyDeliveryResult(input: DeliveryResult) {
    return this.runTenant(input.tenantId, async () => {
      const changed = await this.prisma.db.notification.updateMany({
        where: {
          tenantId: input.tenantId,
          id: input.notificationId,
          channel: 'EMAIL',
          status: { in: ['QUEUED', 'FAILED'] },
          attemptCount: { lt: input.attempt },
        },
        data: input.status === 'SENT'
          ? { status: 'SENT', attemptCount: input.attempt, sentAt: new Date(), providerMessageId: input.providerMessageId ?? null, lastError: null }
          : { status: 'FAILED', attemptCount: input.attempt, lastError: input.errorCode ?? 'WORKER_OPERATION_FAILED' },
      });
      if (changed.count === 1) return { accepted: true };
      const current = await this.prisma.db.notification.findFirst({
        where: { tenantId: input.tenantId, id: input.notificationId, channel: 'EMAIL' },
        select: { status: true, attemptCount: true },
      });
      if (!current) throw AppError.notFound('Notification');
      if (current.attemptCount >= input.attempt || current.status === 'CANCELLED') return { accepted: true };
      throw AppError.conflict('NOTIFICATION_DELIVERY_STATE_CHANGED', 'The notification delivery state no longer accepts this result.');
    });
  }

  private async pollOutbox() {
    if (this.polling || !this.queue) return;
    this.polling = true;
    try {
      const tenants = await this.activeTenantIds();
      for (const tenant of tenants) {
        await this.runTenant(tenant.id, async () => {
          const pending = await this.prisma.db.outboxEvent.findMany({
            where: { tenantId: tenant.id, status: { in: ['PENDING', 'FAILED', 'PROCESSING'] }, attempts: { lt: this.config.queueMaxAttempts }, availableAt: { lte: new Date() } },
            orderBy: { createdAt: 'asc' }, take: 50,
          }) as OutboxRow[];
          for (const event of pending) await this.dispatchOutboxEvent(event);
        });
      }
    } catch (error) {
      this.logger.error({ error: safeErrorCode(error) }, 'Outbox poll failed');
    } finally { this.polling = false; }
  }

  /**
   * Materialize due, overdue, and installment reminders as tenant-scoped
   * outbox events. A per-tenant local-date marker avoids rescanning all open
   * demand on every poll; database dedupe keys make restart/multi-worker races
   * harmless and allow an interrupted run to resume.
   */
  private async scheduleReminders() {
    if (this.schedulingReminders) return;
    this.schedulingReminders = true;
    try {
      const tenants = await this.activeTenantIds();
      for (const tenant of tenants) {
        await this.runTenant(tenant.id, async () => {
          const settings = await this.prisma.db.tenantSettings.findUnique({
            where: { tenantId: tenant.id }, select: { timezone: true, reminderScheduleDays: true },
          });
          if (!settings) return;
          let today: string;
          try { today = localDateInZone(settings.timezone, new Date()); }
          catch { this.logger.warn({ tenantId: tenant.id }, 'Reminder scheduling skipped for an invalid tenant timezone'); return; }
          if (this.reminderRunDayByTenant.get(tenant.id) === today) return;
          try {
            await this.scheduleTenantReminders(tenant.id, today, settings.reminderScheduleDays);
            this.reminderRunDayByTenant.set(tenant.id, today);
          } catch (error) {
            this.logger.warn({ tenantId: tenant.id, error: safeErrorCode(error) }, 'Tenant reminder scheduling failed');
          }
        });
      }
    } catch (error) {
      this.logger.error({ error: safeErrorCode(error) }, 'Reminder scheduler failed');
    } finally { this.schedulingReminders = false; }
  }

  private async scheduleTenantReminders(tenantId: string, today: string, configuredDays: number[]) {
    const reminderDays = [...new Set(configuredDays.filter((days) => Number.isInteger(days) && days >= 0 && days <= 365))];
    const targetDates = new Map(reminderDays.map((days) => [addCalendarDays(today, days), days]));
    let demandCursor: string | undefined;
    while (true) {
      const demands = await this.prisma.db.feeDemand.findMany({
        where: { tenantId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lte: calendarDate(addCalendarDays(today, Math.max(0, ...reminderDays))) } },
        orderBy: { id: 'asc' }, take: 500,
        ...(demandCursor ? { cursor: { id: demandCursor }, skip: 1 } : {}),
        select: { id: true, studentId: true, demandNumber: true, dueDate: true, currency: true, netAmount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true },
      });
      if (!demands.length) break;
      for (const demand of demands) {
        const dueDate = demand.dueDate.toISOString().slice(0, 10);
        const outstanding = demand.netAmount.add(demand.adjustmentAmount).sub(demand.paidAmount).sub(demand.waivedAmount);
        if (outstanding.lte(0)) continue;
        const daysBefore = targetDates.get(dueDate);
        if (daysBefore !== undefined) {
          await this.writeReminderEvent(tenantId, {
            key: `fee-due:${demand.id}:${dueDate}:${daysBefore}`,
            eventType: 'FEE_DUE', aggregateType: 'FeeDemand', aggregateId: demand.id,
            payload: { demandId: demand.id, studentId: demand.studentId, demandNumber: demand.demandNumber, dueDate, currency: demand.currency, outstandingAmount: outstanding.toFixed(4), daysBeforeDue: daysBefore },
          });
        }
        if (dueDate < today) {
          await this.writeReminderEvent(tenantId, {
            key: `fee-overdue:${demand.id}:${dueDate}`,
            eventType: 'FEE_OVERDUE', aggregateType: 'FeeDemand', aggregateId: demand.id,
            payload: { demandId: demand.id, studentId: demand.studentId, demandNumber: demand.demandNumber, dueDate, currency: demand.currency, outstandingAmount: outstanding.toFixed(4) },
          });
        }
      }
      demandCursor = demands[demands.length - 1]!.id;
      if (demands.length < 500) break;
    }

    let installmentCursor: string | undefined;
    while (true) {
      const installments = await this.prisma.db.installment.findMany({
        where: { tenantId, status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lte: calendarDate(today) } },
        orderBy: { id: 'asc' }, take: 500,
        ...(installmentCursor ? { cursor: { id: installmentCursor }, skip: 1 } : {}),
        select: { id: true, demandId: true, label: true, sequence: true, dueDate: true, amount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true },
      });
      if (!installments.length) break;
      const demandRows = await this.prisma.db.feeDemand.findMany({
        where: { tenantId, id: { in: [...new Set(installments.map(({ demandId }) => demandId))] } },
        select: { id: true, studentId: true, demandNumber: true, currency: true },
      });
      const demandById = new Map(demandRows.map((demand) => [demand.id, demand]));
      for (const installment of installments) {
        const demand = demandById.get(installment.demandId);
        if (!demand) continue;
        const outstanding = installment.amount.add(installment.adjustmentAmount).sub(installment.paidAmount).sub(installment.waivedAmount);
        if (outstanding.lte(0)) continue;
        const dueDate = installment.dueDate.toISOString().slice(0, 10);
        await this.writeReminderEvent(tenantId, {
          key: `installment-due:${installment.id}:${dueDate}`,
          eventType: 'INSTALLMENT_DUE', aggregateType: 'Installment', aggregateId: installment.id,
          payload: { installmentId: installment.id, installmentLabel: installment.label, sequence: installment.sequence, dueDate, demandId: demand.id, demandNumber: demand.demandNumber, studentId: demand.studentId, currency: demand.currency, outstandingAmount: outstanding.toFixed(4) },
        });
      }
      installmentCursor = installments[installments.length - 1]!.id;
      if (installments.length < 500) break;
    }
  }

  private async writeReminderEvent(tenantId: string, event: { key: string; eventType: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }) {
    try {
      await this.prisma.db.outboxEvent.create({
        data: { id: randomUUID(), tenantId, eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, payload: event.payload as never, dedupeKey: event.key },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  private async dispatchOutboxEvent(event: OutboxRow) {
    const claimed = await this.prisma.db.outboxEvent.updateMany({
      where: { tenantId: event.tenantId, id: event.id, status: { in: ['PENDING', 'FAILED', 'PROCESSING'] }, attempts: event.attempts, availableAt: { lte: new Date() } },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null, availableAt: new Date(Date.now() + OUTBOX_CLAIM_LEASE_MS) },
    });
    if (claimed.count !== 1) return;
    try {
      await this.createNotifications(event);
      await this.prisma.db.outboxEvent.updateMany({ where: { tenantId: event.tenantId, id: event.id, status: 'PROCESSING' }, data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null } });
    } catch (error) {
      const attempt = event.attempts + 1;
      const backoff = Math.min(this.config.queueBackoffMs * (2 ** Math.min(attempt - 1, 10)), 3_600_000);
      await this.prisma.db.outboxEvent.updateMany({ where: { tenantId: event.tenantId, id: event.id, status: 'PROCESSING' }, data: { status: 'FAILED', lastError: safeErrorCode(error), availableAt: new Date(Date.now() + backoff) } });
      this.logger.warn({ tenantId: event.tenantId, eventId: event.id, attempt, error: safeErrorCode(error) }, 'Outbox event dispatch failed');
    }
  }

  private async createNotifications(event: OutboxRow) {
    if (event.eventType === 'USER_INVITATION') {
      await this.createInvitationNotification(event);
      return;
    }
    if (event.eventType === 'USER_EMAIL_VERIFICATION') {
      await this.createEmailVerificationNotification(event);
      return;
    }
    const notificationEvent = EVENT_MAP[event.eventType];
    if (!notificationEvent || !NOTIFICATION_EVENTS.includes(notificationEvent)) return;
    const payload = objectValue(event.payload);
    let studentId = stringValue(payload.studentId);
    const demandId = stringValue(payload.demandId);
    if (!studentId && demandId) {
      const demand = await this.prisma.db.feeDemand.findFirst({ where: { tenantId: event.tenantId, id: demandId }, select: { studentId: true } });
      studentId = demand?.studentId;
    }
    const paymentId = stringValue(payload.paymentId);
    if (!studentId && paymentId) {
      const payment = await this.prisma.db.payment.findFirst({ where: { tenantId: event.tenantId, id: paymentId }, select: { studentId: true } });
      studentId = payment?.studentId ?? undefined;
    }
    if (!studentId) return;
    const student = await this.prisma.db.student.findFirst({ where: { tenantId: event.tenantId, id: studentId, deletedAt: null }, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true, email: true } });
    if (!student) return;
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id: event.tenantId }, select: { name: true } });
    const settings = await this.prisma.db.tenantSettings.findUnique({ where: { tenantId: event.tenantId }, select: { locale: true } });
    const notificationSetting = await this.prisma.db.tenantNotificationSetting.findFirst({ where: { tenantId: event.tenantId, event: notificationEvent, channel: 'EMAIL' } });
    if (notificationSetting && !notificationSetting.enabled) return;
    let template = await this.prisma.db.notificationTemplate.findFirst({ where: { tenantId: event.tenantId, event: notificationEvent, channel: 'EMAIL', locale: settings?.locale ?? 'en', active: true } });
    if (!template && settings?.locale !== 'en') template = await this.prisma.db.notificationTemplate.findFirst({ where: { tenantId: event.tenantId, event: notificationEvent, channel: 'EMAIL', locale: 'en', active: true } });
    if (!template) return;

    const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId: event.tenantId, studentId: student.id }, select: { guardianId: true, isPrimaryPayer: true } });
    const guardians = links.length ? await this.prisma.db.guardian.findMany({
      where: { tenantId: event.tenantId, id: { in: links.map(({ guardianId }) => guardianId) } },
      select: { id: true, firstName: true, lastName: true, email: true, isPrimaryContact: true, deletedAt: true },
    }) : [];
    const guardianById = new Map(guardians.map((guardian) => [guardian.id, guardian]));
    const resolvedLinks = links.flatMap((link) => {
      const guardian = guardianById.get(link.guardianId);
      return guardian ? [{ isPrimaryPayer: link.isPrimaryPayer, guardian }] : [];
    });
    const primaryLinks = resolvedLinks.filter((link) => !link.guardian.deletedAt && link.guardian.email && (link.isPrimaryPayer || link.guardian.isPrimaryContact));
    const guardianLinks = primaryLinks.length ? primaryLinks : resolvedLinks.filter((link) => !link.guardian.deletedAt && link.guardian.email);
    const recipients = new Map<string, { address: string; type: string; id: string | null; name: string }>();
    if (student.email) recipients.set(student.email.toLowerCase(), { address: student.email, type: 'STUDENT', id: student.id, name: [student.firstName, student.lastName].filter(Boolean).join(' ') });
    for (const link of guardianLinks) {
      const email = link.guardian.email!;
      recipients.set(email.toLowerCase(), { address: email, type: 'GUARDIAN', id: link.guardian.id, name: [link.guardian.firstName, link.guardian.lastName].filter(Boolean).join(' ') });
    }
    if (!recipients.size) return;
    const baseValues = { tenant: { name: tenant?.name ?? 'Institution' }, student: { ...student, fullName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ') }, payment: payload, demand: payload, receipt: payload, refund: payload, event: payload };
    const receiptId = stringValue(payload.receiptId);
    for (const recipient of recipients.values()) {
      const values = { ...baseValues, recipient: { name: recipient.name, type: recipient.type } };
      const subject = template.subject ? renderTemplate(template.subject, values) : undefined;
      const body = renderTemplate(template.body, values);
      const dedupeKey = `${event.id}:${createHash('sha256').update(recipient.address.toLowerCase()).digest('hex').slice(0, 24)}`;
      const notification = await this.prisma.db.notification.upsert({
        where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
        create: { tenantId: event.tenantId, event: notificationEvent, channel: 'EMAIL', status: 'QUEUED', recipientType: recipient.type, recipientId: recipient.id, toAddress: recipient.address, subject, body, payload: event.payload as never, studentId: student.id, paymentId, demandId, receiptId, dedupeKey },
        update: {},
        select: { id: true, status: true },
      });
      if (notification.status === 'SENT' || notification.status === 'DELIVERED') continue;
      const mail = this.config.mail;
      await this.queue!.add('deliver-email', {
        tenantId: event.tenantId,
        notificationId: notification.id,
        to: recipient.address,
        subject,
        body,
        from: stringValue(notificationSetting?.fromAddress) ?? mail.from,
        ...(stringValue(notificationSetting?.fromName) ? { fromName: stringValue(notificationSetting?.fromName) } : {}),
      }, {
        jobId: notification.id, attempts: this.config.queueMaxAttempts,
        backoff: { type: 'exponential', delay: this.config.queueBackoffMs },
        removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 604_800, count: 10_000 },
      });
    }
  }

  private async createInvitationNotification(event: OutboxRow): Promise<void> {
    const payload = objectValue(event.payload);
    const userId = stringValue(payload.userId);
    const acceptUrl = stringValue(payload.acceptUrl);
    const expectedTokenHash = stringValue(payload.tokenHash);
    if (!userId || !acceptUrl || !expectedTokenHash || !event.aggregateId || event.aggregateId !== userId) return;
    const url = new URL(acceptUrl);
    const rawToken = url.hash.slice(1);
    if (!rawToken || createHash('sha256').update(rawToken).digest('hex') !== expectedTokenHash) return;
    const now = new Date();
    const user = await this.prisma.db.user.findFirst({
      where: { tenantId: event.tenantId, id: userId, status: 'INVITED', deletedAt: null, invitationTokenHash: expectedTokenHash, invitationExpiresAt: { gt: now } },
      select: { id: true, email: true, firstName: true, isPlatformAdmin: true },
    });
    if (!user) return;
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id: event.tenantId }, select: { name: true } });
    if (!tenant) return;
    const subject = user.isPlatformAdmin ? 'Platform administrator invitation' : `You are invited to join ${tenant.name}`;
    const body = [
      `Hello ${user.firstName},`,
      '',
      user.isPlatformAdmin
        ? 'You have been invited to administer the SaaS platform. Use the secure platform link below to accept the invitation and set your password:'
        : `You have been invited to join ${tenant.name}. Use the secure link below to accept the invitation and set your password:`,
      acceptUrl,
      '',
      'This link expires in 48 hours and can be used once. If you were not expecting this invitation, you can ignore this message.',
    ].join('\n');
    const dedupeKey = `${event.id}:${user.id}`;
    const notification = await this.prisma.db.notification.upsert({
      where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
      create: {
        tenantId: event.tenantId, event: 'USER_INVITATION', channel: 'EMAIL', status: 'QUEUED',
        recipientType: 'USER', recipientId: user.id, toAddress: user.email, subject, body,
        payload: { purpose: 'USER_INVITATION', userId: user.id }, dedupeKey,
      },
      update: {},
      select: { id: true, status: true },
    });
    if (notification.status === 'SENT' || notification.status === 'DELIVERED') return;
    const mail = this.config.mail;
    await this.queue!.add('deliver-email', {
      tenantId: event.tenantId, notificationId: notification.id, to: user.email,
      subject, body, from: mail.from,
    }, {
      jobId: notification.id, attempts: this.config.queueMaxAttempts,
      backoff: { type: 'exponential', delay: this.config.queueBackoffMs },
      removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 604_800, count: 10_000 },
    });
  }

  private async createEmailVerificationNotification(event: OutboxRow): Promise<void> {
    const payload = objectValue(event.payload);
    const userId = stringValue(payload.userId);
    const acceptUrl = stringValue(payload.acceptUrl);
    const expectedTokenHash = stringValue(payload.tokenHash);
    if (!userId || !acceptUrl || !expectedTokenHash || event.aggregateId !== userId) return;
    const url = new URL(acceptUrl);
    const rawToken = url.hash.slice(1);
    if (url.pathname !== '/verify-email-change' || !rawToken || createHash('sha256').update(rawToken).digest('hex') !== expectedTokenHash) return;
    const now = new Date();
    const user = await this.prisma.db.user.findFirst({
      where: { tenantId: event.tenantId, id: userId, status: 'ACTIVE', deletedAt: null, pendingEmail: { not: null }, emailChangeTokenHash: expectedTokenHash, emailChangeExpiresAt: { gt: now } },
      select: { id: true, firstName: true, pendingEmail: true },
    });
    if (!user?.pendingEmail) return;
    const subject = 'Verify your new email address';
    const body = [
      `Hello ${user.firstName},`,
      '',
      'Confirm this email address to update the sign-in address on your account. Your current email remains active until you verify this change.',
      acceptUrl,
      '',
      'This link expires in 30 minutes and can be used once. If you did not request this change, ignore this message; your account email will not change.',
    ].join('\n');
    const dedupeKey = `${event.id}:${user.id}`;
    const notification = await this.prisma.db.notification.upsert({
      where: { tenantId_dedupeKey: { tenantId: event.tenantId, dedupeKey } },
      create: {
        tenantId: event.tenantId, event: 'USER_EMAIL_VERIFICATION', channel: 'EMAIL', status: 'QUEUED',
        recipientType: 'USER', recipientId: user.id, toAddress: user.pendingEmail, subject, body,
        payload: { purpose: 'USER_EMAIL_VERIFICATION', userId: user.id }, dedupeKey,
      },
      update: {},
      select: { id: true, status: true },
    });
    if (notification.status === 'SENT' || notification.status === 'DELIVERED') return;
    const mail = this.config.mail;
    await this.queue!.add('deliver-email', {
      tenantId: event.tenantId, notificationId: notification.id, to: user.pendingEmail,
      subject, body, from: mail.from,
    }, {
      jobId: notification.id, attempts: this.config.queueMaxAttempts,
      backoff: { type: 'exponential', delay: this.config.queueBackoffMs },
      removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 604_800, count: 10_000 },
    });
  }

}

@Injectable()
export class WorkerCallbackGuard implements CanActivate, OnModuleDestroy {
  private readonly replayStore: IORedis;

  constructor(private readonly config: AppConfigService) {
    this.replayStore = new IORedis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const timestamp = singleHeader(request, 'x-fee-worker-timestamp');
    const nonce = singleHeader(request, 'x-fee-worker-nonce');
    const signature = singleHeader(request, 'x-fee-worker-signature');
    const rawBody = request.rawBody;
    const numericTimestamp = timestamp && /^\d{13}$/.test(timestamp) ? Number(timestamp) : NaN;
    if (!rawBody || !Number.isSafeInteger(numericTimestamp) || Math.abs(Date.now() - numericTimestamp) > 30_000 ||
        !nonce || !UUID_PATTERN.test(nonce) || !signature || !/^[0-9a-f]{64}$/i.test(signature)) {
      throw new UnauthorizedException();
    }
    const expected = createHmac('sha256', this.config.notificationWorkerHmacSecret)
      .update(`${timestamp}.${nonce}.`, 'utf8')
      .update(rawBody)
      .digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw new UnauthorizedException();

    const accepted = await this.replayStore.set(`fee:notification-callback:${nonce}`, '1', 'PX', 60_000, 'NX');
    if (accepted !== 'OK') throw new UnauthorizedException();
    return true;
  }

  async onModuleDestroy() {
    await this.replayStore.quit();
  }
}

@Controller('internal/notifications')
export class WorkerNotificationCallbackController {
  constructor(private readonly dispatcher: NotificationDispatcher) {}

  @Post('delivery-result')
  @Public()
  @TenantOptional()
  @HttpCode(200)
  @UseGuards(WorkerCallbackGuard)
  @UsePipes(new ZodValidationPipe(deliveryResultSchema))
  async deliveryResult(@Body() body: DeliveryResult) {
    return this.dispatcher.applyDeliveryResult(body);
  }
}

function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
function safeErrorCode(error: unknown): string { return safeOperationalErrorCode(error, 'WORKER_OPERATION_FAILED'); }
function singleHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
function addCalendarDays(value: string, days: number): string { const date = calendarDate(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function calendarDate(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function localDateInZone(timezone: string, value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get('year'); const month = get('month'); const day = get('day');
  if (!year || !month || !day) throw new Error('INVALID_TIMEZONE_DATE');
  return `${year}-${month}-${day}`;
}
