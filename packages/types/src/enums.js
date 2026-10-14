"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.APPROVAL_STATUSES = exports.APPROVAL_ACTION_TYPES = exports.ROUNDING_MODES = exports.OVERPAYMENT_POLICIES = exports.PARTIAL_PAYMENT_POLICIES = exports.LATE_FEE_MODES = exports.ASSIGNMENT_TARGET_TYPES = exports.ACADEMIC_UNIT_TYPES = exports.SYSTEM_LEDGER_ACCOUNTS = exports.LEDGER_ACCOUNT_TYPES = exports.LEDGER_SIDES = exports.ADJUSTMENT_STATUSES = exports.ADJUSTMENT_KINDS = exports.CREDIT_SOURCES = exports.CREDIT_STATUSES = exports.REFUND_STATUSES = exports.REFUND_KINDS = exports.ALLOCATION_MODES = exports.GATEWAY_ENVIRONMENTS = exports.GATEWAY_PROVIDERS = exports.PAYER_TYPES = exports.MANUAL_PAYMENT_METHODS = exports.PAYMENT_METHOD_KINDS = exports.PAYMENT_CHANNELS = exports.PAYMENT_STATUSES = exports.INSTALLMENT_BASES = exports.INSTALLMENT_STATUSES = exports.DEMAND_ITEM_STATUSES = exports.DEMAND_STATUSES = exports.CALCULATION_STAGES = exports.ACTION_AMOUNT_BASES = exports.DEBIT_ACTION_KINDS = exports.CREDIT_ACTION_KINDS = exports.ACTION_KINDS = exports.LOGICAL_OPERATORS = exports.CONDITION_OPERATORS = exports.STACKING_MODES = exports.POLICY_TYPES = exports.VERSION_STATUSES = exports.FEE_OPTIONALITIES = exports.FEE_FREQUENCIES = exports.FEE_CALCULATION_METHODS = exports.FEE_CATEGORY_KINDS = exports.ADMISSION_STATUSES = exports.GUARDIAN_RELATIONS = exports.STUDENT_STATUSES = exports.ROLE_KEYS = exports.USER_STATUSES = exports.SUBSCRIPTION_STATUSES = exports.TENANT_STATUSES = void 0;
exports.ENUM_LABELS = exports.SEQUENCE_KINDS = exports.NOTIFICATION_EVENTS = exports.NOTIFICATION_CHANNELS = void 0;
exports.enumLabel = enumLabel;
exports.TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'];
/** Administrative subscription state, distinct from tenant access lifecycle. */
exports.SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'];
exports.USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'];
exports.ROLE_KEYS = [
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
];
exports.STUDENT_STATUSES = ['PROSPECT', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'WITHDRAWN', 'ALUMNI'];
exports.GUARDIAN_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN', 'SPONSOR_CONTACT', 'OTHER'];
exports.ADMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FEES_PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ENROLLED'];
// ---------------------------------------------------------------------------
// Fee catalog
// ---------------------------------------------------------------------------
exports.FEE_CATEGORY_KINDS = [
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
];
exports.FEE_CALCULATION_METHODS = [
    'FIXED',
    'PERCENTAGE',
    'QUANTITY',
    'USAGE',
    'FORMULA',
    'CUSTOM',
];
exports.FEE_FREQUENCIES = [
    'ONE_TIME',
    'MONTHLY',
    'QUARTERLY',
    'HALF_YEARLY',
    'ANNUAL',
    'TERM',
    'SEMESTER',
    'CUSTOM_DATE',
    'EVENT_BASED',
];
exports.FEE_OPTIONALITIES = ['MANDATORY', 'OPTIONAL', 'CONDITIONAL'];
exports.VERSION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED', 'ARCHIVED'];
// ---------------------------------------------------------------------------
// Policy engine
// ---------------------------------------------------------------------------
exports.POLICY_TYPES = [
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
];
exports.STACKING_MODES = [
    'STACKABLE',
    'NON_STACKABLE',
    'EXCLUSIVE',
    'HIGHEST_BENEFIT',
    'PRIORITY_ONLY',
];
exports.CONDITION_OPERATORS = [
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
];
exports.LOGICAL_OPERATORS = ['AND', 'OR'];
exports.ACTION_KINDS = [
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
];
/** Actions that reduce the payable amount. */
exports.CREDIT_ACTION_KINDS = [
    'DISCOUNT_FIXED',
    'DISCOUNT_PERCENTAGE',
    'WAIVE_FULL',
    'WAIVE_PARTIAL',
    'EXEMPT',
];
/** Actions that increase the payable amount. */
exports.DEBIT_ACTION_KINDS = ['ADD_FIXED_AMOUNT', 'ADD_PERCENTAGE'];
exports.ACTION_AMOUNT_BASES = ['BASE_AMOUNT', 'RUNNING_TOTAL', 'FEE_ITEM'];
/**
 * The fixed order in which rule stages run. Tenants control *which* rules exist
 * and their priority within a stage; they cannot reorder the stages themselves,
 * because the arithmetic of a discount-then-surcharge ruleset differs from
 * surcharge-then-discount and both cannot be "correct" for one demand.
 *
 * Stored on each policy as `stage`, so the ordering itself is data.
 */
