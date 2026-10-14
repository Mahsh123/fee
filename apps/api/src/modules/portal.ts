import { Controller, Get, Injectable, Module, Param, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@fee/types';
import { Money } from '@fee/money';
import { formatDate } from '@fee/dates';
import { renderReceiptPdf } from '@fee/receipts';
import { Prisma } from '@fee/database';
import { AppError } from '../common/errors';
import { PrismaModule, PrismaService } from '../common/prisma.service';
import { CurrentTenant, PortalRoute, RequireModules, RequirePermissions, TenantContextModule, TenantContextService } from '../common/tenancy';
import { PaymentsModule, PaymentsService } from './payments';

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService, private readonly tenantContext: TenantContextService, private readonly payments: PaymentsService) {}

  async dashboard(tenantId: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    if (roles.includes('WORKSPACE_PERSON')) return this.personDashboard(tenantId, context.userId);
    const studentIds: string[] = [];
    if (roles.includes('STUDENT') && context.studentId) studentIds.push(context.studentId);
    if (roles.includes('PARENT') && context.guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId: context.guardianId }, select: { studentId: true } });
      studentIds.push(...links.map((link) => link.studentId));
    }
    const allowedStudentIds = [...new Set(studentIds)];
    if (!allowedStudentIds.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');

    const creditWhere: Prisma.CreditWhereInput = { tenantId, studentId: { in: allowedStudentIds }, status: { in: ['AVAILABLE', 'PARTIALLY_ALLOCATED'] }, availableAmount: { gt: 0 } };
    const [students, demands, payments, credits, creditTotals, paymentMethods] = await Promise.all([
      this.prisma.db.student.findMany({ where: { tenantId, id: { in: allowedStudentIds }, deletedAt: null }, orderBy: [{ firstName: 'asc' }, { admissionNumber: 'asc' }], select: { id: true, admissionNumber: true, firstName: true, middleName: true, lastName: true, status: true } }),
      this.prisma.db.feeDemand.findMany({ where: { tenantId, studentId: { in: allowedStudentIds }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }], take: 250, select: { id: true, studentId: true, financialPeriod: true, demandNumber: true, currency: true, dueDate: true, issueDate: true, status: true, netAmount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true } }),
      this.prisma.db.payment.findMany({ where: { tenantId, studentId: { in: allowedStudentIds }, status: { in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, orderBy: { paidAt: 'desc' }, take: 100, select: { id: true, studentId: true, paymentNumber: true, receiptNumber: true, methodKind: true, amount: true, refundedAmount: true, currency: true, status: true, paidAt: true, receipts: { orderBy: { issueDate: 'desc' }, select: { id: true, receiptNumber: true, issueDate: true, status: true } } } }),
      this.prisma.db.credit.findMany({ where: creditWhere, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, studentId: true, source: true, currency: true, availableAmount: true, createdAt: true, reason: true } }),
      this.prisma.db.credit.groupBy({ by: ['currency'], where: creditWhere, _sum: { availableAmount: true } }),
      this.prisma.db.paymentMethod.findMany({ where: { tenantId, active: true, enabledForOnline: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } }),
    ]);
    if (!students.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');

    const demandIds = demands.map((demand) => demand.id);
    const installments = demandIds.length ? await this.prisma.db.installment.findMany({ where: { tenantId, demandId: { in: demandIds }, status: { not: 'CANCELLED' } }, orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }], take: 250, select: { id: true, demandId: true, label: true, sequence: true, dueDate: true, amount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true, status: true } }) : [];
    const portalPayer = roles.includes('PARENT') && context.guardianId
      ? { type: 'PARENT' as const, payerGuardianId: context.guardianId }
      : { type: 'STUDENT' as const };
    const openItemsByStudent = await Promise.all(allowedStudentIds.map((studentId) => this.payments.openItemsForStudent(tenantId, studentId, portalPayer)));
    const studentShareByDemand = new Map<string, Money>();
    const payerOutstandingByInstallment = new Map<string, Money>();
    for (const item of openItemsByStudent.flat()) {
      const prior = studentShareByDemand.get(item.demand.id) ?? Money.zero(item.demand.currency);
      studentShareByDemand.set(item.demand.id, prior.add(Money.fromString(item.outstandingAmount, item.demand.currency)));
      let remaining = Money.fromString(item.outstandingAmount, item.demand.currency);
      const schedule = [...(item.installmentShares ?? [])].sort((left, right) => left.installment.dueDate.getTime() - right.installment.dueDate.getTime() || left.installment.sequence - right.installment.sequence);
      for (const share of schedule) {
        if (!remaining.isPositive) break;
        const scheduleBalance = Money.fromString(share.amount.toString(), item.demand.currency).add(Money.fromString(share.adjustmentAmount.toString(), item.demand.currency)).subtract(Money.fromString(share.paidAmount.toString(), item.demand.currency));
        if (!scheduleBalance.isPositive) continue;
        const allocated = remaining.min(scheduleBalance);
        const installmentId = share.installment.id;
        payerOutstandingByInstallment.set(installmentId, (payerOutstandingByInstallment.get(installmentId) ?? Money.zero(item.demand.currency)).add(allocated));
        remaining = remaining.subtract(allocated);
      }
    }

    const adjustmentRows = demands.length ? await this.prisma.db.adjustment.findMany({
      where: { tenantId, demandId: { in: demands.map((row) => row.id) }, status: { in: ['APPLIED', 'REVERSED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, demandId: true, adjustmentNumber: true, kind: true, direction: true, amount: true, currency: true, reason: true, status: true, createdAt: true },
    }) : [];
    const adjustmentsByDemand = new Map<string, typeof adjustmentRows>();
    for (const row of adjustmentRows) if (row.demandId) adjustmentsByDemand.set(row.demandId, [...(adjustmentsByDemand.get(row.demandId) ?? []), row]);
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));
    const outstanding = demands.map((demand) => ({
      ...demand,
      overallOutstandingAmount: Money.fromString(demand.netAmount.toString(), demand.currency).add(Money.fromString(demand.adjustmentAmount.toString(), demand.currency)).subtract(Money.fromString(demand.paidAmount.toString(), demand.currency)).subtract(Money.fromString(demand.waivedAmount.toString(), demand.currency)).toString(),
      outstandingAmount: (studentShareByDemand.get(demand.id) ?? Money.zero(demand.currency)).toString(),
      adjustments: adjustmentsByDemand.get(demand.id) ?? [],
    })).filter((demand) => Money.fromString(demand.outstandingAmount, demand.currency).isPositive);
    return {
      students,
      demands: outstanding,
      payments,
      installments: installments.map((row) => {
        const demand = demandById.get(row.demandId);
        if (!demand) return null;
        return {
        ...row,
        demand: { studentId: demand.studentId, demandNumber: demand.demandNumber, currency: demand.currency },
        outstandingAmount: (payerOutstandingByInstallment.get(row.id) ?? Money.zero(demand.currency)).toString(),
      };
      }).filter((row): row is NonNullable<typeof row> => row !== null && Money.fromString(row.outstandingAmount, row.demand.currency).isPositive),
      credits,
      paymentMethods,
      totals: {
        linkedStudentCount: students.length,
        openDemandCount: new Set(openItemsByStudent.flat().map((item) => item.demand.id)).size,
        outstandingByCurrency: sumMoneyByCurrency(openItemsByStudent.flat().map((item) => ({ currency: item.demand.currency, amount: item.outstandingAmount }))),
        availableCreditByCurrency: creditTotals.map(({ currency, _sum }) => ({ currency, amount: _sum?.availableAmount?.toString() ?? '0' })),
        recentPaymentCount: payments.length,
      },
    };
  }

  async profile(tenantId: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    if (roles.includes('WORKSPACE_PERSON')) {
      const user = context.userId
        ? await this.prisma.db.user.findFirst({
          where: { tenantId, id: context.userId, status: 'ACTIVE', deletedAt: null },
          select: {
            tenantPerson: {
              select: {
                id: true,
                personNumber: true,
                typeKey: true,
                typeLabel: true,
                firstName: true,
                middleName: true,
                lastName: true,
                preferredName: true,
                email: true,
                phone: true,
                status: true,
                branch: { select: { id: true, name: true, code: true } },
                groupMemberships: {
                  where: { endedOn: null },
                  select: { group: { select: { id: true, name: true, code: true } } },
                },
              },
            },
          },
        })
        : null;
      if (!user?.tenantPerson || user.tenantPerson.status !== 'ACTIVE') throw AppError.forbidden('This portal account is not linked to an active person profile. Contact the organization administrator.');
      return { person: user.tenantPerson, guardian: null, students: [] };
    }
    const linkedIds = await this.allowedStudentIds(tenantId, roles, context.studentId, context.guardianId);
    const students = await this.prisma.db.student.findMany({
      where: { tenantId, id: { in: linkedIds }, deletedAt: null },
      orderBy: [{ firstName: 'asc' }, { admissionNumber: 'asc' }],
      select: {
        id: true, admissionNumber: true, rollNumber: true, firstName: true, middleName: true, lastName: true,
        dateOfBirth: true, gender: true, phone: true, email: true, addressLine1: true, city: true, state: true, postalCode: true,
        status: true, primaryUnitId: true, branchId: true,
      },
    });
    const unitIds = [...new Set(students.flatMap(({ primaryUnitId }) => primaryUnitId ? [primaryUnitId] : []))];
    const branchIds = [...new Set(students.flatMap(({ branchId }) => branchId ? [branchId] : []))];
    const [units, branches, linkedGuardians] = await Promise.all([
      unitIds.length ? this.prisma.db.academicUnit.findMany({ where: { tenantId, id: { in: unitIds } }, select: { id: true, name: true, code: true, unitType: true } }) : Promise.resolve([]),
      branchIds.length ? this.prisma.db.branch.findMany({ where: { tenantId, id: { in: branchIds } }, select: { id: true, name: true, code: true } }) : Promise.resolve([]),
      roles.includes('STUDENT')
        ? this.prisma.db.studentGuardian.findMany({ where: { tenantId, studentId: { in: linkedIds }, guardian: { deletedAt: null } }, select: { studentId: true, isPrimaryPayer: true, guardian: { select: { id: true, firstName: true, lastName: true, relation: true, phone: true, email: true, isPrimaryContact: true } } } })
        : Promise.resolve([]),
    ]);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const guardiansByStudent = new Map<string, typeof linkedGuardians>();
    for (const link of linkedGuardians) guardiansByStudent.set(link.studentId, [...(guardiansByStudent.get(link.studentId) ?? []), link]);
    const guardian = roles.includes('PARENT') && context.guardianId
      ? await this.prisma.db.guardian.findFirst({ where: { tenantId, id: context.guardianId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, relation: true, phone: true, email: true, occupation: true, addressLine1: true, city: true, isPrimaryContact: true } })
      : null;
    return {
      guardian,
      students: students.map((student) => ({
        ...student,
        academicUnit: student.primaryUnitId ? unitById.get(student.primaryUnitId) ?? null : null,
        branch: student.branchId ? branchById.get(student.branchId) ?? null : null,
        guardians: roles.includes('STUDENT') ? (guardiansByStudent.get(student.id) ?? []).map(({ guardian: linked }) => linked) : [],
      })),
    };
  }

  async getReceipt(tenantId: string, receiptId: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const roles = context.roles ?? [];
    if (roles.includes('WORKSPACE_PERSON')) {
      const user = context.userId ? await this.prisma.db.user.findFirst({ where: { tenantId, id: context.userId, status: 'ACTIVE', deletedAt: null }, select: { tenantPersonId: true } }) : null;
      if (!user?.tenantPersonId) throw AppError.forbidden('This portal account is not linked to an active person profile. Contact the organization administrator.');
      const receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, id: receiptId, personId: user.tenantPersonId } });
      if (!receipt) throw AppError.notFound('Receipt');
      const lines = await this.prisma.db.receiptLine.findMany({ where: { tenantId, receiptId: receipt.id }, orderBy: { sequence: 'asc' } });
      return { ...receipt, lines };
    }
    const allowedStudentIds: string[] = [];
    if (roles.includes('STUDENT') && context.studentId) allowedStudentIds.push(context.studentId);
    if (roles.includes('PARENT') && context.guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId: context.guardianId }, select: { studentId: true } });
      allowedStudentIds.push(...links.map((link) => link.studentId));
    }
    if (!allowedStudentIds.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');
    const receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, id: receiptId, studentId: { in: [...new Set(allowedStudentIds)] } } });
    if (!receipt) throw AppError.notFound('Receipt');
    const lines = await this.prisma.db.receiptLine.findMany({ where: { tenantId, receiptId: receipt.id }, orderBy: { sequence: 'asc' } });
    return { ...receipt, lines };
  }

  async receiptPdf(tenantId: string, receiptId: string) {
    const receipt = await this.getReceipt(tenantId, receiptId);
    const snapshot = objectValue(receipt.snapshot);
    const organization = objectValue(snapshot.organization);
    const payer = objectValue(snapshot.payer);
    const student = objectValue(snapshot.student);
    const person = objectValue(snapshot.person);
    const footer = stringValue(organization.receiptFooter);
    const pdf = await renderReceiptPdf({
      title: receipt.status === 'VOID' ? 'Payment receipt · VOID' : 'Payment receipt',
      issuerName: stringValue(organization.organizationName) ?? 'Organization',
      receiptNumber: receipt.receiptNumber,
      issuedOn: formatDate(receipt.issueDate),
      payerName: stringValue(payer.name) ?? stringValue(student.fullName) ?? stringValue(person.fullName) ?? 'Member',
      lines: receipt.lines.map((line) => ({ description: line.description?.trim() || line.feeTypeName, amount: Money.fromString(line.amount.toString(), receipt.currency).format() })),
      total: Money.fromString(receipt.totalAmount.toString(), receipt.currency).format(),
      currency: receipt.currency,
      footer: [footer, receipt.status === 'VOID' ? `Void reason: ${receipt.voidReason ?? 'Not specified'}` : null].filter(Boolean).join('\n') || undefined,
    });
    return { receiptNumber: receipt.receiptNumber, pdf };
  }

  private async personDashboard(tenantId: string, userId?: string) {
    if (!userId) throw AppError.forbidden('Sign in to view your organisation account.');
    const account = await this.prisma.db.user.findFirst({
      where: { tenantId, id: userId, status: 'ACTIVE', deletedAt: null },
      select: { tenantPerson: { select: { id: true, personNumber: true, typeKey: true, typeLabel: true, firstName: true, middleName: true, lastName: true, preferredName: true, status: true, branchId: true, branch: { select: { id: true, name: true, code: true } } } } },
    });
    const person = account?.tenantPerson;
    if (!person || person.status !== 'ACTIVE') throw AppError.forbidden('This portal account is not linked to an active person profile. Contact the organization administrator.');
    const creditWhere: Prisma.CreditWhereInput = { tenantId, personId: person.id, status: { in: ['AVAILABLE', 'PARTIALLY_ALLOCATED'] }, availableAmount: { gt: 0 } };
    const [demands, payments, credits, creditTotals, paymentMethods, openItems] = await Promise.all([
      this.prisma.db.feeDemand.findMany({ where: { tenantId, personId: person.id, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } }, orderBy: [{ dueDate: 'asc' }, { issueDate: 'desc' }], take: 250, select: { id: true, personId: true, studentId: true, financialPeriod: true, demandNumber: true, currency: true, dueDate: true, issueDate: true, status: true, netAmount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true } }),
      this.prisma.db.payment.findMany({ where: { tenantId, personId: person.id, status: { in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, orderBy: { paidAt: 'desc' }, take: 100, select: { id: true, personId: true, studentId: true, paymentNumber: true, receiptNumber: true, methodKind: true, amount: true, refundedAmount: true, currency: true, status: true, paidAt: true, receipts: { orderBy: { issueDate: 'desc' }, select: { id: true, receiptNumber: true, issueDate: true, status: true } } } }),
      this.prisma.db.credit.findMany({ where: creditWhere, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, personId: true, studentId: true, source: true, currency: true, availableAmount: true, createdAt: true, reason: true } }),
      this.prisma.db.credit.groupBy({ by: ['currency'], where: creditWhere, _sum: { availableAmount: true } }),
      this.prisma.db.paymentMethod.findMany({ where: { tenantId, active: true, enabledForOnline: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, kind: true } }),
      this.payments.openItemsForPerson(tenantId, person.id),
    ]);
    const demandIds = demands.map(({ id }) => id);
    const installments = demandIds.length ? await this.prisma.db.installment.findMany({ where: { tenantId, demandId: { in: demandIds }, status: { not: 'CANCELLED' } }, orderBy: [{ dueDate: 'asc' }, { sequence: 'asc' }], take: 250, select: { id: true, demandId: true, label: true, sequence: true, dueDate: true, amount: true, adjustmentAmount: true, paidAmount: true, waivedAmount: true, status: true } }) : [];
    const outstandingByDemand = new Map<string, Money>();
    const outstandingByInstallment = new Map<string, Money>();
    for (const item of openItems) {
      outstandingByDemand.set(item.demand.id, (outstandingByDemand.get(item.demand.id) ?? Money.zero(item.demand.currency)).add(Money.fromString(item.outstandingAmount, item.demand.currency)));
      let remaining = Money.fromString(item.outstandingAmount, item.demand.currency);
      for (const share of [...(item.installmentShares ?? [])].sort((left, right) => left.installment.dueDate.getTime() - right.installment.dueDate.getTime() || left.installment.sequence - right.installment.sequence)) {
        if (!remaining.isPositive) break;
        const balance = Money.fromString(share.amount.toString(), item.demand.currency).add(Money.fromString(share.adjustmentAmount.toString(), item.demand.currency)).subtract(Money.fromString(share.paidAmount.toString(), item.demand.currency));
        if (!balance.isPositive) continue;
        const allocated = remaining.min(balance);
        outstandingByInstallment.set(share.installment.id, (outstandingByInstallment.get(share.installment.id) ?? Money.zero(item.demand.currency)).add(allocated));
        remaining = remaining.subtract(allocated);
      }
    }
    const adjustments = demands.length ? await this.prisma.db.adjustment.findMany({ where: { tenantId, demandId: { in: demandIds }, status: { in: ['APPLIED', 'REVERSED'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, demandId: true, adjustmentNumber: true, kind: true, direction: true, amount: true, currency: true, reason: true, status: true, createdAt: true } }) : [];
    const adjustmentsByDemand = new Map<string, typeof adjustments>();
    for (const row of adjustments) if (row.demandId) adjustmentsByDemand.set(row.demandId, [...(adjustmentsByDemand.get(row.demandId) ?? []), row]);
    const outstanding = demands.map((demand) => ({
      ...demand,
      overallOutstandingAmount: Money.fromString(demand.netAmount.toString(), demand.currency).add(Money.fromString(demand.adjustmentAmount.toString(), demand.currency)).subtract(Money.fromString(demand.paidAmount.toString(), demand.currency)).subtract(Money.fromString(demand.waivedAmount.toString(), demand.currency)).toString(),
      outstandingAmount: (outstandingByDemand.get(demand.id) ?? Money.zero(demand.currency)).toString(), adjustments: adjustmentsByDemand.get(demand.id) ?? [],
    })).filter((demand) => Money.fromString(demand.outstandingAmount, demand.currency).isPositive);
    const demandById = new Map(demands.map((demand) => [demand.id, demand]));
    return {
      person, students: [], demands: outstanding, payments,
      installments: installments.flatMap((row) => {
        const demand = demandById.get(row.demandId);
        const amount = outstandingByInstallment.get(row.id);
        return demand && amount?.isPositive ? [{ ...row, demand: { personId: demand.personId, studentId: null, demandNumber: demand.demandNumber, currency: demand.currency }, outstandingAmount: amount.toString() }] : [];
      }),
      credits, paymentMethods,
      totals: { linkedPersonCount: 1, openDemandCount: new Set(openItems.map((item) => item.demand.id)).size, outstandingByCurrency: sumMoneyByCurrency(openItems.map((item) => ({ currency: item.demand.currency, amount: item.outstandingAmount }))), availableCreditByCurrency: creditTotals.map(({ currency, _sum }) => ({ currency, amount: _sum?.availableAmount?.toString() ?? '0' })), recentPaymentCount: payments.length },
    };
  }

  async listNotifications(tenantId: string, rawLimit?: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const allowed = notificationRecipientFilter(context.roles ?? [], context.userId, context.studentId, context.guardianId);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw AppError.validation('Notification page size must be between 1 and 100.');
    const where = { tenantId, OR: allowed };
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.db.notification.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, event: true, channel: true, status: true, subject: true, body: true, studentId: true, paymentId: true, demandId: true, receiptId: true, sentAt: true, deliveredAt: true, readAt: true, createdAt: true },
      }),
      this.prisma.db.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items: notifications, unreadCount };
  }

  async attendance(tenantId: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    if (!(context.roles ?? []).includes('WORKSPACE_PERSON') || !context.userId) {
      throw AppError.forbidden('Attendance in this portal is available only to the linked organisation member.');
    }
    const account = await this.prisma.db.user.findFirst({
      where: { tenantId, id: context.userId, status: 'ACTIVE', deletedAt: null },
      select: { tenantPerson: { select: { id: true, status: true } } },
    });
    if (!account?.tenantPerson || account.tenantPerson.status !== 'ACTIVE') {
      throw AppError.forbidden('This portal account is not linked to an active person profile. Contact the organisation administrator.');
    }
    const rows = await this.prisma.db.attendanceRecord.findMany({
      where: { tenantId, personId: account.tenantPerson.id },
      orderBy: [{ session: { attendanceDate: 'desc' } }, { createdAt: 'desc' }],
      take: 250,
      select: {
        id: true, status: true, remarks: true,
        session: { select: { attendanceDate: true, sessionLabel: true, branch: { select: { name: true } } } },
      },
    });
    return rows;
  }

  async markNotificationRead(tenantId: string, id: string) {
    this.assertTenant(tenantId);
    const context = this.tenantContext.require();
    const allowed = notificationRecipientFilter(context.roles ?? [], context.userId, context.studentId, context.guardianId);
    const notification = await this.prisma.db.notification.findFirst({ where: { tenantId, id, OR: allowed }, select: { id: true, readAt: true } });
    if (!notification) throw AppError.notFound('Notification');
    if (notification.readAt) return notification;
    const readAt = new Date();
    await this.prisma.db.notification.updateMany({ where: { tenantId, id, OR: allowed, readAt: null }, data: { readAt } });
    return { id, readAt };
  }

  private async allowedStudentIds(tenantId: string, roles: string[], studentId?: string | null, guardianId?: string | null): Promise<string[]> {
    const ids: string[] = [];
    if (roles.includes('STUDENT') && studentId) ids.push(studentId);
    if (roles.includes('PARENT') && guardianId) {
      const links = await this.prisma.db.studentGuardian.findMany({ where: { tenantId, guardianId }, select: { studentId: true } });
      ids.push(...links.map(({ studentId: linkedId }) => linkedId));
    }
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) throw AppError.forbidden('This portal account is not linked to an active student. Contact the institution administrator.');
    return uniqueIds;
  }

  private assertTenant(tenantId: string) {
    if (this.tenantContext.requireTenantId() !== tenantId) throw AppError.forbidden('The requested tenant does not match the authenticated session.');
  }
}

