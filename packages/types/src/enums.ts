/**
 * Domain enumerations.
 *
 * These are declared as `as const` objects rather than TypeScript `enum`s so a
 * value is always a plain string. That keeps them structurally compatible with
 * Prisma's generated enums, with JSON over the wire, and with the values stored
 * in the database, without a cast anywhere.
 *
 * The arrays are also the source of truth for validation and for the
 * configuration UI's dropdowns, so adding a value here is a single-line change.
 */

export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Administrative subscription state, distinct from tenant access lifecycle. */
export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ROLE_KEYS = [
  'PLATFORM_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'TENANT_MEMBER',
  'FINANCE_ADMIN',
  'FINANCE_STAFF',
  'ADMISSION_STAFF',
  'COLLECTION_STAFF',
  'ACCOUNTANT',
  'REPORT_VIEWER',
  'STUDENT',
  'PARENT',
  'WORKSPACE_PERSON',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const STUDENT_STATUSES = ['PROSPECT', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'WITHDRAWN', 'ALUMNI'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const GUARDIAN_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN', 'SPONSOR_CONTACT', 'OTHER'] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

export const ADMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FEES_PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ENROLLED'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Fee catalog
// ---------------------------------------------------------------------------

export const FEE_CATEGORY_KINDS = [
  'ACADEMIC',
  'ADMISSION',
  'EXAMINATION',
  'TRANSPORT',
  'HOSTEL',
  'LIBRARY',
  'LABORATORY',
  'ACTIVITIES',
  'ADMINISTRATIVE',
  'OTHER',
] as const;
export type FeeCategoryKind = (typeof FEE_CATEGORY_KINDS)[number];

export const FEE_CALCULATION_METHODS = [
  'FIXED',
  'PERCENTAGE',
  'QUANTITY',
  'USAGE',
  'FORMULA',
  'CUSTOM',
] as const;
export type FeeCalculationMethod = (typeof FEE_CALCULATION_METHODS)[number];

export const FEE_FREQUENCIES = [
  'ONE_TIME',
  'MONTHLY',
  'QUARTERLY',
  'HALF_YEARLY',
  'ANNUAL',
  'TERM',
  'SEMESTER',
  'CUSTOM_DATE',
  'EVENT_BASED',
] as const;
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];

export const FEE_OPTIONALITIES = ['MANDATORY', 'OPTIONAL', 'CONDITIONAL'] as const;
export type FeeOptionality = (typeof FEE_OPTIONALITIES)[number];

export const VERSION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'ARCHIVED'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Policy engine
// ---------------------------------------------------------------------------

export const POLICY_TYPES = [
  'ELIGIBILITY',
  'SCHOLARSHIP',
  'DISCOUNT',
  'CONCESSION',
  'WAIVER',
  'EXEMPTION',
  'SURCHARGE',
  'OVERRIDE',
  'LATE_FEE',
  'EARLY_PAYMENT_DISCOUNT',
  'INSTALLMENT_RULE',
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const STACKING_MODES = [
  'STACKABLE',
  'NON_STACKABLE',
  'EXCLUSIVE',
  'HIGHEST_BENEFIT',
  'PRIORITY_ONLY',
] as const;
export type StackingMode = (typeof STACKING_MODES)[number];

export const CONDITION_OPERATORS = [
  'EQ',
  'NEQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'BETWEEN',
  'EXISTS',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const LOGICAL_OPERATORS = ['AND', 'OR'] as const;
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number];

export const ACTION_KINDS = [
  'ADD_FIXED_AMOUNT',
  'ADD_PERCENTAGE',
  'DISCOUNT_FIXED',
  'DISCOUNT_PERCENTAGE',
  'WAIVE_FULL',
  'WAIVE_PARTIAL',
  'EXEMPT',
  'OVERRIDE_AMOUNT',
  'SET_DUE_DATE',
  'ADD_LATE_FEE',
  'REMOVE_LATE_FEE',
  'CAP_AMOUNT',
  'SET_MINIMUM_AMOUNT',
  'SET_MAXIMUM_AMOUNT',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Actions that reduce the payable amount. */
export const CREDIT_ACTION_KINDS: readonly ActionKind[] = [
  'DISCOUNT_FIXED',
  'DISCOUNT_PERCENTAGE',
  'WAIVE_FULL',
  'WAIVE_PARTIAL',
  'EXEMPT',
];

/** Actions that increase the payable amount. */
export const DEBIT_ACTION_KINDS: readonly ActionKind[] = ['ADD_FIXED_AMOUNT', 'ADD_PERCENTAGE'];

export const ACTION_AMOUNT_BASES = ['BASE_AMOUNT', 'RUNNING_TOTAL', 'FEE_ITEM'] as const;
export type ActionAmountBasis = (typeof ACTION_AMOUNT_BASES)[number];

/**
 * The fixed order in which rule stages run. Tenants control *which* rules exist
 * and their priority within a stage; they cannot reorder the stages themselves,
 * because the arithmetic of a discount-then-surcharge ruleset differs from
 * surcharge-then-discount and both cannot be "correct" for one demand.
 *
 * Stored on each policy as `stage`, so the ordering itself is data.
 */
export const CALCULATION_STAGES = [
  'BASE',
  'SURCHARGE',
  'SCHOLARSHIP',
  'DISCOUNT',
  'CONCESSION',
  'WAIVER',
  'LIMIT',
  'OVERRIDE',
  'LATE_FEE',
] as const;
export type CalculationStage = (typeof CALCULATION_STAGES)[number];

export type AdjustmentDirection = 'DEBIT' | 'CREDIT';

// ---------------------------------------------------------------------------
// Demands
// ---------------------------------------------------------------------------

export const DEMAND_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'WAIVED',
  'CANCELLED',
  'CREDITED',
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export const DEMAND_ITEM_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED', 'CANCELLED'] as const;
export type DemandItemStatus = (typeof DEMAND_ITEM_STATUSES)[number];

export const INSTALLMENT_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const INSTALLMENT_BASES = ['FIXED_AMOUNT', 'PERCENTAGE', 'CUSTOM_SCHEDULE'] as const;
export type InstallmentBasis = (typeof INSTALLMENT_BASES)[number];

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = [
  'CREATED',
  'INITIATED',
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_CHANNELS = ['ONLINE', 'MANUAL', 'SPONSOR', 'ADVANCE', 'ADMISSION'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_METHOD_KINDS = [
  'CASH',
  'UPI_MANUAL',
  'BANK_TRANSFER',
  'CHEQUE',
  'DD',
  'CARD_OFFLINE',
  'UPI',
  'CARD',
  'NETBANKING',
  'WALLET',
  'INTERNATIONAL_CARD',
  'OTHER',
] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/** Methods a collection clerk can record at the counter. */
export const MANUAL_PAYMENT_METHODS: readonly PaymentMethodKind[] = [
  'CASH',
  'UPI_MANUAL',
  'BANK_TRANSFER',
  'CHEQUE',
  'DD',
  'CARD_OFFLINE',
  'OTHER',
];

export const PAYER_TYPES = [
  'STUDENT',
  'MEMBER',
  'PARENT',
  'GUARDIAN',
  'SPONSOR',
  'GOVERNMENT',
  'SCHOLARSHIP_FUND',
  'INSTITUTION',
  'THIRD_PARTY',
] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export const GATEWAY_PROVIDERS = ['RAZORPAY', 'CASHFREE', 'PAYU', 'STRIPE', 'MOCK'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

export const GATEWAY_ENVIRONMENTS = ['TEST', 'LIVE'] as const;
export type GatewayEnvironment = (typeof GATEWAY_ENVIRONMENTS)[number];

export const ALLOCATION_MODES = ['TARGETED', 'WATERFALL', 'OLDEST_FIRST', 'PROPORTIONAL', 'MANUAL'] as const;
export type AllocationMode = (typeof ALLOCATION_MODES)[number];

// ---------------------------------------------------------------------------
// Money movement
// ---------------------------------------------------------------------------

export const REFUND_KINDS = ['FULL', 'PARTIAL', 'GATEWAY', 'MANUAL'] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

export const REFUND_STATUSES = [
  'REQUESTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const CREDIT_STATUSES = ['AVAILABLE', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'VOID', 'EXPIRED'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const CREDIT_SOURCES = [
  'OVERPAYMENT',
  'ADVANCE_PAYMENT',
  'REFUND_TO_CREDIT',
  'ADJUSTMENT',
  'SPONSOR_SURPLUS',
  'OPENING_BALANCE',
] as const;
export type CreditSource = (typeof CREDIT_SOURCES)[number];

export const ADJUSTMENT_KINDS = [
  'DEBIT_ADJUSTMENT',
  'CREDIT_ADJUSTMENT',
  'WRITE_OFF',
  'WAIVER',
  'CORRECTION',
  'TRANSFER',
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'REVERSED',
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const LEDGER_SIDES = ['DEBIT', 'CREDIT'] as const;
export type LedgerSide = (typeof LEDGER_SIDES)[number];

export const LEDGER_ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY'] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

/**
 * Well-known ledger accounts every tenant is provisioned with. Tenants may add
 * their own accounts, but these keys are referenced by posting code and must
 * therefore exist.
 */
export const SYSTEM_LEDGER_ACCOUNTS = {
  STUDENT_RECEIVABLE: { code: '1100', type: 'ASSET' as LedgerAccountType, name: 'Student Receivable' },
  TENANT_PERSON_RECEIVABLE: { code: '1110', type: 'ASSET' as LedgerAccountType, name: 'Organisation Person Receivable' },
  GATEWAY_CLEARING: { code: '1200', type: 'ASSET' as LedgerAccountType, name: 'Gateway Clearing' },
  CASH_IN_HAND: { code: '1300', type: 'ASSET' as LedgerAccountType, name: 'Cash in Hand' },
  BANK_ACCOUNT: { code: '1400', type: 'ASSET' as LedgerAccountType, name: 'Bank Account' },
  STUDENT_CREDIT: { code: '2100', type: 'LIABILITY' as LedgerAccountType, name: 'Student Credit Balance' },
  TENANT_PERSON_CREDIT: { code: '2110', type: 'LIABILITY' as LedgerAccountType, name: 'Organisation Person Credit Balance' },
  SPONSOR_PAYABLE: { code: '2200', type: 'LIABILITY' as LedgerAccountType, name: 'Sponsor Payable' },
  UNAPPLIED_GATEWAY_RECEIPTS: { code: '2500', type: 'LIABILITY' as LedgerAccountType, name: 'Unapplied Gateway Receipts' },
  FEE_INCOME: { code: '4000', type: 'INCOME' as LedgerAccountType, name: 'Fee Income' },
  DISCOUNT_CONTRA: { code: '4100', type: 'INCOME' as LedgerAccountType, name: 'Discounts and Concessions' },
  SCHOLARSHIP_CONTRA: { code: '4200', type: 'INCOME' as LedgerAccountType, name: 'Scholarships' },
  WAIVER_CONTRA: { code: '4300', type: 'INCOME' as LedgerAccountType, name: 'Waivers' },
  LATE_FEE_INCOME: { code: '4400', type: 'INCOME' as LedgerAccountType, name: 'Late Fee Income' },
  SURCHARGE_INCOME: { code: '4500', type: 'INCOME' as LedgerAccountType, name: 'Surcharge Income' },
  TAX_PAYABLE: { code: '2300', type: 'LIABILITY' as LedgerAccountType, name: 'Tax Payable' },
  GATEWAY_FEE_EXPENSE: { code: '5100', type: 'EXPENSE' as LedgerAccountType, name: 'Gateway Charges' },
  REFUND_EXPENSE: { code: '5200', type: 'EXPENSE' as LedgerAccountType, name: 'Refunds Paid' },
  WRITE_OFF_EXPENSE: { code: '5300', type: 'EXPENSE' as LedgerAccountType, name: 'Bad Debt Write-off' },
  ADJUSTMENT_SUSPENSE: { code: '2400', type: 'LIABILITY' as LedgerAccountType, name: 'Adjustment Suspense' },
} as const;

export type SystemLedgerAccountKey = keyof typeof SYSTEM_LEDGER_ACCOUNTS;

// ---------------------------------------------------------------------------
// Lifecycle / configuration
// ---------------------------------------------------------------------------

export const ACADEMIC_UNIT_TYPES = [
  'COURSE',
  'PROGRAM',
  'CLASS',
  'SECTION',
  'BATCH',
  'DEPARTMENT',
  'HOSTEL',
  'TRANSPORT_ROUTE',
] as const;
export type AcademicUnitType = (typeof ACADEMIC_UNIT_TYPES)[number];

export const ASSIGNMENT_TARGET_TYPES = [
  'PERSON',
  'STUDENT',
  'CLASS',
  'SECTION',
  'BATCH',
  'COURSE',
  'DEPARTMENT',
  'PROGRAM',
  'HOSTEL',
  'TRANSPORT_ROUTE',
  'CUSTOM_GROUP',
] as const;
export type AssignmentTargetType = (typeof ASSIGNMENT_TARGET_TYPES)[number];

export const LATE_FEE_MODES = ['NONE', 'FLAT', 'PER_DAY', 'PERCENTAGE', 'CUSTOM'] as const;
export type LateFeeMode = (typeof LATE_FEE_MODES)[number];

export const PARTIAL_PAYMENT_POLICIES = ['ALLOW', 'ALLOW_WITH_APPROVAL', 'DISALLOW'] as const;
export type PartialPaymentPolicy = (typeof PARTIAL_PAYMENT_POLICIES)[number];

export const OVERPAYMENT_POLICIES = ['REJECT', 'CREDIT_BALANCE', 'ADVANCE_PAYMENT'] as const;
export type OverpaymentPolicy = (typeof OVERPAYMENT_POLICIES)[number];

export const ROUNDING_MODES = ['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL', 'NONE'] as const;
export type RoundingModeName = (typeof ROUNDING_MODES)[number];

export const APPROVAL_ACTION_TYPES = [
  'REFUND',
  'FEE_WAIVER',
  'MANUAL_ADJUSTMENT',
  'STUDENT_OVERRIDE',
  'SCHOLARSHIP',
  'WRITE_OFF',
  'FEE_STRUCTURE_CHANGE',
  'CREDIT_APPLICATION',
  'PAYMENT_COLLECTION',
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_EVENTS = [
  'USER_INVITATION',
  'USER_PASSWORD_RESET',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'PAYMENT_PENDING',
  'RECEIPT_GENERATED',
  'FEE_DUE',
  'FEE_OVERDUE',
  'INSTALLMENT_DUE',
  'ADMISSION_PAYMENT',
  'REFUND',
  'SCHOLARSHIP_APPLIED',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const SEQUENCE_KINDS = [
  'RECEIPT',
  'INVOICE',
  'PAYMENT',
  'DEMAND',
  'APPLICATION',
  'STUDENT',
  'REFUND',
  'CREDIT_NOTE',
  'ADJUSTMENT',
] as const;
export type SequenceKind = (typeof SEQUENCE_KINDS)[number];

/** Human-facing labels, used by the web app so a value is never shown raw. */
export const ENUM_LABELS: Record<string, string> = {
  MANDATORY: 'Mandatory',
  OPTIONAL: 'Optional',
  CONDITIONAL: 'Conditional',
  ONE_TIME: 'One time',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half yearly',
  ANNUAL: 'Annual',
  TERM: 'Per term',
  SEMESTER: 'Per semester',
  CUSTOM_DATE: 'Custom date',
  EVENT_BASED: 'Event based',
  STACKABLE: 'Stackable',
  NON_STACKABLE: 'Non-stackable',
  EXCLUSIVE: 'Exclusive',
  HIGHEST_BENEFIT: 'Highest benefit',
  PRIORITY_ONLY: 'Priority only',
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  WAIVED: 'Waived',
  CANCELLED: 'Cancelled',
  CREDITED: 'Credited',
  ISSUED: 'Issued',
  DRAFT: 'Draft',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  PENDING: 'Pending',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUND_PENDING: 'Refund pending',
  MANUAL: 'Manual',
  ONLINE: 'Online',
  SPONSOR: 'Sponsor',
  ADVANCE: 'Advance',
  ADMISSION: 'Admission',
  CASH: 'Cash',
  UPI_MANUAL: 'UPI (manual entry)',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  DD: 'Demand draft',
  CARD_OFFLINE: 'Card (offline)',
  CARD: 'Card',
  NETBANKING: 'Net banking',
  WALLET: 'Wallet',
  INTERNATIONAL_CARD: 'International card',
};

export function enumLabel(value: string): string {
  return (
    ENUM_LABELS[value] ??
    value
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}
