import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES } from '@fee/types';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AppError, type RequestWithContext } from './errors';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, PORTAL_ROUTE_KEY, TENANT_MODULES_KEY, TenantContextService } from './tenancy';
import { AppConfigService } from '../config/env';
import { PrismaService } from './prisma.service';
import { resolveTenantModuleAccess } from './entitlements';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';

/**
 * Authentication, authorisation and secret handling.
 *
 * Design choices worth stating:
 *   - Passwords use bcrypt with a cost factor recorded alongside the hash, so the
 *     factor can be raised later without invalidating existing credentials.
 *   - Refresh tokens are stored as a SHA-256 hash. A database leak yields hashes,
 *     not sessions.
 *   - Permissions travel inside the access token, resolved at login. Verifying a
 *     request touches no database, which matters at a collection counter where
 *     hundreds of payments land in a minute.
 *   - Gateway secrets are AES-256-GCM encrypted with a random IV per value and
 *     authenticated, so ciphertext cannot be silently altered.
 *   - Secrets never appear in a log line or an API response; `maskSecret` is the
 *     only thing a read endpoint may return.
 */

const BCRYPT_COST = 12;

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
  /** Incremented when platform credentials or activation state are revoked. */
  sessionVersion?: number;
  /** Portal accounts are pinned to one student. */
  studentId?: string | null;
  guardianId?: string | null;
}

export interface AccessTokenClaims {
  sub: string;
  tid: string;
  email: string;
  roles: string[];
  perms: string[];
  platform: boolean;
  sv?: number;
  sid?: string | null;
  gid?: string | null;
  typ: 'access';
}

export interface RefreshTokenClaims {
  sub: string;
  tid: string;
  jti: string;
  typ: 'refresh';
}

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    if (!plain || plain.length < 8) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'A password must be at least 8 characters long.',
      });
    }
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    if (!plain || !hash) return false;
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  /** Constant-work dummy comparison, used to avoid revealing whether an email exists. */
  async burnTime(): Promise<void> {
    await bcrypt.compare('timing-equalisation', '$2a$12$0000000000000000000000000000000000000000000000000000');
  }

  /**
   * Refresh tokens are high-entropy random strings, not passwords, so a fast
   * digest is correct here: bcrypt's cost would be pure latency at no gain.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateToken(): string {
    return randomBytes(48).toString('base64url');
  }
}

// ---------------------------------------------------------------------------
// Gateway secret encryption
// ---------------------------------------------------------------------------

export interface EncryptedValue {
  /** `v1:<iv>:<authTag>:<ciphertext>`, all base64. */
  ciphertext: string;
}

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = deriveKey(config.encryptionKey);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12); // 96-bit nonce, the GCM recommendation
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [version, ivPart, tagPart, dataPart] = payload.split(':');
    if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
      throw new Error('Encrypted value is not in the expected v1 format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    // GCM authentication means tampering surfaces here as a thrown error rather
    // than as a silently wrong secret.
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  }

  /**
   * The only representation of a secret that may leave the API. Enough to
   * recognise which key is configured, not enough to use it.
   */
  static mask(secret: string | null | undefined): string | null {
    if (!secret) return null;
    const tail = secret.slice(-4);
    return `${'•'.repeat(Math.max(4, Math.min(12, secret.length - 4)))}${tail}`;
  }
}

