import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { JwtAuthGuard } from './security';
import { RequestIdMiddleware } from './http';
import { TenantContextService, Public } from './tenancy';
import { TenantHostResolutionMiddleware } from './tenant-host';
import { AppConfigService } from '../config/env';
import { PrismaService } from './prisma.service';
import { GlobalExceptionFilter } from './errors';

const calls: Array<string | null> = [];
const tokenVerifier = {
  async verifyAccessToken(token: string) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (token === 'tenant-a-token') {
      return { sub: 'user-a', tid: 'tenant-a', email: 'a@example.test', roles: [], perms: [], platform: false, typ: 'access' as const };
    }
    if (token === 'tenant-b-token') {
      return { sub: 'user-b', tid: 'tenant-b', email: 'b@example.test', roles: [], perms: [], platform: false, typ: 'access' as const };
    }
    if (token === 'platform-token') {
      return { sub: 'platform-user', tid: 'platform', email: 'admin@example.test', roles: [], perms: [], platform: true, typ: 'access' as const };
    }
    throw new Error('invalid token');
  },
};

@Controller('tenant-probe')
class TenantProbeController {
  constructor(private readonly tenantContext: TenantContextService) {}

  @Get('scope')
  async scope() {
    await Promise.resolve();
    const tenantId = this.tenantContext.requireTenantId();
    calls.push(tenantId);
    return { tenantId };
  }

  @Public()
  @Get('public')
  publicScope() {
    const tenantId = this.tenantContext.tenantId ?? null;
    calls.push(tenantId);
    return { tenantId };
  }

  @Public()
  @Get('host')
  resolvedHost() {
    const host = this.tenantContext.peek()?.tenantHost;
    return { kind: host?.kind ?? null, slug: host?.kind === 'tenant' ? host.slug : null };
  }
}

const directory = new Map([
  ['tenant-a', { id: 'tenant-a', slug: 'tenant-a', name: 'Tenant A', status: 'ACTIVE' }],
  ['tenant-b', { id: 'tenant-b', slug: 'tenant-b', name: 'Tenant B', status: 'ACTIVE' }],
  ['tenant-inactive', { id: 'tenant-inactive', slug: 'tenant-inactive', name: 'Inactive Tenant', status: 'SUSPENDED' }],
  ['fee-platform', { id: 'platform', slug: 'fee-platform', name: 'Fee Platform', status: 'ACTIVE' }],
]);
const testPrisma = {
  db: {
    userBranchMembership: { async findMany() { return []; } },
    tenant: {
      async findUnique({ where }: { where: { slug: string } }) {
        return directory.get(where.slug) ?? null;
      },
      async findFirst({ where }: { where: { domains?: { some?: { domain?: string; verifiedAt?: { not?: null } } } } }) {
        const domain = where.domains?.some?.domain;
        return domain === 'portal.customer.test' ? directory.get('tenant-a') ?? null : null;
      },
    },
  },
};

@Module({
  controllers: [TenantProbeController],
  providers: [
    TenantContextService,
    { provide: APP_FILTER, useFactory: () => new GlobalExceptionFilter({ includeHints: false }) },
    {
      provide: RequestIdMiddleware,
      useFactory: (context: TenantContextService) => new RequestIdMiddleware(context),
      inject: [TenantContextService],
    },
      {
        provide: APP_GUARD,
        useFactory: (reflector: Reflector, context: TenantContextService) =>
        new JwtAuthGuard(reflector, tokenVerifier as never, context, testPrisma as never),
        inject: [Reflector, TenantContextService],
      },
      { provide: PrismaService, useValue: testPrisma },
      { provide: AppConfigService, useValue: { tenantBaseDomain: 'localhost' } },
      {
        provide: TenantHostResolutionMiddleware,
        useFactory: (prisma: PrismaService, config: AppConfigService, context: TenantContextService) =>
          new TenantHostResolutionMiddleware(prisma, config, context),
        inject: [PrismaService, AppConfigService, TenantContextService],
      },
    ],
  })
class TenantHttpTestModule {}

function sendRequest(port: number, host: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1', port, path, method: 'GET',
      headers: { host: `${host}:${port}`, connection: 'close', ...headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(3_000, () => request.destroy(new Error('Timed out waiting for the HTTP response.')));
    request.on('error', reject);
    request.end();
  });
}

function sendDuplicateTenantHeaders(port: number, tenantIds: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const headerLines = tenantIds.map((tenantId) => `X-Tenant-Id: ${tenantId}`).join('\r\n');
      socket.write(
        [
          'GET /tenant-probe/scope HTTP/1.1',
          `Host: tenant-a.localhost:${port}`,
          'Authorization: Bearer tenant-a-token',
          headerLines,
          'Connection: close',
          '',
          '',
        ].join('\r\n'),
      );
    });
    socket.setTimeout(3_000, () => socket.destroy(new Error('Timed out waiting for the HTTP response.')));

    let responseHead = '';
    socket.on('data', (chunk) => {
      responseHead += chunk.toString();
      const lineEnd = responseHead.indexOf('\r\n');
      if (lineEnd < 0) return;
      const firstLine = responseHead.slice(0, lineEnd);
      const status = Number(firstLine.split(' ')[1]);
      if (Number.isFinite(status)) {
        socket.end();
        resolve(status);
      }
    });
    socket.on('error', reject);
  });
}

