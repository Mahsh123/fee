import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { resolveTenantHost } from '@fee/config';
import type { TenantStatus } from '@fee/database';
import { PrismaService } from './prisma.service';
import type { RequestWithContext } from './errors';
import { TenantContextService } from './tenancy';
import { AppConfigService } from '../config/env';

export type ResolvedTenantHost =
  | { kind: 'platform'; hostname: string; baseDomain: string }
  | { kind: 'tenant'; hostname: string; baseDomain: string; tenantId: string; slug: string; name: string; status: TenantStatus }
  | { kind: 'unknown'; hostname: string; baseDomain: string; slug?: string };

/** Resolves the request's workspace from the validated HTTP Host before guards. */
@Injectable()
export class TenantHostResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly context: TenantContextService,
  ) {}

  async use(request: RequestWithContext, response: Response, next: NextFunction): Promise<void> {
    response.vary('Host');
    const parsed = resolveTenantHost(request.headers.host, this.config.tenantBaseDomain, this.config.platformSubdomain);
    let resolved: ResolvedTenantHost;

    // Health probes use localhost/127.0.0.1 and are not workspace requests.
    // Resolving them as custom domains would add a Neon lookup to every
    // readiness probe and can consume connections needed by real requests.
    if (request.path === '/health' || request.path.startsWith('/health/')) {
      resolved = parsed.kind === 'platform'
        ? { kind: 'platform', hostname: parsed.hostname, baseDomain: this.config.tenantBaseDomain }
        : { kind: 'unknown', hostname: parsed.hostname, baseDomain: this.config.tenantBaseDomain, ...('slug' in parsed && parsed.slug ? { slug: parsed.slug } : {}) };
      request.tenantHost = resolved;
      this.context.establishTenantHost(resolved);
      next();
      return;
    }

    if (parsed.kind === 'platform') {
      resolved = { kind: 'platform', hostname: parsed.hostname, baseDomain: this.config.tenantBaseDomain };
    } else if (parsed.kind === 'tenant') {
      const tenant = await this.prisma.db.tenant.findUnique({
        where: { slug: parsed.slug },
        select: { id: true, slug: true, name: true, status: true },
      });
      resolved = tenant
        ? { kind: 'tenant', hostname: parsed.hostname, baseDomain: this.config.tenantBaseDomain, tenantId: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status }
        : { kind: 'unknown', hostname: parsed.hostname, baseDomain: this.config.tenantBaseDomain, slug: parsed.slug };
    } else {
      const hostname = parsed.hostname;
      const isOutsideTenantBase = hostname.length > 0 && hostname !== this.config.tenantBaseDomain &&
        !hostname.endsWith(`.${this.config.tenantBaseDomain}`);
      const tenant = isOutsideTenantBase
        ? await this.prisma.db.tenant.findFirst({
            where: { domains: { some: { domain: hostname, verifiedAt: { not: null } } } },
            select: { id: true, slug: true, name: true, status: true },
          })
        : null;
      resolved = tenant
        ? { kind: 'tenant', hostname, baseDomain: this.config.tenantBaseDomain, tenantId: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status }
        : { kind: 'unknown', hostname, baseDomain: this.config.tenantBaseDomain, ...('slug' in parsed && parsed.slug ? { slug: parsed.slug } : {}) };
    }

    request.tenantHost = resolved;
    this.context.establishTenantHost(resolved);
    next();
  }
}
