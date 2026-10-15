import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { accessTierForRoles, DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, PERMISSIONS, ROLE_KEYS, type RoleKey } from '@fee/types';
import { isUniqueViolation, type TransactionClient } from '@fee/database';
import {
  assignUserRolesSchema,
  bulkInviteTenantUsersSchema,
  inviteTenantUserSchema,
  updateRolePermissionsSchema,
  createTenantRoleSchema,
  updateTenantRoleSchema,
  updateTenantUserStatusSchema,
  updateTenantUserProfileSchema,
  resetTenantUserPasswordSchema,
  type AssignUserRolesInput,
  type BulkInviteTenantUsersInput,
  type CreateTenantUserInput,
  type InviteTenantUserInput,
  type UpdateTenantUserProfileInput,
  type UpdateRolePermissionsInput,
  type CreateTenantRoleInput,
  type UpdateTenantRoleInput,
  type UpdateTenantUserStatusInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { AuthModule } from './auth';
import { PasswordService } from '../common/security';
import { AppConfigService } from '../config/env';
import { buildPasswordResetUrl, buildUserInvitationUrl, enqueuePasswordReset, enqueueUserInvitation } from '../common/invitations';
import { assertTenantUserSeatAvailable } from '../common/user-limits';

export type AccessMutationAudit = (tx: TransactionClient) => Promise<void>;

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
    private readonly config?: AppConfigService,
  ) {}

  async listUsers(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['email', 'firstName', 'status', 'createdAt'] });
    const where = {
      tenantId,
      deletedAt: null,
      ...(query.status?.length ? { status: { in: query.status as Array<'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED'> } } : {}),
      ...buildSearchFilter(query.search, ['email', 'firstName', 'lastName', 'phone']),
    };
    const [users, total] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        select: {
          id: true, email: true, phone: true, firstName: true, lastName: true, status: true, mustChangePassword: true, studentId: true, guardianId: true, tenantPersonId: true,
          lastLoginAt: true, createdAt: true, invitationExpiresAt: true, emailVerifiedAt: true,
        },
        orderBy: toPrismaOrderBy(query.sort) as never,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.db.user.count({ where }),
    ]);
    const userIds = users.map(({ id }) => id);
    const [roleLinks, branchLinks, unitLinks] = userIds.length ? await Promise.all([
      this.prisma.db.userRole.findMany({ where: { tenantId, userId: { in: userIds } } }),
      this.prisma.db.userBranchMembership.findMany({ where: { tenantId, userId: { in: userIds } }, select: { userId: true, branchId: true, isPrimary: true } }),
      this.prisma.db.userOrganizationMembership.findMany({ where: { tenantId, userId: { in: userIds } }, select: { userId: true, unitId: true } }),
    ]) : [[], [], []] as const;
    const roleIds = [...new Set(roleLinks.map(({ roleId }) => roleId))];
    const roles = roleIds.length ? await this.prisma.db.role.findMany({ where: { tenantId, id: { in: roleIds } }, select: { id: true, key: true, name: true } }) : [];
    const branchIds = [...new Set(branchLinks.map(({ branchId }) => branchId))];
    const branches = branchIds.length ? await this.prisma.db.branch.findMany({ where: { tenantId, id: { in: branchIds } }, select: { id: true, code: true, name: true } }) : [];
    const unitIds = [...new Set(unitLinks.map(({ unitId }) => unitId))];
    const units = unitIds.length ? await this.prisma.db.organizationUnit.findMany({ where: { tenantId, id: { in: unitIds } }, select: { id: true, code: true, name: true, unitType: true } }) : [];
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const rolesByUser = new Map<string, Array<{ role: { id: string; key: string; name: string } }>>();
    const branchesByUser = new Map<string, Array<{ id: string; code: string; name: string; isPrimary: boolean }>>();
    const unitsByUser = new Map<string, Array<{ id: string; code: string; name: string; unitType: string }>>();
    for (const link of roleLinks) {
      const role = roleById.get(link.roleId);
      if (role) rolesByUser.set(link.userId, [...(rolesByUser.get(link.userId) ?? []), { role }]);
    }
    for (const link of branchLinks) {
      const branch = branchById.get(link.branchId);
      if (branch) branchesByUser.set(link.userId, [...(branchesByUser.get(link.userId) ?? []), { ...branch, isPrimary: link.isPrimary }]);
    }
    for (const link of unitLinks) {
      const unit = unitById.get(link.unitId);
      if (unit) unitsByUser.set(link.userId, [...(unitsByUser.get(link.userId) ?? []), unit]);
    }
    const items = users.map((user) => {
      const userRoles = rolesByUser.get(user.id) ?? [];
      return { ...user, userRoles, branches: branchesByUser.get(user.id) ?? [], organizationUnits: unitsByUser.get(user.id) ?? [], accessTier: accessTierForRoles(userRoles.map(({ role }) => role.key)) };
    });
    return paginate(items, total, query);
  }

  async createUser(tenantId: string, input: CreateTenantUserInput, extraAudit?: AccessMutationAudit) {
    this.assertTenant(tenantId);
    const actor = this.tenantContext.require();
    const actorId = actor.userId;
    const tenantActorId = actor.isPlatformAdmin ? undefined : actorId;
    const roleIds = [...new Set(input.roleIds)];
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        await this.assertSeatAvailable(tx, tenantId);
        const roles = await this.assertRoleIds(tx, tenantId, roleIds);
        this.assertMayAssignTenantAdministratorRole(roles.map((role) => role.key));
        await this.assertPortalIdentity(tx, tenantId, roles.map((role) => role.key), input.studentId ?? null, input.guardianId ?? null, input.tenantPersonId ?? null, undefined, input.email);
        const id = cryptoRandomId();
        const user = await tx.user.create({
          data: {
            id,
            tenantId,
            email: input.email,
            phone: input.phone?.trim() || null,
            firstName: input.firstName,
            lastName: input.lastName?.trim() || null,
            passwordHash,
            status: 'ACTIVE',
            mustChangePassword: true,
            studentId: input.studentId ?? null,
            guardianId: input.guardianId ?? null,
            tenantPersonId: input.tenantPersonId ?? null,
            createdBy: tenantActorId ?? null,
          },
          select: { id: true, email: true, phone: true, firstName: true, lastName: true, status: true, mustChangePassword: true, studentId: true, guardianId: true, tenantPersonId: true, createdAt: true },
        });
        await tx.userRole.createMany({ data: roles.map((role) => ({ tenantId, userId: id, roleId: role.id, grantedBy: tenantActorId ?? null })) });
        const primaryBranch = await tx.branch.findFirst({
          where: { tenantId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!primaryBranch) throw AppError.conflict('NO_ACTIVE_BRANCH', 'Create or activate a branch before adding organization users.');
        await tx.userBranchMembership.create({
          data: { tenantId, userId: id, branchId: primaryBranch.id, isPrimary: true, grantedBy: tenantActorId ?? null },
        });
        if (extraAudit) await extraAudit(tx);
        else await this.audit.record(tx, {
          tenantId, actorId: tenantActorId, action: 'user.created', entityType: 'User', entityId: id,
          after: { email: user.email, status: user.status, mustChangePassword: true, roleIds },
        });
        return { ...user, roles: roles.map(({ id: roleId, key, name }) => ({ id: roleId, key, name })) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('USER_EMAIL_EXISTS', 'A user with this email address already exists in this organization.');
      throw error;
    }
  }

  async inviteUser(tenantId: string, input: InviteTenantUserInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const host = this.tenantContext.requireTenantHost();
    if (host.kind !== 'tenant' || host.tenantId !== tenantId) throw AppError.forbidden('Invitations can only be sent from this tenant workspace.');
    try {
      return await this.prisma.transactionWithRetry(async (tx) => this.createInvitation(tx, tenantId, input, actorId, host.hostname));
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('USER_EMAIL_EXISTS', 'A user with this email address already exists in this organization.');
      throw error;
    }
  }

  async inviteUsersBulk(tenantId: string, input: BulkInviteTenantUsersInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const host = this.tenantContext.requireTenantHost();
    if (host.kind !== 'tenant' || host.tenantId !== tenantId) throw AppError.forbidden('Invitations can only be sent from this tenant workspace.');
    const emails = input.users.map((user) => user.email.toLowerCase());
    if (new Set(emails).size !== emails.length) throw AppError.validation('Remove duplicate email addresses from the import before continuing.');
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const existing = await tx.user.findMany({ where: { tenantId, email: { in: emails }, deletedAt: null }, select: { email: true } });
        if (existing.length) throw AppError.conflict('USER_EMAIL_EXISTS', `These email addresses already have accounts in this organization: ${existing.map(({ email }) => email).join(', ')}.`);
        const items = [];
        for (const user of input.users) items.push(await this.createInvitation(tx, tenantId, user, actorId, host.hostname));
        return { items, count: items.length };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('USER_EMAIL_EXISTS', 'At least one email address already has an account in this organization. Nothing was imported; review the file and try again.');
      throw error;
    }
  }

  private async createInvitation(tx: TransactionClient, tenantId: string, input: InviteTenantUserInput, actorId: string | undefined, hostname: string) {
    await this.assertSeatAvailable(tx, tenantId);
    const roleIds = [...new Set(input.roleIds)];
    const roles = await this.assertRoleIds(tx, tenantId, roleIds);
    this.assertMayAssignTenantAdministratorRole(roles.map((role) => role.key));
    const linkedPerson = input.personNumber
      ? await tx.tenantPerson.findFirst({ where: { tenantId, personNumber: input.personNumber, deletedAt: null }, select: { id: true, branchId: true } })
      : null;
    if (input.personNumber && !linkedPerson) throw AppError.validation(`No active organisation person has profile number ${input.personNumber}.`);
    let tenantPersonId = input.tenantPersonId ?? linkedPerson?.id ?? null;
    await this.assertPortalIdentity(tx, tenantId, roles.map((role) => role.key), input.studentId ?? null, input.guardianId ?? null, tenantPersonId, undefined, input.email);

    const actor = this.tenantContext.require();
    let requestedBranchIds = input.branchIds ? [...input.branchIds] : [];
    if (!requestedBranchIds.length && actor.branchScopeEnabled) requestedBranchIds = [...new Set(actor.branchIds ?? [])].slice(0, 1);
    if (!requestedBranchIds.length) {
      const primary = await tx.branch.findFirst({ where: { tenantId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (primary) requestedBranchIds = [primary.id];
    }
    if (!requestedBranchIds.length) throw AppError.conflict('NO_ACTIVE_BRANCH', 'Create or activate a branch before adding organization users.');
    if (actor.branchScopeEnabled && requestedBranchIds.some((branchId) => !(actor.branchIds ?? []).includes(branchId))) {
      throw AppError.forbidden('You can only assign users to branches where you have access.');
    }
    const branches = await tx.branch.findMany({ where: { tenantId, id: { in: requestedBranchIds }, status: 'ACTIVE' }, select: { id: true } });
    if (branches.length !== requestedBranchIds.length) throw AppError.validation('Choose active branches from this organization.');
    if (tenantPersonId && linkedPerson?.branchId && !requestedBranchIds.includes(linkedPerson.branchId)) throw AppError.validation('The invited member must be assigned to their profile branch.');
    const primaryBranchId = input.primaryBranchId ?? requestedBranchIds[0]!;
    if (!requestedBranchIds.includes(primaryBranchId)) throw AppError.validation('The primary branch must be included in the assigned branches.');
    const organizationUnitIds = [...new Set(input.organizationUnitIds ?? [])];
    if (organizationUnitIds.length) {
      const units = await tx.organizationUnit.findMany({ where: { tenantId, id: { in: organizationUnitIds }, active: true }, select: { id: true } });
      if (units.length !== organizationUnitIds.length) throw AppError.validation('Choose active groups from this organization.');
    }

    const passwordHash = await this.passwords.hash(this.passwords.generateToken());
    const token = this.passwords.generateToken();
    const tokenHash = this.passwords.hashToken(token);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const acceptUrl = buildUserInvitationUrl(this.config?.webAppUrl ?? 'http://platform.localhost:3000', hostname, token, this.config?.isProduction ?? false);
    const id = cryptoRandomId();
    if (!tenantPersonId && input.studentId) {
      const student = await tx.student.findFirst({ where: { tenantId, id: input.studentId }, select: { personId: true } });
      tenantPersonId = student?.personId ?? null;
    }
    const user = await tx.user.create({
      data: {
        id, tenantId, email: input.email, phone: input.phone?.trim() || null,
        firstName: input.firstName, lastName: input.lastName?.trim() || null, passwordHash,
        status: 'INVITED', mustChangePassword: true, studentId: input.studentId ?? null, tenantPersonId,
        guardianId: input.guardianId ?? null, createdBy: actorId ?? null,
        invitationTokenHash: tokenHash, invitationExpiresAt: expiresAt,
      },
      select: { id: true, email: true, firstName: true, status: true, createdAt: true },
    });
    await tx.userRole.createMany({ data: roles.map((role) => ({ tenantId, userId: id, roleId: role.id, grantedBy: actorId ?? null })) });
    await tx.userBranchMembership.createMany({ data: requestedBranchIds.map((branchId) => ({ tenantId, userId: id, branchId, isPrimary: branchId === primaryBranchId, grantedBy: actorId ?? null })) });
    if (organizationUnitIds.length) await tx.userOrganizationMembership.createMany({ data: organizationUnitIds.map((unitId) => ({ tenantId, userId: id, unitId })) });
    await enqueueUserInvitation(tx, { tenantId, userId: id, email: user.email, firstName: user.firstName, acceptUrl, tokenHash });
    await this.audit.record(tx, {
      tenantId, actorId, action: 'user.invitation.sent', entityType: 'User', entityId: id,
      after: { email: user.email, status: user.status, expiresAt: expiresAt.toISOString(), roleIds, branchIds: requestedBranchIds, organizationUnitIds },
    });
    return { id: user.id, email: user.email, firstName: user.firstName, status: user.status, invitationExpiresAt: expiresAt };
  }

  async resendInvitation(tenantId: string, userId: string, extraAudit?: AccessMutationAudit) {
    this.assertTenant(tenantId);
    const actor = this.tenantContext.require();
    const actorId = actor.userId;
    const tenantActorId = actor.isPlatformAdmin ? undefined : actorId;
    const host = this.tenantContext.requireTenantHost();
    if (host.kind !== 'tenant' || host.tenantId !== tenantId) throw AppError.forbidden('Invitations can only be sent from this tenant workspace.');
    const token = this.passwords.generateToken();
    const tokenHash = this.passwords.hashToken(token);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const acceptUrl = buildUserInvitationUrl(this.config?.webAppUrl ?? 'http://platform.localhost:3000', host.hostname, token, this.config?.isProduction ?? false);
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null, status: { in: ['INVITED', 'SUSPENDED', 'DISABLED'] } } });
      if (!current) throw AppError.notFound('Pending invitation');
      if (current.emailVerifiedAt) throw AppError.conflict('USER_ALREADY_VERIFIED', 'This account has already verified its email address.');
      await this.assertMayManageTenantAdministrator(tx, tenantId, userId);
      const changed = await tx.user.updateMany({
        where: { tenantId, id: userId, status: current.status, updatedAt: current.updatedAt },
        data: { status: 'INVITED', invitationTokenHash: tokenHash, invitationExpiresAt: expiresAt, pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null, updatedBy: tenantActorId ?? null },
      });
      if (changed.count !== 1) throw AppError.conflict('INVITATION_CHANGED', 'This invitation changed while it was being resent. Reload and retry.');
      await enqueueUserInvitation(tx, { tenantId, userId, email: current.email, firstName: current.firstName, acceptUrl, tokenHash });
      if (extraAudit) {
        await extraAudit(tx);
      } else {
        await this.audit.record(tx, {
          tenantId, actorId: tenantActorId, action: 'user.invitation.resent', entityType: 'User', entityId: userId,
          before: { invitationExpiresAt: current.invitationExpiresAt?.toISOString() ?? null },
          after: { invitationExpiresAt: expiresAt.toISOString() },
        });
      }
      return { id: current.id, email: current.email, status: current.status, invitationExpiresAt: expiresAt };
    });
  }

  async sendPasswordResetLink(tenantId: string, userId: string) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    const host = this.tenantContext.requireTenantHost();
    if (host.kind !== 'tenant' || host.tenantId !== tenantId) throw AppError.forbidden('Password reset links can only be sent from this tenant workspace.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.user.findFirst({ where: { tenantId, id: userId, isPlatformAdmin: false, deletedAt: null, status: 'ACTIVE' }, select: { id: true, email: true, firstName: true, emailVerifiedAt: true } });
      if (!current) throw AppError.notFound('Active organization user');
      if (!current.emailVerifiedAt) throw AppError.conflict('USER_INVITATION_REQUIRED', 'This user has not activated their account yet. Resend the invitation instead.');
      await this.assertMayManageTenantAdministrator(tx, tenantId, userId);
      const token = this.passwords.generateToken();
      const tokenHash = this.passwords.hashToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);
      const resetUrl = buildPasswordResetUrl(this.config?.webAppUrl ?? 'http://platform.localhost:3000', host.hostname, token, this.config?.isProduction ?? false);
      const changed = await tx.user.updateMany({
        where: { tenantId, id: userId, status: 'ACTIVE', email: current.email, emailVerifiedAt: { not: null }, deletedAt: null },
        data: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
      });
      if (changed.count !== 1) throw AppError.conflict('PASSWORD_RESET_CHANGED', 'This account changed while the reset link was being created. Reload and retry.');
      await enqueuePasswordReset(tx, { tenantId, userId, email: current.email, firstName: current.firstName, resetUrl, tokenHash });
      await this.audit.record(tx, { tenantId, actorId, action: 'user.password_reset.sent', entityType: 'User', entityId: userId, after: { expiresAt: expiresAt.toISOString() } });
      return { id: userId, email: current.email, expiresAt };
    });
  }

  async assignRoles(tenantId: string, userId: string, input: AssignUserRolesInput, extraAudit?: AccessMutationAudit) {
    this.assertTenant(tenantId);
    const actor = this.tenantContext.require();
    const actorId = actor.userId;
    const tenantActorId = actor.isPlatformAdmin ? undefined : actorId;
    const roleIds = [...new Set(input.roleIds)];
    return this.prisma.transactionWithRetry(async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null }, select: { id: true, email: true, studentId: true, guardianId: true, tenantPersonId: true } });
      if (!user) throw AppError.notFound('User');
      const roles = await this.assertRoleIds(tx, tenantId, roleIds);
      this.assertMayAssignTenantAdministratorRole(roles.map((role) => role.key));
      await this.assertPortalIdentity(tx, tenantId, roles.map((role) => role.key), user.studentId ?? null, user.guardianId ?? null, user.tenantPersonId ?? null, user.id, user.email);
      const existing = await tx.userRole.findMany({ where: { tenantId, userId } });
      const existingRoleIds = [...new Set(existing.map(({ roleId }) => roleId))];
      const existingRoles = existingRoleIds.length ? await tx.role.findMany({ where: { tenantId, id: { in: existingRoleIds } }, select: { id: true, key: true } }) : [];
      this.assertMayManageTenantAdministratorRoles(existingRoles.map((role) => role.key));
      const existingRoleById = new Map(existingRoles.map((role) => [role.id, role]));
      const wasAdmin = existing.some((link) => isTenantAdminRole(existingRoleById.get(link.roleId)?.key));
      const remainsAdmin = roles.some((role) => isTenantAdminRole(role.key));
      if (wasAdmin && !remainsAdmin) await this.assertAnotherActiveTenantAdministrator(tx, tenantId, userId);
      const before = existing.map((link) => link.roleId);
      await tx.userRole.deleteMany({ where: { tenantId, userId } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ tenantId, userId, roleId: role.id, grantedBy: tenantActorId ?? null })) });
      await tx.refreshToken.updateMany({ where: { tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (extraAudit) await extraAudit(tx);
      else await this.audit.record(tx, { tenantId, actorId: tenantActorId, action: 'user.roles.assigned', entityType: 'User', entityId: userId, before: { roleIds: before }, after: { roleIds } });
      return { userId, email: user.email, roles: roles.map(({ id, key, name }) => ({ id, key, name })) };
    });
  }

  async updateStatus(tenantId: string, userId: string, input: UpdateTenantUserStatusInput, extraAudit?: AccessMutationAudit) {
    this.assertTenant(tenantId);
    const actor = this.tenantContext.require();
    const actorId = actor.userId;
    const tenantActorId = actor.isPlatformAdmin ? undefined : actorId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null } });
      if (!user) throw AppError.notFound('User');
      if (input.status === 'ACTIVE' && !user.emailVerifiedAt) {
        throw AppError.conflict('USER_INVITATION_REQUIRED', 'An account must verify its email before it can be activated.');
      }
      const roleLinks = await tx.userRole.findMany({ where: { tenantId, userId } });
      const roleIds = [...new Set(roleLinks.map(({ roleId }) => roleId))];
      const roles = roleIds.length ? await tx.role.findMany({ where: { tenantId, id: { in: roleIds } }, select: { id: true, key: true } }) : [];
      this.assertMayManageTenantAdministratorRoles(roles.map((role) => role.key));
      if (roles.some((role) => isTenantAdminRole(role.key)) && input.status !== 'ACTIVE') await this.assertAnotherActiveTenantAdministrator(tx, tenantId, userId);
      const changed = await tx.user.updateMany({ where: { tenantId, id: userId, updatedAt: user.updatedAt }, data: {
        status: input.status,
        ...(input.status === 'ACTIVE' ? {} : {
          invitationTokenHash: null, invitationExpiresAt: null,
          pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null,
        }),
        updatedBy: tenantActorId ?? null,
      } });
      if (changed.count !== 1) throw AppError.conflict('USER_CHANGED', 'This user changed while you were updating the account. Reload and retry.');
      if (input.status !== 'ACTIVE') await tx.refreshToken.updateMany({ where: { tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (extraAudit) await extraAudit(tx);
      else await this.audit.record(tx, { tenantId, actorId: tenantActorId, action: 'user.status.updated', entityType: 'User', entityId: userId, before: { status: user.status }, after: { status: input.status } });
      return { id: userId, status: input.status };
    });
  }

  async updateUserProfile(tenantId: string, userId: string, input: UpdateTenantUserProfileInput, extraAudit?: AccessMutationAudit) {
    this.assertTenant(tenantId);
    const actor = this.tenantContext.require();
    const actorId = actor.userId;
    const tenantActorId = actor.isPlatformAdmin ? undefined : actorId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const current = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null } });
        if (!current) throw AppError.notFound('User');
        if (input.email && input.email !== current.email) {
          throw AppError.conflict('EMAIL_CHANGE_VERIFICATION_REQUIRED', 'The user must verify a new email address before it can replace the current one.');
        }
        await this.assertMayManageTenantAdministrator(tx, tenantId, userId);
        const changed = await tx.user.updateMany({
          where: { tenantId, id: userId, deletedAt: null, updatedAt: current.updatedAt },
          data: { ...input, updatedBy: tenantActorId ?? null },
        });
        if (changed.count !== 1) throw AppError.conflict('USER_CHANGED', 'This user changed while the profile was being updated. Reload and retry.');
        const updated = await tx.user.findFirst({
          where: { tenantId, id: userId },
          select: { id: true, email: true, phone: true, firstName: true, lastName: true, status: true, mustChangePassword: true, createdAt: true, updatedAt: true },
        });
        if (!updated) throw AppError.notFound('User');
        if (extraAudit) await extraAudit(tx);
        else await this.audit.record(tx, {
          tenantId, actorId: tenantActorId, action: 'user.profile.updated', entityType: 'User', entityId: userId,
          before: { email: current.email, phone: current.phone, firstName: current.firstName, lastName: current.lastName },
          after: { email: updated.email, phone: updated.phone, firstName: updated.firstName, lastName: updated.lastName },
        });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('USER_EMAIL_EXISTS', 'A user with this email address already exists in this organization.');
      throw error;
    }
  }

  async resetTemporaryPassword(tenantId: string, userId: string, temporaryPassword: string, extraAudit?: AccessMutationAudit) {
    this.assertTenant(tenantId);
    const actor = this.tenantContext.require();
    const actorId = actor.userId;
    const tenantActorId = actor.isPlatformAdmin ? undefined : actorId;
    const passwordHash = await this.passwords.hash(temporaryPassword);
    return this.prisma.transactionWithRetry(async (tx) => {
      const user = await tx.user.findFirst({ where: { tenantId, id: userId, deletedAt: null }, select: { id: true, email: true, mustChangePassword: true } });
      if (!user) throw AppError.notFound('User');
      await this.assertMayManageTenantAdministrator(tx, tenantId, userId);
      const changed = await tx.user.updateMany({
        where: { tenantId, id: userId, deletedAt: null },
        data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, pendingEmail: null, emailChangeTokenHash: null, emailChangeExpiresAt: null, updatedBy: tenantActorId ?? null },
      });
      if (changed.count !== 1) throw AppError.conflict('USER_CHANGED', 'This user changed while the password was being reset. Reload and retry.');
      await tx.refreshToken.updateMany({ where: { tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (extraAudit) await extraAudit(tx);
      else await this.audit.record(tx, {
        tenantId, actorId: tenantActorId, action: 'user.temporary_password.reset', entityType: 'User', entityId: userId,
        before: { mustChangePassword: user.mustChangePassword }, after: { mustChangePassword: true },
      });
      return { id: user.id, email: user.email, mustChangePassword: true };
    });
  }

  async listRoles(tenantId: string) {
    this.assertTenant(tenantId);
    const roles = await this.prisma.db.role.findMany({
      where: { tenantId, key: { not: 'PLATFORM_ADMIN' } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    const roleIds = roles.map(({ id }) => id);
    const links = roleIds.length ? await this.prisma.db.rolePermission.findMany({ where: { tenantId, roleId: { in: roleIds } } }) : [];
    const permissionIds = [...new Set(links.map(({ permissionId }) => permissionId))];
    const permissions = permissionIds.length ? await this.prisma.db.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true, key: true } }) : [];
    const permissionById = new Map(permissions.map((permission) => [permission.id, permission]));
    const permissionsByRole = new Map<string, string[]>();
    for (const link of links) {
      const permission = permissionById.get(link.permissionId);
      if (permission) permissionsByRole.set(link.roleId, [...(permissionsByRole.get(link.roleId) ?? []), permission.key]);
    }
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      active: role.active,
      permissionsConfigured: role.permissionsConfigured,
      permissionKeys: role.permissionsConfigured
        ? (permissionsByRole.get(role.id) ?? []).sort()
        : [...(DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey] ?? [])].sort(),
    }));
  }

  async createRole(tenantId: string, input: CreateTenantRoleInput) {
    this.assertTenant(tenantId);
    this.assertTenantAdministratorActor();
    if (ROLE_KEYS.includes(input.key as RoleKey)) throw AppError.validation('That key is reserved for a built-in role. Choose a tenant-specific role key.');
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const permissions = input.permissionKeys.length
          ? await tx.permission.findMany({ where: { key: { in: [...new Set(input.permissionKeys)] } }, select: { id: true, key: true } })
          : [];
        const permissionKeys = [...new Set(input.permissionKeys)];
        if (permissions.length !== permissionKeys.length) throw AppError.validation('One or more selected permissions are not available. Reload the permission list.');
        const role = await tx.role.create({ data: {
          tenantId, key: input.key, name: input.name, description: input.description ?? null,
          isSystem: false, active: true, permissionsConfigured: true,
        } });
        if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map(({ id: permissionId }) => ({ tenantId, roleId: role.id, permissionId })) });
        await this.audit.record(tx, { tenantId, actorId, action: 'role.created', entityType: 'Role', entityId: role.id, after: { key: role.key, name: role.name, permissionKeys } });
        return { ...role, permissionKeys: permissionKeys.sort() };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('ROLE_KEY_EXISTS', 'That role key is already in use in this organization.');
      throw error;
    }
  }

  async updateRole(tenantId: string, roleId: string, input: UpdateTenantRoleInput) {
    this.assertTenant(tenantId);
    this.assertTenantAdministratorActor();
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const role = await tx.role.findFirst({ where: { tenantId, id: roleId } });
      if (!role || role.key === 'PLATFORM_ADMIN') throw AppError.notFound('Role');
      if (role.isSystem && input.active === false) throw AppError.conflict('SYSTEM_ROLE_ACTIVE', 'Built-in roles cannot be deactivated.');
      const changed = await tx.role.updateMany({ where: { tenantId, id: roleId, updatedAt: role.updatedAt }, data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      } });
      if (changed.count !== 1) throw AppError.conflict('ROLE_CHANGED', 'This role changed while it was being updated. Reload and retry.');
      const links = await tx.userRole.findMany({ where: { tenantId, roleId }, select: { userId: true } });
      const userIds = [...new Set(links.map(({ userId }) => userId))];
      if (userIds.length && (input.active === false || input.active === true)) {
        await tx.refreshToken.updateMany({ where: { tenantId, userId: { in: userIds }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(tx, { tenantId, actorId, action: 'role.updated', entityType: 'Role', entityId: roleId, before: { name: role.name, description: role.description, active: role.active }, after: { name: input.name ?? role.name, description: input.description ?? role.description, active: input.active ?? role.active } });
      return tx.role.findFirst({ where: { tenantId, id: roleId } });
    });
  }

  async listPortalSubjects(tenantId: string) {
    this.assertTenant(tenantId);
    const [students, guardianLinks, persons] = await Promise.all([
      this.prisma.db.student.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null }, orderBy: [{ admissionNumber: 'asc' }], take: 500, select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true } }),
      this.prisma.db.studentGuardian.findMany({ where: { tenantId }, select: { guardianId: true }, distinct: ['guardianId'], take: 500 }),
      this.prisma.db.tenantPerson.findMany({ where: { tenantId, status: 'ACTIVE', deletedAt: null, account: null }, orderBy: [{ personNumber: 'asc' }], take: 1000, select: { id: true, personNumber: true, typeLabel: true, firstName: true, middleName: true, lastName: true, email: true, branchId: true } }),
    ]);
    const guardianIds = guardianLinks.map(({ guardianId }) => guardianId);
    const guardians = guardianIds.length ? await this.prisma.db.guardian.findMany({ where: { tenantId, id: { in: guardianIds }, deletedAt: null }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], take: 500, select: { id: true, firstName: true, lastName: true, email: true, phone: true } }) : [];
    return { students, guardians, persons };
  }

  async permissionCatalog(tenantId: string) {
    this.assertTenant(tenantId);
    const permissions = await this.prisma.db.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
    return { groups: PERMISSION_GROUPS, permissions };
  }

  async updateRolePermissions(tenantId: string, roleId: string, input: UpdateRolePermissionsInput) {
    this.assertTenant(tenantId);
    this.assertTenantAdministratorActor();
    const actorId = this.tenantContext.require().userId;
    const permissionKeys = [...new Set(input.permissionKeys)];
    return this.prisma.transactionWithRetry(async (tx) => {
      const role = await tx.role.findFirst({ where: { tenantId, id: roleId } });
      if (!role || role.key === 'PLATFORM_ADMIN' || !role.active) throw AppError.notFound('Active role');
      const existingLinks = await tx.rolePermission.findMany({ where: { tenantId, roleId } });
      const existingPermissionIds = [...new Set(existingLinks.map(({ permissionId }) => permissionId))];
      const existingPermissions = existingPermissionIds.length ? await tx.permission.findMany({ where: { id: { in: existingPermissionIds } }, select: { id: true, key: true } }) : [];
      const existingPermissionKeys = existingPermissions.map(({ key }) => key).sort();
      const permissions = permissionKeys.length
        ? await tx.permission.findMany({ where: { key: { in: permissionKeys } }, select: { id: true, key: true } })
        : [];
      if (permissions.length !== permissionKeys.length) throw AppError.validation('One or more selected permissions are not available. Reload the permission list.');
      if (isTenantAdminRole(role.key)) {
        const ownerAccess = [PERMISSIONS.USER_READ, PERMISSIONS.USER_CREATE, PERMISSIONS.USER_DISABLE, PERMISSIONS.ROLE_READ, PERMISSIONS.ROLE_ASSIGN, PERMISSIONS.PERMISSION_READ, PERMISSIONS.TENANT_SETTINGS_READ, PERMISSIONS.TENANT_SETTINGS_UPDATE];
        const selected = new Set(permissionKeys);
        if (ownerAccess.some((permission) => !selected.has(permission))) {
          throw AppError.conflict('TENANT_ADMIN_ACCESS_REQUIRED', 'A tenant administrator role must retain user, role, permission, and settings administration access.');
        }
      }
      const before = role.permissionsConfigured ? existingPermissionKeys : [...(DEFAULT_ROLE_PERMISSIONS[role.key as RoleKey] ?? [])].sort();
      const members = await tx.userRole.findMany({ where: { tenantId, roleId }, select: { userId: true } });
      const roleChanged = await tx.role.updateMany({ where: { tenantId, id: roleId, updatedAt: role.updatedAt }, data: { permissionsConfigured: true } });
      if (roleChanged.count !== 1) throw AppError.conflict('ROLE_CHANGED', 'This role changed while permissions were being saved. Reload and retry.');
      await tx.rolePermission.deleteMany({ where: { tenantId, roleId } });
      if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((permission) => ({ tenantId, roleId, permissionId: permission.id })) });
      if (members.length) await tx.refreshToken.updateMany({ where: { tenantId, userId: { in: members.map((member) => member.userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { tenantId, actorId, action: 'role.permissions.updated', entityType: 'Role', entityId: roleId, before: { permissionKeys: before }, after: { permissionKeys } });
      return { id: roleId, permissionKeys };
    });
  }

  private async assertRoleIds(tx: TransactionClient, tenantId: string, roleIds: string[]) {
    const roles = await tx.role.findMany({ where: { tenantId, id: { in: roleIds }, key: { not: 'PLATFORM_ADMIN' }, active: true }, select: { id: true, key: true, name: true } });
    if (roles.length !== roleIds.length) throw AppError.validation('Choose roles that belong to this organization.');
    return roles;
  }

  private assertTenantAdministratorActor(): void {
    const actor = this.tenantContext.require();
    const tenantAdmin = actor.roles?.some(isTenantAdminRole);
    const scopedPlatformAdmin = actor.isPlatformAdmin && actor.roles?.includes('PLATFORM_ADMIN') && actor.actingAsTenantId === actor.tenantId;
    if (!tenantAdmin && !scopedPlatformAdmin) {
      throw AppError.forbidden('Only a tenant administrator can change organization-wide role configuration.');
    }
  }

  private assertMayAssignTenantAdministratorRole(roleKeys: string[]): void {
    if (roleKeys.some(isTenantAdminRole)) this.assertTenantAdministratorActor();
  }

  private assertMayManageTenantAdministratorRoles(roleKeys: string[]): void {
    if (roleKeys.some(isTenantAdminRole)) this.assertTenantAdministratorActor();
  }

  private async assertMayManageTenantAdministrator(tx: TransactionClient, tenantId: string, userId: string): Promise<void> {
    if (this.tenantContext.require().roles?.some(isTenantAdminRole)) return;
    const links = await tx.userRole.findMany({ where: { tenantId, userId }, select: { roleId: true } });
    if (!links.length) return;
    const roles = await tx.role.findMany({ where: { tenantId, id: { in: links.map((link) => link.roleId) } }, select: { key: true } });
    this.assertMayManageTenantAdministratorRoles(roles.map((role) => role.key));
  }

  private async assertSeatAvailable(tx: TransactionClient, tenantId: string): Promise<void> {
    return assertTenantUserSeatAvailable(tx, tenantId);
  }

  private async assertPortalIdentity(tx: TransactionClient, tenantId: string, roleKeys: string[], studentId: string | null, guardianId: string | null, tenantPersonId: string | null, excludeUserId?: string, accountEmail?: string): Promise<void> {
    const portalRoles = roleKeys.filter((key) => key === 'STUDENT' || key === 'PARENT');
    const isWorkspacePerson = roleKeys.includes('WORKSPACE_PERSON');
    if (isWorkspacePerson) {
      if (roleKeys.length !== 1 || portalRoles.length || !tenantPersonId || studentId || guardianId) throw AppError.validation('A person portal account must have only the Workspace Person role and link to exactly one person profile.');
      const person = await tx.tenantPerson.findFirst({ where: { tenantId, id: tenantPersonId, status: 'ACTIVE', deletedAt: null }, select: { id: true, email: true } });
      if (!person) throw AppError.validation('Choose an active person profile from this organization.');
      if (!person.email) throw AppError.validation('Add an email address to this person profile before sending an account invitation.');
      if (accountEmail && person.email.toLowerCase() !== accountEmail.toLowerCase()) throw AppError.validation('The invitation email must match the email address on this person profile.');
      const existing = await tx.user.findFirst({ where: { tenantId, tenantPersonId, deletedAt: null, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) }, select: { id: true } });
      if (existing) throw AppError.conflict('PERSON_PORTAL_EXISTS', 'This person already has a workspace account. Manage the existing account instead.');
      return;
    }
    if (portalRoles.length === 0) {
      if (studentId || guardianId || tenantPersonId) throw AppError.validation('A person, student, or guardian link is only valid for a portal account.');
      return;
    }
    if (roleKeys.length !== 1 || portalRoles.length !== 1) throw AppError.validation('A portal account must have exactly one portal role and no staff roles.');
    if (portalRoles[0] === 'STUDENT') {
      if (!studentId || guardianId) throw AppError.validation('A student portal account must be linked to exactly one student.');
      const student = await tx.student.findFirst({ where: { tenantId, id: studentId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!student) throw AppError.validation('Choose an active student from this institution.');
      const existing = await tx.user.findFirst({ where: { tenantId, studentId, deletedAt: null, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) }, select: { id: true } });
      if (existing) throw AppError.conflict('STUDENT_PORTAL_EXISTS', 'This student already has a portal account. Update that account instead.');
      return;
    }
    if (!guardianId || studentId) throw AppError.validation('A parent portal account must be linked to exactly one guardian.');
    const guardian = await tx.guardian.findFirst({ where: { tenantId, id: guardianId, deletedAt: null }, select: { id: true } });
    if (!guardian) throw AppError.validation('Choose a guardian from this institution.');
    const existing = await tx.user.findFirst({ where: { tenantId, guardianId, deletedAt: null, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) }, select: { id: true } });
    if (existing) throw AppError.conflict('GUARDIAN_PORTAL_EXISTS', 'This guardian already has a portal account. Update that account instead.');
    const hasLinkedStudent = await tx.studentGuardian.findFirst({ where: { tenantId, guardianId }, select: { id: true } });
    if (!hasLinkedStudent) throw AppError.validation('Link the guardian to at least one student before creating a portal account.');
  }

  private async assertAnotherActiveTenantAdministrator(tx: TransactionClient, tenantId: string, userId: string): Promise<void> {
    const adminRoles = await tx.role.findMany({ where: { tenantId, key: { in: ['TENANT_ADMIN', 'TENANT_OWNER'] } }, select: { id: true } });
    if (adminRoles.length === 0) throw AppError.conflict('LAST_TENANT_ADMIN', 'At least one active tenant administrator must remain assigned.');
    const links = await tx.userRole.findMany({ where: { tenantId, roleId: { in: adminRoles.map(({ id }) => id) }, userId: { not: userId } }, select: { userId: true } });
    const userIds = [...new Set(links.map(({ userId: id }) => id))];
    const owners = userIds.length ? await tx.user.count({ where: { tenantId, id: { in: userIds }, status: 'ACTIVE', deletedAt: null } }) : 0;
    if (owners < 1) throw AppError.conflict('LAST_TENANT_ADMIN', 'At least one active tenant administrator must remain assigned.');
  }

  private assertTenant(tenantId: string): void {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('access management')
@RequireModules('USERS')
@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('users') @RequirePermissions(PERMISSIONS.USER_READ) listUsers(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.access.listUsers(tenant, query); }
  @Post('users') @RequirePermissions(PERMISSIONS.USER_CREATE, PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(inviteTenantUserSchema)) @ApiOperation({ summary: 'Add a tenant user and send a secure activation invitation' }) createUser(@CurrentTenant() tenant: string, @Body() body: InviteTenantUserInput) { return this.access.inviteUser(tenant, body); }
  @Post('users/invitations') @RequirePermissions(PERMISSIONS.USER_CREATE, PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(inviteTenantUserSchema)) @ApiOperation({ summary: 'Create an invited tenant user and queue an expiring acceptance email' }) inviteUser(@CurrentTenant() tenant: string, @Body() body: InviteTenantUserInput) { return this.access.inviteUser(tenant, body); }
  @Post('users/bulk-invitations') @RequirePermissions(PERMISSIONS.USER_CREATE, PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(bulkInviteTenantUsersSchema)) @ApiOperation({ summary: 'Validate and atomically invite up to 100 tenant users from a reviewed import' }) bulkInviteUsers(@CurrentTenant() tenant: string, @Body() body: BulkInviteTenantUsersInput) { return this.access.inviteUsersBulk(tenant, body); }
  @Post('users/:id/invitation') @RequirePermissions(PERMISSIONS.USER_CREATE) @ApiOperation({ summary: 'Rotate and resend an unaccepted tenant user invitation' }) resendInvitation(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.access.resendInvitation(tenant, id); }
  @Post('users/:id/password-reset-link') @RequirePermissions(PERMISSIONS.USER_CREATE) @ApiOperation({ summary: 'Send a one-time password reset link to an active tenant user' }) sendPasswordResetLink(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.access.sendPasswordResetLink(tenant, id); }
  @Patch('users/:id') @RequirePermissions(PERMISSIONS.USER_CREATE) @UsePipes(new ZodValidationPipe(updateTenantUserProfileSchema)) updateUser(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateTenantUserProfileInput) { return this.access.updateUserProfile(tenant, id, body); }
  @Post('users/:id/password-reset') @RequirePermissions(PERMISSIONS.USER_CREATE) @UsePipes(new ZodValidationPipe(resetTenantUserPasswordSchema)) resetPassword(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: { temporaryPassword: string }) { return this.access.resetTemporaryPassword(tenant, id, body.temporaryPassword); }
  @Patch('users/:id/roles') @RequirePermissions(PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(assignUserRolesSchema)) assignRoles(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: AssignUserRolesInput) { return this.access.assignRoles(tenant, id, body); }
  @Patch('users/:id/status') @RequirePermissions(PERMISSIONS.USER_DISABLE) @UsePipes(new ZodValidationPipe(updateTenantUserStatusSchema)) setStatus(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateTenantUserStatusInput) { return this.access.updateStatus(tenant, id, body); }
  @Get('roles') @RequirePermissions(PERMISSIONS.ROLE_READ) listRoles(@CurrentTenant() tenant: string) { return this.access.listRoles(tenant); }
  @Post('roles') @RequirePermissions(PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(createTenantRoleSchema)) createRole(@CurrentTenant() tenant: string, @Body() body: CreateTenantRoleInput) { return this.access.createRole(tenant, body); }
  @Patch('roles/:id') @RequirePermissions(PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(updateTenantRoleSchema)) updateRole(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateTenantRoleInput) { return this.access.updateRole(tenant, id, body); }
  @Get('portal-subjects') @RequirePermissions(PERMISSIONS.USER_CREATE, PERMISSIONS.ROLE_ASSIGN) portalSubjects(@CurrentTenant() tenant: string) { return this.access.listPortalSubjects(tenant); }
  @Get('permissions') @RequirePermissions(PERMISSIONS.PERMISSION_READ) listPermissions(@CurrentTenant() tenant: string) { return this.access.permissionCatalog(tenant); }
  @Patch('roles/:id/permissions') @RequirePermissions(PERMISSIONS.ROLE_ASSIGN) @UsePipes(new ZodValidationPipe(updateRolePermissionsSchema)) updateRolePermissions(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateRolePermissionsInput) { return this.access.updateRolePermissions(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule, AuthModule], controllers: [AccessController], providers: [AccessService], exports: [AccessService] })
export class AccessModule {}

function cryptoRandomId(): string { return randomUUID(); }

function isTenantAdminRole(key: string | undefined): boolean {
  return key === 'TENANT_ADMIN' || key === 'TENANT_OWNER';
}