describe('tenant context over HTTP', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    app = await NestFactory.create(TenantHttpTestModule, { logger: false });
    const middleware = app.get(RequestIdMiddleware);
    app.use((request: Request, response: Response, next: NextFunction) =>
      middleware.use(request as never, response, next),
    );
    const hostMiddleware = app.get(TenantHostResolutionMiddleware);
    app.use((request: Request, response: Response, next: NextFunction) => {
      void hostMiddleware.use(request as never, response, next).catch(next);
    });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    port = address.port;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves the actual HTTP Host and binds a request to the signed tenant', async () => {
    const absent = await sendRequest(port, 'tenant-a.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token' });
    expect(absent.status, absent.body).toBe(200);
    expect(JSON.parse(absent.body)).toMatchObject({ tenantId: 'tenant-a' });

    const matching = await sendRequest(port, 'tenant-b.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-b-token', 'x-tenant-id': 'tenant-b' });
    expect(matching.status).toBe(200);
    expect(JSON.parse(matching.body)).toMatchObject({ tenantId: 'tenant-b' });

    const sibling = await sendRequest(port, 'tenant-b.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token' });
    expect(sibling.status).toBe(403);
  });

  it('rejects conflicting and repeated tenant headers before the handler runs', async () => {
    const before = calls.length;
    const conflicting = await sendRequest(port, 'tenant-a.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token', 'x-tenant-id': 'tenant-b' });
    expect(conflicting.status).toBe(403);

    const repeatedIdentical = await sendDuplicateTenantHeaders(port, ['tenant-a', 'tenant-a']);
    expect(repeatedIdentical).toBe(403);
    const repeatedConflicting = await sendDuplicateTenantHeaders(port, ['tenant-a', 'tenant-b']);
    expect(repeatedConflicting).toBe(403);
    expect(calls).toHaveLength(before);
  });

  it('resolves the platform subdomain, apex, unknown, and inactive hosts before guards', async () => {
    const publicResponse = await sendRequest(port, 'tenant-a.localhost', '/tenant-probe/public', { authorization: 'Bearer tenant-a-token' });
    expect(publicResponse.status).toBe(200);
    expect(JSON.parse(publicResponse.body)).toMatchObject({ tenantId: null });

    const platform = await sendRequest(port, 'platform.localhost', '/tenant-probe/host', { authorization: 'Bearer platform-token' });
    expect(platform.status).toBe(200);
    expect(JSON.parse(platform.body)).toMatchObject({ kind: 'platform', slug: null });

    const apex = await sendRequest(port, 'localhost', '/tenant-probe/host');
    expect(apex.status).toBe(200);
    expect(JSON.parse(apex.body)).toMatchObject({ kind: 'unknown', slug: null });
    const protectedApex = await sendRequest(port, 'localhost', '/tenant-probe/scope', { authorization: 'Bearer platform-token' });
    expect(protectedApex.status).toBe(401);

    const unknown = await sendRequest(port, 'unknown.localhost', '/tenant-probe/host');
    expect(unknown.status).toBe(200);
    expect(JSON.parse(unknown.body)).toMatchObject({ kind: 'unknown', slug: null });
    const unknownProtected = await sendRequest(port, 'unknown.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token' });
    expect(unknownProtected.status).toBe(404);

    const inactive = await sendRequest(port, 'tenant-inactive.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token' });
    expect(inactive.status).toBe(403);

    const before = calls.length;
    const missing = await sendRequest(port, 'tenant-a.localhost', '/tenant-probe/scope');
    expect(missing.status).toBe(401);
    const invalid = await sendRequest(port, 'tenant-a.localhost', '/tenant-probe/scope', { authorization: 'Bearer invalid-token' });
    expect(invalid.status).toBe(401);
    expect(calls).toHaveLength(before);
  });

  it('routes a custom hostname only when the directory returns a verified domain mapping', async () => {
    const verified = await sendRequest(port, 'portal.customer.test', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token' });
    expect(verified.status).toBe(200);
    expect(JSON.parse(verified.body)).toMatchObject({ tenantId: 'tenant-a' });

    const pending = await sendRequest(port, 'pending.customer.test', '/tenant-probe/host');
    expect(pending.status).toBe(200);
    expect(JSON.parse(pending.body)).toMatchObject({ kind: 'unknown', slug: null });
  });

  it('keeps concurrent HTTP requests isolated by tenant', async () => {
    const responses = await Promise.all([
      sendRequest(port, 'tenant-a.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-a-token' }),
      sendRequest(port, 'tenant-b.localhost', '/tenant-probe/scope', { authorization: 'Bearer tenant-b-token' }),
    ]);
    const bodies = responses.map((response) => JSON.parse(response.body) as { tenantId: string });
    expect(bodies.map((body) => body.tenantId)).toEqual(['tenant-a', 'tenant-b']);
  });
});
