import { Controller, Get, Header, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, TenantOptional } from '../common/tenancy';
import { PrismaService } from '../common/prisma.service';
import { AppConfigService } from '../config/env';

/**
 * Health checks.
 *
 * Three distinct questions, because a container orchestrator needs to tell them
 * apart:
 *
 *   /health        a human-readable summary
 *   /health/live   is the process alive? Never checks dependencies, or a
 *                  database blip would restart every instance at once
 *   /health/ready  should this instance receive traffic? Checks dependencies, and
 *                  reports *why* it is not ready
 */

interface CheckResult {
  name: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs?: number;
  detail?: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  @Public()
  @TenantOptional()
  @ApiOperation({ summary: 'Overall health with dependency detail' })
  async summary(): Promise<{
    status: 'ok' | 'degraded' | 'down';
    uptimeSeconds: number;
    version: string;
    environment: string;
    checks: CheckResult[];
  }> {
    const checks = await this.runChecks();
    const status = deriveStatus(checks);
    return {
      status,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      version: '1.0.0',
      environment: this.config.nodeEnv,
      checks,
    };
  }

  @Get('live')
  @Public()
  @TenantOptional()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Liveness: is the process running' })
  live(): { status: 'ok'; uptimeSeconds: number } {
    // Deliberately dependency-free: a database outage must not cause the
    // orchestrator to kill healthy processes.
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000) };
  }

  @Get('ready')
  @Public()
  @TenantOptional()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Readiness: can this instance serve traffic' })
  async ready(): Promise<{ status: 'ready' | 'not_ready'; checks: CheckResult[] }> {
    const checks = await this.runChecks();
    // Degraded optional services such as Redis must remain visible without
    // removing API instances from service when payment writes remain available.
    const ready = checks.every((check) => check.status !== 'down');
    return { status: ready ? 'ready' : 'not_ready', checks };
  }

  private async runChecks(): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];
    const database = await this.prisma.ping();
    checks.push({
      name: 'database',
      status: database.ok ? 'up' : 'down',
      latencyMs: database.latencyMs,
      detail: database.ok ? undefined : 'The database did not answer a trivial query.',
    });

    // Redis is cache, queue and rate-limit infrastructure. Its absence degrades
    // the system (no background jobs) but must not stop payments being recorded,
    // so it is reported as degraded rather than down.
    const redis = await checkTcp(this.config.redisUrl, 1_000);
    checks.push({
      name: 'redis',
      status: redis.ok ? 'up' : 'degraded',
      latencyMs: redis.latencyMs,
      detail: redis.ok ? undefined : 'Redis is unreachable; background jobs and rate limiting are degraded.',
    });

    const keyConfigured = this.config.encryptionKey.length >= 32;
    checks.push({
      name: 'encryption-key',
      status: keyConfigured ? 'up' : 'down',
      detail: keyConfigured ? undefined : 'ENCRYPTION_KEY is missing or too short; gateway secrets cannot be read.',
    });

    return checks;
  }
}

function deriveStatus(checks: CheckResult[]): 'ok' | 'degraded' | 'down' {
  if (checks.some((check) => check.status === 'down')) return 'down';
  if (checks.some((check) => check.status === 'degraded')) return 'degraded';
  return 'ok';
}

/** Minimal TCP probe so readiness does not depend on a Redis client library. */
async function checkTcp(url: string, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  let host = 'localhost';
  let port = 6379;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    port = Number(parsed.port || 6379);
  } catch {
    return { ok: false, latencyMs: Date.now() - startedAt };
  }

  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - startedAt });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host);
  });
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