exports.CALCULATION_STAGES = [
    'BASE',
    'SURCHARGE',
    'SCHOLARSHIP',
    'DISCOUNT',
    'CONCESSION',
    'WAIVER',
    'LIMIT',
    'OVERRIDE',
    'LATE_FEE',
];
// ---------------------------------------------------------------------------
// Demands
// ---------------------------------------------------------------------------
exports.DEMAND_STATUSES = [
    'DRAFT',
    'ISSUED',
    'PARTIALLY_PAID',
    'PAID',
    'OVERDUE',
    'WAIVED',
    'CANCELLED',
    'CREDITED',
];
exports.DEMAND_ITEM_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED', 'CANCELLED'];
exports.INSTALLMENT_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];
exports.INSTALLMENT_BASES = ['FIXED_AMOUNT', 'PERCENTAGE', 'CUSTOM_SCHEDULE'];
// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
exports.PAYMENT_STATUSES = [
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
];
exports.PAYMENT_CHANNELS = ['ONLINE', 'MANUAL', 'SPONSOR', 'ADVANCE', 'ADMISSION'];
exports.PAYMENT_METHOD_KINDS = [
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
];
/** Methods a collection clerk can record at the counter. */
exports.MANUAL_PAYMENT_METHODS = [
    'CASH',
    'UPI_MANUAL',
    'BANK_TRANSFER',
    'CHEQUE',
    'DD',
    'CARD_OFFLINE',
    'OTHER',
];
exports.PAYER_TYPES = [
    'STUDENT',
    'PARENT',
    'GUARDIAN',
    'SPONSOR',
    'GOVERNMENT',
    'SCHOLARSHIP_FUND',
    'INSTITUTION',
    'THIRD_PARTY',
];
exports.GATEWAY_PROVIDERS = ['RAZORPAY', 'CASHFREE', 'PAYU', 'STRIPE', 'MOCK'];
exports.GATEWAY_ENVIRONMENTS = ['TEST', 'LIVE'];
exports.ALLOCATION_MODES = ['TARGETED', 'WATERFALL', 'OLDEST_FIRST', 'PROPORTIONAL', 'MANUAL'];
// ---------------------------------------------------------------------------
// Money movement
// ---------------------------------------------------------------------------
exports.REFUND_KINDS = ['FULL', 'PARTIAL', 'GATEWAY', 'MANUAL'];
exports.REFUND_STATUSES = [
    'REQUESTED',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
];
exports.CREDIT_STATUSES = ['AVAILABLE', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'VOID', 'EXPIRED'];
exports.CREDIT_SOURCES = [
    'OVERPAYMENT',
    'ADVANCE_PAYMENT',
    'REFUND_TO_CREDIT',
    'ADJUSTMENT',
    'SPONSOR_SURPLUS',
    'OPENING_BALANCE',
];
exports.ADJUSTMENT_KINDS = [
    'DEBIT_ADJUSTMENT',
    'CREDIT_ADJUSTMENT',
    'WRITE_OFF',
    'WAIVER',
    'CORRECTION',
    'TRANSFER',
];
exports.ADJUSTMENT_STATUSES = [
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'APPLIED',
    'REJECTED',
    'REVERSED',
];
exports.LEDGER_SIDES = ['DEBIT', 'CREDIT'];
exports.LEDGER_ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY'];
/**
 * Well-known ledger accounts every tenant is provisioned with. Tenants may add
 * their own accounts, but these keys are referenced by posting code and must
 * therefore exist.
 */
