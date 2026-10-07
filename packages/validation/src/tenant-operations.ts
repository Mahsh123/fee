import { z } from 'zod';

const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable().optional();
const tenantLogoUrl = z.union([
  z.string().trim().max(500).regex(/^\/(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9/_.,~-]*$/, 'Use a same-site logo path.'),
  z.string().trim().url().max(500).refine((value) => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }, 'Logo URLs must use HTTPS.'),
  z.literal(''),
  z.null(),
]).optional();

export const tenantBrandingUpdateSchema = z.object({
  organizationName: z.string().trim().min(1).max(180).optional(),
  logoUrl: tenantLogoUrl,
  landingTitle: optionalText(180),
  landingDescription: optionalText(1000),
  landingActionLabel: optionalText(80),
  legalName: optionalText(180),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  state: optionalText(120),
  postalCode: optionalText(32),
  country: optionalText(120),
  phone: optionalText(40),
  email: z.union([z.string().trim().email().max(254), z.literal(''), z.null()]).optional(),
  website: optionalText(254),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  receiptFooter: optionalText(1000),
  invoiceFooter: optionalText(1000),
  authorizedSignatory: optionalText(180),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one branding field to update.');

const prefix = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/);
export const tenantNumberingUpdateSchema = z.object({
  receiptPrefix: prefix.optional(),
  invoicePrefix: prefix.optional(),
  paymentPrefix: prefix.optional(),
  demandPrefix: prefix.optional(),
  refundPrefix: prefix.optional(),
  creditNotePrefix: prefix.optional(),
  adjustmentPrefix: prefix.optional(),
  applicationPrefix: prefix.optional(),
  studentPrefix: prefix.optional(),
  padding: z.number().int().min(1).max(12).optional(),
  includeYear: z.boolean().optional(),
  separator: z.string().min(0).max(5).regex(/^[A-Za-z0-9._-]*$/).optional(),
  resetAnnually: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one numbering field to update.');

export type TenantBrandingUpdateInput = z.infer<typeof tenantBrandingUpdateSchema>;
export type TenantNumberingUpdateInput = z.infer<typeof tenantNumberingUpdateSchema>;
