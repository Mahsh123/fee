import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Put, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { isUniqueViolation } from '@fee/database';
import {
  createBranchSchema, updateBranchSchema, replaceBranchMembersSchema,
  replaceUserBranchesSchema,
  createOrganizationUnitSchema, updateOrganizationUnitSchema, replaceOrganizationMembersSchema,
  replaceUserOrganizationUnitsSchema,
  createUserAssignmentSchema, updateUserAssignmentSchema,
  type CreateBranchInput, type UpdateBranchInput, type ReplaceBranchMembersInput, type ReplaceUserBranchesInput,
  type CreateOrganizationUnitInput, type UpdateOrganizationUnitInput, type ReplaceOrganizationMembersInput,
  type ReplaceUserOrganizationUnitsInput,
  type CreateUserAssignmentInput, type UpdateUserAssignmentInput,
} from '@fee/validation';
import { PERMISSIONS } from '@fee/types';
import { Prisma } from '@fee/database';
import { AppError } from '../common/errors';
import { AuditService, FinancialModule } from '../common/financial';
import { buildSearchFilter, parseListQuery, paginate, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { resolveTenantModuleAccess } from '../common/entitlements';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly context: TenantContextService) {}

  async dashboard(tenantId: string) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    const isOrganizationAdmin = actor.roles?.some((role) => role === 'TENANT_ADMIN' || role === 'TENANT_OWNER') ?? false;
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id: tenantId }, select: { name: true, organizationType: true, enabledModules: true, status: true, subscriptionStatus: true, trialEndsAt: true, subscriptionRenewalAt: true } });
    if (!tenant) throw AppError.notFound('Organization');
    const [subscription, branchRows, moduleAccess] = await Promise.all([
      this.prisma.db.tenantSubscription.findFirst({ where: { tenantId, isCurrent: true }, include: { plan: { select: { key: true, name: true } } } }),
      this.prisma.db.branch.findMany({ where: { tenantId, status: { not: 'ARCHIVED' }, ...(isOrganizationAdmin ? {} : { memberships: { some: { userId: actor.userId } } }) }, select: { id: true } }),
      resolveTenantModuleAccess(this.prisma.db, tenantId),
    ]);
    const branchIds = branchRows.map(({ id }) => id);
    const enabledModules = moduleAccess?.enabledModules ?? [];
    const needsRegionalDashboardData = enabledModules.includes('FEES') || enabledModules.includes('ATTENDANCE') || enabledModules.includes('ADMISSIONS');
    const settings = needsRegionalDashboardData
      ? await this.prisma.db.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } })
      : null;
    const timezone = settings?.timezone ?? 'Asia/Kolkata';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const [totalUsers, activeUsers, activeBranches, activeUnits, assignedUsers, openAssignments] = await Promise.all([
      this.prisma.db.user.count({ where: { tenantId, deletedAt: null, isPlatformAdmin: false, ...(isOrganizationAdmin ? {} : { id: actor.userId }) } }),
      this.prisma.db.user.count({ where: { tenantId, deletedAt: null, isPlatformAdmin: false, status: 'ACTIVE', ...(isOrganizationAdmin ? {} : { id: actor.userId }) } }),
      Promise.resolve(branchRows.length),
      this.prisma.db.organizationUnit.count({ where: { tenantId, active: true, ...(isOrganizationAdmin ? {} : { memberships: { some: { userId: actor.userId } } }) } }),
      isOrganizationAdmin
        ? this.prisma.db.user.count({ where: { tenantId, deletedAt: null, isPlatformAdmin: false } })
        : this.prisma.db.userBranchMembership.findMany({ where: { tenantId, branchId: { in: branchIds } }, select: { userId: true } }).then((links) => new Set(links.map(({ userId }) => userId)).size),
      this.prisma.db.userAssignment.count({ where: { tenantId, status: { in: ['ASSIGNED', 'STARTED', 'IN_PROGRESS', 'OVERDUE'] }, ...(isOrganizationAdmin ? {} : { userId: actor.userId }) } }),
    ]);
    const [finance, attendanceToday, activeStudents] = await Promise.all([
      enabledModules.includes('FEES')
        ? this.prisma.financeReportData({ tenantId, from: monthStart, to: today, today, timezone, ...(isOrganizationAdmin ? {} : { branchIds }) })
        : Promise.resolve(null),
      enabledModules.includes('ATTENDANCE')
        ? this.prisma.db.attendanceRecord.groupBy({
            by: ['status'],
            where: { tenantId, session: { attendanceDate: new Date(`${today}T00:00:00.000Z`), ...(isOrganizationAdmin ? {} : { branchId: { in: branchIds } }) } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      enabledModules.includes('ADMISSIONS')
        ? this.prisma.db.student.count({ where: { tenantId, status: 'ACTIVE', deletedAt: null, ...(isOrganizationAdmin ? {} : { branchId: { in: branchIds } }) } })
        : Promise.resolve(null),
    ]);
    const onboarding = isOrganizationAdmin ? [
      { key: 'organization', label: 'Review organization settings', complete: Boolean(tenant.name && tenant.organizationType) },
      { key: 'branch', label: 'Create or confirm a branch', complete: activeBranches > 0 },
      { key: 'team', label: 'Invite your team', complete: totalUsers > 1 },
      { key: 'plan', label: 'Review plan and enabled features', complete: Boolean(subscription) },
    ] : [];
    return {
      organization: { name: tenant.name, type: tenant.organizationType, status: tenant.status, subscriptionStatus: tenant.subscriptionStatus },
      subscription: subscription ? { plan: subscription.plan.name, planKey: subscription.plan.key, status: subscription.status, billingInterval: subscription.billingInterval, trialEndsAt: subscription.trialEndsAt, periodEnd: subscription.currentPeriodEnd } : { plan: null, planKey: null, status: tenant.subscriptionStatus, billingInterval: null, trialEndsAt: tenant.trialEndsAt, periodEnd: tenant.subscriptionRenewalAt },
      modules: enabledModules,
      counts: { totalUsers, activeUsers, branchCount: activeBranches, organizationUnitCount: activeUnits, visibleMembers: assignedUsers, openAssignments, ...(activeStudents === null ? {} : { activeStudents }) },
      financialTotals: finance ? { month: { from: monthStart, to: today, timezone }, collections: finance.collectionSummary, outstanding: finance.outstanding } : null,
      attendanceToday: enabledModules.includes('ATTENDANCE')
        ? { date: today, timezone, byStatus: attendanceToday.map(({ status, _count }) => ({ status, count: _count._all })), totalMarked: attendanceToday.reduce((sum, row) => sum + row._count._all, 0) }
        : null,
      onboarding,
    };
  }

  async listBranches(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'code', 'status', 'createdAt'] });
    const actor = this.context.require();
    const admin = Boolean(actor.isPlatformAdmin) || (actor.roles?.some((role) => role === 'TENANT_ADMIN' || role === 'TENANT_OWNER') ?? false);
    const memberships = admin ? [] : await this.prisma.db.userBranchMembership.findMany({ where: { tenantId, userId: actor.userId }, select: { branchId: true } });
    const branchIds = memberships.map(({ branchId }) => branchId);
    const where: Prisma.BranchWhereInput = {
      tenantId,
      ...(admin ? {} : { id: { in: branchIds } }),
      ...(query.status?.length ? { status: { in: query.status as Array<'ACTIVE' | 'INACTIVE' | 'ARCHIVED'> } } : {}),
      ...buildSearchFilter(query.search, ['name', 'code', 'email', 'phone']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.branch.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.BranchOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.branch.count({ where }),
    ]);
    const ids = items.map(({ id }) => id);
    const memberLinks = ids.length ? await this.prisma.db.userBranchMembership.findMany({ where: { tenantId, branchId: { in: ids } }, select: { branchId: true, userId: true, isPrimary: true } }) : [];
    const managerIds = items.flatMap(({ managerId }) => managerId ? [managerId] : []);
    const users = managerIds.length ? await this.prisma.db.user.findMany({ where: { tenantId, id: { in: managerIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const managerById = new Map(users.map((user) => [user.id, user]));
    const result = items.map((branch) => {
      const members = memberLinks.filter((link) => link.branchId === branch.id).map(({ userId, isPrimary }) => ({ userId, isPrimary }));
      return { ...branch, members, memberCount: members.length, manager: branch.managerId ? managerById.get(branch.managerId) ?? null : null };
    });
    return paginate(result, total, query);
  }

  async createBranch(tenantId: string, input: CreateBranchInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    // Creating a branch changes organization-wide structure and cannot be safely
    // bounded to an existing branch membership. Reserve it for tenant admins.
    if (!actor.isPlatformAdmin) this.assertTenantAdministrator(actor.roles ?? []);
    await this.assertWithinLimit(tenantId, 'MAX_BRANCHES', await this.prisma.db.branch.count({ where: { tenantId, status: { not: 'ARCHIVED' } } }));
    if (input.managerId) await this.assertUser(tenantId, input.managerId);
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const branch = await tx.branch.create({ data: {
          tenantId, code: input.code.toUpperCase(), name: input.name,
          phone: input.phone?.trim() || null, email: input.email || null,
          address: input.address === undefined || input.address === null ? Prisma.JsonNull : input.address as Prisma.InputJsonValue,
          capacity: input.capacity ?? null, managerId: input.managerId ?? null,
          enabledModules: input.enabledModules ?? [],
        } });
        if (input.managerId) await tx.userBranchMembership.upsert({
          where: { userId_branchId: { userId: input.managerId, branchId: branch.id } },
          create: { tenantId, userId: input.managerId, branchId: branch.id, grantedBy: actor.userId },
          update: {},
        });
        await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'branch.created', entityType: 'Branch', entityId: branch.id, after: { code: branch.code, name: branch.name, managerId: branch.managerId } });
        return branch;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('BRANCH_CODE_EXISTS', 'That branch code is already in use in this organization.');
      throw error;
    }
  }

  async updateBranch(tenantId: string, id: string, input: UpdateBranchInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    await this.assertCanManageBranch(tenantId, id, actor.userId, actor.roles ?? [], actor.permissions ?? [], actor.isPlatformAdmin);
    if (input.managerId) await this.assertUser(tenantId, input.managerId);
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.branch.findFirst({ where: { tenantId, id } });
      if (!current) throw AppError.notFound('Branch');
      if ((input.status === 'ARCHIVED' || input.status === 'INACTIVE') && current.status === 'ACTIVE') {
        const activeBranches = await tx.branch.count({ where: { tenantId, status: 'ACTIVE' } });
        if (activeBranches <= 1) throw AppError.conflict('LAST_ACTIVE_BRANCH', 'Keep at least one active branch in this organization.');
      }
      const data: Prisma.BranchUpdateManyMutationInput = {
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status, archivedAt: input.status === 'ARCHIVED' ? new Date() : null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.address !== undefined ? { address: input.address === null ? Prisma.JsonNull : input.address as Prisma.InputJsonValue } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
        ...(input.enabledModules !== undefined ? { enabledModules: input.enabledModules } : {}),
      };
      const changed = await tx.branch.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data });
      if (changed.count !== 1) throw AppError.conflict('BRANCH_CHANGED', 'This branch changed while it was being updated. Reload and retry.');
      if (input.managerId) await tx.userBranchMembership.upsert({
        where: { userId_branchId: { userId: input.managerId, branchId: id } },
        create: { tenantId, userId: input.managerId, branchId: id, grantedBy: actor.userId }, update: {},
      });
      const updated = await tx.branch.findFirst({ where: { tenantId, id } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'branch.updated', entityType: 'Branch', entityId: id, before: { name: current.name, status: current.status, managerId: current.managerId }, after: { name: updated?.name, status: updated?.status, managerId: updated?.managerId } });
      return updated;
    });
  }

  async replaceBranchMembers(tenantId: string, branchId: string, input: ReplaceBranchMembersInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    await this.assertCanManageBranch(tenantId, branchId, actor.userId, actor.roles ?? [], actor.permissions ?? [], actor.isPlatformAdmin);
    return this.prisma.transactionWithRetry(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { tenantId, id: branchId, status: 'ACTIVE' }, select: { id: true } });
      if (!branch) throw AppError.notFound('Active branch');
      const users = input.userIds.length ? await tx.user.findMany({ where: { tenantId, id: { in: input.userIds }, deletedAt: null, status: 'ACTIVE', isPlatformAdmin: false }, select: { id: true } }) : [];
      if (users.length !== input.userIds.length) throw AppError.validation('Every selected user must be active and belong to this organization.');
      const previous = await tx.userBranchMembership.findMany({ where: { tenantId, branchId }, select: { userId: true } });
      const removed = previous.map(({ userId }) => userId).filter((userId) => !input.userIds.includes(userId));
      for (const userId of removed) {
        const membershipCount = await tx.userBranchMembership.count({ where: { tenantId, userId } });
        if (membershipCount <= 1) throw AppError.conflict('USER_NEEDS_BRANCH', 'Every active user must remain assigned to at least one branch.');
      }
      await tx.userBranchMembership.deleteMany({ where: { tenantId, branchId, userId: { notIn: input.userIds } } });
      const existingIds = new Set(previous.map(({ userId }) => userId));
      const newIds = input.userIds.filter((userId) => !existingIds.has(userId));
      if (newIds.length) await tx.userBranchMembership.createMany({ data: newIds.map((userId) => ({ tenantId, branchId, userId, grantedBy: actor.userId })) });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'branch.members_replaced', entityType: 'Branch', entityId: branchId, before: { userIds: previous.map(({ userId }) => userId) }, after: { userIds: input.userIds } });
      return { branchId, userIds: input.userIds };
    });
  }

  async replaceUserBranches(tenantId: string, userId: string, input: ReplaceUserBranchesInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    // This edits a user's organization-wide branch scope; branch managers may
    // only edit membership inside a branch they already belong to.
    this.assertTenantAdministrator(actor.roles ?? []);
    const user = await this.assertUser(tenantId, userId);
    const { branchIds, primaryBranchId } = input;
    const branches = await this.prisma.db.branch.findMany({ where: { tenantId, id: { in: branchIds }, status: 'ACTIVE' }, select: { id: true } });
    if (branches.length !== branchIds.length) throw AppError.validation('Choose active branches from this organization.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.userBranchMembership.findMany({ where: { tenantId, userId }, select: { branchId: true } });
      await tx.userBranchMembership.deleteMany({ where: { tenantId, userId } });
      await tx.userBranchMembership.createMany({ data: branchIds.map((branchId) => ({ tenantId, userId, branchId, isPrimary: branchId === primaryBranchId, grantedBy: actor.userId })) });
      await tx.refreshToken.updateMany({ where: { tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'user.branches.updated', entityType: 'User', entityId: userId, before: { branchIds: current.map(({ branchId }) => branchId) }, after: { branchIds, primaryBranchId } });
      return { userId, branchIds, primaryBranchId };
    });
  }

  async replaceUserOrganizationUnits(tenantId: string, userId: string, input: ReplaceUserOrganizationUnitsInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    this.assertTenantAdministrator(actor.roles ?? []);
    await this.assertUser(tenantId, userId);
    const unitIds = [...new Set(input.unitIds)];
    const units = unitIds.length ? await this.prisma.db.organizationUnit.findMany({ where: { tenantId, id: { in: unitIds }, active: true }, select: { id: true } }) : [];
    if (units.length !== unitIds.length) throw AppError.validation('Choose active groups from this organization.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.userOrganizationMembership.findMany({ where: { tenantId, userId }, select: { unitId: true } });
      await tx.userOrganizationMembership.deleteMany({ where: { tenantId, userId } });
      if (unitIds.length) await tx.userOrganizationMembership.createMany({ data: unitIds.map((unitId) => ({ tenantId, userId, unitId })) });
      await tx.refreshToken.updateMany({ where: { tenantId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'user.organization_units.updated', entityType: 'User', entityId: userId, before: { unitIds: current.map(({ unitId }) => unitId) }, after: { unitIds } });
      return { userId, unitIds };
    });
  }

  async listOrganizationUnits(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['name', 'code', 'unitType', 'createdAt'] });
    const where: Prisma.OrganizationUnitWhereInput = { tenantId, ...buildSearchFilter(query.search, ['name', 'code', 'unitType', 'description']) };
    const [items, total] = await Promise.all([
      this.prisma.db.organizationUnit.findMany({ where, include: { memberships: { select: { userId: true } }, _count: { select: { memberships: true } } }, orderBy: toPrismaOrderBy(query.sort) as Prisma.OrganizationUnitOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.organizationUnit.count({ where }),
    ]);
    const actor = this.context.require();
    const canReadUsers = actor.roles?.some((role) => role === 'TENANT_ADMIN' || role === 'TENANT_OWNER') || actor.permissions?.includes(PERMISSIONS.USER_READ);
    return paginate(items.map(({ memberships, _count, ...unit }) => ({
      ...unit,
      memberships: canReadUsers ? memberships : [],
      memberCount: _count.memberships,
    })), total, query);
  }

  async createOrganizationUnit(tenantId: string, input: CreateOrganizationUnitInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    await this.assertCanManageTenant(actor.roles ?? [], actor.permissions ?? [], PERMISSIONS.ORGANIZATION_UNIT_MANAGE);
    if (input.parentId) await this.assertOrganizationUnit(tenantId, input.parentId);
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const unit = await tx.organizationUnit.create({ data: { tenantId, code: input.code.toUpperCase(), name: input.name, unitType: input.unitType.toUpperCase(), description: input.description ?? null, parentId: input.parentId ?? null } });
        await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'organization_unit.created', entityType: 'OrganizationUnit', entityId: unit.id, after: { code: unit.code, name: unit.name, unitType: unit.unitType, parentId: unit.parentId } });
        return unit;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('ORGANIZATION_UNIT_CODE_EXISTS', 'That code is already in use for this unit type.');
      throw error;
    }
  }

  async updateOrganizationUnit(tenantId: string, id: string, input: UpdateOrganizationUnitInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    await this.assertCanManageTenant(actor.roles ?? [], actor.permissions ?? [], PERMISSIONS.ORGANIZATION_UNIT_MANAGE);
    if (input.parentId) {
      if (input.parentId === id) throw AppError.validation('An organization unit cannot be its own parent.');
      await this.assertOrganizationUnit(tenantId, input.parentId);
    }
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.organizationUnit.findFirst({ where: { tenantId, id } });
      if (!current) throw AppError.notFound('Organization unit');
      if (input.parentId) {
        const allUnits = await tx.organizationUnit.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
        const childrenByParent = new Map<string, string[]>();
        for (const unit of allUnits) {
          if (unit.parentId) childrenByParent.set(unit.parentId, [...(childrenByParent.get(unit.parentId) ?? []), unit.id]);
        }
        const descendants = new Set<string>();
        const pending = [...(childrenByParent.get(id) ?? [])];
        while (pending.length) {
          const childId = pending.pop()!;
          if (descendants.has(childId)) continue;
          descendants.add(childId);
          pending.push(...(childrenByParent.get(childId) ?? []));
        }
        if (descendants.has(input.parentId)) throw AppError.validation('An organization unit cannot be moved beneath one of its descendants.');
      }
      const data: Prisma.OrganizationUnitUpdateManyMutationInput = {
        ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unitType !== undefined ? { unitType: input.unitType.toUpperCase() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      const result = await tx.organizationUnit.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data });
      if (result.count !== 1) throw AppError.conflict('ORGANIZATION_UNIT_CHANGED', 'This organization unit changed while it was being updated. Reload and retry.');
      const updated = await tx.organizationUnit.findFirst({ where: { tenantId, id } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'organization_unit.updated', entityType: 'OrganizationUnit', entityId: id, before: { name: current.name, active: current.active }, after: { name: updated?.name, active: updated?.active } });
      return updated;
    });
  }

  async replaceUnitMembers(tenantId: string, unitId: string, input: ReplaceOrganizationMembersInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    await this.assertCanManageTenant(actor.roles ?? [], actor.permissions ?? [], PERMISSIONS.ORGANIZATION_UNIT_MANAGE);
    await this.assertOrganizationUnit(tenantId, unitId);
    const users = input.userIds.length ? await this.prisma.db.user.findMany({ where: { tenantId, id: { in: input.userIds }, deletedAt: null, status: 'ACTIVE', isPlatformAdmin: false }, select: { id: true } }) : [];
    if (users.length !== input.userIds.length) throw AppError.validation('Every selected user must be active and belong to this organization.');
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.userOrganizationMembership.findMany({ where: { tenantId, unitId }, select: { userId: true } });
      await tx.userOrganizationMembership.deleteMany({ where: { tenantId, unitId } });
      if (input.userIds.length) await tx.userOrganizationMembership.createMany({ data: input.userIds.map((userId) => ({ tenantId, unitId, userId })) });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'organization_unit.members_replaced', entityType: 'OrganizationUnit', entityId: unitId, before: { userIds: before.map(({ userId }) => userId) }, after: { userIds: input.userIds } });
      return { unitId, userIds: input.userIds };
    });
  }

  async listAssignments(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['createdAt', 'dueAt', 'status', 'resourceType'] });
    const actor = this.context.require();
    const isTenantAdmin = this.isTenantAdministrator(actor.roles ?? []);
    const canReadAcrossBranches = actor.permissions?.includes(PERMISSIONS.ASSIGNMENT_READ) ?? false;
    const actorUserId = actor.userId;
    if (!actorUserId) throw AppError.forbidden('A signed-in user is required.');
    const requestedUserId = typeof raw.userId === 'string' ? raw.userId : undefined;
    const branchIds = isTenantAdmin || !canReadAcrossBranches
      ? []
      : await this.getActorBranchIds(tenantId, actorUserId);
    const where: Prisma.UserAssignmentWhereInput = {
      tenantId,
      ...(isTenantAdmin
        ? (requestedUserId ? { userId: requestedUserId } : {})
        : canReadAcrossBranches
          ? {
              ...(requestedUserId ? { userId: requestedUserId } : {}),
              OR: [
                ...(branchIds.length ? [{ branchId: { in: branchIds } }] : []),
                // A user's assignments are personal resources. This includes
                // branchless records, which otherwise have no scope to grant.
                { userId: actorUserId },
              ],
            }
          : { userId: actor.userId }),
      ...(typeof raw.resourceType === 'string' ? { resourceType: raw.resourceType } : {}),
      ...buildSearchFilter(query.search, ['resourceType', 'resourceId', 'resourceLabel']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.userAssignment.findMany({ where, orderBy: toPrismaOrderBy(query.sort) as Prisma.UserAssignmentOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.userAssignment.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async createAssignment(tenantId: string, input: CreateUserAssignmentInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    const isTenantAdmin = this.isTenantAdministrator(actor.roles ?? []);
    await this.assertUser(tenantId, input.userId);
    if (input.branchId) {
      await this.assertBranch(tenantId, input.branchId);
      await this.assertUserBranch(tenantId, input.userId, input.branchId);
      if (!isTenantAdmin) await this.assertActorBranchMembership(tenantId, input.branchId, actor.userId);
    } else if (!isTenantAdmin && input.userId !== actor.userId) {
      // Branchless assignments have no organizational scope. Non-admins may
      // create them only for themselves (the own-resource exception).
      throw AppError.forbidden('A branch is required to assign work to another user.');
    }
    const assignment = await this.prisma.transactionWithRetry(async (tx) => {
      const created = await tx.userAssignment.create({ data: {
        tenantId, userId: input.userId, branchId: input.branchId ?? null,
        resourceType: input.resourceType.toUpperCase(), resourceId: input.resourceId,
        resourceLabel: input.resourceLabel ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null,
        metadata: input.metadata === undefined || input.metadata === null ? Prisma.JsonNull : input.metadata as Prisma.InputJsonValue,
        createdBy: actor.userId,
      } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'user_assignment.created', entityType: 'UserAssignment', entityId: created.id, after: { userId: created.userId, branchId: created.branchId, resourceType: created.resourceType, resourceId: created.resourceId } });
      return created;
    });
    return assignment;
  }

  async updateAssignment(tenantId: string, id: string, input: UpdateUserAssignmentInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    const current = await this.prisma.db.userAssignment.findFirst({ where: { tenantId, id } });
    if (!current) throw AppError.notFound('Assignment');
    const isTenantAdmin = this.isTenantAdministrator(actor.roles ?? []);
    const isOwnResource = current.userId === actor.userId;
    if (!isTenantAdmin && !isOwnResource) {
      if (!(actor.permissions?.includes(PERMISSIONS.ASSIGNMENT_MANAGE) ?? false) || !current.branchId) {
        throw AppError.forbidden('You can update only your own assignments or assignments in a branch you manage.');
      }
      await this.assertActorBranchMembership(tenantId, current.branchId, actor.userId);
    }
    const updated = await this.prisma.transactionWithRetry(async (tx) => {
      const changed = await tx.userAssignment.updateMany({ where: { tenantId, id, updatedAt: current.updatedAt }, data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt ? new Date(input.startedAt) : null } : {}),
        ...(input.completedAt !== undefined ? { completedAt: input.completedAt ? new Date(input.completedAt) : null } : {}),
      } });
      if (changed.count !== 1) throw AppError.conflict('ASSIGNMENT_CHANGED', 'This assignment changed while it was being updated. Reload and retry.');
      const result = await tx.userAssignment.findFirst({ where: { tenantId, id } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'user_assignment.updated', entityType: 'UserAssignment', entityId: id, before: { status: current.status }, after: { status: result?.status } });
      return result;
    });
    return updated;
  }

  private async assertCanManageTenant(roles: string[], permissions: string[], requiredPermission: string) {
    if (!roles.includes('TENANT_ADMIN') && !roles.includes('TENANT_OWNER') && !permissions.includes(requiredPermission)) throw AppError.forbidden('The required organization permission is needed for this change.');
  }
  private async assertCanManageBranch(tenantId: string, branchId: string, userId: string | undefined, roles: string[], permissions: string[], isPlatformAdmin = false) {
    if (!userId) throw AppError.forbidden('A signed-in user is required.');
    if (isPlatformAdmin || this.isTenantAdministrator(roles)) return;
    const branch = await this.prisma.db.branch.findFirst({ where: { tenantId, id: branchId }, select: { managerId: true } });
    const member = await this.prisma.db.userBranchMembership.findFirst({ where: { tenantId, branchId, userId }, select: { id: true } });
    if (!branch || !member || (!(permissions.includes(PERMISSIONS.BRANCH_MANAGE)) && branch.managerId !== userId)) {
      throw AppError.forbidden('You can manage only a branch where you have membership and branch management access.');
    }
  }
  private isTenantAdministrator(roles: string[]) {
    return roles.includes('TENANT_ADMIN') || roles.includes('TENANT_OWNER');
  }
  private assertTenantAdministrator(roles: string[]) {
    if (!this.isTenantAdministrator(roles)) throw AppError.forbidden('A tenant administrator is required for this organization-wide change.');
  }
  private async getActorBranchIds(tenantId: string, userId: string) {
    const memberships = await this.prisma.db.userBranchMembership.findMany({ where: { tenantId, userId }, select: { branchId: true } });
    return memberships.map(({ branchId }) => branchId);
  }
  private async assertActorBranchMembership(tenantId: string, branchId: string, userId: string | undefined) {
    if (!userId) throw AppError.forbidden('A signed-in user is required.');
    const membership = await this.prisma.db.userBranchMembership.findFirst({ where: { tenantId, branchId, userId }, select: { id: true } });
    if (!membership) throw AppError.forbidden('You can access assignments only in a branch where you have membership.');
  }
  private async assertWithinLimit(tenantId: string, key: string, current: number) {
    const subscription = await this.prisma.db.tenantSubscription.findFirst({ where: { tenantId, isCurrent: true }, select: { planId: true } });
    if (!subscription) return;
    const [entitlement, override] = await Promise.all([
      this.prisma.db.planEntitlement.findFirst({ where: { planId: subscription.planId, entitlementKey: key }, select: { limitValue: true } }),
      this.prisma.db.tenantEntitlementOverride.findFirst({ where: { tenantId, entitlementKey: key }, select: { limitValue: true } }),
    ]);
    const limit = override ? override.limitValue : entitlement?.limitValue;
    if (limit !== null && limit !== undefined && current >= limit) {
      throw AppError.conflict('TENANT_LIMIT_REACHED', `The organization has reached its ${key.toLowerCase().replaceAll('_', ' ')} limit.`);
    }
  }
  private async assertUser(tenantId: string, userId: string) {
    const user = await this.prisma.db.user.findFirst({ where: { tenantId, id: userId, status: 'ACTIVE', deletedAt: null, isPlatformAdmin: false }, select: { id: true } });
    if (!user) throw AppError.validation('Choose an active user from this organization.');
    return user;
  }
  private async assertBranch(tenantId: string, branchId: string) {
    const branch = await this.prisma.db.branch.findFirst({ where: { tenantId, id: branchId, status: 'ACTIVE' }, select: { id: true } });
    if (!branch) throw AppError.validation('Choose an active branch from this organization.');
  }
  private async assertUserBranch(tenantId: string, userId: string, branchId: string) {
    const membership = await this.prisma.db.userBranchMembership.findFirst({ where: { tenantId, userId, branchId }, select: { id: true } });
    if (!membership) throw AppError.validation('The user must be assigned to the selected branch.');
  }
  private async assertOrganizationUnit(tenantId: string, id: string) {
    const unit = await this.prisma.db.organizationUnit.findFirst({ where: { tenantId, id, active: true }, select: { id: true } });
    if (!unit) throw AppError.validation('Choose an active organization unit from this organization.');
  }
  private assertTenant(tenantId: string) {
    if (this.context.requireTenantId() !== tenantId) throw AppError.forbidden('The requested organization does not match the authenticated session.');
  }
}