exports.SYSTEM_LEDGER_ACCOUNTS = {
    STUDENT_RECEIVABLE: { code: '1100', type: 'ASSET', name: 'Student Receivable' },
    GATEWAY_CLEARING: { code: '1200', type: 'ASSET', name: 'Gateway Clearing' },
    CASH_IN_HAND: { code: '1300', type: 'ASSET', name: 'Cash in Hand' },
    BANK_ACCOUNT: { code: '1400', type: 'ASSET', name: 'Bank Account' },
    STUDENT_CREDIT: { code: '2100', type: 'LIABILITY', name: 'Student Credit Balance' },
    SPONSOR_PAYABLE: { code: '2200', type: 'LIABILITY', name: 'Sponsor Payable' },
    UNAPPLIED_GATEWAY_RECEIPTS: { code: '2500', type: 'LIABILITY', name: 'Unapplied Gateway Receipts' },
    FEE_INCOME: { code: '4000', type: 'INCOME', name: 'Fee Income' },
    DISCOUNT_CONTRA: { code: '4100', type: 'INCOME', name: 'Discounts and Concessions' },
    SCHOLARSHIP_CONTRA: { code: '4200', type: 'INCOME', name: 'Scholarships' },
    WAIVER_CONTRA: { code: '4300', type: 'INCOME', name: 'Waivers' },
    LATE_FEE_INCOME: { code: '4400', type: 'INCOME', name: 'Late Fee Income' },
    SURCHARGE_INCOME: { code: '4500', type: 'INCOME', name: 'Surcharge Income' },
    TAX_PAYABLE: { code: '2300', type: 'LIABILITY', name: 'Tax Payable' },
    GATEWAY_FEE_EXPENSE: { code: '5100', type: 'EXPENSE', name: 'Gateway Charges' },
    REFUND_EXPENSE: { code: '5200', type: 'EXPENSE', name: 'Refunds Paid' },
    WRITE_OFF_EXPENSE: { code: '5300', type: 'EXPENSE', name: 'Bad Debt Write-off' },
    ADJUSTMENT_SUSPENSE: { code: '2400', type: 'LIABILITY', name: 'Adjustment Suspense' },
};
// ---------------------------------------------------------------------------
// Lifecycle / configuration
// ---------------------------------------------------------------------------
exports.ACADEMIC_UNIT_TYPES = [
    'COURSE',
    'PROGRAM',
    'CLASS',
    'SECTION',
    'BATCH',
    'DEPARTMENT',
    'HOSTEL',
    'TRANSPORT_ROUTE',
];
exports.ASSIGNMENT_TARGET_TYPES = [
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
];
exports.LATE_FEE_MODES = ['NONE', 'FLAT', 'PER_DAY', 'PERCENTAGE', 'CUSTOM'];
exports.PARTIAL_PAYMENT_POLICIES = ['ALLOW', 'ALLOW_WITH_APPROVAL', 'DISALLOW'];
exports.OVERPAYMENT_POLICIES = ['REJECT', 'CREDIT_BALANCE', 'ADVANCE_PAYMENT'];
exports.ROUNDING_MODES = ['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL', 'NONE'];
exports.APPROVAL_ACTION_TYPES = [
    'REFUND',
    'FEE_WAIVER',
    'MANUAL_ADJUSTMENT',
    'STUDENT_OVERRIDE',
    'SCHOLARSHIP',
    'WRITE_OFF',
    'FEE_STRUCTURE_CHANGE',
    'CREDIT_APPLICATION',
    'PAYMENT_COLLECTION',
];
exports.APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED'];
exports.NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'];
exports.NOTIFICATION_EVENTS = [
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
];
exports.SEQUENCE_KINDS = [
    'RECEIPT',
    'INVOICE',
    'PAYMENT',
    'DEMAND',
    'APPLICATION',
    'STUDENT',
    'REFUND',
    'CREDIT_NOTE',
    'ADJUSTMENT',
];
/** Human-facing labels, used by the web app so a value is never shown raw. */
exports.ENUM_LABELS = {
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
function enumLabel(value) {
    return (exports.ENUM_LABELS[value] ??
        value
            .toLowerCase()
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '));
}
//# sourceMappingURL=enums.js.map