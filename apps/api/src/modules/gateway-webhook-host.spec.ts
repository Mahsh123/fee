import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from '../common/tenancy';
import { GatewayWebhooksController } from './gateways';

describe('gateway webhook hostname binding', () => {
  const tenantHost = {
    kind: 'tenant' as const,
    hostname: 'school.localhost',
    baseDomain: 'localhost',
    tenantId: 'tenant-school',
    slug: 'school',
    name: 'School',
    status: 'ACTIVE' as const,
  };

  it('routes a signed provider event only through its resolved active tenant host', async () => {
    const receiveWebhook = vi.fn().mockResolvedValue({ accepted: true });
    const context = new TenantContextService();
    const controller = new GatewayWebhooksController({ receiveWebhook } as never, context);

    const result = await context.run({ requestId: 'req-1', tenantHost }, () =>
      controller.receive('school', 'gateway-config-1', { tenantHost } as never),
    );

    expect(result).toEqual({ accepted: true });
    expect(receiveWebhook).toHaveBeenCalledOnce();
    expect(receiveWebhook).toHaveBeenCalledWith('tenant-school', 'gateway-config-1', { tenantHost });
  });

  it.each([
    ['sibling tenant slug', { ...tenantHost, slug: 'other-school', tenantId: 'tenant-other' }],
    ['unknown hostname', { kind: 'unknown' as const, hostname: 'unknown.localhost', baseDomain: 'localhost', slug: 'unknown' }],
    ['platform subdomain', { kind: 'platform' as const, hostname: 'platform.localhost', baseDomain: 'localhost' }],
    ['suspended tenant', { ...tenantHost, status: 'SUSPENDED' as const }],
  ])('rejects %s before payment processing', async (_label, host) => {
    const receiveWebhook = vi.fn();
    const context = new TenantContextService();
    const controller = new GatewayWebhooksController({ receiveWebhook } as never, context);

    await expect(context.run({ requestId: 'req-2', tenantHost: host }, () =>
      controller.receive('school', 'gateway-config-1', { tenantHost: host } as never),
    )).rejects.toThrow();
    expect(receiveWebhook).not.toHaveBeenCalled();
  });
});
