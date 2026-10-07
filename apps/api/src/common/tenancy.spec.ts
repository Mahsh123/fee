import { describe, expect, it } from 'vitest';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from './errors';
import { RequestIdMiddleware } from './http';
import { TenantContextService } from './tenancy';

describe('TenantContextService', () => {
  it('keeps the request context available across awaited work', async () => {
    const context = new TenantContextService();

    await context.run(
      { requestId: 'request-123', isPlatformAdmin: false },
      async () => {
        await Promise.resolve();
        expect(context.peek()?.requestId).toBe('request-123');
      },
    );

    expect(context.peek()).toBeUndefined();
  });

  it('makes the verified tenant available to later async work', async () => {
    const context = new TenantContextService();

    await context.run(
      { requestId: 'request-456', isPlatformAdmin: false },
      async () => {
        context.establish({ tenantId: 'tenant-a', userId: 'user-a', isPlatformAdmin: false });
        await Promise.resolve();
        expect(context.requireTenantId()).toBe('tenant-a');
        expect(context.require().userId).toBe('user-a');
      },
    );

    expect(context.peek()).toBeUndefined();
  });

  it('fails closed when a tenant service runs outside an authenticated scope', () => {
    const context = new TenantContextService();
    expect(() => context.requireTenantId()).toThrow(/authenticated tenant context/i);
  });

  it('isolates tenant IDs across concurrent request scopes', async () => {
    const context = new TenantContextService();
    const resolveTenant = (tenantId: string) =>
      context.run(
        { requestId: `request-${tenantId}`, isPlatformAdmin: false },
        async () => {
          context.establish({ tenantId, isPlatformAdmin: false });
          await new Promise((resolve) => setTimeout(resolve, 0));
          return context.requireTenantId();
        },
      );

    await expect(Promise.all([resolveTenant('tenant-a'), resolveTenant('tenant-b')])).resolves.toEqual([
      'tenant-a',
      'tenant-b',
    ]);
  });

  it('keeps the middleware scope open while Express continues the request', async () => {
    const context = new TenantContextService();
    const middleware = new RequestIdMiddleware(context);
    const request = { headers: {} } as RequestWithContext;
    const response = { setHeader: () => undefined } as unknown as Response;
    const result = new Promise<string>((resolve, reject) => {
      middleware.use(request, response, (() => {
        setTimeout(() => {
          try {
            context.establish({ tenantId: 'tenant-from-token', isPlatformAdmin: false });
            resolve(context.requireTenantId());
          } catch (error) {
            reject(error);
          }
        }, 0);
      }) as NextFunction);
    });

    await expect(result).resolves.toBe('tenant-from-token');
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
