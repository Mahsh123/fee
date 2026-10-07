import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query, UsePipes } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '@fee/types';
import { isUniqueViolation, Prisma } from '@fee/database';
import {
  createPayerResponsibilityRuleSchema,
  updatePayerResponsibilityRuleSchema,
  type CreatePayerResponsibilityRuleInput,
} from '@fee/validation';
import { AppError } from '../common/errors';
import { AuditService, OutboxService } from '../common/financial';
import { ZodValidationPipe } from '../common/http';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import type { TransactionClient } from '@fee/database';
import { canActivatePayerResponsibilityRule } from './payer-responsibility-engine';

type PayerRuleRow = Prisma.PayerResponsibilityRuleGetPayload<{}>;

@Injectable()
export class PayerResponsibilitiesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly tenantContext: TenantContextService) {}

  async list(tenantId: string) {
    this.assertTenant(tenantId);
    const rows = await this.prisma.db.payerResponsibilityRule.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return this.withReferences(this.prisma.db as unknown as TransactionClient, tenantId, rows);
  }

  async guardianOptions(tenantId: string, studentId?: string) {
    this.assertTenant(tenantId);
    if (studentId) {
      const student = await this.prisma.db.student.findFirst({ where: { tenantId, id: studentId, deletedAt: null }, select: { id: true } });
      if (!student) throw AppError.notFound('Student');
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, studentId: student.id }, select: { guardianId: true } });
      const ids = [...new Set(links.map((link) => link.guardianId))];
      if (!ids.length) return [];
      return this.prisma.db.guardian.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }], select: { id: true, firstName: true, lastName: true } });
    }
    const candidates = await this.prisma.db.guardian.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      take: 500,
      select: { id: true, firstName: true, lastName: true },
    });
    if (!candidates.length) return [];
    const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId: { in: candidates.map((guardian) => guardian.id) } }, select: { guardianId: true, studentId: true } });
    if (!links.length) return [];
    const activeStudents = await this.prisma.db.student.findMany({ where: { tenantId, id: { in: [...new Set(links.map((link) => link.studentId))] }, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    const activeStudentIds = new Set(activeStudents.map((student) => student.id));
    const linkedGuardianIds = new Set(links.filter((link) => activeStudentIds.has(link.studentId)).map((link) => link.guardianId));
    return candidates.filter((guardian) => linkedGuardianIds.has(guardian.id));
  }

  async create(tenantId: string, input: CreatePayerResponsibilityRuleInput) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    try {
      return await this.prisma.transactionWithRetry(async (tx) => {
        const guardianPayer = input.payerType === 'PARENT' || input.payerType === 'GUARDIAN';
        const [sponsor, guardian, student, group, year, feeType] = await Promise.all([
          input.payerSponsorId ? tx.sponsor.findFirst({ where: { tenantId, id: input.payerSponsorId, active: true, deletedAt: null }, select: { id: true, name: true } }) : null,
          input.payerGuardianId ? tx.guardian.findFirst({ where: { tenantId, id: input.payerGuardianId, deletedAt: null }, select: { id: true, firstName: true, lastName: true } }) : null,
          input.studentId ? tx.student.findFirst({ where: { tenantId, id: input.studentId, deletedAt: null }, select: { id: true } }) : null,
          input.studentGroupId ? tx.studentGroup.findFirst({ where: { tenantId, id: input.studentGroupId, active: true, deletedAt: null }, select: { id: true } }) : null,
          input.academicYearId ? tx.academicYear.findFirst({ where: { tenantId, id: input.academicYearId }, select: { id: true } }) : null,
          input.feeTypeId ? tx.feeType.findFirst({ where: { tenantId, id: input.feeTypeId, active: true, deletedAt: null }, select: { id: true } }) : null,
        ]);
        if (input.payerType === 'SPONSOR' && !sponsor) throw AppError.validation('Choose an active sponsor from this institution.');
        if (guardianPayer && !guardian) throw AppError.validation('Choose an active guardian from this institution.');
        if (!guardianPayer && input.payerGuardianId) throw AppError.validation('A guardian reference is only valid for a parent or guardian payer.');
        if (guardian) {
          const links = await tx.studentGuardian.findMany({ where: { tenantId, guardianId: guardian.id, ...(student ? { studentId: student.id } : {}) }, select: { id: true, studentId: true } });
          const linkedStudentIds = [...new Set(links.map((link) => link.studentId))];
          const activeLinkedStudents = linkedStudentIds.length
            ? await tx.student.findMany({ where: { tenantId, id: { in: linkedStudentIds }, status: 'ACTIVE', deletedAt: null }, select: { id: true } })
            : [];
          if (!activeLinkedStudents.length) throw AppError.validation(student ? 'The selected guardian is not linked to this student.' : 'Choose a guardian linked to an active student in this institution.');
        }
        if (input.studentId && !student) throw AppError.validation('The selected student is not available in this institution.');
        if (input.studentGroupId && !group) throw AppError.validation('The selected group is not available in this institution.');
        if (input.academicYearId && !year) throw AppError.validation('The selected academic year is not available in this institution.');
        if (input.feeTypeId && !feeType) throw AppError.validation('The selected fee type is not available in this institution.');
        const row = await tx.payerResponsibilityRule.create({
          data: {
            id: randomUUID(), tenantId, code: input.code.toUpperCase(), name: input.name, payerType: input.payerType,
            payerName: input.payerType === 'SPONSOR' ? sponsor!.name : guardian ? `${guardian.firstName} ${guardian.lastName ?? ''}`.trim() : input.payerName!.trim(),
            payerSponsorId: sponsor?.id ?? null, payerGuardianId: guardian?.id ?? null,
            studentId: student?.id ?? null, studentGroupId: group?.id ?? null, academicYearId: year?.id ?? null, feeTypeId: feeType?.id ?? null,
            basis: input.basis, value: input.value, priority: input.priority ?? 100,
            effectiveFrom: dateValue(input.effectiveFrom), effectiveTo: input.effectiveTo ? dateValue(input.effectiveTo) : null, active: true, createdBy: actorId ?? null,
          },
        });
        const response = (await this.withReferences(tx, tenantId, [row]))[0]!;
        await this.audit.record(tx, { tenantId, actorId, action: 'PAYER_RESPONSIBILITY_RULE_CREATED', entityType: 'PayerResponsibilityRule', entityId: row.id, after: ruleAuditView(row) });
        await this.outbox.publish(tx, { tenantId, eventType: 'PAYER_RESPONSIBILITY_RULE_CREATED', aggregateType: 'PayerResponsibilityRule', aggregateId: row.id, payload: { ruleId: row.id, payerType: row.payerType, priority: row.priority }, actorId, requestId: this.tenantContext.requestId });
        return response;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('PAYER_RULE_CODE_EXISTS', 'A payer responsibility rule already uses this code.');
      throw error;
    }
  }

  async setActive(tenantId: string, id: string, active: boolean) {
    this.assertTenant(tenantId);
    const actorId = this.tenantContext.require().userId;
    return this.prisma.transactionWithRetry(async (tx) => {
      const before = await tx.payerResponsibilityRule.findFirst({ where: { tenantId, id, deletedAt: null } });
      if (!before) throw AppError.notFound('Payer responsibility rule');
      if (active && !canActivatePayerResponsibilityRule(before)) {
        throw AppError.conflict('PAYER_GUARDIAN_ID_REQUIRED', 'Link this parent or guardian rule to a tenant guardian before activating it.');
      }
      const changed = await tx.payerResponsibilityRule.updateMany({ where: { tenantId, id, updatedAt: before.updatedAt, deletedAt: null }, data: { active } });
      if (changed.count !== 1) throw AppError.conflict('PAYER_RULE_CHANGED', 'This payer rule changed while it was being edited. Reload and retry.');
      const changedRule = await tx.payerResponsibilityRule.findFirst({ where: { tenantId, id } });
      if (!changedRule) throw AppError.notFound('Payer responsibility rule');
      const after = (await this.withReferences(tx, tenantId, [changedRule]))[0]!;
      await this.audit.record(tx, { tenantId, actorId, action: active ? 'PAYER_RESPONSIBILITY_RULE_ACTIVATED' : 'PAYER_RESPONSIBILITY_RULE_DEACTIVATED', entityType: 'PayerResponsibilityRule', entityId: id, before: ruleAuditView(before), after: ruleAuditView(after) });
      await this.outbox.publish(tx, { tenantId, eventType: active ? 'PAYER_RESPONSIBILITY_RULE_ACTIVATED' : 'PAYER_RESPONSIBILITY_RULE_DEACTIVATED', aggregateType: 'PayerResponsibilityRule', aggregateId: id, payload: { ruleId: id }, actorId, requestId: this.tenantContext.requestId });
      return after;
    });
  }

  private assertTenant(tenantId: string) {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }

  private async withReferences(client: TransactionClient, tenantId: string, rows: PayerRuleRow[]) {
    const ids = (pick: (row: PayerRuleRow) => string | null) => [...new Set(rows.map(pick).filter((id): id is string => Boolean(id)))];
    const [sponsors, guardians, students, groups, years, feeTypes] = await Promise.all([
      client.sponsor.findMany({ where: { tenantId, id: { in: ids((row) => row.payerSponsorId) } }, select: { id: true, name: true, code: true } }),
      client.guardian.findMany({ where: { tenantId, id: { in: ids((row) => row.payerGuardianId) } }, select: { id: true, firstName: true, lastName: true } }),
      client.student.findMany({ where: { tenantId, id: { in: ids((row) => row.studentId) } }, select: { id: true, admissionNumber: true, firstName: true, lastName: true } }),
      client.studentGroup.findMany({ where: { tenantId, id: { in: ids((row) => row.studentGroupId) } }, select: { id: true, name: true, code: true } }),
      client.academicYear.findMany({ where: { tenantId, id: { in: ids((row) => row.academicYearId) } }, select: { id: true, name: true } }),
      client.feeType.findMany({ where: { tenantId, id: { in: ids((row) => row.feeTypeId) } }, select: { id: true, name: true, code: true } }),
    ]);
    const byId = <T extends { id: string }>(values: T[]) => new Map(values.map((value) => [value.id, value]));
    const sponsorById = byId(sponsors); const guardianById = byId(guardians); const studentById = byId(students);
    const groupById = byId(groups); const yearById = byId(years); const feeTypeById = byId(feeTypes);
    return rows.map((row) => ({
      ...row,
      sponsor: row.payerSponsorId ? sponsorById.get(row.payerSponsorId) ?? null : null,
      payerGuardian: row.payerGuardianId ? guardianById.get(row.payerGuardianId) ?? null : null,
      student: row.studentId ? studentById.get(row.studentId) ?? null : null,
      studentGroup: row.studentGroupId ? groupById.get(row.studentGroupId) ?? null : null,
      academicYear: row.academicYearId ? yearById.get(row.academicYearId) ?? null : null,
      feeType: row.feeTypeId ? feeTypeById.get(row.feeTypeId) ?? null : null,
    }));
  }
}

@ApiTags('payer responsibility')
@RequireModules('FEES')
@Controller('payer-responsibility-rules')
export class PayerResponsibilitiesController {
  constructor(private readonly rules: PayerResponsibilitiesService) {}
  @Get() @RequirePermissions(PERMISSIONS.PAYER_RESPONSIBILITY_READ) list(@CurrentTenant() tenant: string) { return this.rules.list(tenant); }
  @Get('guardians') @RequirePermissions(PERMISSIONS.PAYER_RESPONSIBILITY_READ) guardians(@CurrentTenant() tenant: string, @Query('studentId') studentId?: string) { return this.rules.guardianOptions(tenant, studentId); }
  @Post() @RequirePermissions(PERMISSIONS.PAYER_RESPONSIBILITY_CONFIGURE) @UsePipes(new ZodValidationPipe(createPayerResponsibilityRuleSchema)) @ApiOperation({ summary: 'Configure future demand responsibility shares' }) create(@CurrentTenant() tenant: string, @Body() body: CreatePayerResponsibilityRuleInput) { return this.rules.create(tenant, body); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.PAYER_RESPONSIBILITY_CONFIGURE) @UsePipes(new ZodValidationPipe(updatePayerResponsibilityRuleSchema)) setActive(@CurrentTenant() tenant: string, @Param('id') id: string, @Body() body: { active: boolean }) { return this.rules.setActive(tenant, id, body.active); }
}

@Module({ imports: [PrismaModule, TenantContextModule], controllers: [PayerResponsibilitiesController], providers: [PayerResponsibilitiesService] })
export class PayerResponsibilitiesModule {}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function ruleAuditView(value: { id: string; code: string; name: string; payerType: string; payerName: string | null; payerSponsorId: string | null; payerGuardianId?: string | null; studentId?: string | null; studentGroupId?: string | null; academicYearId?: string | null; feeTypeId?: string | null; basis: string; value: Prisma.Decimal; priority: number; effectiveFrom: Date; effectiveTo: Date | null; active: boolean }) {
  return { code: value.code, name: value.name, payerType: value.payerType, payerName: value.payerName, payerSponsorId: value.payerSponsorId, payerGuardianId: value.payerGuardianId ?? null, studentId: value.studentId ?? null, studentGroupId: value.studentGroupId ?? null, academicYearId: value.academicYearId ?? null, feeTypeId: value.feeTypeId ?? null, basis: value.basis, value: value.value.toString(), priority: value.priority, effectiveFrom: value.effectiveFrom.toISOString().slice(0, 10), effectiveTo: value.effectiveTo?.toISOString().slice(0, 10) ?? null, active: value.active };
}