@ApiTags('organization')
@RequireModules('BRANCHES')
@Controller('branches')
export class BranchesController {
  constructor(private readonly organization: OrganizationService) {}
  @Get() @RequirePermissions(PERMISSIONS.BRANCH_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.organization.listBranches(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.BRANCH_MANAGE) @UsePipes(new ZodValidationPipe(createBranchSchema)) @ApiOperation({ summary: 'Create a tenant-scoped organization branch' }) create(@CurrentTenant() tenant: string, @Body() body: CreateBranchInput) { return this.organization.createBranch(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.BRANCH_MANAGE) @UsePipes(new ZodValidationPipe(updateBranchSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateBranchInput) { return this.organization.updateBranch(tenant, id, body); }
  @Put(':id/users') @RequirePermissions(PERMISSIONS.BRANCH_MANAGE) @UsePipes(new ZodValidationPipe(replaceBranchMembersSchema)) members(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReplaceBranchMembersInput) { return this.organization.replaceBranchMembers(tenant, id, body); }
}

@ApiTags('organization dashboard')
@Controller('organization/dashboard')
export class OrganizationDashboardController {
  constructor(private readonly organization: OrganizationService) {}
  @Get() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Read a tenant and branch-scoped industry-neutral workspace overview' })
  get(@CurrentTenant() tenant: string) { return this.organization.dashboard(tenant); }
}

@ApiTags('organization')
@RequireModules('ORGANIZATION')
@Controller('organization-units')
export class OrganizationUnitsController {
  constructor(private readonly organization: OrganizationService) {}
  @Get() @RequirePermissions(PERMISSIONS.ORGANIZATION_UNIT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.organization.listOrganizationUnits(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.ORGANIZATION_UNIT_MANAGE) @UsePipes(new ZodValidationPipe(createOrganizationUnitSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateOrganizationUnitInput) { return this.organization.createOrganizationUnit(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.ORGANIZATION_UNIT_MANAGE) @UsePipes(new ZodValidationPipe(updateOrganizationUnitSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateOrganizationUnitInput) { return this.organization.updateOrganizationUnit(tenant, id, body); }
  @Put(':id/users') @RequirePermissions(PERMISSIONS.ORGANIZATION_UNIT_MANAGE) @UsePipes(new ZodValidationPipe(replaceOrganizationMembersSchema)) members(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReplaceOrganizationMembersInput) { return this.organization.replaceUnitMembers(tenant, id, body); }
}

@ApiTags('organization')
@RequireModules('ASSIGNMENTS')
@Controller('assignments')
export class UserAssignmentsController {
  constructor(private readonly organization: OrganizationService) {}
  @Get() @RequirePermissions(PERMISSIONS.ASSIGNMENT_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.organization.listAssignments(tenant, query); }
  @Post() @RequirePermissions(PERMISSIONS.ASSIGNMENT_MANAGE) @UsePipes(new ZodValidationPipe(createUserAssignmentSchema)) create(@CurrentTenant() tenant: string, @Body() body: CreateUserAssignmentInput) { return this.organization.createAssignment(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.ASSIGNMENT_MANAGE) @UsePipes(new ZodValidationPipe(updateUserAssignmentSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateUserAssignmentInput) { return this.organization.updateAssignment(tenant, id, body); }
}

@ApiTags('access management')
@RequireModules('BRANCHES')
@Controller('access/users')
export class UserBranchesController {
  constructor(private readonly organization: OrganizationService) {}
  @Put(':id/branches') @RequirePermissions(PERMISSIONS.BRANCH_MANAGE) @UsePipes(new ZodValidationPipe(replaceUserBranchesSchema)) @ApiOperation({ summary: 'Assign organization branches to a user' })
  update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReplaceUserBranchesInput) {
    return this.organization.replaceUserBranches(tenant, id, body);
  }
}

@ApiTags('access management')
@RequireModules('ORGANIZATION')
@Controller('access/users')
export class UserOrganizationUnitsController {
  constructor(private readonly organization: OrganizationService) {}
  @Put(':id/organization-units') @RequirePermissions(PERMISSIONS.ORGANIZATION_UNIT_MANAGE) @UsePipes(new ZodValidationPipe(replaceUserOrganizationUnitsSchema)) @ApiOperation({ summary: 'Assign tenant organization groups to a user' })
  update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReplaceUserOrganizationUnitsInput) {
    return this.organization.replaceUserOrganizationUnits(tenant, id, body);
  }
}

@Module({ imports: [PrismaModule, TenantContextModule, FinancialModule], controllers: [OrganizationDashboardController, BranchesController, OrganizationUnitsController, UserAssignmentsController, UserBranchesController, UserOrganizationUnitsController], providers: [OrganizationService], exports: [OrganizationService] })
export class OrganizationModule {}
