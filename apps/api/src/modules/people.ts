import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Put, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Prisma, type TransactionClient } from '@fee/database';
import { PERMISSIONS } from '@fee/types';
import {
  bulkCreateTenantPeopleSchema,
  createTenantPersonGroupSchema,
  createTenantPersonSchema,
  replaceTenantPersonGroupMembersSchema,
  updateTenantPersonGroupSchema,
  updateTenantPersonSchema,
  type BulkCreateTenantPeopleInput,
  type CreateTenantPersonGroupInput,
  type CreateTenantPersonInput,
  type ReplaceTenantPersonGroupMembersInput,
  type UpdateTenantPersonGroupInput,
  type UpdateTenantPersonInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, FinancialModule } from '../common/financial';
import { buildSearchFilter, paginate, parseListQuery, toPrismaOrderBy, ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';

@Injectable()
export class TenantPeopleService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContextService, private readonly audit: AuditService) {}

  async list(tenantId: string, raw: Record<string, unknown>) {
    this.assertTenant(tenantId);
    const query = parseListQuery(raw, { allowedSortFields: ['personNumber', 'firstName', 'lastName', 'status', 'typeKey', 'createdAt'] });
    const actor = this.context.require();
    const requestedBranch = typeof raw.branchId === 'string' && raw.branchId.trim() ? raw.branchId.trim() : undefined;
    if (requestedBranch) this.assertBranchAccess(actor, requestedBranch);
    const branchScope = actor.branchScopeEnabled
      ? { branchId: { in: actor.branchIds ?? [] } }
      : requestedBranch ? { branchId: requestedBranch } : {};
    const where: Prisma.TenantPersonWhereInput = {
      tenantId, deletedAt: null, ...branchScope,
      ...(query.status?.length ? { status: { in: query.status as Array<'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED'> } } : {}),
      ...(typeof raw.typeKey === 'string' && raw.typeKey.trim() ? { typeKey: raw.typeKey.trim().toUpperCase() } : {}),
      ...buildSearchFilter(query.search, ['personNumber', 'firstName', 'middleName', 'lastName', 'preferredName', 'email', 'phone']),
    };
    const [items, total] = await Promise.all([
      this.prisma.db.tenantPerson.findMany({ where, include: { branch: { select: { id: true, code: true, name: true } }, account: { select: { id: true, email: true, status: true } }, studentProfile: { select: { id: true, admissionNumber: true } } }, orderBy: toPrismaOrderBy(query.sort) as Prisma.TenantPersonOrderByWithRelationInput[], skip: query.skip, take: query.take }),
      this.prisma.db.tenantPerson.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(tenantId: string, personId: string) {
    this.assertTenant(tenantId);
    const person = await this.prisma.db.tenantPerson.findFirst({ where: { tenantId, id: personId, deletedAt: null }, include: { branch: { select: { id: true, code: true, name: true } }, account: { select: { id: true, email: true, status: true } }, studentProfile: { select: { id: true, admissionNumber: true } }, groupMemberships: { where: { endedOn: null }, include: { group: { select: { id: true, name: true, code: true, typeKey: true } } } } } });
    if (!person) throw AppError.notFound('Person');
    this.assertBranchAccess(this.context.require(), person.branchId);
    return person;
  }

  async create(tenantId: string, input: CreateTenantPersonInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    this.assertBranchAccess(actor, input.branchId ?? null);
    return this.prisma.transactionWithRetry(async (tx) => this.createInTransaction(tx, tenantId, input, actor.userId));
  }

  async createBulk(tenantId: string, input: BulkCreateTenantPeopleInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    for (const person of input.people) this.assertBranchAccess(actor, person.branchId ?? null);
    return this.prisma.transactionWithRetry(async (tx) => {
      const items = [];
      for (const person of input.people) items.push(await this.createInTransaction(tx, tenantId, person, actor.userId));
      return { count: items.length, items };
    });
  }

  async update(tenantId: string, personId: string, input: UpdateTenantPersonInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    return this.prisma.transactionWithRetry(async (tx) => {
      const current = await tx.tenantPerson.findFirst({ where: { tenantId, id: personId, deletedAt: null } });
      if (!current) throw AppError.notFound('Person');
      this.assertBranchAccess(actor, current.branchId);
      if (input.branchId !== undefined) this.assertBranchAccess(actor, input.branchId);
      if (input.branchId) await this.assertActiveBranch(tx, tenantId, input.branchId);
      const data: Prisma.TenantPersonUncheckedUpdateManyInput = {
          ...(input.typeKey !== undefined ? { typeKey: input.typeKey } : {}),
          ...(input.typeLabel !== undefined ? { typeLabel: input.typeLabel } : {}),
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.middleName !== undefined ? { middleName: clean(input.middleName) } : {}),
          ...(input.lastName !== undefined ? { lastName: clean(input.lastName) } : {}),
          ...(input.preferredName !== undefined ? { preferredName: clean(input.preferredName) } : {}),
          ...(input.email !== undefined ? { email: clean(input.email)?.toLowerCase() ?? null } : {}),
          ...(input.phone !== undefined ? { phone: clean(input.phone) } : {}),
          ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata === null ? Prisma.DbNull : input.metadata as Prisma.InputJsonValue } : {}),
          updatedBy: actor.userId ?? null,
      };
      const result = await tx.tenantPerson.updateMany({
        where: { tenantId, id: personId, deletedAt: null, updatedAt: current.updatedAt },
        data,
      });
      if (result.count !== 1) throw AppError.conflict('CONFLICT', 'This person changed while you were editing it. Reload and try again.');
      const updated = await tx.tenantPerson.findFirst({ where: { tenantId, id: personId } });
      if (!updated) throw AppError.notFound('Person');
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'person.updated', entityType: 'TenantPerson', entityId: personId, before: personSnapshot(current), after: personSnapshot(updated) });
      return updated;
    });
  }

  async listGroups(tenantId: string) {
    this.assertTenant(tenantId);
    return this.prisma.db.tenantPersonGroup.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: { _count: { select: { members: { where: { endedOn: null } } } } } });
  }

  async createGroup(tenantId: string, input: CreateTenantPersonGroupInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    return this.prisma.transactionWithRetry(async (tx) => {
      const group = await tx.tenantPersonGroup.create({ data: { tenantId, name: input.name, code: input.code, description: clean(input.description), typeKey: input.typeKey ?? null, active: input.active ?? true } });
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'person.group.created', entityType: 'TenantPersonGroup', entityId: group.id, after: group });
      return group;
    });
  }

  async updateGroup(tenantId: string, groupId: string, input: UpdateTenantPersonGroupInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.tenantPersonGroup.findFirst({ where: { tenantId, id: groupId } });
      if (!before) throw AppError.notFound('Person group');
      const data: Prisma.TenantPersonGroupUpdateManyMutationInput = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined ? { description: clean(input.description) } : {}),
        ...(input.typeKey !== undefined ? { typeKey: input.typeKey } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      };
      const changed = await tx.tenantPersonGroup.updateMany({ where: { tenantId, id: groupId, updatedAt: before.updatedAt }, data });
      if (!changed.count) throw AppError.conflict('CONFLICT', 'This group changed while you were editing it. Reload and try again.');
      const after = await tx.tenantPersonGroup.findFirst({ where: { tenantId, id: groupId } });
      if (!after) throw AppError.notFound('Person group');
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'person.group.updated', entityType: 'TenantPersonGroup', entityId: groupId, before, after });
      return after;
    });
  }

  async replaceGroupMembers(tenantId: string, groupId: string, input: ReplaceTenantPersonGroupMembersInput) {
    this.assertTenant(tenantId);
    const actor = this.context.require();
    const now = new Date();
    const startsOn = input.startedOn ? dateValue(input.startedOn) : dateValue(now.toISOString().slice(0, 10));
    return this.prisma.transactionWithRetry(async (tx) => {
      const group = await tx.tenantPersonGroup.findFirst({ where: { tenantId, id: groupId, active: true }, select: { id: true, name: true, typeKey: true } });
      if (!group) throw AppError.notFound('Active person group');
      const persons = input.personIds.length ? await tx.tenantPerson.findMany({ where: { tenantId, id: { in: input.personIds }, deletedAt: null, status: 'ACTIVE', ...(group.typeKey ? { typeKey: group.typeKey } : {}) }, select: { id: true, branchId: true } }) : [];
      if (persons.length !== input.personIds.length) throw AppError.validation(group.typeKey ? `Choose active people of type ${group.typeKey} from this organization.` : 'Choose active people from this organization.');
      for (const person of persons) this.assertBranchAccess(actor, person.branchId);
      const current = await tx.tenantPersonGroupMember.findMany({ where: { tenantId, groupId, endedOn: null }, select: { personId: true } });
      const wanted = new Set(input.personIds);
      const removed = current.filter(({ personId }) => !wanted.has(personId)).map(({ personId }) => personId);
      if (removed.length) await tx.tenantPersonGroupMember.updateMany({ where: { tenantId, groupId, personId: { in: removed }, endedOn: null }, data: { endedOn: dateValue(now.toISOString().slice(0, 10)) } });
      const present = new Set(current.map(({ personId }) => personId));
      for (const personId of input.personIds) {
        if (present.has(personId)) continue;
        const prior = await tx.tenantPersonGroupMember.findFirst({ where: { tenantId, groupId, personId }, orderBy: { createdAt: 'desc' } });
        if (prior) await tx.tenantPersonGroupMember.update({ where: { tenantId_id: { tenantId, id: prior.id } }, data: { startedOn: startsOn, endedOn: null } });
        else await tx.tenantPersonGroupMember.create({ data: { tenantId, groupId, personId, startedOn: startsOn } });
      }
      await this.audit.record(tx, { tenantId, actorId: actor.userId, action: 'person.group.members_replaced', entityType: 'TenantPersonGroup', entityId: groupId, before: { personIds: current.map(({ personId }) => personId) }, after: { personIds: input.personIds } });
      return { groupId, personIds: input.personIds, count: input.personIds.length };
    });
  }

  private async createInTransaction(tx: TransactionClient, tenantId: string, input: CreateTenantPersonInput, actorId?: string) {
    if (input.branchId) await this.assertActiveBranch(tx, tenantId, input.branchId);
    const id = randomUUID();
    const person = await tx.tenantPerson.create({ data: {
      id, tenantId, personNumber: input.personNumber?.trim() || `P-${id.slice(0, 8).toUpperCase()}`,
      typeKey: input.typeKey, typeLabel: input.typeLabel, firstName: input.firstName,
      middleName: clean(input.middleName), lastName: clean(input.lastName), preferredName: clean(input.preferredName),
      email: input.email?.trim().toLowerCase() || null, phone: clean(input.phone), branchId: input.branchId ?? null,
      status: input.status ?? 'ACTIVE', metadata: input.metadata === null ? Prisma.DbNull : input.metadata as Prisma.InputJsonValue | undefined,
      createdBy: actorId ?? null, updatedBy: actorId ?? null,
    } });
    await this.audit.record(tx, { tenantId, actorId, action: 'person.created', entityType: 'TenantPerson', entityId: person.id, after: personSnapshot(person) });
    return person;
  }

  private async assertActiveBranch(tx: TransactionClient, tenantId: string, branchId: string) {
    const branch = await tx.branch.findFirst({ where: { tenantId, id: branchId, status: 'ACTIVE' }, select: { id: true } });
    if (!branch) throw AppError.validation('Choose an active branch from this organization.');
  }

  private assertBranchAccess(actor: ReturnType<TenantContextService['require']>, branchId: string | null | undefined) {
    if (actor.branchScopeEnabled && (!branchId || !(actor.branchIds ?? []).includes(branchId))) throw AppError.forbidden('This person is outside your assigned branch access.');
  }

  private assertTenant(tenantId: string) {
    if (this.context.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('tenant people')
@RequireModules('USERS')
@Controller('people')
export class TenantPeopleController {
  constructor(private readonly people: TenantPeopleService) {}
  @Get() @RequirePermissions(PERMISSIONS.USER_READ) list(@CurrentTenant() tenant: string, @Query() query: Record<string, unknown>) { return this.people.list(tenant, query); }
  @Get('groups') @RequirePermissions(PERMISSIONS.USER_READ) groups(@CurrentTenant() tenant: string) { return this.people.listGroups(tenant); }
  @Post() @RequirePermissions(PERMISSIONS.USER_CREATE) @UsePipes(new ZodValidationPipe(createTenantPersonSchema)) @ApiOperation({ summary: 'Create an industry-neutral tenant person profile' }) create(@CurrentTenant() tenant: string, @Body() body: CreateTenantPersonInput) { return this.people.create(tenant, body); }
  @Post('bulk') @RequirePermissions(PERMISSIONS.USER_CREATE) @UsePipes(new ZodValidationPipe(bulkCreateTenantPeopleSchema)) @ApiOperation({ summary: 'Create up to 100 validated tenant people atomically' }) bulk(@CurrentTenant() tenant: string, @Body() body: BulkCreateTenantPeopleInput) { return this.people.createBulk(tenant, body); }
  @Get(':id') @RequirePermissions(PERMISSIONS.USER_READ) get(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.people.get(tenant, id); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.USER_UPDATE) @UsePipes(new ZodValidationPipe(updateTenantPersonSchema)) update(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateTenantPersonInput) { return this.people.update(tenant, id, body); }
  @Post('groups') @RequirePermissions(PERMISSIONS.USER_CREATE) @UsePipes(new ZodValidationPipe(createTenantPersonGroupSchema)) createGroup(@CurrentTenant() tenant: string, @Body() body: CreateTenantPersonGroupInput) { return this.people.createGroup(tenant, body); }
  @Patch('groups/:id') @RequirePermissions(PERMISSIONS.USER_UPDATE) @UsePipes(new ZodValidationPipe(updateTenantPersonGroupSchema)) updateGroup(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: UpdateTenantPersonGroupInput) { return this.people.updateGroup(tenant, id, body); }
  @Put('groups/:id/members') @RequirePermissions(PERMISSIONS.USER_UPDATE) @UsePipes(new ZodValidationPipe(replaceTenantPersonGroupMembersSchema)) members(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: ReplaceTenantPersonGroupMembersInput) { return this.people.replaceGroupMembers(tenant, id, body); }
}

@Module({ imports: [PrismaModule, TenantContextModule, FinancialModule], controllers: [TenantPeopleController], providers: [TenantPeopleService], exports: [TenantPeopleService] })
export class TenantPeopleModule {}

function clean(value: string | null | undefined): string | null { return value?.trim() || null; }
function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function personSnapshot(person: { personNumber: string; typeKey: string; typeLabel: string; firstName: string; middleName?: string | null; lastName?: string | null; email: string | null; phone: string | null; branchId: string | null; status: string }) {
  return { personNumber: person.personNumber, typeKey: person.typeKey, typeLabel: person.typeLabel, firstName: person.firstName, middleName: person.middleName ?? null, lastName: person.lastName ?? null, email: person.email, phone: person.phone, branchId: person.branchId, status: person.status };
}
