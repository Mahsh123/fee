import { ACADEMIC_UNIT_TYPES, GUARDIAN_RELATIONS, STUDENT_STATUSES } from '@fee/types';
import { z } from 'zod';

const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const optionalEmail = z.union([z.string().trim().email().max(254), z.literal(''), z.null()]).optional();
const optionalDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.'),
  z.null(),
]).optional();
const optionalUuid = z.union([z.string().uuid(), z.literal(''), z.null()]).optional();
const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const createAcademicUnitSchema = z.object({
  unitType: z.enum(ACADEMIC_UNIT_TYPES),
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(64),
  parentId: optionalUuid,
  metadata: metadataSchema,
});

export const updateAcademicUnitSchema = createAcademicUnitSchema.partial().extend({
  active: z.boolean().optional(),
});

export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  middleName: optionalText(120),
  lastName: optionalText(120),
  dateOfBirth: optionalDate,
  gender: optionalText(64),
  category: optionalText(100),
  phone: optionalText(40),
  email: optionalEmail,
  addressLine1: optionalText(200),
  city: optionalText(120),
  state: optionalText(120),
  postalCode: optionalText(32),
  country: optionalText(120),
  rollNumber: optionalText(80),
  academicYearId: optionalUuid,
  branchId: optionalUuid,
  primaryUnitId: optionalUuid,
  admissionType: optionalText(100),
  scholarshipCategory: optionalText(120),
  hostelStatus: z.boolean().optional(),
  transportStatus: z.boolean().optional(),
  transportRouteId: optionalUuid,
  isInternational: z.boolean().optional(),
  academicScore: z.union([z.string().regex(/^\d{1,4}(?:\.\d{1,2})?$/), z.literal(''), z.null()]).optional(),
  metadata: metadataSchema,
});

export const updateStudentSchema = createStudentSchema.omit({ academicYearId: true, primaryUnitId: true }).partial();

const customAttributeSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  value: z.string().max(2000).nullable(),
  valueType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM']),
}).superRefine((attribute, context) => {
  if (attribute.value === null) return;
  if (attribute.valueType === 'NUMBER' && !/^-?\d{1,14}(?:\.\d{1,4})?$/.test(attribute.value)) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Enter a number with up to four decimal places.' });
  }
  if (attribute.valueType === 'BOOLEAN' && !['true', 'false'].includes(attribute.value)) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Choose true or false.' });
  }
  if (attribute.valueType === 'DATE') {
    const parsed = new Date(`${attribute.value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attribute.value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== attribute.value) {
      context.addIssue({ code: 'custom', path: ['value'], message: 'Enter a valid date in YYYY-MM-DD format.' });
    }
  }
});

export const replaceStudentCustomAttributesSchema = z.object({
  attributes: z.array(customAttributeSchema).max(100),
}).superRefine((input, context) => {
  const keys = input.attributes.map((attribute) => attribute.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: ['attributes'], message: 'Each custom field key can appear only once.' });
});

export const createGuardianSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: optionalText(120),
  relation: z.enum(GUARDIAN_RELATIONS),
  phone: optionalText(40),
  email: optionalEmail,
  occupation: optionalText(120),
  addressLine1: optionalText(200),
  city: optionalText(120),
  isPrimaryContact: z.boolean().optional(),
  isPrimaryPayer: z.boolean().optional(),
});

export const createAdmissionApplicationSchema = z.object({
  applicantFirstName: z.string().trim().min(1).max(120),
  applicantLastName: optionalText(120),
  dateOfBirth: optionalDate,
  gender: optionalText(64),
  phone: optionalText(40),
  email: optionalEmail,
  category: optionalText(100),
  academicYearId: optionalUuid,
  targetUnitId: optionalUuid,
  admissionType: optionalText(100),
  isInternational: z.boolean().optional(),
  metadata: metadataSchema,
});

export const updateAdmissionApplicationSchema = createAdmissionApplicationSchema.partial();

export const admissionDecisionSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const studentStatusTransitionSchema = z.object({
  status: z.enum(STUDENT_STATUSES),
  reason: z.string().trim().min(1).max(1000),
});

export type CreateAcademicUnitInput = z.infer<typeof createAcademicUnitSchema>;
export type UpdateAcademicUnitInput = z.infer<typeof updateAcademicUnitSchema>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type ReplaceStudentCustomAttributesInput = z.infer<typeof replaceStudentCustomAttributesSchema>;
export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;
export type CreateAdmissionApplicationInput = z.infer<typeof createAdmissionApplicationSchema>;
export type UpdateAdmissionApplicationInput = z.infer<typeof updateAdmissionApplicationSchema>;
