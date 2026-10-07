import { Controller, Get, Header, Injectable, Module, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { Public, TenantContextModule, TenantContextService } from '../common/tenancy';
import type { RequestWithContext } from '../common/errors';
import { resolveTenantModuleAccess } from '../common/entitlements';

export type PublicTenantContext =
  | { kind: 'platform' }
  | { kind: 'unknown' }
  | { kind: 'inactive'; name: string; slug: string }
  | {
      kind: 'tenant';
      name: string;
      slug: string;
      enabledModules: string[];
      allowPublicRegistration: boolean;
      branding: {
        organizationName: string;
        email: string | null;
        logoUrl: string | null;
        primaryColor: string;
        accentColor: string;
        landingTitle: string | null;
        landingDescription: string | null;
        landingActionLabel: string | null;
      };
    };

@Injectable()
export class PublicTenantContextService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContextService) {}

  async resolve(request: RequestWithContext): Promise<PublicTenantContext> {
    const host = request.tenantHost ?? this.tenantContext.peek()?.tenantHost;
    if (!host || host.kind === 'unknown') return { kind: 'unknown' };
    if (host.kind === 'platform') return { kind: 'platform' };
    if (host.status === 'SUSPENDED' || host.status === 'ARCHIVED') {
      return { kind: 'inactive', name: host.name, slug: host.slug };
    }

    const current = this.tenantContext.peek();
    const [branding, settings, moduleAccess] = await this.tenantContext.run(
      { ...(current ?? { requestId: request.requestId ?? 'unknown' }), tenantId: host.tenantId, isPlatformAdmin: false },
      // Prisma returns a lazy thenable. Await it before leaving the tenant scope
      // so the tenant-scoped database extension sees the resolved host tenant.
      async () => await Promise.all([
        this.prisma.db.tenantBranding.findUnique({
          where: { tenantId: host.tenantId },
          select: {
            organizationName: true,
            email: true,
            logoUrl: true,
            primaryColor: true,
            accentColor: true,
            landingTitle: true,
            landingDescription: true,
            landingActionLabel: true,
          },
        }),
        this.prisma.db.tenantSettings.findUnique({
          where: { tenantId: host.tenantId },
          select: { allowPublicRegistration: true },
        }),
        resolveTenantModuleAccess(this.prisma.db, host.tenantId),
      ]),
    );

    return {
      kind: 'tenant',
      name: host.name,
      slug: host.slug,
      enabledModules: moduleAccess?.enabledModules ?? [],
      allowPublicRegistration: settings?.allowPublicRegistration ?? false,
      branding: {
        organizationName: branding?.organizationName ?? host.name,
        email: branding?.email ?? null,
        logoUrl: branding?.logoUrl ?? null,
        primaryColor: branding?.primaryColor ?? '#0F172A',
        accentColor: branding?.accentColor ?? '#2563EB',
        landingTitle: branding?.landingTitle ?? null,
        landingDescription: branding?.landingDescription ?? null,
        landingActionLabel: branding?.landingActionLabel ?? null,
      },
    };
  }
}

@ApiTags('tenant context')
@Controller('tenant-context')
export class PublicTenantContextController {
  constructor(private readonly context: PublicTenantContextService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Resolve public tenant branding from the request hostname' })
  get(@Req() request: RequestWithContext): Promise<PublicTenantContext> {
    return this.context.resolve(request);
  }
}

@Module({
  imports: [PrismaModule, TenantContextModule],
  controllers: [PublicTenantContextController],
  providers: [PublicTenantContextService],
})
export class TenantContextPublicModule {}
