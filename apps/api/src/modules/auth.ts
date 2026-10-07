import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { isUniqueViolation, type TransactionClient } from '@fee/database';
import { AppConfigService } from '../config/env';
import { AppError, type RequestWithContext } from '../common/errors';
import { AuditService, FinancialModule } from '../common/financial';
import { InMemoryRateLimitStore, LoginRateLimitGuard, ZodValidationPipe } from '../common/http';
import { buildAuthenticatedUser, PasswordService, TokenService } from '../common/security';
import { CurrentUser, PortalRoute, Public, TenantContextModule, TenantContextService } from '../common/tenancy';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type RoleKey } from '@fee/types';
import { acceptEmailChangeSchema, acceptInvitationSchema, changeOwnEmailSchema, changePasswordSchema, loginSchema, publicTenantRegistrationSchema, refreshSchema, updateOwnProfileSchema, type AcceptEmailChangeInput, type AcceptInvitationInput, type ChangeOwnEmailInput, type ChangePasswordInput, type LoginInput, type PublicTenantRegistrationInput, type RefreshInput, type UpdateOwnProfileInput } from '@fee/validation';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';
import { buildEmailChangeVerificationUrl, buildUserInvitationUrl, enqueueUserEmailVerification, enqueueUserInvitation } from '../common/invitations';
import { assertTenantUserSeatAvailable } from '../common/user-limits';

export { changePasswordSchema, loginSchema, refreshSchema } from '@fee/validation';
export type { ChangePasswordInput, LoginInput, RefreshInput } from '@fee/validation';

/**
 * Authentication.
 *
 * Sign-in is host-scoped: middleware resolves the institution from the request
 * hostname before credentials are checked. Email lookup and session creation are
 * then pinned to that tenant's database scope.
 *
 * Permissions are resolved from the database at sign-in and embedded in the
 * access token, so request authorisation costs no query. They are re-resolved on
 * every refresh, which bounds how long a revoked permission can survive.
 */

/** The transaction client type, aliased for readability at call sites. */
type TransactionHandle = Parameters<Parameters<PrismaService['transaction']>[0]>[0];

export interface SessionUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string | null;
  roles: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
  studentId: string | null;
  guardianId: string | null;
  mustChangePassword: boolean;
}

export type OwnProfile = SessionUser & { pendingEmail: string | null; emailVerifiedAt: Date | null };

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

/**
 * What `issueSession` needs. Kept separate from `SessionUser` because the caller
 * has the user id but not yet the tenant slug/name, which are joined in.
 */
