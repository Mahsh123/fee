import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  AUTHENTICATION_READ_MODELS,
  AUTHENTICATION_REFRESH_TOKEN_UPDATE_COLUMNS,
  AUTHENTICATION_USER_UPDATE_COLUMNS,
  expectedPublicRelations,
  parsePrismaObjectInventory,
} from './database-acl-manifest.mjs';
import { verifyPostgresUrlTarget } from './compose-database-target.mjs';
import { buildTenantIdentityGuardManifest } from './tenant-identity-guard-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_CUTOVER_LOCK = [4605253, 1095058482];
const FUNCTION_OWNER_ROLES = ['fee_audit_owner', 'fee_lifecycle_owner', 'fee_numbering_owner'];
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const SEQUENCE_PRIVILEGES = ['SELECT', 'USAGE', 'UPDATE'];

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeRole(value, key) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${key} must be a lowercase PostgreSQL role identifier`);
  }
  return value;
}

export function buildAclManifest(inventory, { auditMode = 'legacy', hasCapabilityTable = false } = {}) {
  if (!['legacy', 'v2'].includes(auditMode)) throw new Error('Unknown audit capability mode');
  const modelTable = (name) => {
    const table = inventory.models.get(name);
    if (!table) throw new Error(`ACL manifest model is missing from Prisma schema: ${name}`);
    return table;
  };
  const runtime = new Map();
  const backup = new Set();
  for (const modelName of [...inventory.models.keys()]) backup.add(modelTable(modelName));
  backup.add('_prisma_migrations');
  if (hasCapabilityTable) backup.add('app_schema_capabilities');

  for (const name of AUTHENTICATION_READ_MODELS) runtime.set(modelTable(name), { select: true });
  runtime.set(modelTable('User'), {
    select: true,
    updateColumns: [...AUTHENTICATION_USER_UPDATE_COLUMNS],
  });
  runtime.set(modelTable('RefreshToken'), {
    select: true,
    insert: true,
    updateColumns: [...AUTHENTICATION_REFRESH_TOKEN_UPDATE_COLUMNS],
  });
  runtime.set(modelTable('TenantBranding'), {
    select: true,
    insert: true,
    updateColumns: [
      'institutionName', 'legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
      'country', 'phone', 'email', 'website', 'logoUrl', 'primaryColor', 'accentColor',
      'landingTitle', 'landingDescription', 'landingActionLabel', 'receiptFooter',
      'invoiceFooter', 'authorizedSignatory', 'updatedAt',
    ],
  });
  runtime.set(modelTable('TenantNumberingSettings'), {
    select: true,
    insert: true,
    updateColumns: [
      'formatVersion', 'receiptPrefix', 'invoicePrefix', 'paymentPrefix', 'demandPrefix', 'refundPrefix',
      'creditNotePrefix', 'adjustmentPrefix', 'applicationPrefix', 'studentPrefix', 'padding',
      'includeYear', 'separator', 'resetAnnually', 'reset_annually_from', 'updatedAt',
    ],
  });
  // Academic structure is operational configuration, not posted financial
  // history. Keep writes limited to the fields used by its versioned services.
  runtime.set(modelTable('AcademicYear'), {
    select: true,
    insert: true,
    updateColumns: ['name', 'startDate', 'endDate', 'isCurrent', 'isClosed', 'closedAt', 'updatedAt'],
  });
  runtime.set(modelTable('AcademicUnit'), {
    select: true,
    insert: true,
    updateColumns: ['unitType', 'name', 'code', 'parentId', 'metadata', 'active', 'updatedAt'],
  });
  runtime.set(modelTable('Student'), {
    select: true,
    insert: true,
    updateColumns: [
      'rollNumber', 'firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender', 'category', 'phone', 'email',
      'addressLine1', 'city', 'state', 'postalCode', 'country', 'status', 'admissionType', 'scholarshipCategory',
      'hostelStatus', 'transportStatus', 'transportRouteId', 'isInternational', 'academicScore', 'metadata',
      'updatedBy', 'updatedAt',
    ],
  });
  runtime.set(modelTable('StudentUnitMembership'), { select: true, insert: true });
  runtime.set(modelTable('Guardian'), { select: true, insert: true });
  runtime.set(modelTable('StudentGuardian'), { select: true, insert: true });
  runtime.set(modelTable('TenantSettings'), { select: true });
  runtime.set(modelTable('AdmissionApplication'), {
    select: true,
    insert: true,
    updateColumns: [
      'applicantFirstName', 'applicantLastName', 'dateOfBirth', 'gender', 'phone', 'email', 'category',
      'academicYearId', 'targetUnitId', 'admissionType', 'isInternational', 'metadata', 'status', 'submittedAt', 'updatedAt',
    ],
  });
  runtime.set(modelTable('FeeCategory'), {
    select: true,
    insert: true,
    updateColumns: ['name', 'code', 'kind', 'description', 'sortOrder', 'active', 'updatedAt'],
  });
  runtime.set(modelTable('FeeType'), {
    select: true,
    insert: true,
    updateColumns: [
      'categoryId', 'name', 'description', 'calculationMethod', 'defaultFrequency', 'optionality', 'taxable',
      'taxPercent', 'applicabilityRule', 'priority', 'active', 'updatedBy', 'updatedAt',
    ],
  });
  runtime.set(modelTable('FeeTypeVersion'), {
    select: true,
    insert: true,
    updateColumns: ['status', 'effectiveTo', 'approvedBy', 'approvedAt'],
  });
  runtime.set(modelTable('FeeStructure'), {
    select: true,
    insert: true,
    updateColumns: ['name', 'description', 'priority', 'active', 'updatedBy', 'updatedAt'],
  });
  runtime.set(modelTable('FeeStructureVersion'), {
    select: true,
    insert: true,
    updateColumns: ['status', 'effectiveTo', 'totalAmount', 'approvedBy', 'approvedAt'],
  });
  runtime.set(modelTable('FeeStructureItem'), { select: true, insert: true });
  runtime.set(modelTable('StudentGroup'), {
    select: true,
    insert: true,
    updateColumns: ['name', 'code', 'description', 'membershipRule', 'isDynamic', 'updatedAt'],
  });
  runtime.set(modelTable('StudentGroupMember'), { select: true, insert: true, delete: true });
  runtime.set(modelTable('StudentCustomAttribute'), {
    select: true,
    insert: true,
    updateColumns: ['value', 'valueType', 'updatedAt'],
  });
  runtime.set(modelTable('OutboxEvent'), {
    select: true,
    insert: true,
    updateColumns: ['tenantId', 'status', 'attempts', 'lastError', 'availableAt', 'publishedAt'],
  });
  runtime.set(modelTable('TenantNotificationSetting'), { select: true });
  runtime.set(modelTable('NotificationTemplate'), {
    select: true,
    insert: true,
    updateColumns: ['tenantId', 'subject', 'body', 'variables', 'active', 'updatedAt'],
  });
  runtime.set(modelTable('Notification'), {
    select: true,
    insert: true,
    updateColumns: ['tenantId', 'status', 'attemptCount', 'sentAt', 'deliveredAt', 'readAt', 'providerMessageId', 'lastError', 'updatedAt'],
  });

  // Complete the operation grant surface for the assembled domain modules.
  // Writes remain field-scoped for UPDATE; tenantId is needed by the scoped
  // Prisma boundary and is protected by the database identity guard. Prisma's
  // @updatedAt columns are included automatically because the client emits them
  // in the same UPDATE statement even when the service did not name them.
  const addModelAccess = (model, { insert = false, update = [], delete: canDelete = false } = {}) => {
    const table = modelTable(model);
    const current = runtime.get(table) ?? {};
    const columns = inventory.physicalColumns?.get(model);
    const updates = [...(current.updateColumns ?? []), ...update.map((field) => columns?.get(field) ?? field)];
    if (model !== 'Tenant' && model !== 'Permission') {
      const tenantColumn = columns?.get('tenantId');
      if (tenantColumn) updates.push(tenantColumn);
    }
    updates.push(...(inventory.automaticUpdateColumns?.get(model) ?? []));
    runtime.set(table, {
      ...current,
      select: true,
      insert: current.insert === true || insert,
      delete: current.delete === true || canDelete,
      ...(updates.length ? { updateColumns: [...new Set(updates)] } : {}),
    });
  };
  const addAccess = (models, options = {}) => { for (const model of models) addModelAccess(model, options); };

  addAccess([
    'Adjustment', 'AdmissionApplication', 'ApprovalRequest', 'AttendanceRecord', 'AttendanceSession', 'BenefitAssignment', 'Concession', 'Credit',
    'CreditAllocation', 'Discount', 'FeeAssignment', 'FeeDemand', 'FeeDemandItem', 'FeeDemandItemAdjustment',
    'FeeDemandResponsibility', 'FeeOverride', 'FeePolicy', 'FeePolicyAction', 'FeePolicyScope', 'FeePolicyVersion',
    'FeeStructure', 'FeeStructureItem', 'FeeStructureVersion', 'FeeType', 'FeeTypeVersion', 'GatewayTransaction',
    'GatewayWebhook', 'Guardian', 'IdempotencyKey', 'Installment', 'InstallmentItem', 'Invoice', 'InvoiceLine',
    'LateFeeAccrual', 'LedgerAccount', 'LedgerEntry', 'Notification', 'NotificationTemplate', 'OutboxEvent',
    'PayerResponsibilityRule', 'Payment', 'PaymentAllocation', 'PaymentMethod', 'PaymentOrder', 'Receipt',
    'ReceiptLine', 'ReconciliationRecord', 'Refund', 'RefundAllocation', 'Role', 'RolePermission', 'Settlement',
    'Sponsor', 'Student', 'StudentGroup', 'StudentGroupMember', 'StudentGuardian', 'StudentUnitMembership',
    'Tenant', 'TenantBranding', 'TenantDomain', 'TenantNotificationSetting', 'TenantNumberingSettings', 'TenantPaymentGateway',
    'TenantSettings', 'User', 'UserRole', 'Waiver', 'Scholarship', 'Surcharge',
  ]);

  // Platform billing and tenant directory operations use their own SaaS
  // tables. Keep these grants explicit so the runtime can run lifecycle jobs
  // and provisioning without opening direct access to internal audit/sequence
  // tables.
  addAccess([
    'TenantProvisioningOperation', 'Branch', 'UserBranchMembership', 'OrganizationUnit',
    'UserOrganizationMembership', 'UserAssignment', 'Plan', 'PlanModule', 'PlanEntitlement',
    'TenantSubscription', 'TenantModuleOverride', 'TenantEntitlementOverride',
    'PlatformInvoice', 'PlatformPayment', 'PlatformRefund',
  ], { insert: true });

  addAccess([
    'Adjustment', 'AdmissionApplication', 'ApprovalRequest', 'AttendanceRecord', 'AttendanceSession', 'BenefitAssignment', 'Concession', 'Credit',
    'CreditAllocation', 'Discount', 'FeeAssignment', 'FeeDemand', 'FeeDemandItem', 'FeeDemandItemAdjustment',
    'FeeDemandResponsibility', 'FeeOverride', 'FeePolicy', 'FeePolicyAction', 'FeePolicyScope', 'FeePolicyVersion',
    'FeeStructure', 'FeeStructureItem', 'FeeStructureVersion', 'FeeType', 'FeeTypeVersion', 'GatewayTransaction',
    'GatewayWebhook', 'Guardian', 'IdempotencyKey', 'Installment', 'InstallmentItem', 'Invoice', 'InvoiceLine',
    'LateFeeAccrual', 'LedgerAccount', 'LedgerEntry', 'OutboxEvent', 'PayerResponsibilityRule', 'Payment',
    'PaymentAllocation', 'PaymentMethod', 'PaymentOrder', 'Receipt', 'ReceiptLine', 'ReconciliationRecord',
    'Refund', 'RefundAllocation', 'Role', 'RolePermission', 'Settlement', 'Sponsor', 'Student', 'StudentGroup',
    'StudentGroupMember', 'StudentGuardian', 'StudentUnitMembership', 'Tenant', 'TenantBranding', 'TenantDomain',
    'TenantNumberingSettings', 'TenantPaymentGateway', 'TenantSettings', 'User', 'UserRole', 'Waiver',
    'Scholarship', 'Surcharge',
  ], { insert: true });

  // Financial state is advanced only through the service transitions. No
  // posted amount, allocation, receipt, or audit row receives a generic UPDATE.
  const updateFields = {
    AcademicYear: ['name', 'startDate', 'endDate', 'isCurrent', 'isClosed', 'closedAt'],
    AcademicUnit: ['unitType', 'name', 'code', 'parentId', 'metadata', 'active'],
    Adjustment: ['approvalRequestId', 'status', 'approvedBy', 'approvedAt', 'reversedAt', 'reversalReason', 'appliedAt'],
    AttendanceRecord: ['status', 'remarks', 'updatedBy'],
    AdmissionApplication: ['applicantFirstName', 'applicantLastName', 'dateOfBirth', 'gender', 'phone', 'email', 'category', 'academicYearId', 'targetUnitId', 'admissionType', 'isInternational', 'metadata', 'status', 'submittedAt'],
    ApprovalRequest: ['status', 'decidedBy', 'decidedAt', 'decisionNote', 'executedAt'],
    BenefitAssignment: ['status', 'approvedBy', 'approvedAt', 'updatedBy'],
    Credit: ['availableAmount', 'allocatedAmount', 'refundedAmount', 'status'],
    CreditAllocation: ['reversedAt', 'reason'],
    FeeAssignment: ['branchId', 'dueDateOverride', 'updatedBy', 'status', 'needsAttention', 'generatedAt', 'generationSummary', 'approvedBy', 'approvedAt'],
    FeeCategory: ['name', 'code', 'kind', 'description', 'sortOrder', 'active'],
    FeeDemand: ['status', 'issuedAt', 'creditedAmount', 'paidAmount', 'adjustmentAmount', 'updatedBy'],
    FeeDemandItem: ['paidAmount', 'adjustmentAmount', 'status'],
    FeeOverride: ['status', 'approvedBy', 'approvedAt', 'updatedBy'],
    FeePolicy: ['name', 'description', 'priority', 'stage', 'active', 'explainTemplate', 'updatedBy'],
    FeePolicyVersion: ['status', 'approvedBy', 'approvedAt'],
    FeeStructure: ['name', 'description', 'priority', 'active', 'updatedBy'],
    FeeStructureVersion: ['status', 'effectiveTo', 'totalAmount', 'approvedBy', 'approvedAt'],
    FeeType: ['categoryId', 'name', 'description', 'priority', 'active', 'calculationMethod', 'defaultFrequency', 'optionality', 'taxable', 'taxPercent', 'applicabilityRule', 'updatedBy'],
    FeeTypeVersion: ['status', 'effectiveTo', 'approvedBy', 'approvedAt'],
    GatewayTransaction: ['status', 'providerOrderId', 'responsePayload', 'providerPaymentId', 'providerTxnId', 'providerStatusRaw', 'capturedAt', 'failedAt', 'paymentId', 'settlementId', 'errorCode', 'errorMessage'],
    GatewayWebhook: ['processingStatus', 'attemptCount', 'lastError', 'processedAt', 'resultingPaymentId', 'resultingTransactionId'],
    IdempotencyKey: ['status', 'responseCode', 'responseBody', 'resourceId', 'resourceType', 'completedAt'],
    Installment: ['paidAmount', 'adjustmentAmount', 'status'],
    InstallmentItem: ['paidAmount', 'adjustmentAmount'],
    Invoice: ['paidAmount', 'adjustmentAmount', 'status'],
    LedgerEntry: ['status', 'reversedByGroupId'],
    Notification: ['status', 'attemptCount', 'sentAt', 'deliveredAt', 'readAt', 'providerMessageId', 'lastError'],
    NotificationTemplate: ['subject', 'body', 'variables', 'active'],
    OutboxEvent: ['status', 'attempts', 'lastError', 'availableAt', 'publishedAt'],
    PayerResponsibilityRule: ['active'],
    Branch: ['code', 'name', 'status', 'archivedAt', 'phone', 'email', 'address', 'capacity', 'managerId', 'enabledModules'],
    OrganizationUnit: ['code', 'name', 'unitType', 'description', 'parentId', 'active'],
    UserAssignment: ['status', 'dueAt', 'startedAt', 'completedAt'],
    Plan: ['name', 'description', 'monthlyPrice', 'yearlyPrice', 'currency', 'trialDays', 'active'],
    TenantSubscription: ['isCurrent', 'status', 'cancelledAt', 'cancelAtPeriodEnd', 'trialEndsAt', 'currentPeriodStart', 'currentPeriodEnd'],
    TenantModuleOverride: ['enabled', 'reason', 'updatedBy'],
    TenantEntitlementOverride: ['limitValue', 'reason', 'updatedBy'],
    PlatformInvoice: ['status', 'paidAt'],
    PlatformPayment: ['status'],
    PlatformRefund: ['status', 'externalRefundId', 'processedAt'],
    Payment: ['allocatedAmount', 'unallocatedAmount', 'refundedAmount', 'netAmount', 'status', 'updatedBy'],
    PaymentAllocation: ['reversedAt', 'reversedBy', 'reversalReason'],
    PaymentMethod: ['name', 'code', 'kind', 'requiresReference', 'requiresInstrument', 'enabledForManual', 'enabledForOnline', 'active', 'sortOrder'],
    PaymentOrder: ['status', 'completedAt', 'providerStatusCheckLeaseUntil', 'providerStatusCheckLeaseId', 'providerStatusNextCheckAt', 'providerStatusCheckedAt'],
    ReconciliationRecord: ['status', 'resolution', 'resolvedBy', 'resolvedAt'],
    Refund: ['status', 'approvedBy', 'approvedAt', 'processedBy', 'processedAt', 'reversalApplied', 'resultingCreditId'],
    Role: ['permissionsConfigured'],
    Scholarship: ['name', 'code', 'percentage', 'fixedAmount', 'maxAmount', 'feeTypeIds', 'effectiveFrom', 'effectiveTo', 'active', 'policyId', 'requiresApproval', 'kind', 'funder', 'academicYearId', 'notes'],
    Discount: ['name', 'code', 'percentage', 'fixedAmount', 'maxAmount', 'feeTypeIds', 'effectiveFrom', 'effectiveTo', 'active', 'policyId', 'requiresApproval', 'reason', 'stackingMode', 'priority'],
    Concession: ['name', 'code', 'percentage', 'fixedAmount', 'maxAmount', 'feeTypeIds', 'effectiveFrom', 'effectiveTo', 'active', 'policyId', 'requiresApproval', 'reason'],
    Waiver: ['name', 'code', 'percentage', 'fixedAmount', 'maxAmount', 'feeTypeIds', 'effectiveFrom', 'effectiveTo', 'active', 'policyId', 'requiresApproval', 'reason', 'fullWaiver'],
    Surcharge: ['name', 'code', 'percentage', 'fixedAmount', 'maxAmount', 'feeTypeIds', 'effectiveFrom', 'effectiveTo', 'active', 'policyId', 'reason', 'taxable', 'taxPercent', 'mandatory', 'stackingMode', 'priority'],
    Settlement: ['status', 'reconciledAt'],
    Sponsor: ['name', 'code', 'type', 'contactPerson', 'phone', 'email', 'address', 'creditLimit', 'active'],
    Student: ['branchId', 'rollNumber', 'firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender', 'category', 'phone', 'email', 'addressLine1', 'city', 'state', 'postalCode', 'country', 'status', 'admissionType', 'scholarshipCategory', 'hostelStatus', 'transportStatus', 'transportRouteId', 'isInternational', 'academicScore', 'metadata', 'updatedBy'],
    StudentCustomAttribute: ['value', 'valueType'],
    StudentGroup: ['name', 'code', 'description', 'membershipRule', 'isDynamic'],
    Tenant: [
      'slug', 'name', 'status', 'contactEmail', 'contactPhone', 'countryCode', 'enabledModules', 'trialEndsAt',
      'subscriptionPlan', 'subscriptionStatus', 'subscriptionRenewalAt', 'updatedBy',
    ],
    TenantDomain: ['isPrimary', 'verifiedAt', 'verificationToken'],
    TenantBranding: ['institutionName', 'legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country', 'phone', 'email', 'website', 'logoUrl', 'primaryColor', 'accentColor', 'landingTitle', 'landingDescription', 'landingActionLabel', 'receiptFooter', 'invoiceFooter', 'authorizedSignatory'],
    TenantNumberingSettings: ['formatVersion', 'receiptPrefix', 'invoicePrefix', 'paymentPrefix', 'demandPrefix', 'refundPrefix', 'creditNotePrefix', 'adjustmentPrefix', 'applicationPrefix', 'studentPrefix', 'padding', 'includeYear', 'separator', 'resetAnnually', 'resetAnnuallyFrom'],
    TenantPaymentGateway: ['displayName', 'keyId', 'secretCiphertext', 'webhookSecretCiphertext', 'enabled', 'active', 'isDefault', 'isBackup', 'priority', 'supportedMethods', 'routingRules', 'minAmount', 'maxAmount', 'extraConfig', 'updatedBy'],
    TenantSettings: ['currency', 'currencySymbol', 'currencyMinorUnits', 'roundingMode', 'timezone', 'locale', 'dateFormat', 'defaultAcademicYearId', 'lateFeeMode', 'lateFeeGraceDays', 'lateFeeFlatAmount', 'lateFeePerDay', 'lateFeePercent', 'lateFeeMaxAmount', 'lateFeePaymentTermDays', 'lateFeeFeeTypeId', 'partialPaymentPolicy', 'overpaymentPolicy', 'allowAdvancePayment', 'minimumPartialAmount', 'refundApprovalThreshold', 'waiverApprovalThreshold', 'adjustmentApprovalThreshold', 'reminderScheduleDays', 'allowNegativeDemand', 'updatedBy'],
    User: [
      'email', 'phone', 'firstName', 'lastName', 'status', 'updatedBy', 'passwordHash',
      'mustChangePassword', 'failedLoginCount', 'lockedUntil', 'sessionVersion',
      'invitationTokenHash', 'invitationExpiresAt', 'emailVerifiedAt',
      'passwordResetTokenHash', 'passwordResetExpiresAt', 'pendingEmail',
      'emailChangeTokenHash', 'emailChangeExpiresAt',
      'platformRole', 'mfaSecret', 'mfaEnabledAt', 'mfaRecoveryCodeHashes',
    ],
  };
  for (const [model, fields] of Object.entries(updateFields)) addModelAccess(model, { update: fields });
  addModelAccess('StudentGroupMember', { delete: true });
  addModelAccess('RolePermission', { delete: true });
  addModelAccess('UserRole', { delete: true });
  addModelAccess('TenantDomain', { delete: true });
  addModelAccess('UserBranchMembership', { delete: true });
  addModelAccess('UserOrganizationMembership', { delete: true });
  addModelAccess('PlanModule', { delete: true });
  addModelAccess('PlanEntitlement', { delete: true });
  addModelAccess('TenantModuleOverride', { delete: true });
  addModelAccess('TenantEntitlementOverride', { delete: true });
  addModelAccess('IdempotencyKey', { delete: true });

  if (auditMode === 'legacy') runtime.set(modelTable('AuditLog'), { select: true, insert: true });
  if (hasCapabilityTable) runtime.set('app_schema_capabilities', { select: true });
  return { runtime, backup, modelTables: new Set(inventory.models.values()) };
}

function compareNames(label, expected, actual) {
  const missing = [...expected].filter((name) => !actual.has(name));
  const unknown = [...actual].filter((name) => !expected.has(name));
  if (missing.length || unknown.length) {
    throw new Error(`${label} catalog mismatch (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`);
  }
}

export function validateCapabilityMarkerSchema(columns, primaryKeys) {
  if (columns.length !== 1 || columns[0].column_name !== 'key'
    || columns[0].data_type !== 'text' || columns[0].is_nullable !== 'NO') {
    throw new Error('Capability marker table must contain only one non-null text key column');
  }
  if (primaryKeys.length !== 1 || !Array.isArray(primaryKeys[0].columns)
    || primaryKeys[0].columns.length !== 1 || primaryKeys[0].columns[0] !== 'key') {
    throw new Error('Capability marker table must use key as its only primary-key column');
  }
}

export function validateLargeObjectInventory(hasLargeObjects) {
  if (typeof hasLargeObjects !== 'boolean') {
    throw new Error('PostgreSQL large-object inventory could not be verified');
  }
  if (hasLargeObjects) {
    throw new Error('Unexpected PostgreSQL large objects require an explicit backup and ACL policy');
  }
}

async function readInventory(client, prismaInventory, migrationRole, runtimeRole, backupRole, identityGuardManifest) {
  const largeObjects = await client.query(
    'SELECT EXISTS (SELECT 1 FROM pg_largeobject_metadata) AS present',
  );
  validateLargeObjectInventory(largeObjects.rows[0]?.present);

  const capability = await client.query(
    `SELECT to_regclass('public.app_schema_capabilities') IS NOT NULL AS exists`,
  );
  const hasCapabilityTable = capability.rows[0].exists;
  let auditMode = 'legacy';
  const expectedRelations = expectedPublicRelations(prismaInventory, { hasCapabilityTable });
  const relations = await client.query(
    `SELECT relation.relname AS name, relation.relkind AS kind,
       relation.relowner::regrole::text AS owner
     FROM pg_class AS relation
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND relation.relpersistence <> 't'`,
  );
  compareNames('Public relation', expectedRelations, new Set(relations.rows.map(({ name }) => name)));
  if (relations.rows.some(({ owner }) => owner !== migrationRole)) {
    throw new Error('A public application relation is not owned by the configured migration role');
  }

  // Audit tables are inaccessible to the runtime credential. The dedicated
  // non-login owner receives only the exact operations needed by the signed
  // append/verifier functions; those functions remain the only runtime path.
  const auditOwnerTableGrants = new Map([
    [prismaInventory.models.get('AuditLog'), new Set(['SELECT', 'INSERT'])],
    // Chain-head UPDATE is granted per-column by the final audit migration;
    // table-level UPDATE must remain revoked and is verified below.
    [prismaInventory.models.get('AuditChainHead'), new Set(['SELECT', 'INSERT'])],
    [prismaInventory.models.get('AuditSigningKey'), new Set(['SELECT', 'INSERT'])],
    [prismaInventory.models.get('AuditRequestNonce'), new Set(['SELECT', 'INSERT', 'DELETE'])],
  ]);
  for (const [table, allowedPrivileges] of auditOwnerTableGrants) {
    for (const privilege of TABLE_PRIVILEGES) {
      const result = await client.query(
        'SELECT has_table_privilege($1, $2, $3) AS allowed',
        ['fee_audit_owner', `public.${table}`, privilege],
      );
      const expected = allowedPrivileges.has(privilege);
      if (result.rows[0].allowed !== expected) {
        throw new Error(`Audit-owner table ${privilege} privilege differs from the manifest on ${table}`);
      }
    }
  }
  const auditHeadColumns = await client.query(
    `SELECT attribute.attname AS name,
       has_column_privilege('fee_audit_owner', attribute.attrelid, attribute.attname, 'UPDATE') AS can_update
     FROM pg_attribute AS attribute
     WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped`,
    [`public.${prismaInventory.models.get('AuditChainHead')}`],
  );
  const allowedHeadUpdates = new Set(['lastSequence', 'lastHash', 'legacySnapshotHash', 'updatedAt']);
  if (auditHeadColumns.rows.some(({ name, can_update }) => Boolean(can_update) !== allowedHeadUpdates.has(name))) {
    throw new Error('Audit-owner chain-head column UPDATE privileges differ from the exact mutable-head manifest');
  }

  const sequences = await client.query(
    `SELECT relation.relname AS name, relation.relowner::regrole::text AS owner
     FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relkind = 'S'`,
  );
  if (sequences.rows.length) {
    throw new Error(`Unexpected public sequences require an explicit ACL manifest: ${sequences.rows.map(({ name }) => name).join(', ')}`);
  }

  const routines = await client.query(
    `SELECT namespace.nspname AS schema_name, procedure.proname AS name,
       pg_get_function_identity_arguments(procedure.oid) AS arguments,
       procedure.proowner::regrole::text AS owner, procedure.prosecdef AS security_definer,
       procedure.proconfig AS configuration
     FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public' AND procedure.prokind IN ('f', 'p')`,
  );
  const expectedRoutine = identityGuardManifest.function;
  const expectedRoutineIdentity = expectedRoutine.schema + '.' + expectedRoutine.name + '(' + expectedRoutine.argumentTypes.join(', ') + ')';
  const brandingCompatibilityRoutineIdentity = 'public.sync_tenant_branding_organization_name()';
  const routineIdentity = (routine) => routine.schema_name + '.' + routine.name + '(' + routine.arguments + ')';
  compareNames('Public function', new Set([expectedRoutineIdentity, brandingCompatibilityRoutineIdentity]), new Set(routines.rows.map(routineIdentity)));
  for (const routine of routines.rows) {
    if (routine.owner !== migrationRole || routine.security_definer ||
        JSON.stringify(routine.configuration ?? []) !== JSON.stringify(['search_path=pg_catalog'])) {
      throw new Error('Tenant identity trigger function owner or execution configuration differs from the approved manifest');
    }
  }

  const auditFunctions = [
    ['app_private.fee_audit_canonical_json(jsonb)', false],
    ['app_private.fee_audit_append_core(jsonb)', true],
    ['app_private.fee_audit_append_api(jsonb, bytea)', true],
    ['app_private.fee_audit_legacy_snapshot_hash(uuid)', true],
    ['app_private.fee_audit_anchor_legacy_snapshots()', true],
    ['app_private.fee_audit_verify_tenant(uuid, integer)', true],
    ['app_private.fee_audit_read_tenant(uuid, uuid, jsonb, integer, integer, jsonb)', true],
    ['app_private.fee_audit_provision_tenant_head()', true],
  ];
  const auditRoutineRows = await client.query(
    `SELECT namespace.nspname || '.' || procedure.proname || '('
         || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
       procedure.proowner::regrole::text AS owner, procedure.prosecdef AS security_definer,
       procedure.proconfig AS configuration,
       EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
         WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) AS public_execute
     FROM pg_proc AS procedure
     JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'app_private'
       AND namespace.nspname || '.' || procedure.proname || '('
         || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' = ANY($1::text[])`,
    [auditFunctions.map(([identity]) => identity)],
  );
  const auditRoutineByIdentity = new Map(auditRoutineRows.rows.map((routine) => [routine.identity, routine]));
  if (auditRoutineRows.rows.length !== auditFunctions.length || auditFunctions.some(([identity, definer]) => {
    const routine = auditRoutineByIdentity.get(identity);
    return !routine || routine.owner !== 'fee_audit_owner' || routine.security_definer !== definer
      || JSON.stringify(routine.configuration ?? []) !== JSON.stringify(['search_path=pg_catalog'])
      || routine.public_execute;
  })) {
    throw new Error('Audit routines differ from their owner, SECURITY DEFINER, safe search_path, or PUBLIC-execute contract');
  }

  const numberingFunctions = [
    'app_private.fee_document_number(uuid, "SequenceKind", text, date, boolean)',
    'app_private.fee_lock_numbering_configuration(uuid)',
  ];
  const numberingRoutines = await client.query(
    `SELECT procedure.proowner::regrole::text AS owner, procedure.prosecdef AS security_definer,
       procedure.proconfig AS configuration,
       EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
         WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
       ) AS public_execute
     FROM pg_proc AS procedure
     JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'app_private'
       AND namespace.nspname || '.' || procedure.proname || '('
         || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' = ANY($1::text[])`,
    [numberingFunctions],
  );
  if (numberingRoutines.rows.length !== numberingFunctions.length || numberingRoutines.rows.some((routine) =>
    routine.owner !== 'fee_numbering_owner' || !routine.security_definer
      || JSON.stringify(routine.configuration ?? []) !== JSON.stringify(['search_path=pg_catalog'])
      || routine.public_execute)) {
    throw new Error('Numbering functions are missing or differ from their owner, definer, search_path, or PUBLIC-execute contract');
  }
  const unexpectedPrivateExec = await client.query(
    `SELECT procedure.proname AS name
     FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app_private' AND procedure.prokind IN ('f', 'p')
       AND (has_function_privilege($1, procedure.oid, 'EXECUTE')
         OR has_function_privilege($2, procedure.oid, 'EXECUTE')
         OR EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
           WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
         ))
       AND namespace.nspname || '.' || procedure.proname || '('
         || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' <> ALL($3::text[])
       -- Provider-owned pgcrypto routines are extension members, not app
       -- helper functions. PUBLIC still has no schema USAGE on app_private.
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend AS dependency
         JOIN pg_extension AS extension ON extension.oid = dependency.refobjid
         WHERE dependency.classid = 'pg_proc'::regclass
           AND dependency.objid = procedure.oid
           AND dependency.refclassid = 'pg_extension'::regclass
           AND dependency.deptype = 'e'
           AND extension.extname = 'pgcrypto'
       )`,
    [runtimeRole, backupRole, [
      ...numberingFunctions,
      'app_private.fee_audit_append_api(jsonb, bytea)', 'app_private.fee_audit_verify_tenant(uuid, integer)',
      'app_private.fee_audit_read_tenant(uuid, uuid, jsonb, integer, integer, jsonb)',
    ]],
  );
  if (unexpectedPrivateExec.rows.length) {
    throw new Error('Runtime or backup has an unclassified app_private function grant');
  }

  const enums = await client.query(
    `SELECT type.typname AS name, type.typowner::regrole::text AS owner
     FROM pg_type AS type JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
     WHERE namespace.nspname = 'public' AND type.typtype = 'e'`,
  );
  compareNames('Public enum', new Set(prismaInventory.enums), new Set(enums.rows.map(({ name }) => name)));
  if (enums.rows.some(({ owner }) => owner !== migrationRole)) {
    throw new Error('A public Prisma enum is not owned by the configured migration role');
  }

  const domains = await client.query(
    `SELECT type.typname AS name FROM pg_type AS type
     JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
     WHERE namespace.nspname = 'public' AND type.typtype = 'd'`,
  );
  if (domains.rows.length) {
    throw new Error(`Unexpected public domains require an explicit ACL manifest: ${domains.rows.map(({ name }) => name).join(', ')}`);
  }

  const triggers = await client.query(
    `SELECT trigger.tgname AS name, relation.relname AS table_name,
       trigger.tgtype AS trigger_type, trigger.tgenabled AS enabled,
       trigger.tgqual IS NOT NULL AS has_condition,
       function.proname AS function_name,
       function_namespace.nspname AS function_schema,
       pg_get_function_identity_arguments(function.oid) AS function_arguments,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(trigger.tgattr::smallint[]) AS changed_column(attnum)
         JOIN pg_attribute AS attribute
           ON attribute.attrelid = trigger.tgrelid AND attribute.attnum = changed_column.attnum
         ORDER BY attribute.attnum
       ) AS columns
     FROM pg_trigger AS trigger JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     JOIN pg_proc AS function ON function.oid = trigger.tgfoid
     JOIN pg_namespace AS function_namespace ON function_namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal`,
  );
  const expectedTriggers = new Map(identityGuardManifest.triggers.map((trigger) => [trigger.triggerName, trigger]));
  expectedTriggers.set('tenants_audit_head_after_insert', {
    triggerName: 'tenants_audit_head_after_insert', table: 'tenants', triggerType: 5, enabled: 'O',
    hasCondition: false, functionSchema: 'app_private', functionName: 'fee_audit_provision_tenant_head',
    functionArguments: '', columns: [],
  });
  expectedTriggers.set('tenant_branding_organization_name_compat', {
    triggerName: 'tenant_branding_organization_name_compat', table: 'tenant_branding', triggerType: 23, enabled: 'O',
    hasCondition: false, functionSchema: 'public', functionName: 'sync_tenant_branding_organization_name',
    functionArguments: '', columns: ['institutionName', 'organizationName'],
  });
  compareNames('Public trigger', new Set(expectedTriggers.keys()), new Set(triggers.rows.map(({ name }) => name)));
  for (const trigger of triggers.rows) {
    const expected = expectedTriggers.get(trigger.name);
    const auditHeadTrigger = trigger.name === 'tenants_audit_head_after_insert';
    const brandingCompatibilityTrigger = trigger.name === 'tenant_branding_organization_name_compat';
    const expectedTriggerType = auditHeadTrigger ? 5 : brandingCompatibilityTrigger ? 23 : 19;
    const expectedFunctionSchema = auditHeadTrigger ? 'app_private' : expectedRoutine.schema;
    const expectedFunctionName = auditHeadTrigger
      ? 'fee_audit_provision_tenant_head'
      : brandingCompatibilityTrigger ? 'sync_tenant_branding_organization_name' : expectedRoutine.name;
    const expectedColumns = auditHeadTrigger ? [] : brandingCompatibilityTrigger ? ['institutionName', 'organizationName'] : expected ? [expected.column] : [];
    if (!expected || trigger.table_name !== expected.table || Number(trigger.trigger_type) !== expectedTriggerType ||
        trigger.enabled !== 'O' || trigger.has_condition || trigger.function_schema !== expectedFunctionSchema ||
        trigger.function_name !== expectedFunctionName || trigger.function_arguments !== '' ||
        JSON.stringify(trigger.columns) !== JSON.stringify(expectedColumns)) {
      throw new Error('Tenant identity trigger differs from the approved table/column/function manifest: ' + trigger.name);
    }
  }

  if (hasCapabilityTable) {
    const columns = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'app_schema_capabilities'
       ORDER BY ordinal_position`,
    );
    const primaryKeys = await client.query(
      `SELECT array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
       FROM pg_constraint AS constraint_row
       JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
       JOIN pg_attribute AS attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = key.attnum
       WHERE constraint_row.conrelid = 'public.app_schema_capabilities'::regclass
         AND constraint_row.contype = 'p'
       GROUP BY constraint_row.oid`,
    );
    validateCapabilityMarkerSchema(columns.rows, primaryKeys.rows);
    const marker = await client.query(
      'SELECT EXISTS (SELECT 1 FROM public.app_schema_capabilities WHERE key = $1) AS installed',
      ['audit-chain-v2'],
    );
    if (marker.rows[0].installed) auditMode = 'v2';
  }
  return { relations: relations.rows, hasCapabilityTable, auditMode };
}

async function revokeColumnPrivileges(client, runtimeRole, backupRole, relationNames) {
  const roles = `PUBLIC, ${quoteIdentifier(runtimeRole)}, ${quoteIdentifier(backupRole)}`;
  for (const relation of relationNames) {
    const columns = await client.query(
      `SELECT attribute.attname AS name
       FROM pg_attribute AS attribute
       JOIN pg_class AS relation ON relation.oid = attribute.attrelid
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public' AND relation.relname = $1
         AND attribute.attnum > 0 AND NOT attribute.attisdropped
       ORDER BY attribute.attnum`,
      [relation],
    );
    if (columns.rows.length) {
      const names = columns.rows.map(({ name }) => quoteIdentifier(name)).join(', ');
      await client.query(`REVOKE ALL PRIVILEGES (${names}) ON TABLE public.${quoteIdentifier(relation)} FROM ${roles}`);
    }
  }

}

async function applyExactAcls(client, config, inventory) {
  const { migrationRole, runtimeRole, backupRole } = config;
  const migration = quoteIdentifier(migrationRole);
  const runtime = quoteIdentifier(runtimeRole);
  const backupRoleId = quoteIdentifier(backupRole);
  const { rows: publicRelations } = await client.query(
    `SELECT relation.relname
     FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND relation.relpersistence <> 't' ORDER BY relation.relname`,
  );
  const relationNames = publicRelations.map(({ relname }) => relname);
  await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await revokeColumnPrivileges(client, runtimeRole, backupRole, relationNames);
  await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, ${runtime}, ${backupRoleId}`);

  const identityFunction = inventory.identityGuardManifest.function;
  const identityFunctionRef = identityFunction.schema + '.' + quoteIdentifier(identityFunction.name) +
    '(' + identityFunction.argumentTypes.join(', ') + ')';
  const identityAcl = await client.query(
    `SELECT has_function_privilege($1, $3, 'EXECUTE') AS runtime_execute,
       has_function_privilege($2, $3, 'EXECUTE') AS backup_execute,
       EXISTS (
         SELECT 1 FROM pg_proc AS procedure
         CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
         WHERE procedure.oid = $3::regprocedure AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       ) AS public_execute`,
    [runtimeRole, backupRole, identityFunctionRef],
  );
  if (identityAcl.rows[0]?.runtime_execute || identityAcl.rows[0]?.backup_execute || identityAcl.rows[0]?.public_execute) {
    throw new Error('Tenant identity trigger function is executable by runtime, backup, or PUBLIC');
  }

  const numberingFunctions = [
    'app_private.fee_document_number(uuid, public."SequenceKind", text, date, boolean)',
    'app_private.fee_lock_numbering_configuration(uuid)',
  ];
  const numberingFunctionIdentities = [
    'app_private.fee_document_number(uuid, "SequenceKind", text, date, boolean)',
    'app_private.fee_lock_numbering_configuration(uuid)',
  ];
  const auditAppendFunction = 'app_private.fee_audit_append_api(jsonb, bytea)';
  const auditVerifyFunction = 'app_private.fee_audit_verify_tenant(uuid, integer)';
  const auditReadFunction = 'app_private.fee_audit_read_tenant(uuid, uuid, jsonb, integer, integer, jsonb)';
  await client.query('SET ROLE fee_audit_owner');
  await client.query(`REVOKE ALL ON FUNCTION ${auditAppendFunction}, ${auditVerifyFunction}, ${auditReadFunction} FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${auditAppendFunction} TO ${runtime}`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${auditVerifyFunction} TO ${runtime}`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${auditReadFunction} TO ${runtime}`);
  await client.query('RESET ROLE');

  const auditWrapperAcl = await client.query(
    `WITH routine_acl AS (
       SELECT namespace.nspname || '.' || procedure.proname || '('
           || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
         procedure.oid,
         EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
           WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
         ) AS public_execute
       FROM pg_proc AS procedure
       JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app_private'
         AND namespace.nspname || '.' || procedure.proname || '('
           || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' = ANY(ARRAY[$3::text, $4::text, $5::text])
     )
     SELECT has_function_privilege($1, (SELECT oid FROM routine_acl WHERE identity = $3), 'EXECUTE') AS runtime_execute,
       has_function_privilege($2, (SELECT oid FROM routine_acl WHERE identity = $3), 'EXECUTE') AS backup_execute,
       has_function_privilege($1, (SELECT oid FROM routine_acl WHERE identity = $4), 'EXECUTE') AS verify_runtime_execute,
       has_function_privilege($2, (SELECT oid FROM routine_acl WHERE identity = $4), 'EXECUTE') AS verify_backup_execute,
       has_function_privilege($1, (SELECT oid FROM routine_acl WHERE identity = $5), 'EXECUTE') AS read_runtime_execute,
       has_function_privilege($2, (SELECT oid FROM routine_acl WHERE identity = $5), 'EXECUTE') AS read_backup_execute,
       EXISTS (SELECT 1 FROM routine_acl WHERE public_execute) AS public_execute`,
    [runtimeRole, backupRole, auditAppendFunction, auditVerifyFunction, auditReadFunction],
  );
  const wrappers = auditWrapperAcl.rows[0];
  if (!wrappers?.runtime_execute || wrappers.backup_execute || !wrappers.verify_runtime_execute ||
      wrappers.verify_backup_execute || !wrappers.read_runtime_execute || wrappers.read_backup_execute || wrappers.public_execute) {
    throw new Error('Signed audit append/verifier wrapper EXECUTE grants differ from the least-privilege runtime boundary');
  }

  await client.query('SET ROLE fee_numbering_owner');
  for (const numberingFunction of numberingFunctions) {
    await client.query(`REVOKE ALL ON FUNCTION ${numberingFunction} FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query(`GRANT EXECUTE ON FUNCTION ${numberingFunction} TO ${runtime}`);
  }
  await client.query('RESET ROLE');

  for (const relation of relationNames) {
    await client.query(`GRANT SELECT ON TABLE public.${quoteIdentifier(relation)} TO ${backupRoleId}`);
  }

  const numberingAcl = await client.query(
    `WITH routine_acl AS (
       SELECT namespace.nspname || '.' || procedure.proname || '('
           || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
         procedure.oid,
         EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS privilege
           WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
         ) AS public_execute
       FROM pg_proc AS procedure
       JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
       WHERE namespace.nspname = 'app_private'
         AND namespace.nspname || '.' || procedure.proname || '('
           || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' = ANY(ARRAY[$3::text, $4::text])
     )
     SELECT has_function_privilege($1, (SELECT oid FROM routine_acl WHERE identity = $3), 'EXECUTE') AS runtime_execute,
       has_function_privilege($2, (SELECT oid FROM routine_acl WHERE identity = $3), 'EXECUTE') AS backup_execute,
       EXISTS (SELECT 1 FROM routine_acl WHERE identity = $3 AND public_execute) AS public_execute,
       has_function_privilege($1, (SELECT oid FROM routine_acl WHERE identity = $4), 'EXECUTE') AS runtime_lock_execute,
       has_function_privilege($2, (SELECT oid FROM routine_acl WHERE identity = $4), 'EXECUTE') AS backup_lock_execute,
       EXISTS (SELECT 1 FROM routine_acl WHERE identity = $4 AND public_execute) AS public_lock_execute,
       has_schema_privilege($1, 'app_private', 'USAGE') AS runtime_schema_usage,
       has_schema_privilege($1, 'app_private', 'CREATE') AS runtime_schema_create,
       has_schema_privilege($2, 'app_private', 'USAGE') AS backup_schema_usage,
       has_schema_privilege('fee_audit_owner', 'app_private', 'USAGE') AS audit_schema_usage,
       has_schema_privilege('fee_audit_owner', 'app_private', 'CREATE') AS audit_schema_create,
       has_schema_privilege('fee_numbering_owner', 'app_private', 'CREATE') AS owner_schema_create,
       has_table_privilege('fee_numbering_owner', 'public.sequences', 'INSERT') AS owner_sequence_insert,
       has_column_privilege('fee_numbering_owner', 'public.sequences', 'nextValue', 'UPDATE') AS owner_counter_update,
       has_column_privilege('fee_numbering_owner', 'public.sequences', 'updatedAt', 'UPDATE') AS owner_timestamp_update,
       has_column_privilege('fee_numbering_owner', 'public.sequences', 'prefix', 'UPDATE') AS owner_snapshot_update,
       has_table_privilege('fee_numbering_owner', 'public.sequences', 'DELETE') AS owner_sequence_delete,
       has_table_privilege('fee_numbering_owner', 'public.sequences', 'SELECT') AS owner_sequence_table_select,
       has_table_privilege($1, 'public.sequences', 'SELECT') AS runtime_sequence_select,
       has_table_privilege($1, 'public.sequences', 'INSERT') AS runtime_sequence_insert,
       has_table_privilege($1, 'public.sequences', 'UPDATE') AS runtime_sequence_update,
       has_table_privilege($1, 'public.tenant_numbering_settings', 'SELECT') AS runtime_settings_select
     `,
    [runtimeRole, backupRole, ...numberingFunctionIdentities],
  );
  const numberingAclRow = numberingAcl.rows[0];
  if (!numberingAclRow.runtime_execute || numberingAclRow.backup_execute || numberingAclRow.public_execute
    || !numberingAclRow.runtime_lock_execute || numberingAclRow.backup_lock_execute || numberingAclRow.public_lock_execute
    || !numberingAclRow.runtime_schema_usage || numberingAclRow.runtime_schema_create || numberingAclRow.backup_schema_usage
    || !numberingAclRow.audit_schema_usage || !numberingAclRow.audit_schema_create
    || !numberingAclRow.owner_schema_create || numberingAclRow.owner_sequence_insert || !numberingAclRow.owner_counter_update
    || !numberingAclRow.owner_timestamp_update || numberingAclRow.owner_snapshot_update || numberingAclRow.owner_sequence_delete
    || numberingAclRow.owner_sequence_table_select
    || numberingAclRow.runtime_sequence_select || numberingAclRow.runtime_sequence_insert || numberingAclRow.runtime_sequence_update
    || numberingAclRow.runtime_settings_select) {
    throw new Error('Numbering function or app_private schema grants differ from the least-privilege runtime boundary');
  }
  const readNumberingColumnAcl = async (relation) => {
    const result = await client.query(
      `SELECT
         COALESCE(array_agg(attribute.attname::text ORDER BY attribute.attname)
           FILTER (WHERE has_column_privilege('fee_numbering_owner', attribute.attrelid, attribute.attname, 'SELECT')), ARRAY[]::text[]) AS select_columns,
         COALESCE(array_agg(attribute.attname::text ORDER BY attribute.attname)
           FILTER (WHERE has_column_privilege('fee_numbering_owner', attribute.attrelid, attribute.attname, 'INSERT')), ARRAY[]::text[]) AS insert_columns,
         COALESCE(array_agg(attribute.attname::text ORDER BY attribute.attname)
           FILTER (WHERE has_column_privilege('fee_numbering_owner', attribute.attrelid, attribute.attname, 'UPDATE')), ARRAY[]::text[]) AS update_columns
       FROM pg_attribute AS attribute
       WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped`,
      [relation],
    );
    return result.rows[0];
  };
  const checkColumnSet = (relation, privilege, actual, expected) => {
    const normalize = (values) => new Set(values.map((value) => String(value)));
    const allowed = normalize(expected);
    const found = normalize(actual ?? []);
    const missing = [...allowed].filter((column) => !found.has(column));
    const unexpected = [...found].filter((column) => !allowed.has(column));
    if (missing.length || unexpected.length) {
      throw new Error(`Numbering-owner ${privilege} column grants differ on ${relation} (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`);
    }
  };
  const settingsColumns = await readNumberingColumnAcl('public.tenant_numbering_settings');
  const sequenceColumns = await readNumberingColumnAcl('public.sequences');
  checkColumnSet('TenantNumberingSettings', 'SELECT', settingsColumns.select_columns,
    ['tenantId', 'formatVersion', 'receiptPrefix', 'invoicePrefix', 'paymentPrefix', 'demandPrefix', 'refundPrefix', 'creditNotePrefix', 'adjustmentPrefix', 'applicationPrefix', 'studentPrefix', 'padding', 'includeYear', 'separator', 'resetAnnually', 'reset_annually_from']);
  checkColumnSet('TenantNumberingSettings', 'INSERT', settingsColumns.insert_columns, []);
  checkColumnSet('TenantNumberingSettings', 'UPDATE', settingsColumns.update_columns, []);
  checkColumnSet('Sequence', 'SELECT', sequenceColumns.select_columns, ['id', 'tenantId', 'kind', 'formatVersion', 'scope', 'nextValue']);
  checkColumnSet('Sequence', 'INSERT', sequenceColumns.insert_columns,
    ['id', 'tenantId', 'kind', 'formatVersion', 'scope', 'prefix', 'nextValue', 'padding', 'separator', 'resetAnnually', 'lastResetPeriod', 'includeYear', 'periodSegment', 'updatedAt']);
  checkColumnSet('Sequence', 'UPDATE', sequenceColumns.update_columns, ['nextValue', 'updatedAt']);
  const { rows: publicSequences } = await client.query(
    `SELECT relation.relname FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND relation.relkind = 'S'`,
  );
  for (const { relname } of publicSequences) {
    await client.query(`GRANT SELECT ON SEQUENCE public.${quoteIdentifier(relname)} TO ${backupRoleId}`);
  }

  for (const [relation, grants] of inventory.runtime) {
    const target = `public.${quoteIdentifier(relation)}`;
    if (grants.select) await client.query(`GRANT SELECT ON TABLE ${target} TO ${runtime}`);
    if (grants.selectColumns?.length) {
      const columns = grants.selectColumns.map(quoteIdentifier).join(', ');
      await client.query(`GRANT SELECT (${columns}) ON TABLE ${target} TO ${runtime}`);
    }
    if (grants.insert) await client.query(`GRANT INSERT ON TABLE ${target} TO ${runtime}`);
    if (grants.delete) await client.query(`GRANT DELETE ON TABLE ${target} TO ${runtime}`);
    if (grants.updateColumns?.length) {
      const columns = grants.updateColumns.map(quoteIdentifier).join(', ');
      await client.query(`GRANT UPDATE (${columns}) ON TABLE ${target} TO ${runtime}`);
    }
  }

  for (const relation of relationNames) {
    const allowed = inventory.runtime.get(relation);
    for (const privilege of TABLE_PRIVILEGES) {
      const result = await client.query(
        `SELECT has_table_privilege($1, $2, $3) AS allowed`,
        [runtimeRole, `public.${relation}`, privilege],
      );
      const expected = privilege === 'SELECT' ? Boolean(allowed?.select)
        : privilege === 'INSERT' ? Boolean(allowed?.insert)
          : privilege === 'DELETE' ? Boolean(allowed?.delete) : false;
      if (result.rows[0].allowed !== expected) {
        throw new Error(`Runtime table-level ${privilege} privilege differs from the manifest on ${relation}`);
      }
    }
    const columns = await client.query(
      `SELECT attribute.attname AS name FROM pg_attribute AS attribute
       WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped
       ORDER BY attribute.attname`,
      [`public.${relation}`],
    );
    const expectedSelectColumns = new Set(allowed?.selectColumns ?? []);
    for (const { name } of columns.rows) {
      const result = await client.query(
        `SELECT has_column_privilege($1, $2, $3, 'SELECT') AS allowed`,
        [runtimeRole, `public.${relation}`, name],
      );
      const expected = Boolean(allowed?.select) || expectedSelectColumns.has(name);
      if (result.rows[0].allowed !== expected) {
        throw new Error(`Runtime column SELECT privilege differs from the manifest for ${relation}.${name}`);
      }
    }
    const backupCheck = await client.query(
      `SELECT has_table_privilege($1, $2, 'SELECT') AS can_read,
         has_table_privilege($1, $2, 'INSERT') AS can_insert,
         has_table_privilege($1, $2, 'UPDATE') AS can_update,
         has_table_privilege($1, $2, 'DELETE') AS can_delete,
         has_table_privilege($1, $2, 'TRUNCATE') AS can_truncate,
         has_table_privilege($1, $2, 'REFERENCES') AS can_reference,
         has_table_privilege($1, $2, 'TRIGGER') AS can_trigger`,
      [backupRole, `public.${relation}`],
    );
    const row = backupCheck.rows[0];
    if (!row.can_read || row.can_insert || row.can_update || row.can_delete || row.can_truncate || row.can_reference || row.can_trigger) {
      throw new Error(`Backup table privileges are not read-only on ${relation}`);
    }
  }

  const userTable = `public.${quoteIdentifier(inventory.modelTables.get('User'))}`;
  const refreshTable = `public.${quoteIdentifier(inventory.modelTables.get('RefreshToken'))}`;
  for (const column of AUTHENTICATION_USER_UPDATE_COLUMNS) {
    if (!(await client.query('SELECT has_column_privilege($1, $2, $3, \'UPDATE\') AS allowed', [runtimeRole, userTable, column])).rows[0].allowed) {
      throw new Error(`Runtime is missing the approved User.${column} update grant`);
    }
  }
  const userColumns = await client.query(
    `SELECT attribute.attname AS name FROM pg_attribute AS attribute
     WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped`,
    [userTable],
  );
  const userUpdateColumns = new Set(inventory.runtime.get(inventory.modelTables.get('User'))?.updateColumns ?? []);
  for (const { name } of userColumns.rows) {
    const allowed = userUpdateColumns.has(name);
    if ((await client.query('SELECT has_column_privilege($1, $2, $3, \'UPDATE\') AS allowed', [runtimeRole, userTable, name])).rows[0].allowed !== allowed) {
      throw new Error(`Runtime User column UPDATE privilege differs from the manifest for ${name}`);
    }
  }
  for (const column of AUTHENTICATION_REFRESH_TOKEN_UPDATE_COLUMNS) {
    if (!(await client.query('SELECT has_column_privilege($1, $2, $3, \'UPDATE\') AS allowed', [runtimeRole, refreshTable, column])).rows[0].allowed) {
      throw new Error(`Runtime is missing the approved RefreshToken.${column} update grant`);
    }
  }
  const refreshColumns = await client.query(
    `SELECT attribute.attname AS name FROM pg_attribute AS attribute
     WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped`,
    [refreshTable],
  );
  const refreshUpdateColumns = new Set(inventory.runtime.get(inventory.modelTables.get('RefreshToken'))?.updateColumns ?? []);
  for (const { name } of refreshColumns.rows) {
    const allowed = refreshUpdateColumns.has(name);
    if ((await client.query('SELECT has_column_privilege($1, $2, $3, \'UPDATE\') AS allowed', [runtimeRole, refreshTable, name])).rows[0].allowed !== allowed) {
      throw new Error(`Runtime RefreshToken column UPDATE privilege differs from the manifest for ${name}`);
    }
  }
  for (const [relation, grants] of inventory.runtime) {
    const target = `public.${quoteIdentifier(relation)}`;
    const columns = await client.query(
      `SELECT attribute.attname AS name FROM pg_attribute AS attribute
       WHERE attribute.attrelid = $1::regclass AND attribute.attnum > 0 AND NOT attribute.attisdropped
       ORDER BY attribute.attname`,
      [target],
    );
    const expectedUpdateColumns = new Set(grants.updateColumns ?? []);
    for (const { name } of columns.rows) {
      const result = await client.query(
        `SELECT has_column_privilege($1, $2, $3, 'UPDATE') AS allowed`,
        [runtimeRole, target, name],
      );
      if (result.rows[0].allowed !== expectedUpdateColumns.has(name)) {
        throw new Error(`Runtime column UPDATE privilege differs from the manifest for ${relation}.${name}`);
      }
    }
  }

  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE ALL ON TABLES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE ALL ON SEQUENCES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ${runtime}, ${backupRoleId}`);
  for (const owner of FUNCTION_OWNER_ROLES) {
    const ownerId = quoteIdentifier(owner);
    await client.query(`SET ROLE ${ownerId}`);
    await client.query(`ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query(`ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query(`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, ${runtime}, ${backupRoleId}`);
    await client.query('RESET ROLE');
  }
  const defaultAcls = await client.query(
    `SELECT creator.rolname AS creator, defaults.defaclobjtype AS object_type,
       privilege.privilege_type, privilege.grantee::text AS grantee_oid,
       pg_get_userbyid(privilege.grantee) AS grantee_name, privilege.is_grantable
     FROM pg_default_acl AS defaults
     JOIN pg_roles AS creator ON creator.oid = defaults.defaclrole
     CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS privilege
     LEFT JOIN pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
     WHERE (namespace.nspname = 'public' OR defaults.defaclnamespace = 0)
       AND defaults.defaclobjtype IN ('r', 'S', 'f')`,
  );
  for (const acl of defaultAcls.rows) {
    if (acl.grantee_oid === '0' || acl.grantee_name === runtimeRole || acl.grantee_name === backupRole) {
      throw new Error(`Default ACL grants public/runtime/backup privileges on future ${acl.privilege_type} objects`);
    }
    const approvedNeonDefault = config.neonManagedHost
      && acl.creator === 'cloud_admin'
      && acl.grantee_name === 'neon_superuser'
      && ['r', 'S'].includes(acl.object_type)
      && acl.is_grantable;
    if (![migrationRole, ...FUNCTION_OWNER_ROLES].includes(acl.grantee_name) && !approvedNeonDefault) {
      throw new Error(`Default ACL includes an unclassified grantee: ${acl.grantee_name}`);
    }
  }

  const database = await client.query(
    `SELECT has_database_privilege($1, current_database(), 'CONNECT') AS runtime_connect,
       has_database_privilege($1, current_database(), 'CREATE') AS runtime_create,
       has_database_privilege($1, current_database(), 'TEMP') AS runtime_temp,
       has_database_privilege($2, current_database(), 'CONNECT') AS backup_connect,
       has_database_privilege($2, current_database(), 'CREATE') AS backup_create,
       has_database_privilege($2, current_database(), 'TEMP') AS backup_temp,
       has_schema_privilege($1, 'public', 'USAGE') AS runtime_schema_usage,
       has_schema_privilege($1, 'public', 'CREATE') AS runtime_schema_create,
       has_schema_privilege($2, 'public', 'USAGE') AS backup_schema_usage,
       has_schema_privilege($2, 'public', 'CREATE') AS backup_schema_create`,
    [runtimeRole, backupRole],
  );
  const checked = database.rows[0];
  if (!checked.runtime_connect || checked.runtime_create || checked.runtime_temp || !checked.runtime_schema_usage || checked.runtime_schema_create
    || !checked.backup_connect || checked.backup_create || checked.backup_temp || !checked.backup_schema_usage || checked.backup_schema_create) {
    throw new Error('Runtime/backup database or schema privileges differ from the least-privilege manifest');
  }
  const membership = await client.query(
    `SELECT pg_has_role($1, owner.oid, 'MEMBER') AS member
     FROM pg_roles AS owner WHERE owner.rolname = ANY($2::text[])`,
    [runtimeRole, FUNCTION_OWNER_ROLES],
  );
  if (membership.rows.some(({ member }) => member)) throw new Error('Runtime can assume a function-owner role');
  const backupMembership = await client.query(
    `SELECT pg_has_role($1, owner.oid, 'MEMBER') AS member
     FROM pg_roles AS owner WHERE owner.rolname = ANY($2::text[])`,
    [backupRole, FUNCTION_OWNER_ROLES],
  );
  if (backupMembership.rows.some(({ member }) => member)) throw new Error('Backup can assume a function-owner role');
}

export async function synchronizeDatabaseAcls({
  connectionString,
  migrationRole,
  runtimeRole,
  backupRole,
  target,
  schemaSource,
  ClientConstructor = Client,
} = {}) {
  migrationRole = safeRole(migrationRole, 'MIGRATION_DATABASE_ROLE');
  runtimeRole = safeRole(runtimeRole, 'RUNTIME_DATABASE_ROLE');
  backupRole = safeRole(backupRole, 'BACKUP_DATABASE_ROLE');
  if (new Set([migrationRole, runtimeRole, backupRole]).size !== 3) throw new Error('Migration, runtime, and backup roles must be distinct');
  if (!connectionString || !target) throw new Error('Migration connection URL and shared database target are required');
  const parsed = verifyPostgresUrlTarget(connectionString, 'MIGRATION_DATABASE_URL', target);
  if (parsed.username !== migrationRole || !parsed.password) throw new Error('Migration URL must use the configured migration role');
  const source = schemaSource ?? await readFile(resolve(root, 'prisma/schema.prisma'), 'utf8');
  const prismaInventory = parsePrismaObjectInventory(source);
  const identityGuardManifest = buildTenantIdentityGuardManifest(source);
  const client = new ClientConstructor({ connectionString, connectionTimeoutMillis: 5000, application_name: 'fee-database-acl-sync' });
  let connected = false;
  let transaction = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query(
      `SELECT current_database() AS database_name, current_user AS current_role, session_user AS login_role,
         current_user = $1 AS migration_identity,
         (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`,
      [migrationRole],
    );
    if (identity.rows[0]?.database_name !== target.database || identity.rows[0]?.current_role !== migrationRole
      || identity.rows[0]?.login_role !== migrationRole || identity.rows[0]?.privileged) {
      throw new Error('ACL synchronizer is not connected as the approved non-admin migration role and target');
    }

    await client.query('BEGIN');
    transaction = true;
    await client.query('SELECT pg_advisory_xact_lock_shared($1, $2)', AUDIT_CUTOVER_LOCK);
    const catalog = await readInventory(client, prismaInventory, migrationRole, runtimeRole, backupRole, identityGuardManifest);
    const manifest = buildAclManifest(prismaInventory, {
      auditMode: catalog.auditMode,
      hasCapabilityTable: catalog.hasCapabilityTable,
    });
    const config = {
      migrationRole,
      runtimeRole,
      backupRole,
      neonManagedHost: target.host.toLowerCase().endsWith('.neon.tech'),
    };
    await applyExactAcls(client, config, {
      ...manifest,
      modelTables: prismaInventory.models,
      identityGuardManifest,
    });
    await client.query('COMMIT');
    transaction = false;
    return { relations: catalog.relations.length, guardedTables: identityGuardManifest.triggers.length, auditMode: catalog.auditMode };
  } catch (error) {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    const safeCode = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? ` (${error.code})` : '';
    if (error instanceof Error && !error.code) throw error;
    throw new Error(`Database ACL synchronization failed${safeCode}`);
  } finally {
    if (connected) await client.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = {
    host: process.env.DATABASE_TARGET_HOST,
    port: process.env.DATABASE_TARGET_PORT,
    database: process.env.DATABASE_TARGET_NAME,
    schema: process.env.DATABASE_TARGET_SCHEMA,
  };
  try {
    const result = await synchronizeDatabaseAcls({
      connectionString: process.env.MIGRATION_DATABASE_URL,
      migrationRole: process.env.MIGRATION_DATABASE_ROLE,
      runtimeRole: process.env.RUNTIME_DATABASE_ROLE,
      backupRole: process.env.BACKUP_DATABASE_ROLE,
      target,
    });
    console.log(`Database ACL manifest synchronized for ${result.relations} public relations and ${result.guardedTables} tenant identity guards (${result.auditMode} audit mode).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Database ACL synchronization failed');
    process.exitCode = 1;
  }
}
