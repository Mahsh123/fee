import { Body, Controller, Get, Injectable, Module, Param, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, PERMISSIONS } from '@fee/types';
import { AppError } from '../common/errors';
import { AuditService, OutboxService } from '../common/financial';
import { ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { NotificationDispatcher, WorkerCallbackGuard, WorkerNotificationCallbackController } from './notification-dispatcher';

const templateSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS), channel: z.enum(NOTIFICATION_CHANNELS), locale: z.string().trim().min(2).max(12),
  subject: z.string().trim().max(300).nullable().optional(), body: z.string().min(1).max(10000),
  variables: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]*$/)).max(100).default([]), active: z.boolean().default(true),
}).superRefine((input, context) => {
  if (input.channel === 'EMAIL' && !input.subject?.trim()) context.addIssue({ code: 'custom', path: ['subject'], message: 'Email templates need a subject.' });
});
type TemplateInput = z.infer<typeof templateSchema>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly tenantContext: TenantContextService) {}

  async listTemplates(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.db.notificationTemplate.findMany({ where: { tenantId }, orderBy: [{ event: 'asc' }, { channel: 'asc' }, { locale: 'asc' }] });
  }

  async listHistory(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const status = typeof raw.status === 'string' && ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED'].includes(raw.status) ? raw.status as 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'CANCELLED' : undefined;
    return this.prisma.db.notification.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, event: true, channel: true, status: true, recipientType: true, toAddress: true, subject: true, attemptCount: true, lastError: true, scheduledFor: true, sentAt: true, deliveredAt: true, createdAt: true, studentId: true, paymentId: true, demandId: true, receiptId: true } });
  }

  async saveTemplate(tenantId: string, input: TemplateInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const key = { tenantId, event: input.event, channel: input.channel, locale: input.locale };
      const before = await tx.notificationTemplate.findUnique({ where: { tenantId_event_channel_locale: key } });
      const row = await tx.notificationTemplate.upsert({
        where: { tenantId_event_channel_locale: key },
        create: { ...key, subject: input.subject ?? null, body: input.body, variables: input.variables, active: input.active },
        update: { subject: input.subject ?? null, body: input.body, variables: input.variables, active: input.active },
      });
      await this.audit.record(tx, { tenantId, actorId, action: before ? 'NOTIFICATION_TEMPLATE_UPDATED' : 'NOTIFICATION_TEMPLATE_CREATED', entityType: 'NotificationTemplate', entityId: row.id, before: before ? { active: before.active } : undefined, after: { event: row.event, channel: row.channel, locale: row.locale, active: row.active } });
      await this.outbox.publish(tx, { tenantId, eventType: before ? 'NOTIFICATION_TEMPLATE_UPDATED' : 'NOTIFICATION_TEMPLATE_CREATED', aggregateType: 'NotificationTemplate', aggregateId: row.id, payload: { templateId: row.id, event: row.event, channel: row.channel, locale: row.locale, active: row.active }, actorId, requestId: this.tenantContext.requestId });
      return row;
    });
  }

  async getHistoryItem(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    if (!isUuid(id)) throw AppError.validation('The notification ID must be a valid identifier.');
    const row = await this.prisma.db.notification.findFirst({ where: { tenantId, id } });
    if (!row) throw AppError.notFound('Notification');
    return row;
  }

  private assertTenant(tenantId: string) { if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.'); }
}

@ApiTags('notifications')
@RequireModules('NOTIFICATIONS')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get('templates') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) listTemplates(@CurrentTenant() tenant: string) { return this.notifications.listTemplates(tenant); }
  @Post('templates') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_UPDATE) @UsePipes(new ZodValidationPipe(templateSchema)) @ApiOperation({ summary: 'Create or update a tenant notification template' }) saveTemplate(@CurrentTenant() tenant: string, @Body() body: TemplateInput) { return this.notifications.saveTemplate(tenant, body); }
  @Get('history') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) listHistory(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.notifications.listHistory(tenant, query); }
  @Get('history/:id') @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ) historyItem(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.notifications.getHistoryItem(tenant, id); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [NotificationsController, WorkerNotificationCallbackController], providers: [NotificationsService, NotificationDispatcher, WorkerCallbackGuard], exports: [NotificationsService] })
export class NotificationsModule {}

function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