interface IssueSessionInput {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string | null;
  roles: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
  sessionVersion: number;
  studentId: string | null;
  guardianId: string | null;
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async login(input: LoginInput, context: { ip?: string; userAgent?: string; requestId?: string }): Promise<Session> {
    const host = this.tenantContext.requireTenantHost();
    const tenant = host.kind === 'tenant'
      ? { id: host.tenantId, slug: host.slug, name: host.name, status: host.status }
      : host.kind === 'platform'
        ? await this.prisma.db.tenant.findUnique({
            where: { slug: PLATFORM_SYSTEM_TENANT_SLUG },
            select: { id: true, slug: true, name: true, status: true },
          })
        : null;

    // The same generic failure is returned whether the tenant, the email or the
    // password was wrong, so the endpoint cannot be used to enumerate accounts.
    const genericFailure = new UnauthorizedException('The email or password is incorrect.');

    if (!tenant || (host.kind !== 'tenant' && host.kind !== 'platform')) {
      await this.passwords.burnTime();
      throw genericFailure;
    }
    if (tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED') {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'This institution account is not active. Please contact your administrator.',
      });
    }

    // The request hostname is authoritative. The frontend submits no tenant
    // identifier, and credential lookup remains scoped to the resolved tenant.
    const requestId = context.requestId ?? this.tenantContext.peek()?.requestId ?? 'unknown';
    return this.tenantContext.run(
      { ...(this.tenantContext.peek() ?? { requestId }), tenantId: tenant.id, requestId, isPlatformAdmin: false },
      async () => {
    const user = await this.prisma.db.user.findFirst({
      where: { tenantId: tenant.id, email: input.email.toLowerCase(), deletedAt: null },
    });
    if (!user) {
      await this.passwords.burnTime();
      throw genericFailure;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'This account is temporarily locked after too many failed attempts. Please try again later.',
      });
    }

    const passwordOk = await this.passwords.verify(input.password, user.passwordHash);
    if (!passwordOk) {
      const failedCount = user.failedLoginCount + 1;
      await this.prisma.db.user.update({
        where: { id: user.id },
        // Lock after enough failures to make guessing impractical, without
        // permanently locking a user out on a forgotten password.
        data: {
          failedLoginCount: failedCount,
          lockedUntil: failedCount >= 8 ? new Date(Date.now() + 15 * 60 * 1_000) : null,
        },
      });
      throw genericFailure;
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'This account has not been activated or has been disabled.',
      });
    }

    if ((host.kind === 'platform') !== user.isPlatformAdmin) {
      await this.passwords.burnTime();
      throw genericFailure;
    }

    const resolved = await this.resolveAccess(user.id, tenant.id);
    if (user.isPlatformAdmin !== resolved.roles.includes('PLATFORM_ADMIN')) {
      await this.passwords.burnTime();
      throw genericFailure;
    }

    const session = await this.issueSession({
      userId: user.id,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: resolved.roles,
      permissions: resolved.permissions,
      isPlatformAdmin: user.isPlatformAdmin,
      sessionVersion: user.sessionVersion,
      studentId: user.studentId,
      guardianId: user.guardianId,
      mustChangePassword: user.mustChangePassword,
    });

    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    await this.prisma.transaction(async (tx) => {
      await this.audit.record(tx, {
        tenantId: tenant.id,
        actorId: user.id,
        actorEmail: user.email,
        actorRoles: resolved.roles,
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        requestId,
        ipAddress: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
    });

    return session;
      },
    );
  }

  async requestTenantRegistration(input: PublicTenantRegistrationInput, context: { requestId?: string; ip?: string; userAgent?: string }): Promise<{ submitted: true }> {
    const host = this.tenantContext.requireTenantHost();
    if (host.kind !== 'tenant' || host.status !== 'ACTIVE') {
      throw AppError.conflict('REGISTRATION_UNAVAILABLE', 'This workspace is not accepting registrations right now. Contact its administrator.');
    }

    const requestId = context.requestId ?? this.tenantContext.peek()?.requestId ?? 'unknown';
    const tenantScope = { ...(this.tenantContext.peek() ?? { requestId }), tenantId: host.tenantId, requestId, isPlatformAdmin: false };
    const initialSettings = await this.tenantContext.run(tenantScope, async () => await this.prisma.db.tenantSettings.findUnique({
      where: { tenantId: host.tenantId }, select: { allowPublicRegistration: true },
    }));
    if (!initialSettings?.allowPublicRegistration) {
      throw AppError.conflict('REGISTRATION_UNAVAILABLE', 'This workspace is not accepting registrations right now. Contact its administrator.');
    }

    const token = this.passwords.generateToken();
    const tokenHash = this.passwords.hashToken(token);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const passwordHash = await this.passwords.hash(this.passwords.generateToken());
    const acceptUrl = buildUserInvitationUrl(this.config.webAppUrl, host.hostname, token, this.config.isProduction);

    try {
      return await this.tenantContext.run(
        tenantScope,
        () => this.prisma.transactionWithRetry(async (tx: TransactionClient) => {
          const settings = await tx.tenantSettings.findUnique({ where: { tenantId: host.tenantId }, select: { allowPublicRegistration: true } });
          if (!settings?.allowPublicRegistration) {
            throw AppError.conflict('REGISTRATION_UNAVAILABLE', 'This workspace is not accepting registrations right now. Contact its administrator.');
          }

          await assertTenantUserSeatAvailable(tx, host.tenantId);
          const role = await tx.role.findFirst({
            where: { tenantId: host.tenantId, key: 'TENANT_MEMBER', active: true },
            select: {
              id: true,
              permissionsConfigured: true,
              rolePermissions: { where: { tenantId: host.tenantId }, select: { permission: { select: { key: true } } } },
            },
          });
          const branch = await tx.branch.findFirst({ where: { tenantId: host.tenantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
          if (!role || !branch) {
            throw AppError.conflict('REGISTRATION_UNAVAILABLE', 'This workspace is not accepting registrations right now. Contact its administrator.');
          }

          // Public registration always grants a least-privilege member role.
          // If an administrator customized that role with stronger access,
          // fail closed instead of handing elevated permissions to the public.
          const defaultPermissions = DEFAULT_ROLE_PERMISSIONS.TENANT_MEMBER;
          const effectivePermissions = role.permissionsConfigured
            ? role.rolePermissions.map(({ permission }) => permission.key)
            : defaultPermissions;
          const allowedPermissions = new Set<string>(defaultPermissions);
          if (!effectivePermissions.includes(PERMISSIONS.DASHBOARD_READ) || effectivePermissions.some((permission) => !allowedPermissions.has(permission))) {
            throw AppError.conflict('REGISTRATION_UNAVAILABLE', 'This workspace is not accepting registrations right now. Contact its administrator.');
          }

          const userId = randomUUID();
          const user = await tx.user.create({
            data: {
              id: userId,
              tenantId: host.tenantId,
              email: input.email,
              firstName: input.firstName,
              lastName: input.lastName?.trim() || null,
              passwordHash,
              status: 'INVITED',
              mustChangePassword: true,
              invitationTokenHash: tokenHash,
              invitationExpiresAt: expiresAt,
            },
            select: { id: true, email: true, firstName: true },
          });
          await tx.userRole.create({ data: { tenantId: host.tenantId, userId, roleId: role.id } });
          await tx.userBranchMembership.create({ data: { tenantId: host.tenantId, userId, branchId: branch.id, isPrimary: true } });
          await enqueueUserInvitation(tx, { tenantId: host.tenantId, userId, email: user.email, firstName: user.firstName, acceptUrl, tokenHash });
          await this.audit.record(tx, {
            tenantId: host.tenantId,
            actorId: null,
            actorEmail: user.email,
            action: 'auth.registration.requested',
            entityType: 'User',
            entityId: user.id,
            requestId,
            ipAddress: context.ip ?? null,
            userAgent: context.userAgent ?? null,
            after: { status: 'INVITED', roleKey: 'TENANT_MEMBER', branchId: branch.id, invitationExpiresAt: expiresAt.toISOString() },
          });
          return { submitted: true as const };
        }),
      );
    } catch (error) {
      // Keep an existing account indistinguishable from a newly queued invite.
      if (isUniqueViolation(error)) return { submitted: true };
      throw error;
    }
  }

  async acceptInvitation(input: AcceptInvitationInput, context: { requestId?: string; ip?: string; userAgent?: string }): Promise<{ accepted: true }> {
    const host = this.tenantContext.requireTenantHost();
    let tenantId: string;
    const isPlatformAdmin = host.kind === 'platform';
    if (host.kind === 'platform') {
      const platformTenant = await this.prisma.db.tenant.findUnique({
        where: { slug: PLATFORM_SYSTEM_TENANT_SLUG },
        select: { id: true, status: true },
      });
      if (!platformTenant || platformTenant.status !== 'ACTIVE') throw new UnauthorizedException('This platform invitation is not available.');
      tenantId = platformTenant.id;
    } else if (host.kind === 'tenant' && host.status === 'ACTIVE') {
      tenantId = host.tenantId;
    } else {
      throw new UnauthorizedException('This invitation is not available for this workspace.');
    }
    const tokenHash = this.passwords.hashToken(input.token);
    const passwordHash = await this.passwords.hash(input.password);
    const requestId = context.requestId ?? this.tenantContext.peek()?.requestId ?? 'unknown';
    return this.tenantContext.run(
      { ...(this.tenantContext.peek() ?? { requestId }), tenantId, requestId, isPlatformAdmin },
      () => this.prisma.transactionWithRetry(async (tx) => {
        const now = new Date();
        const user = await tx.user.findFirst({
          where: { tenantId, isPlatformAdmin, status: 'INVITED', deletedAt: null, invitationTokenHash: tokenHash, invitationExpiresAt: { gt: now } },
          select: { id: true, email: true, status: true },
        });
        if (!user) throw AppError.validation('This invitation is invalid or expired. Ask your organization administrator to send a new one.');
        const changed = await tx.user.updateMany({
          where: { tenantId, id: user.id, isPlatformAdmin, status: 'INVITED', invitationTokenHash: tokenHash, invitationExpiresAt: { gt: now }, deletedAt: null },
          data: {
            passwordHash, status: 'ACTIVE', mustChangePassword: false, emailVerifiedAt: now,
            invitationTokenHash: null, invitationExpiresAt: null, failedLoginCount: 0, lockedUntil: null, updatedBy: user.id,
          },
        });
        if (changed.count !== 1) throw AppError.conflict('INVITATION_ALREADY_USED', 'This invitation was already accepted or replaced. Ask an administrator to send a new one.');
        await this.audit.record(tx, {
          tenantId, actorId: user.id, actorEmail: user.email, action: 'auth.invitation.accepted',
          entityType: 'User', entityId: user.id, requestId, ipAddress: context.ip ?? null, userAgent: context.userAgent ?? null,
          before: { status: user.status }, after: { status: 'ACTIVE', emailVerified: true },
        });
        return { accepted: true as const };
      }),
    );
  }

  /**
   * Rotates a refresh token.
   *
   * The old token is revoked in the same transaction that issues its replacement,
   * so a stolen token is usable at most once and the theft becomes visible as a
   * reuse attempt.
   */
  async refresh(input: RefreshInput, context: { ip?: string; userAgent?: string; requestId?: string }): Promise<Session> {
    const refreshToken = input.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('A refresh session is required.');
    let claims: { sub: string; tid: string; jti: string };
    try {
      claims = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException('The refresh token is not valid or has expired.');
    }

    const requestId = context.requestId ?? this.tenantContext.peek()?.requestId ?? 'unknown';
    await this.assertRefreshHostTenant(claims.tid);
    return this.tenantContext.run(
      { ...(this.tenantContext.peek() ?? { requestId }), tenantId: claims.tid, requestId, isPlatformAdmin: false },
      async () => {
    const tokenHash = this.passwords.hashToken(refreshToken);
    const stored = await this.prisma.db.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      // A revoked token being presented is a signal worth recording.
      await this.audit.record(
        this.prisma.db as never,
        {
          tenantId: claims.tid,
          actorId: claims.sub,
          action: 'auth.refresh.reuse_detected',
          entityType: 'RefreshToken',
          entityId: stored?.id ?? null,
          severity: 'CRITICAL',
          reason: 'A revoked or unknown refresh token was presented.',
          requestId,
          ipAddress: context.ip ?? null,
        },
      ).catch(() => undefined);
      throw new UnauthorizedException('This session has already ended. Please sign in again.');
    }

    const user = await this.prisma.db.user.findFirst({ where: { id: claims.sub, tenantId: claims.tid } });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      throw new UnauthorizedException('This account is no longer active.');
    }

    const tenant = await this.prisma.db.tenant.findUnique({ where: { id: claims.tid }, select: { slug: true, name: true } });
    if (!tenant) throw new UnauthorizedException('This institution account is no longer available.');

    // Re-resolving here is what bounds the lifetime of a stale permission.
    const resolved = await this.resolveAccess(user.id, user.tenantId);
    const host = this.tenantContext.requireTenantHost();
    if ((host.kind === 'platform') !== user.isPlatformAdmin || user.isPlatformAdmin !== resolved.roles.includes('PLATFORM_ADMIN')) {
      throw new UnauthorizedException('This session is no longer valid for this hostname. Please sign in again.');
    }

    return this.prisma.transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      return this.issueSession(
        {
          userId: user.id,
          tenantId: user.tenantId,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          email: user.email,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: resolved.roles,
          permissions: resolved.permissions,
          isPlatformAdmin: user.isPlatformAdmin,
          sessionVersion: user.sessionVersion,
          studentId: user.studentId,
          guardianId: user.guardianId,
          mustChangePassword: user.mustChangePassword,
        },
        tx,
        stored.id,
      );
    });
      },
    );
  }

  async logout(
    refreshToken: string | undefined,
    actor: { id: string; tenantId: string } | undefined,
    context: { ip?: string; userAgent?: string; requestId?: string } = {},
  ): Promise<{ revoked: boolean }> {
    if (!refreshToken) return { revoked: false };
    let claims: { sub: string; tid: string };
    try {
      claims = await this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      return { revoked: false };
    }
    if (actor && actor.tenantId !== claims.tid) return { revoked: false };

    try {
      await this.assertRefreshHostTenant(claims.tid);
    } catch {
      return { revoked: false };
    }

    const requestId = context.requestId ?? this.tenantContext.peek()?.requestId ?? 'unknown';
    return this.tenantContext.run(
      { ...(this.tenantContext.peek() ?? { requestId }), tenantId: claims.tid, requestId, isPlatformAdmin: false },
      async () => {
        const tokenHash = this.passwords.hashToken(refreshToken);
        const result = await this.prisma.db.refreshToken.updateMany({
          where: { tenantId: claims.tid, tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        if (result.count > 0 && actor) {
          await this.prisma.transaction(async (tx) => {
            await this.audit.record(tx, {
              tenantId: actor.tenantId,
              actorId: actor.id,
              action: 'auth.logout',
              entityType: 'User',
              entityId: actor.id,
              requestId,
              ipAddress: context.ip ?? null,
              userAgent: context.userAgent ?? null,
            });
          });
        }
        return { revoked: result.count > 0 };
      },
    );
  }

  async me(userId: string, tenantId: string): Promise<OwnProfile> {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw AppError.notFound('User');
    const tenant = await this.prisma.db.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, name: true },
    });
    if (!tenant) throw AppError.notFound('Tenant');
    const resolved = await this.resolveAccess(user.id, user.tenantId);

    return {
      id: user.id,
      tenantId: user.tenantId,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      email: user.email,
      pendingEmail: user.pendingEmail,
      emailVerifiedAt: user.emailVerifiedAt,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: resolved.roles,
      permissions: resolved.permissions,
      isPlatformAdmin: user.isPlatformAdmin,
      studentId: user.studentId,
      guardianId: user.guardianId,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async updateOwnProfile(userId: string, tenantId: string, input: UpdateOwnProfileInput, context: { requestId?: string; ip?: string; userAgent?: string }) {
    const actor = this.tenantContext.require();
    if (actor.tenantId !== tenantId || actor.userId !== userId) throw AppError.forbidden('You can update only your own profile in this workspace.');
    const requestId = context.requestId ?? actor.requestId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null, status: 'ACTIVE' } });
      if (!current) throw AppError.notFound('Active user');
      const changed = await tx.user.updateMany({
        where: { tenantId, id: userId, deletedAt: null, status: 'ACTIVE', updatedAt: current.updatedAt },
        data: { ...input, updatedBy: userId },
      });
      if (changed.count !== 1) throw AppError.conflict('PROFILE_CHANGED', 'Your profile changed while it was being saved. Reload and retry.');
      const updated = await tx.user.findFirst({ where: { tenantId, id: userId }, select: { id: true, email: true, phone: true, firstName: true, lastName: true } });
      if (!updated) throw AppError.notFound('User');
      await this.audit.record(tx, {
        tenantId, actorId: userId, actorEmail: current.email, action: 'auth.profile.updated', entityType: 'User', entityId: userId,
        before: { phone: current.phone, firstName: current.firstName, lastName: current.lastName },
        after: { phone: updated.phone, firstName: updated.firstName, lastName: updated.lastName },
        requestId, ipAddress: context.ip ?? null, userAgent: context.userAgent ?? null,
      });
      return updated;
    });
  }

  async requestOwnEmailChange(userId: string, tenantId: string, input: ChangeOwnEmailInput, context: { requestId?: string; ip?: string; userAgent?: string }) {
    const actor = this.tenantContext.require();
    if (actor.tenantId !== tenantId || actor.userId !== userId) throw AppError.forbidden('You can change only your own email address.');
    const host = this.tenantContext.requireTenantHost();
    const isPlatformAdmin = host.kind === 'platform';
    if (host.kind === 'tenant') {
      if (host.status !== 'ACTIVE' || host.tenantId !== tenantId || actor.isPlatformAdmin) throw AppError.forbidden('Use the matching active workspace hostname to change this email.');
    } else if (host.kind === 'platform') {
      const platformTenant = await this.prisma.db.tenant.findUnique({ where: { slug: PLATFORM_SYSTEM_TENANT_SLUG }, select: { id: true, status: true } });
      if (!platformTenant || platformTenant.id !== tenantId || platformTenant.status !== 'ACTIVE' || !actor.isPlatformAdmin) throw AppError.forbidden('Use the platform hostname to change a platform administrator email.');
    } else {
      throw AppError.forbidden('This hostname cannot change account email.');
    }

    const token = this.passwords.generateToken();
    const tokenHash = this.passwords.hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);
    const acceptUrl = buildEmailChangeVerificationUrl(this.config.webAppUrl, host.hostname, token, this.config.isProduction);
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null, status: 'ACTIVE' } });
        if (!current || current.isPlatformAdmin !== isPlatformAdmin) throw AppError.notFound('Active account');
        if (!(await this.passwords.verify(input.currentPassword, current.passwordHash))) throw AppError.validation('The current password is incorrect.');
        if (input.email === current.email && current.emailVerifiedAt) throw AppError.validation('Enter a different email address.');
        const emailInUse = await tx.user.findFirst({ where: { tenantId, id: { not: userId }, email: input.email, deletedAt: null }, select: { id: true } });
        const pendingEmailInUse = await tx.user.findFirst({ where: { tenantId, id: { not: userId }, pendingEmail: input.email, deletedAt: null }, select: { id: true } });
        if (emailInUse || pendingEmailInUse) throw AppError.conflict('USER_EMAIL_EXISTS', 'That email address is already assigned or awaiting verification in this workspace.');
        const changed = await tx.user.updateMany({
          where: { tenantId, id: userId, status: 'ACTIVE', email: current.email, updatedAt: current.updatedAt },
          data: { pendingEmail: input.email, emailChangeTokenHash: tokenHash, emailChangeExpiresAt: expiresAt, updatedBy: userId },
        });
        if (changed.count !== 1) throw AppError.conflict('PROFILE_CHANGED', 'Your account changed while this request was being saved. Reload and retry.');
        await enqueueUserEmailVerification(tx, { tenantId, userId, email: input.email, firstName: current.firstName, acceptUrl, tokenHash });
        await this.audit.record(tx, {
          tenantId, actorId: userId, actorEmail: current.email, action: 'auth.email_change.requested', entityType: 'User', entityId: userId,
          before: { email: current.email }, after: { pendingEmail: input.email, expiresAt: expiresAt.toISOString() },
          requestId: context.requestId ?? actor.requestId, ipAddress: context.ip ?? null, userAgent: context.userAgent ?? null,
        });
        return { pendingEmail: input.email, expiresAt };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('USER_EMAIL_EXISTS', 'That email address is already assigned or awaiting verification in this workspace.');
      throw error;
    }
  }

  async acceptEmailChange(input: AcceptEmailChangeInput, context: { requestId?: string; ip?: string; userAgent?: string }): Promise<{ accepted: true; email: string }> {
    const host = this.tenantContext.requireTenantHost();
    const isPlatformAdmin = host.kind === 'platform';
    let tenantId: string;
    if (host.kind === 'platform') {
      const platformTenant = await this.prisma.db.tenant.findUnique({ where: { slug: PLATFORM_SYSTEM_TENANT_SLUG }, select: { id: true, status: true } });
      if (!platformTenant || platformTenant.status !== 'ACTIVE') throw new UnauthorizedException('This platform email verification is not available.');
      tenantId = platformTenant.id;
    } else if (host.kind === 'tenant' && host.status === 'ACTIVE') {
      tenantId = host.tenantId;
    } else {
      throw new UnauthorizedException('This email verification is not available for this workspace.');
    }
    const tokenHash = this.passwords.hashToken(input.token);
    const requestId = context.requestId ?? this.tenantContext.peek()?.requestId ?? 'unknown';
    try {
      return await this.tenantContext.run(
        { ...(this.tenantContext.peek() ?? { requestId }), tenantId, requestId, isPlatformAdmin },
        () => this.prisma.transactionWithRetry(async (tx) => {
          const now = new Date();
          const current = await tx.user.findFirst({
            where: { tenantId, isPlatformAdmin, status: 'ACTIVE', deletedAt: null, emailChangeTokenHash: tokenHash, emailChangeExpiresAt: { gt: now }, pendingEmail: { not: null } },
            select: { id: true, email: true, pendingEmail: true },
          });
          if (!current?.pendingEmail) throw AppError.validation('This email verification is invalid or expired. Request a new verification email.');
          const changed = await tx.user.updateMany({
            where: { tenantId, id: current.id, isPlatformAdmin, status: 'ACTIVE', emailChangeTokenHash: tokenHash, emailChangeExpiresAt: { gt: now }, pendingEmail: current.pendingEmail, deletedAt: null },
            data: { email: current.pendingEmail, emailVerifiedAt: now, pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null, sessionVersion: { increment: 1 }, updatedBy: current.id },
          });
          if (changed.count !== 1) throw AppError.conflict('EMAIL_VERIFICATION_CHANGED', 'This verification request changed while it was being accepted. Request a new one.');
          await tx.refreshToken.updateMany({ where: { tenantId, userId: current.id, revokedAt: null }, data: { revokedAt: now } });
          await this.audit.record(tx, {
            tenantId, actorId: current.id, actorEmail: current.email, action: 'auth.email_change.verified', entityType: 'User', entityId: current.id,
            before: { email: current.email }, after: { email: current.pendingEmail, emailVerified: true }, requestId,
            ipAddress: context.ip ?? null, userAgent: context.userAgent ?? null,
          });
          return { accepted: true as const, email: current.pendingEmail };
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('USER_EMAIL_EXISTS', 'That email address was assigned to another account before verification completed.');
      throw error;
    }
  }

  async changePassword(userId: string, tenantId: string, input: ChangePasswordInput, context: { requestId?: string; ip?: string; userAgent?: string }) {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
    const requestId = context.requestId ?? this.tenantContext.requestId ?? 'unknown';
    return this.prisma.transactionWithRetry(async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null } });
      if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('This account is no longer active.');
      if (!(await this.passwords.verify(input.currentPassword, user.passwordHash))) throw AppError.validation('The current password is incorrect.');
      if (await this.passwords.verify(input.newPassword, user.passwordHash)) throw AppError.validation('Choose a new password that differs from the current password.');
      const passwordHash = await this.passwords.hash(input.newPassword);
      const changed = await tx.user.updateMany({
        where: { tenantId, id: userId, passwordHash: user.passwordHash, status: 'ACTIVE' },
        data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null, updatedBy: userId },
      });
      if (changed.count !== 1) throw AppError.conflict('PASSWORD_CHANGED_CONCURRENTLY', 'This account changed while you were updating its password. Sign in again and retry.');
      await tx.refreshToken.updateMany({ where: { tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        tenantId, actorId: userId, actorEmail: user.email, action: 'auth.password.changed', entityType: 'User', entityId: userId,
        before: { mustChangePassword: user.mustChangePassword }, after: { mustChangePassword: false }, requestId,
        ipAddress: context.ip ?? null, userAgent: context.userAgent ?? null,
      });
      return { changed: true };
    });
  }

  private async assertRefreshHostTenant(tenantId: string): Promise<void> {
    const host = this.tenantContext.requireTenantHost();
    if (host.kind === 'tenant') {
      if ((host.status === 'SUSPENDED' || host.status === 'ARCHIVED') || host.tenantId !== tenantId) {
        throw new UnauthorizedException('This session does not belong to an active workspace on this hostname.');
      }
      return;
    }
    if (host.kind === 'platform') {
      const platformTenant = await this.prisma.db.tenant.findUnique({
        where: { slug: PLATFORM_SYSTEM_TENANT_SLUG },
        select: { id: true },
      });
      if (!platformTenant || platformTenant.id !== tenantId) {
        throw new UnauthorizedException('This session does not belong to the platform hostname.');
      }
      return;
    }
    throw new UnauthorizedException('This hostname does not resolve to an active workspace.');
  }

  /**
   * Effective permissions = the tenant's configured role permissions, falling back
   * to the platform default matrix for a system role that has no rows yet.
   *
   * The fallback is what makes a freshly provisioned tenant usable immediately,
   * while still allowing the tenant to narrow a role later.
   */
  private async resolveAccess(userId: string, tenantId: string): Promise<{ roles: string[]; permissions: string[] }> {
    const userRoleLinks = await this.prisma.db.userRole.findMany({
      where: { userId, tenantId },
      select: { roleId: true },
    });

    const linkedRoleIds = [...new Set(userRoleLinks.map((entry) => entry.roleId))];
    const tenantRoles = linkedRoleIds.length
      ? await this.prisma.db.role.findMany({
          where: { tenantId, id: { in: linkedRoleIds }, active: true },
          select: { id: true, key: true, permissionsConfigured: true },
        })
      : [];
    const roles = tenantRoles.map((entry) => entry.key);
    if (roles.length === 0) return { roles, permissions: [] };

    const roleIds = tenantRoles.map((entry) => entry.id);
    const permissionLinks = await this.prisma.db.rolePermission.findMany({
      where: { tenantId, roleId: { in: roleIds } },
      select: { roleId: true, permissionId: true },
    });
    // Keep the tenant-owned link query separate from the global permission
    // catalogue read. Nested relation traversal is intentionally rejected by
    // the scoped Prisma boundary because it cannot inject tenant predicates.
    const permissionIds = [...new Set(permissionLinks.map((link) => link.permissionId))];
    const permissionRows = permissionIds.length
      ? await this.prisma.db.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, key: true } })
      : [];
    const permissionKeyById = new Map(permissionRows.map((permission) => [permission.id, permission.key]));
    const configuredByRole = new Map<string, Set<string>>();
    for (const link of permissionLinks) {
      const keys = configuredByRole.get(link.roleId) ?? new Set<string>();
      const permissionKey = permissionKeyById.get(link.permissionId);
      if (permissionKey) keys.add(permissionKey);
      configuredByRole.set(link.roleId, keys);
    }
    const effectivePermissions = new Set<string>();
    for (const role of tenantRoles) {
      if (role.permissionsConfigured) {
        for (const permission of configuredByRole.get(role.id) ?? []) effectivePermissions.add(permission);
      } else {
        for (const permission of DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey] ?? []) effectivePermissions.add(permission);
      }
    }
    return { roles, permissions: [...effectivePermissions].sort() };
  }

  private async issueSession(
    input: IssueSessionInput,
    existingTx?: TransactionHandle,
    rotatedFromId?: string,
  ): Promise<Session> {
    const tokenId = randomUUID();
    const refreshToken = await this.tokens.signRefreshToken({ id: input.userId, tenantId: input.tenantId }, tokenId);
    const accessToken = await this.tokens.signAccessToken(
      buildAuthenticatedUser({
        id: input.userId,
        tenantId: input.tenantId,
        email: input.email,
        roles: input.roles,
        permissions: input.permissions,
        isPlatformAdmin: input.isPlatformAdmin,
        sessionVersion: input.sessionVersion,
        studentId: input.studentId,
        guardianId: input.guardianId,
      }),
    );

    const persist = async (tx: TransactionHandle): Promise<void> => {
      await tx.refreshToken.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          tokenHash: this.passwords.hashToken(refreshToken),
          expiresAt: new Date(Date.now() + this.config.jwtRefreshTtlSeconds * 1_000),
          rotatedFromId: rotatedFromId ?? null,
        },
      });
    };

    if (existingTx) await persist(existingTx);
    else await this.prisma.transaction(persist);

    const user: SessionUser = {
      id: input.userId,
      tenantId: input.tenantId,
      tenantSlug: input.tenantSlug,
      tenantName: input.tenantName,
      email: input.email,
      phone: input.phone ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      roles: input.roles,
      permissions: input.permissions,
      isPlatformAdmin: input.isPlatformAdmin,
      studentId: input.studentId,
      guardianId: input.guardianId,
      mustChangePassword: input.mustChangePassword,
    };

    return { accessToken, refreshToken, expiresIn: this.config.jwtAccessTtlSeconds, user };
  }
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: AppConfigService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodValidationPipe(loginSchema))
  @ApiOperation({ summary: 'Sign in to a tenant' })
  async login(@Body() body: LoginInput, @Req() request: RequestWithContext, @Res({ passthrough: true }) response: Response): Promise<Omit<Session, 'refreshToken'>> {
    // No `@CurrentUser()` here: the route is public, and reading the authenticated
    // principal would force an authentication that has not happened yet.
    this.assertBrowserOrigin(request);
    const session = await this.auth.login(body, authRequestContext(request));
    this.setRefreshCookie(response, session.refreshToken);
    const { refreshToken: _refreshToken, ...publicSession } = session;
    return publicSession;
  }

  @Post('register')
  @Public()
  @HttpCode(202)
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodValidationPipe(publicTenantRegistrationSchema))
  @ApiOperation({ summary: 'Request a tenant account invitation on the current workspace host' })
  register(@Body() body: PublicTenantRegistrationInput, @Req() request: RequestWithContext): Promise<{ submitted: true }> {
    this.assertBrowserOrigin(request);
    return this.auth.requestTenantRegistration(body, authRequestContext(request));
  }

  @Post('accept-invitation')
  @Public()
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodValidationPipe(acceptInvitationSchema))
  @ApiOperation({ summary: 'Accept a tenant user invitation and set a verified password' })
  acceptInvitation(@Body() body: AcceptInvitationInput, @Req() request: RequestWithContext): Promise<{ accepted: true }> {
    this.assertBrowserOrigin(request);
    return this.auth.acceptInvitation(body, authRequestContext(request));
  }

  @Post('accept-email-change')
  @Public()
  @HttpCode(200)
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodValidationPipe(acceptEmailChangeSchema))
  @ApiOperation({ summary: 'Verify a pending account email change and revoke existing sessions' })
  acceptEmailChange(@Body() body: AcceptEmailChangeInput, @Req() request: RequestWithContext) {
    this.assertBrowserOrigin(request);
    return this.auth.acceptEmailChange(body, authRequestContext(request));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(refreshSchema))
  @ApiOperation({ summary: 'Rotate a refresh token' })
  async refresh(@Body() body: RefreshInput, @Req() request: RequestWithContext, @Res({ passthrough: true }) response: Response): Promise<Omit<Session, 'refreshToken'>> {
    this.assertBrowserOrigin(request);
    const cookieToken = (request as RequestWithContext & { cookies?: Record<string, string> }).cookies?.fee_refresh;
    const refreshToken = body.refreshToken ?? cookieToken;
    if (!refreshToken) throw new UnauthorizedException('A refresh session is required.');
    const session = await this.auth.refresh({ refreshToken }, authRequestContext(request));
    this.setRefreshCookie(response, session.refreshToken);
    const { refreshToken: _refreshToken, ...publicSession } = session;
    return publicSession;
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() body: { refreshToken?: string }, @Req() request: RequestWithContext, @Res({ passthrough: true }) response: Response): Promise<{ revoked: boolean }> {
    this.assertBrowserOrigin(request);
    const cookieToken = (request as RequestWithContext & { cookies?: Record<string, string> }).cookies?.fee_refresh;
    const result = await this.auth.logout(body?.refreshToken ?? cookieToken, undefined, authRequestContext(request));
    response.clearCookie('fee_refresh', this.refreshCookieOptions());
    return result;
  }

  @Get('me')
  @PortalRoute()
  @ApiOperation({ summary: 'The signed-in user, their roles and permissions' })
  async me(@CurrentUser() user: { id: string; tenantId: string }): Promise<OwnProfile> {
    return this.auth.me(user.id, user.tenantId);
  }

  @Patch('me')
  @PortalRoute()
  @UsePipes(new ZodValidationPipe(updateOwnProfileSchema))
  @ApiOperation({ summary: 'Update the signed-in user’s own name and phone number' })
  updateOwnProfile(@CurrentUser() user: { id: string; tenantId: string }, @Body() body: UpdateOwnProfileInput, @Req() request: RequestWithContext) {
    return this.auth.updateOwnProfile(user.id, user.tenantId, body, authRequestContext(request));
  }

  @Post('me/email-change')
  @UsePipes(new ZodValidationPipe(changeOwnEmailSchema))
  @ApiOperation({ summary: 'Request a verified change to the signed-in account email address' })
  requestOwnEmailChange(@CurrentUser() user: { id: string; tenantId: string }, @Body() body: ChangeOwnEmailInput, @Req() request: RequestWithContext) {
    return this.auth.requestOwnEmailChange(user.id, user.tenantId, body, authRequestContext(request));
  }

  @Post('change-password')
  @PortalRoute()
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  @ApiOperation({ summary: 'Change the signed-in user password and revoke all refresh sessions' })
  changePassword(@CurrentUser() user: { id: string; tenantId: string }, @Body() body: ChangePasswordInput, @Req() request: RequestWithContext) {
    return this.auth.changePassword(user.id, user.tenantId, body, authRequestContext(request));
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie('fee_refresh', token, { ...this.refreshCookieOptions(), maxAge: this.config.jwtRefreshTtlSeconds * 1000 });
  }

  private refreshCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax' as const,
      path: `${this.config.apiBasePath}/auth`,
    };
  }

  private assertBrowserOrigin(request: RequestWithContext): void {
    const origin = request.headers.origin;
    if (origin && !this.config.allowsBrowserOrigin(origin, request.headers.host)) {
      throw AppError.forbidden('The request origin is not allowed.');
    }
  }
}

function authRequestContext(request: RequestWithContext): { requestId?: string; ip?: string; userAgent?: string } {
  return {
    requestId: request.requestId,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

@Module({
  imports: [PrismaModule, TenantContextModule, FinancialModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, InMemoryRateLimitStore, LoginRateLimitGuard],
  exports: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