@ApiTags('student and parent portal')
@RequireModules('PORTAL')
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}
  @Get('profile') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Read linked student profiles, group labels, and authorised guardian contacts' }) profile(@CurrentTenant() tenant: string) { return this.portal.profile(tenant); }
  @Get('dashboard') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Read fee and payment information for the signed-in student or linked guardian' }) dashboard(@CurrentTenant() tenant: string) { return this.portal.dashboard(tenant); }
  @Get('attendance') @PortalRoute() @RequireModules('PORTAL', 'ATTENDANCE') @RequirePermissions(PERMISSIONS.ATTENDANCE_READ) @ApiOperation({ summary: 'Read attendance recorded for the signed-in tenant person' }) attendance(@CurrentTenant() tenant: string) { return this.portal.attendance(tenant); }
  @Get('receipts/:id') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Read a receipt for the signed-in student or a linked student' }) receipt(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.portal.getReceipt(tenant, id); }
  @Get('receipts/:id/download') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'Download a tenant-branded PDF receipt for a linked student' })
  async downloadReceipt(@CurrentTenant() tenant: string, @Param('id') id: string, @Res() response: Response) {
    const { receiptNumber, pdf } = await this.portal.receiptPdf(tenant, id);
    const safeName = receiptNumber.replace(/[^A-Za-z0-9_-]/g, '_');
    response.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.byteLength), 'Content-Disposition': `attachment; filename="receipt-${safeName}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    response.status(200).send(pdf);
  }
  @Get('notifications') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) @ApiOperation({ summary: 'List notifications addressed to the signed-in student or guardian account' }) notifications(@CurrentTenant() tenant: string, @Query('limit') limit?: string) { return this.portal.listNotifications(tenant, limit); }
  @Patch('notifications/:id/read') @PortalRoute() @RequirePermissions(PERMISSIONS.DASHBOARD_READ) markNotificationRead(@CurrentTenant() tenant: string, @Param('id') id: string) { return this.portal.markNotificationRead(tenant, id); }
}

@Module({ imports: [PrismaModule, TenantContextModule, PaymentsModule], controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}

function notificationRecipientFilter(roles: string[], userId: string | undefined, studentId?: string | null, guardianId?: string | null) {
  const allowed: Array<{ recipientType: string; recipientId: string }> = [];
  if (userId) allowed.push({ recipientType: 'USER', recipientId: userId });
  if (roles.includes('STUDENT') && studentId) allowed.push({ recipientType: 'STUDENT', recipientId: studentId });
  if (roles.includes('PARENT') && guardianId) allowed.push({ recipientType: 'GUARDIAN', recipientId: guardianId });
  if (!allowed.length) throw AppError.forbidden('This portal account does not have a notification identity.');
  return allowed;
}

function sumMoneyByCurrency(rows: Array<{ currency: string; amount: string }>) {
  const totals = new Map<string, Money>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? Money.zero(row.currency)).add(Money.fromString(row.amount, row.currency)));
  return [...totals].map(([currency, total]) => ({ currency, amount: total.toString() }));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
