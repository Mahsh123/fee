import { ACADEMIC_UNIT_TYPES, CONDITION_OPERATORS, FEE_RULE_FIELDS, LOGICAL_OPERATORS } from '@fee/types';
import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');

export const createAcademicYearSchema = z.object({
  name: z.string().trim().min(1).max(40),
  startDate: date,
  endDate: date,
  isCurrent: z.boolean().optional(),
}).refine((value) => value.endDate >= value.startDate, { path: ['endDate'], message: 'The end date must be on or after the start date.' });
export const updateAcademicYearSchema = createAcademicYearSchema;

const conditionValue = z.union([
  z.string().max(500), z.number().finite(), z.boolean(),
  z.array(z.union([z.string().max(500), z.number().finite(), z.boolean()])).min(1).max(100),
]);
const studentFactPaths = new Set(FEE_RULE_FIELDS.filter((field) => field.group === 'Student').map((field) => field.path));
const groupConditionSchema = z.object({
  field: z.string().trim().min(1).max(160).refine((field) => studentFactPaths.has(field) || /^student\.customAttributes\.[A-Za-z0-9_.-]{1,120}$/.test(field) || /^custom\.[A-Za-z0-9_.-]{1,120}$/.test(field), 'Choose a student fact or custom student attribute.'),
  operator: z.enum(CONDITION_OPERATORS),
  value: conditionValue.optional(),
  valueType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM']).optional(),
  negate: z.boolean().optional(),
}).superRefine((condition, context) => {
  if (condition.operator !== 'EXISTS' && condition.value === undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'This condition needs a value.' });
  if (condition.operator === 'BETWEEN' && (!Array.isArray(condition.value) || condition.value.length !== 2)) context.addIssue({ code: 'custom', path: ['value'], message: 'Between conditions need a start and end value.' });
});

export const groupMembershipRuleSchema = z.object({
  op: z.enum(LOGICAL_OPERATORS),
  conditions: z.array(groupConditionSchema).min(1).max(50),
});

export const createStudentGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().trim().max(1000).nullable().optional(),
  mode: z.enum(['STATIC', 'DYNAMIC']),
  membershipRule: groupMembershipRuleSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (value.mode === 'DYNAMIC' && !value.membershipRule) context.addIssue({ code: 'custom', path: ['membershipRule'], message: 'Dynamic groups need at least one membership condition.' });
  if (value.mode === 'STATIC' && value.membershipRule) context.addIssue({ code: 'custom', path: ['membershipRule'], message: 'Static groups use manual student membership.' });
});
export const updateStudentGroupSchema = createStudentGroupSchema;
export const replaceStudentGroupMembersSchema = z.object({ studentIds: z.array(uuid).max(5000).refine((ids) => new Set(ids).size === ids.length, 'A student can be added only once.') });

export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;
export type GroupMembershipRuleInput = z.infer<typeof groupMembershipRuleSchema>;
export type CreateStudentGroupInput = z.infer<typeof createStudentGroupSchema>;
export type UpdateStudentGroupInput = z.infer<typeof updateStudentGroupSchema>;
export type ReplaceStudentGroupMembersInput = z.infer<typeof replaceStudentGroupMembersSchema>;

export const academicUnitTypeOptions = ACADEMIC_UNIT_TYPES;
