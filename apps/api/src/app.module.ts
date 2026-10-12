import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule, AppConfigService } from './config/env';
import { PrismaModule } from './common/prisma.service';
import { FinancialModule } from './common/financial';
import { envelopeInterceptor, GlobalExceptionFilter } from './common/errors';
import { JwtAuthGuard, ModuleEntitlementGuard, PermissionsGuard } from './common/security';
import { TenantContextModule } from './common/tenancy';
import { RequestIdMiddleware } from './common/http';
import { AuthModule } from './modules/auth';
import { HealthModule } from './modules/health';
import { StudentsModule } from './modules/students';
import { FeesModule } from './modules/fees';
import { FeePoliciesModule } from './modules/fee-policies';
import { AssignmentsModule } from './modules/assignments';
import { PaymentsModule } from './modules/payments';
import { RefundsModule } from './modules/refunds';
import { CreditsModule } from './modules/credits';
import { InstallmentsModule } from './modules/installments';
import { GatewaysModule } from './modules/gateways';
import { InvoicesModule } from './modules/invoices';
import { ReportsModule } from './modules/reports';
import { SettlementsModule } from './modules/settlements';
import { NotificationsModule } from './modules/notifications';
import { TenantSettingsModule } from './modules/settings';
import { LateFeesModule } from './modules/late-fees';
import { AccessModule } from './modules/access';
import { AcademicOperationsModule } from './modules/academics';
import { TenantOperationsModule } from './modules/tenant-operations';
import { PlatformModule } from './modules/platform';
import { SponsorsModule } from './modules/sponsors';
import { PortalModule } from './modules/portal';
import { AdjustmentsModule } from './modules/adjustments';
import { BenefitsModule } from './modules/benefits';
import { AttendanceModule } from './modules/attendance';
import { PayerResponsibilitiesModule } from './modules/payer-responsibilities';
import { TenantContextPublicModule } from './modules/tenant-context';
import { TenantHostResolutionMiddleware } from './common/tenant-host';
import { OrganizationModule } from './modules/organization';

/**
 * The application module graph.
 *
 * This is a modular monolith: one deployable, strict internal boundaries. The
 * modules below are ordered by the dependency direction of the domain - platform
 * concerns first, then the financial lifecycle - so a future extraction of the
 * payment service (phase 2 in the architecture plan) is a move of a module and
 * its tables, not a rewrite.
 *
 * Global behaviour is registered here rather than repeated per controller:
 *
 *   APP_GUARD        authentication, then permission enforcement
 *   APP_FILTER       one error vocabulary and one response shape
 *   APP_INTERCEPTOR  the success envelope
 *
 * Authentication is global, so a new controller is protected by default. A route
 * opts out with `@Public()`. That default matters: the opposite convention makes
 * an unauthenticated endpoint the result of forgetting something.
 */
@Module({
  imports: [
    // Secrets are passed per sign/verify call, so the module needs no default.
    JwtModule.register({ global: true }),
    AppConfigModule,
    TenantContextModule,
    PrismaModule,
    FinancialModule,
    HealthModule,
    AuthModule,
    StudentsModule,
    FeesModule,
    FeePoliciesModule,
    AssignmentsModule,
    PaymentsModule,
    RefundsModule,
    CreditsModule,
    InstallmentsModule,
    GatewaysModule,
    InvoicesModule,
    ReportsModule,
    SettlementsModule,
    NotificationsModule,
    TenantSettingsModule,
    LateFeesModule,
    AccessModule,
    AcademicOperationsModule,
    TenantOperationsModule,
    PlatformModule,
    SponsorsModule,
    PortalModule,
    AdjustmentsModule,
    BenefitsModule,
    AttendanceModule,
    PayerResponsibilitiesModule,
    TenantContextPublicModule,
    OrganizationModule,
  ],
  providers: [
    RequestIdMiddleware,
    TenantHostResolutionMiddleware,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ModuleEntitlementGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    {
      provide: APP_FILTER,
      useFactory: (config: AppConfigService) => new GlobalExceptionFilter({ includeHints: !config.isProduction }),
      inject: [AppConfigService],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (config: AppConfigService) => envelopeInterceptor({ includeHints: !config.isProduction }),
      inject: [AppConfigService],
    },
  ],
})
export class AppModule {}