function deriveKey(configured: string): Buffer {
  // A 64-character hex string is treated as a raw key; anything else is hashed
  // to 32 bytes so an operator cannot accidentally deploy a short key.
  if (/^[0-9a-fA-F]{64}$/.test(configured)) return Buffer.from(configured, 'hex');
  const base64 = Buffer.from(configured, 'base64');
  if (base64.length === 32) return base64;
  return createHash('sha256').update(configured).digest();
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  signAccessToken(user: AuthenticatedUser): Promise<string> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      tid: user.tenantId,
      email: user.email,
      roles: user.roles,
      perms: user.permissions,
      platform: user.isPlatformAdmin,
      sv: user.sessionVersion ?? 0,
      sid: user.studentId ?? null,
      gid: user.guardianId ?? null,
      typ: 'access',
    };
    return this.jwt.signAsync(claims, {
      secret: this.config.jwtSecret,
      expiresIn: this.config.jwtAccessTtlSeconds,
    });
  }

  signRefreshToken(user: { id: string; tenantId: string }, tokenId: string): Promise<string> {
    const claims: RefreshTokenClaims = { sub: user.id, tid: user.tenantId, jti: tokenId, typ: 'refresh' };
    return this.jwt.signAsync(claims, {
      secret: this.config.jwtRefreshSecret,
      expiresIn: this.config.jwtRefreshTtlSeconds,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, { secret: this.config.jwtSecret });
    if (claims.typ !== 'access') {
      throw new UnauthorizedException('Presented a refresh token where an access token was expected.');
    }
    return claims;
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const claims = await this.jwt.verifyAsync<RefreshTokenClaims>(token, { secret: this.config.jwtRefreshSecret });
    if (claims.typ !== 'refresh') {
      throw new UnauthorizedException('Presented an access token where a refresh token was expected.');
    }
    return claims;
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private platformTenantLookup: Promise<string | null> | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (isPublic) return true;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('A bearer access token is required.');
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new UnauthorizedException(expired ? 'Your session has expired. Please sign in again.' : 'The access token is not valid.');
    }

    if (claims.platform !== claims.roles.includes('PLATFORM_ADMIN')) {
      throw new UnauthorizedException('The platform administrator role in this session is not valid. Please sign in again.');
    }

    const host = request.tenantHost ?? this.tenantContext.peek()?.tenantHost;
    if (!host || host.kind === 'unknown') throw AppError.notFound('Workspace');
    if (host.kind === 'tenant') {
      if (host.status === 'SUSPENDED' || host.status === 'ARCHIVED') {
        throw AppError.forbidden('This institution workspace is not active. Please contact its administrator.');
      }
      if (claims.platform) {
        throw AppError.forbidden('Platform administrator sessions can only use the platform hostname.');
      }
      if (claims.tid !== host.tenantId) {
        throw new AppError({ code: ERROR_CODES.TENANT_MISMATCH, message: 'Your session does not belong to this institution hostname.' });
      }
    } else {
      const platformTenantId = await this.getPlatformTenantId();
      if (!claims.platform || !platformTenantId || claims.tid !== platformTenantId) {
        throw AppError.forbidden('Only platform administrator sessions can use the platform hostname.');
      }
    }

    const tenantHeader = request.headers['x-tenant-id'];
    if (tenantHeader !== undefined) {
      const tenantIds = Array.isArray(tenantHeader) ? tenantHeader : [tenantHeader];
      if (tenantIds.length !== 1 || tenantIds[0] !== claims.tid) {
        throw new AppError({
          code: ERROR_CODES.TENANT_MISMATCH,
          message: 'The tenant in the request does not match the tenant in your session.',
        });
      }
    }

    request.user = {
      id: claims.sub,
      tenantId: claims.tid,
      email: claims.email,
      roles: claims.roles,
      permissions: claims.perms,
      isPlatformAdmin: claims.platform,
      sessionVersion: claims.sv ?? 0,
      studentId: claims.sid ?? null,
      guardianId: claims.gid ?? null,
    };

    request.tenantId = claims.tid;
    this.tenantContext.establish({
      tenantId: claims.tid,
      userId: claims.sub,
      isPlatformAdmin: claims.platform,
      roles: claims.roles,
      permissions: claims.perms,
      studentId: claims.sid ?? null,
      guardianId: claims.gid ?? null,
    });

    const isTenantAdmin = claims.roles.some((role) => role === 'TENANT_ADMIN' || role === 'TENANT_OWNER');
    const isPortalOnly = claims.roles.length > 0 && claims.roles.every(isPortalRole);
    if (host.kind === 'tenant' && !claims.platform && !isTenantAdmin && !isPortalOnly) {
      // Resolve memberships from the database on each request so removing a
      // user's branch access takes effect immediately and cannot be forged in a
      // JWT or request header. Empty membership intentionally grants no branch.
      const memberships = await this.prisma.db.userBranchMembership.findMany({
        where: { tenantId: claims.tid, userId: claims.sub },
        select: { branchId: true },
      });
      this.tenantContext.establish({
        tenantId: claims.tid,
        userId: claims.sub,
        isPlatformAdmin: false,
        branchScopeEnabled: true,
        branchIds: [...new Set(memberships.map(({ branchId }) => branchId))],
      });
    }

    return true;
  }

  /**
   * The platform workspace is a reserved singleton. Cache its immutable ID
   * after the first successful lookup so every platform API request does not
   * spend another Neon connection validating the same signed tenant claim.
   * A transient database error clears the promise and can be retried.
   */
  private getPlatformTenantId(): Promise<string | null> {
    if (!this.platformTenantLookup) {
      const lookup = this.prisma.db.tenant.findUnique({
        where: { slug: PLATFORM_SYSTEM_TENANT_SLUG },
        select: { id: true },
      }).then((tenant) => tenant?.id ?? null);
      this.platformTenantLookup = lookup.catch((error: unknown) => {
        this.platformTenantLookup = null;
        throw error;
      });
    }
    return this.platformTenantLookup;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const isPortalRoute = this.reflector.getAllAndOverride<boolean>(PORTAL_ROUTE_KEY, [context.getHandler(), context.getClass()]) ?? false;
    const roles = request.user?.roles ?? [];
    const hasPortalRole = roles.some(isPortalRole);
    const hasStaffRole = roles.some((role) => !isPortalRole(role));
    if (!isPortalRoute && hasPortalRole && !hasStaffRole) throw new ForbiddenException('Portal accounts can only use portal endpoints.');
    if (!required || required.length === 0) return true;

    const granted = new Set(request.user?.permissions ?? []);
    if (request.user?.isPlatformAdmin && request.user.roles.includes('PLATFORM_ADMIN')) return true;

    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `You do not have permission to perform this action. Missing: ${missing.join(', ')}.`,
      );
    }
    return true;
  }
}

