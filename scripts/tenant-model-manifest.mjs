// Every model declared here must own tenantId and a Tenant relation.
// New tenant-owned models are added deliberately so the DB generator can fail closed.
export const TENANT_MODEL_NAMES = Object.freeze([
  'TenantSettings', 'TenantBranding', 'TenantDomain', 'TenantNumberingSettings',
  'Branch', 'UserBranchMembership', 'OrganizationUnit', 'UserOrganizationMembership', 'UserAssignment',
  'TenantSubscription', 'TenantModuleOverride', 'TenantEntitlementOverride', 'PlatformInvoice', 'PlatformPayment', 'PlatformRefund',
  'TenantPaymentGateway', 'TenantNotificationSetting', 'User', 'Role', 'UserRole',
  'RolePermission', 'RefreshToken', 'AcademicYear', 'AcademicUnit', 'Student',
  'StudentUnitMembership', 'Guardian', 'StudentGuardian', 'StudentGroup',
  'StudentGroupMember', 'StudentCustomAttribute', 'AdmissionApplication', 'Admission',
  'Sponsor', 'FeeCategory', 'FeeType', 'FeeTypeVersion', 'FeeStructure',
  'FeeStructureVersion', 'FeeStructureItem', 'InstallmentRuleItem', 'FeePolicy',
  'FeePolicyVersion', 'FeePolicyCondition', 'FeePolicyAction', 'FeePolicyScope',
  'Scholarship', 'Discount', 'Concession', 'Waiver', 'Surcharge', 'FeeOverride',
  'BenefitAssignment', 'FeeAssignment', 'FeeDemand', 'FeeDemandItem',
  'PayerResponsibilityRule', 'FeeDemandResponsibility',
  'FeeDemandItemAdjustment', 'LateFeeAccrual', 'Installment', 'InstallmentItem',
  'PaymentOrder', 'Payment', 'PaymentAllocation', 'PaymentMethod',
  'GatewayTransaction', 'GatewayWebhook', 'IdempotencyKey', 'Refund', 'RefundAllocation', 'Credit',
  'CreditAllocation', 'Adjustment', 'LedgerAccount', 'LedgerEntry', 'Receipt',
  'ReceiptLine', 'Invoice', 'InvoiceLine', 'Document', 'Settlement',
  'ReconciliationRecord', 'NotificationTemplate', 'Notification', 'AuditLog', 'AuditChainHead', 'AuditRequestNonce',
  'ApprovalRequest', 'ReportJob', 'ExportJob', 'OutboxEvent', 'Sequence',
]);
