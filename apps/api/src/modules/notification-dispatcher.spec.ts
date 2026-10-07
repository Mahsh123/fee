import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { NotificationDispatcher } from './notification-dispatcher';

describe('tenant invitation email dispatch', () => {
  it('keeps trial workspaces in the outbox delivery poll', async () => {
    const context = new TenantContextService();
    let platformContextSeen = false;
    const tenantFindMany = vi.fn(() => ({
      then(resolve: (rows: Array<{ id: string }>) => unknown, reject?: (reason: unknown) => unknown) {
        platformContextSeen = Boolean(context.peek()?.isPlatformAdmin);
        return (platformContextSeen ? Promise.resolve([{ id: 'trial-tenant' }]) : Promise.reject(new Error('missing platform context')))
          .then(resolve, reject);
      },
    }));
    const dispatcher = new NotificationDispatcher(
      { db: { tenant: { findMany: tenantFindMany } } } as never,
      context, {} as never,
    ) as unknown as { activeTenantIds: () => Promise<Array<{ id: string }>> };

    await expect(dispatcher.activeTenantIds()).resolves.toEqual([{ id: 'trial-tenant' }]);
    expect(platformContextSeen).toBe(true);
    expect(tenantFindMany).toHaveBeenCalledWith({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { id: true } });
  });

  it('queues mail only for the current, unexpired tenant invitation', async () => {
    const token = 'single-use-invitation-token-value';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const userFindFirst = vi.fn(async () => ({ id: 'user-a', email: 'invitee@example.test', firstName: 'Asha' }));
    const notificationUpsert = vi.fn(async () => ({ id: 'notification-a', status: 'QUEUED' }));
    const queueAdd = vi.fn(async () => ({}));
    const dispatcher = new NotificationDispatcher(
      { db: {
        user: { findFirst: userFindFirst },
        tenant: { findUnique: vi.fn(async () => ({ name: 'Cedar Club' })) },
        notification: { upsert: notificationUpsert },
      } } as never,
      new TenantContextService(),
      { mail: { from: 'noreply@example.test' }, queueMaxAttempts: 4, queueBackoffMs: 250 } as never,
    ) as unknown as {
      createInvitationNotification: (event: { id: string; tenantId: string; eventType: string; aggregateId: string; attempts: number; payload: unknown }) => Promise<void>;
      queue: { add: typeof queueAdd };
    };
    dispatcher.queue = { add: queueAdd };

    await dispatcher.createInvitationNotification({
      id: 'outbox-a', tenantId: 'tenant-a', eventType: 'USER_INVITATION', aggregateId: 'user-a', attempts: 0,
      payload: { userId: 'user-a', tokenHash, acceptUrl: `https://cedar.example.test/accept-invitation#${token}` },
    });

    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a', id: 'user-a', status: 'INVITED', invitationTokenHash: tokenHash, invitationExpiresAt: { gt: expect.any(Date) } }) }));
    expect(notificationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenantId: 'tenant-a', event: 'USER_INVITATION', recipientId: 'user-a', toAddress: 'invitee@example.test' }),
    }));
    expect(queueAdd).toHaveBeenCalledWith('deliver-email', expect.objectContaining({
      tenantId: 'tenant-a', to: 'invitee@example.test', subject: 'You are invited to join Cedar Club',
      body: expect.stringContaining(`https://cedar.example.test/accept-invitation#${token}`),
    }), expect.objectContaining({ jobId: 'notification-a', attempts: 4 }));
  });

  it('skips a rotated or accepted invitation before mail is queued', async () => {
    const token = 'outdated-invitation-token-value';
    const queueAdd = vi.fn();
    const notificationUpsert = vi.fn();
    const dispatcher = new NotificationDispatcher(
      { db: { user: { findFirst: vi.fn(async () => null) }, tenant: { findUnique: vi.fn() }, notification: { upsert: notificationUpsert } } } as never,
      new TenantContextService(), { mail: { from: 'noreply@example.test' }, queueMaxAttempts: 4, queueBackoffMs: 250 } as never,
    ) as unknown as {
      createInvitationNotification: (event: { id: string; tenantId: string; eventType: string; aggregateId: string; attempts: number; payload: unknown }) => Promise<void>;
      queue: { add: typeof queueAdd };
    };
    dispatcher.queue = { add: queueAdd };

    await dispatcher.createInvitationNotification({
      id: 'outbox-stale', tenantId: 'tenant-a', eventType: 'USER_INVITATION', aggregateId: 'user-a', attempts: 0,
      payload: { userId: 'user-a', tokenHash: createHash('sha256').update(token).digest('hex'), acceptUrl: `https://cedar.example.test/accept-invitation#${token}` },
    });

    expect(notificationUpsert).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('sends a verified email-change link only to the pending address', async () => {
    const token = 'email-change-verification-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const userFindFirst = vi.fn(async () => ({ id: 'user-a', firstName: 'Asha', pendingEmail: 'new@example.test' }));
    const notificationUpsert = vi.fn(async () => ({ id: 'notification-email-change', status: 'QUEUED' }));
    const queueAdd = vi.fn(async () => ({}));
    const dispatcher = new NotificationDispatcher(
      { db: { user: { findFirst: userFindFirst }, notification: { upsert: notificationUpsert } } } as never,
      new TenantContextService(), { mail: { from: 'noreply@example.test' }, queueMaxAttempts: 4, queueBackoffMs: 250 } as never,
    ) as unknown as {
      createEmailVerificationNotification: (event: { id: string; tenantId: string; eventType: string; aggregateId: string; attempts: number; payload: unknown }) => Promise<void>;
      queue: { add: typeof queueAdd };
    };
    dispatcher.queue = { add: queueAdd };

    await dispatcher.createEmailVerificationNotification({
      id: 'outbox-email-change', tenantId: 'tenant-a', eventType: 'USER_EMAIL_VERIFICATION', aggregateId: 'user-a', attempts: 0,
      payload: { userId: 'user-a', tokenHash, acceptUrl: `https://north.example.test/verify-email-change#${token}` },
    });

    expect(notificationUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ event: 'USER_EMAIL_VERIFICATION', toAddress: 'new@example.test' }) }));
    expect(queueAdd).toHaveBeenCalledWith('deliver-email', expect.objectContaining({ to: 'new@example.test', subject: 'Verify your new email address' }), expect.any(Object));
  });
});