function isPortalRole(role: string): boolean { return role === 'STUDENT' || role === 'PARENT' || role === 'WORKSPACE_PERSON'; }

/** Enforces plan and platform module access before any tenant controller runs. */
@Injectable()
export class ModuleEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(TENANT_MODULES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const actor = context.switchToHttp().getRequest<RequestWithContext>().user;
    if (!actor) throw new UnauthorizedException('Sign in to access this organization feature.');
    const tenantId = this.tenantContext.requireTenantId();
    const moduleAccess = await resolveTenantModuleAccess(this.prisma.db, tenantId);
    if (!moduleAccess) throw new UnauthorizedException('The organization workspace is unavailable.');
    const enabled = new Set(moduleAccess.enabledModules);
    const unavailable = required.filter((moduleKey) => !enabled.has(moduleKey));
    if (unavailable.length) throw new ForbiddenException(`This organization plan does not include: ${unavailable.join(', ')}.`);
    return true;
  }
}

/** An explicit platform boundary; ordinary tenant roles never grant it. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly inFlightPlatformAdminChecks = new Map<string, Promise<boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const actor = request.user;
    if (!actor?.isPlatformAdmin || !actor.roles.includes('PLATFORM_ADMIN')) {
      throw new ForbiddenException('Super administrator access is required.');
    }
    const sessionVersion = actor.sessionVersion ?? 0;
    const key = `${actor.tenantId}:${actor.id}:${sessionVersion}`;
    let validation = this.inFlightPlatformAdminChecks.get(key);
    if (!validation) {
      validation = this.tenantContext.run({
        tenantId: actor.tenantId,
        userId: actor.id,
        roles: actor.roles,
        requestId: this.tenantContext.requestId ?? 'platform-admin-guard',
        isPlatformAdmin: true,
      }, () => this.prisma.db.user.findFirst({
        where: { id: actor.id, tenantId: actor.tenantId, isPlatformAdmin: true, deletedAt: null },
        select: { status: true, sessionVersion: true },
      })).then((currentUser) => Boolean(
        currentUser && currentUser.status === 'ACTIVE' && currentUser.sessionVersion === sessionVersion,
      ));
      this.inFlightPlatformAdminChecks.set(key, validation);
      const clear = () => {
        if (this.inFlightPlatformAdminChecks.get(key) === validation) this.inFlightPlatformAdminChecks.delete(key);
      };
      void validation.then(clear, clear);
    }
    if (!await validation) {
      throw new UnauthorizedException('This Super Admin session is no longer active. Sign in again.');
    }
    return true;
  }
}

/** Resolves the caller's permissions at login from the database, not from the token. */
export function buildAuthenticatedUser(input: {
  id: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
  sessionVersion?: number;
  studentId?: string | null;
  guardianId?: string | null;
}): AuthenticatedUser {
  return { ...input };
}

export const CurrentStudentId = createParamDecorator((_data: unknown, context: ExecutionContext): string | null => {
  const request = context.switchToHttp().getRequest<RequestWithContext>();
  return request.user?.studentId ?? null;
});

export const CurrentGuardianId = createParamDecorator((_data: unknown, context: ExecutionContext): string | null => {
  const request = context.switchToHttp().getRequest<RequestWithContext>();
  return request.user?.guardianId ?? null;
});

export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');

export { ERROR_CODES };
