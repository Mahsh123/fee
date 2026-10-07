import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppConfigService } from '../config/env';
import { RequestIdMiddleware } from '../common/http';
import { TenantHostResolutionMiddleware } from '../common/tenant-host';
import { TenantContextService } from '../common/tenancy';
import { PrismaService } from '../common/prisma.service';
import { GlobalExceptionFilter } from '../common/errors';
import { GatewayWebhooksController, GatewaysService } from './gateways';

const tenantRows = new Map([
  ['school', { id: 'tenant-school', slug: 'school', name: 'School', status: 'ACTIVE' }],
  ['other', { id: 'tenant-other', slug: 'other', name: 'Other', status: 'ACTIVE' }],
  ['paused', { id: 'tenant-paused', slug: 'paused', name: 'Paused', status: 'SUSPENDED' }],
]);
const prisma = {
  db: { tenant: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => tenantRows.get(where.slug) ?? null) } },
};
const gatewayService = { receiveWebhook: vi.fn().mockResolvedValue({ accepted: true }) };

@Module({
  controllers: [GatewayWebhooksController],
  providers: [
    TenantContextService,
    { provide: APP_FILTER, useFactory: () => new GlobalExceptionFilter({ includeHints: false }) },
    { provide: GatewaysService, useValue: gatewayService },
    { provide: PrismaService, useValue: prisma },
    { provide: AppConfigService, useValue: { tenantBaseDomain: 'localhost' } },
    {
      provide: TenantHostResolutionMiddleware,
      useFactory: (database: PrismaService, config: AppConfigService, context: TenantContextService) =>
        new TenantHostResolutionMiddleware(database, config, context),
      inject: [PrismaService, AppConfigService, TenantContextService],
    },
  ],
})
class GatewayWebhookHttpTestModule {}

function sendWebhook(port: number, host: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: { host: `${host}:${port}`, connection: 'close', 'content-type': 'application/json' },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(3_000, () => request.destroy(new Error('Timed out waiting for the webhook response.')));
    request.on('error', reject);
    request.end('{}');
  });
}

describe('gateway webhook host routing over HTTP', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(GatewayWebhookHttpTestModule, { logger: false });
    const context = app.get(TenantContextService);
    const requestId = new RequestIdMiddleware(context);
    const host = app.get(TenantHostResolutionMiddleware);
    app.use((request: Request, response: Response, next: NextFunction) => requestId.use(request as never, response, next));
    app.use((request: Request, response: Response, next: NextFunction) => {
      void host.use(request as never, response, next).catch(next);
    });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => { await app?.close(); });

  it('routes a provider callback using the middleware-resolved tenant through the preserved URL', async () => {
    gatewayService.receiveWebhook.mockClear();
    const response = await sendWebhook(port, 'school.localhost', '/webhooks/school/gateway-1');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ accepted: true });
    expect(gatewayService.receiveWebhook).toHaveBeenCalledOnce();
    expect(gatewayService.receiveWebhook.mock.calls[0]?.[0]).toBe('tenant-school');
  });

  it.each([
    ['sibling host', 'other.localhost'],
    ['platform subdomain', 'platform.localhost'],
    ['apex', 'localhost'],
    ['unknown host', 'missing.localhost'],
    ['inactive tenant host', 'paused.localhost'],
  ])('rejects %s before invoking gateway payment processing', async (_name, host) => {
    gatewayService.receiveWebhook.mockClear();
    const response = await sendWebhook(port, host, '/webhooks/school/gateway-1');
    expect(response.status).toBe(404);
    expect(gatewayService.receiveWebhook).not.toHaveBeenCalled();
  });
});
