import { createParamDecorator, Injectable, Module, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ERROR_CODES } from '@fee/types';
import { AppError, type RequestWithContext } from './errors';
import type { ResolvedTenantHost } from './tenant-host';

/**
 * Tenant isolation.
 *
 * Defence in depth, in three layers, because a multi-tenant financial system
 * fails catastrophically the first time one layer is forgotten:
 *
 *   1. **Token.** The tenant id is a claim inside a signed access token. A client
 *      cannot assert a tenant; it can only present a token issued for one.
 *   2. **Context.** Every request runs inside an `AsyncLocalStorage` scope holding
 *      the tenant id, so a service can obtain it without threading it through
 *      every signature - and without falling back to a default.
 *   3. **Database boundary.** Prisma model operations automatically apply the
 *      tenant predicate and tenant-owned writes are bound to the current scope.
 *      The scope throws rather than returning `undefined`, so a missing context
 *      fails closed.
 *
 * Frontend filtering is never part of this boundary. Raw SQL helpers must still
 * include an explicit tenant predicate and are kept behind fixed internal APIs.
 */

export interface TenantContextValue {
  /** Unset while a public request is being resolved; required by tenant services. */
  tenantId?: string;
  userId?: string;
  roles?: string[];
  permissions?: string[];
  studentId?: string | null;
  guardianId?: string | null;
  /** Current live branch memberships; never taken from client input. */
  branchIds?: string[];
  /** Enables row filtering for non-admin tenant users with branch-level access. */
  branchScopeEnabled?: boolean;
  requestId: string;
  isPlatformAdmin?: boolean;
  /** Set when an operator is impersonating a tenant, for audit purposes. */
  actingAsTenantId?: string;
  /** Host-derived workspace, resolved by the API before guards run. */
  tenantHost?: ResolvedTenantHost;
}

const storage = new AsyncLocalStorage<TenantContextValue>();

@Injectable()
export class TenantContextService {
  /** Runs `work` with the given tenant pinned for its whole async lifetime. */
  run<T>(value: TenantContextValue, work: () => T): T {
    return storage.run(value, work);
  }

  /**
   * Updates the current request scope after authentication has verified its
   * token. The request middleware creates one store per request, so mutating
   * that store makes the verified tenant visible to every awaited handler and
   * database operation created in the request chain.
   */
  establish(value: Pick<TenantContextValue, 'tenantId' | 'userId' | 'isPlatformAdmin'> & Partial<Pick<TenantContextValue, 'roles' | 'permissions' | 'studentId' | 'guardianId' | 'branchIds' | 'branchScopeEnabled'>>): void {
    const current = storage.getStore();
    if (!current) {
      throw new AppError({
        code: ERROR_CODES.TENANT_MISMATCH,
        message: 'The request context has not been initialized.',
        status: 500,
      });
    }
    Object.assign(current, value);
  }

  establishTenantHost(value: ResolvedTenantHost): void {
    const current = storage.getStore();
    if (!current) {
      throw new AppError({ code: ERROR_CODES.TENANT_MISMATCH, message: 'The request context has not been initialized.', status: 500 });
    }
    current.tenantHost = value;
  }

  requireTenantHost(): ResolvedTenantHost {
    const value = storage.getStore()?.tenantHost;
    if (!value) throw new AppError({ code: ERROR_CODES.TENANT_MISMATCH, message: 'The request hostname has not been resolved.', status: 500 });
    return value;
  }

  /** The context, or `undefined` outside a request (workers, seeds, tests). */
  peek(): TenantContextValue | undefined {
    return storage.getStore();
  }

  /**
   * The context, or a hard failure. Repositories call this, so a query can never
   * silently run unscoped.
   */
  require(): TenantContextValue & { tenantId: string } {
    const value = storage.getStore();
    if (!value?.tenantId) {
      throw new AppError({
        code: ERROR_CODES.TENANT_MISMATCH,
        message: 'No authenticated tenant context is established for this operation.',
        status: 500,
        context: { reason: 'TenantContextService.require() called outside an authenticated tenant scope' },
      });
    }
    return value as TenantContextValue & { tenantId: string };
  }

  requireTenantId(): string {
    return this.require().tenantId;
  }

  get tenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  }

  get requestId(): string | undefined {
    return storage.getStore()?.requestId;
  }
}

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

export const IS_PUBLIC_KEY = 'fee:isPublic';
export const PERMISSIONS_KEY = 'fee:permissions';
export const TENANT_OPTIONAL_KEY = 'fee:tenantOptional';
export const PORTAL_ROUTE_KEY = 'fee:portalRoute';
export const TENANT_MODULES_KEY = 'fee:tenantModules';

/** Marks a route as reachable without authentication (login, webhooks, health). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Marks a route whose handler needs no tenant scope (platform administration). */
export const TenantOptional = (): MethodDecorator & ClassDecorator => SetMetadata(TENANT_OPTIONAL_KEY, true);

/** Marks an endpoint intentionally scoped to a student or guardian portal account. */
export const PortalRoute = (): MethodDecorator & ClassDecorator => SetMetadata(PORTAL_ROUTE_KEY, true);

/**
 * Declares the permissions a route requires. Enforced by `PermissionsGuard`;
 * the handler never performs its own permission check, so a missing check is a
 * routing mistake rather than a silent hole.
 */
export const RequirePermissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Declares the plan module required by a tenant route; enforced server-side. */
export const RequireModules = (...modules: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_MODULES_KEY, modules);

export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<RequestWithContext>();
  const tenantId = request.user?.tenantId;
  if (!tenantId) {
    throw new AppError({ code: ERROR_CODES.TENANT_MISMATCH, message: 'This request is not scoped to a tenant.' });
  }
  return tenantId;
});

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): RequestWithContext['user'] => {
  const request = context.switchToHttp().getRequest<RequestWithContext>();
  if (!request.user) {
    throw new AppError({ code: ERROR_CODES.UNAUTHENTICATED, message: 'This request is not authenticated.' });
  }
  return request.user;
});

export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<RequestWithContext>();
  return request.requestId ?? 'unknown';
});

/** Read-only view of the context for logging and auditing. */
export function describeTenantContext(): Record<string, unknown> {
  const value = storage.getStore();
  if (!value) return {};
  return { tenantId: value.tenantId, userId: value.userId, requestId: value.requestId };
}

@Module({ providers: [TenantContextService], exports: [TenantContextService] })
export class TenantContextModule {}
