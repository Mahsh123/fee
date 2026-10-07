import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../common/prisma.service';
import { envelopeInterceptor } from '../common/errors';
import { AppConfigService } from '../config/env';
import { HealthModule } from './health';

const ping = vi.fn<() => Promise<{ ok: boolean; latencyMs: number }>>();
interface HealthHttpResponse {
  success: boolean;
  data: {
    status: 'ready' | 'not_ready';
    checks: Array<{ name: string; status: 'up' | 'down' | 'degraded' }>;
  };
  requestId: string;
}

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: { ping } },
    {
      provide: AppConfigService,
      useValue: { redisUrl: 'redis://127.0.0.1:1', encryptionKey: 'e'.repeat(32) },
    },
  ],
  exports: [PrismaService, AppConfigService],
})
class HealthHttpTestDependenciesModule {}

@Module({
  imports: [HealthHttpTestDependenciesModule, HealthModule],
  providers: [{ provide: APP_INTERCEPTOR, useValue: envelopeInterceptor({ includeHints: false }) }],
})
class HealthHttpTestModule {}

describe('health readiness HTTP response', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HealthHttpTestModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports ready under the standard success envelope when Redis is degraded', async () => {
    ping.mockResolvedValue({ ok: true, latencyMs: 1 });
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json() as HealthHttpResponse;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { status: 'ready' } });
    expect(body.data.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'redis', status: 'degraded' })]));
  });

  it('reports not_ready under the envelope when the database is down', async () => {
    ping.mockResolvedValue({ ok: false, latencyMs: 1 });
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json() as HealthHttpResponse;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { status: 'not_ready' } });
  });
});
