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
export declare const TENANT_STATUSES: readonly ["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"];
export type TenantStatus = (typeof TENANT_STATUSES)[number];
/** Administrative subscription state, distinct from tenant access lifecycle. */
export declare const SUBSCRIPTION_STATUSES: readonly ["TRIAL", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"];
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export declare const USER_STATUSES: readonly ["INVITED", "ACTIVE", "SUSPENDED", "DISABLED"];
export type UserStatus = (typeof USER_STATUSES)[number];
export declare const ROLE_KEYS: readonly ["PLATFORM_ADMIN", "TENANT_OWNER", "TENANT_ADMIN", "TENANT_MEMBER", "FINANCE_ADMIN", "FINANCE_STAFF", "ADMISSION_STAFF", "COLLECTION_STAFF", "ACCOUNTANT", "REPORT_VIEWER", "STUDENT", "PARENT"];
export type RoleKey = (typeof ROLE_KEYS)[number];
export declare const STUDENT_STATUSES: readonly ["PROSPECT", "ACTIVE", "ON_LEAVE", "SUSPENDED", "WITHDRAWN", "ALUMNI"];
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export declare const GUARDIAN_RELATIONS: readonly ["FATHER", "MOTHER", "GUARDIAN", "SPONSOR_CONTACT", "OTHER"];
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];
export declare const ADMISSION_STATUSES: readonly ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FEES_PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "ENROLLED"];
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];
export declare const FEE_CATEGORY_KINDS: readonly ["ACADEMIC", "ADMISSION", "EXAMINATION", "TRANSPORT", "HOSTEL", "LIBRARY", "LABORATORY", "ACTIVITIES", "ADMINISTRATIVE", "OTHER"];
export type FeeCategoryKind = (typeof FEE_CATEGORY_KINDS)[number];
export declare const FEE_CALCULATION_METHODS: readonly ["FIXED", "PERCENTAGE", "QUANTITY", "USAGE", "FORMULA", "CUSTOM"];
export type FeeCalculationMethod = (typeof FEE_CALCULATION_METHODS)[number];
export declare const FEE_FREQUENCIES: readonly ["ONE_TIME", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL", "TERM", "SEMESTER", "CUSTOM_DATE", "EVENT_BASED"];
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];
export declare const FEE_OPTIONALITIES: readonly ["MANDATORY", "OPTIONAL", "CONDITIONAL"];
export type FeeOptionality = (typeof FEE_OPTIONALITIES)[number];
export declare const VERSION_STATUSES: readonly ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "RETIRED", "ARCHIVED"];
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export declare const POLICY_TYPES: readonly ["ELIGIBILITY", "SCHOLARSHIP", "DISCOUNT", "CONCESSION", "WAIVER", "EXEMPTION", "SURCHARGE", "OVERRIDE", "LATE_FEE", "EARLY_PAYMENT_DISCOUNT", "INSTALLMENT_RULE"];
export type PolicyType = (typeof POLICY_TYPES)[number];
export declare const STACKING_MODES: readonly ["STACKABLE", "NON_STACKABLE", "EXCLUSIVE", "HIGHEST_BENEFIT", "PRIORITY_ONLY"];
export type StackingMode = (typeof STACKING_MODES)[number];
export declare const CONDITION_OPERATORS: readonly ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "CONTAINS", "BETWEEN", "EXISTS"];
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export declare const LOGICAL_OPERATORS: readonly ["AND", "OR"];
export type LogicalOperator = (typeof LOGICAL_OPERATORS)[number];
export declare const ACTION_KINDS: readonly ["ADD_FIXED_AMOUNT", "ADD_PERCENTAGE", "DISCOUNT_FIXED", "DISCOUNT_PERCENTAGE", "WAIVE_FULL", "WAIVE_PARTIAL", "EXEMPT", "OVERRIDE_AMOUNT", "SET_DUE_DATE", "ADD_LATE_FEE", "REMOVE_LATE_FEE", "CAP_AMOUNT", "SET_MINIMUM_AMOUNT", "SET_MAXIMUM_AMOUNT"];
export type ActionKind = (typeof ACTION_KINDS)[number];
/** Actions that reduce the payable amount. */
export declare const CREDIT_ACTION_KINDS: readonly ActionKind[];
/** Actions that increase the payable amount. */
export declare const DEBIT_ACTION_KINDS: readonly ActionKind[];
export declare const ACTION_AMOUNT_BASES: readonly ["BASE_AMOUNT", "RUNNING_TOTAL", "FEE_ITEM"];
export type ActionAmountBasis = (typeof ACTION_AMOUNT_BASES)[number];
/**
 * The fixed order in which rule stages run. Tenants control *which* rules exist
 * and their priority within a stage; they cannot reorder the stages themselves,
 * because the arithmetic of a discount-then-surcharge ruleset differs from
 * surcharge-then-discount and both cannot be "correct" for one demand.
 *
 * Stored on each policy as `stage`, so the ordering itself is data.
 */
export declare const CALCULATION_STAGES: readonly ["BASE", "SURCHARGE", "SCHOLARSHIP", "DISCOUNT", "CONCESSION", "WAIVER", "LIMIT", "OVERRIDE", "LATE_FEE"];
export type CalculationStage = (typeof CALCULATION_STAGES)[number];
export type AdjustmentDirection = 'DEBIT' | 'CREDIT';
export declare const DEMAND_STATUSES: readonly ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "WAIVED", "CANCELLED", "CREDITED"];
export type DemandStatus = (typeof DEMAND_STATUSES)[number];
export declare const DEMAND_ITEM_STATUSES: readonly ["UNPAID", "PARTIALLY_PAID", "PAID", "WAIVED", "CANCELLED"];
export type DemandItemStatus = (typeof DEMAND_ITEM_STATUSES)[number];
export declare const INSTALLMENT_STATUSES: readonly ["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"];
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];
export declare const INSTALLMENT_BASES: readonly ["FIXED_AMOUNT", "PERCENTAGE", "CUSTOM_SCHEDULE"];
export type InstallmentBasis = (typeof INSTALLMENT_BASES)[number];
export declare const PAYMENT_STATUSES: readonly ["CREATED", "INITIATED", "PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export declare const PAYMENT_CHANNELS: readonly ["ONLINE", "MANUAL", "SPONSOR", "ADVANCE", "ADMISSION"];
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];
export declare const PAYMENT_METHOD_KINDS: readonly ["CASH", "UPI_MANUAL", "BANK_TRANSFER", "CHEQUE", "DD", "CARD_OFFLINE", "UPI", "CARD", "NETBANKING", "WALLET", "INTERNATIONAL_CARD", "OTHER"];
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];
/** Methods a collection clerk can record at the counter. */
export declare const MANUAL_PAYMENT_METHODS: readonly PaymentMethodKind[];
export declare const PAYER_TYPES: readonly ["STUDENT", "PARENT", "GUARDIAN", "SPONSOR", "GOVERNMENT", "SCHOLARSHIP_FUND", "INSTITUTION", "THIRD_PARTY"];
export type PayerType = (typeof PAYER_TYPES)[number];
export declare const GATEWAY_PROVIDERS: readonly ["RAZORPAY", "CASHFREE", "PAYU", "STRIPE", "MOCK"];
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];
export declare const GATEWAY_ENVIRONMENTS: readonly ["TEST", "LIVE"];
export type GatewayEnvironment = (typeof GATEWAY_ENVIRONMENTS)[number];
export declare const ALLOCATION_MODES: readonly ["TARGETED", "WATERFALL", "OLDEST_FIRST", "PROPORTIONAL", "MANUAL"];
export type AllocationMode = (typeof ALLOCATION_MODES)[number];
export declare const REFUND_KINDS: readonly ["FULL", "PARTIAL", "GATEWAY", "MANUAL"];
export type RefundKind = (typeof REFUND_KINDS)[number];
export declare const REFUND_STATUSES: readonly ["REQUESTED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PROCESSING", "COMPLETED", "FAILED"];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export declare const CREDIT_STATUSES: readonly ["AVAILABLE", "PARTIALLY_ALLOCATED", "ALLOCATED", "VOID", "EXPIRED"];
export type CreditStatus = (typeof CREDIT_STATUSES)[number];
export declare const CREDIT_SOURCES: readonly ["OVERPAYMENT", "ADVANCE_PAYMENT", "REFUND_TO_CREDIT", "ADJUSTMENT", "SPONSOR_SURPLUS", "OPENING_BALANCE"];
export type CreditSource = (typeof CREDIT_SOURCES)[number];
export declare const ADJUSTMENT_KINDS: readonly ["DEBIT_ADJUSTMENT", "CREDIT_ADJUSTMENT", "WRITE_OFF", "WAIVER", "CORRECTION", "TRANSFER"];
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export declare const ADJUSTMENT_STATUSES: readonly ["DRAFT", "PENDING_APPROVAL", "APPROVED", "APPLIED", "REJECTED", "REVERSED"];
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];
export declare const LEDGER_SIDES: readonly ["DEBIT", "CREDIT"];
export type LedgerSide = (typeof LEDGER_SIDES)[number];
export declare const LEDGER_ACCOUNT_TYPES: readonly ["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"];
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];
/**
 * Well-known ledger accounts every tenant is provisioned with. Tenants may add
 * their own accounts, but these keys are referenced by posting code and must
 * therefore exist.
 */
export declare const SYSTEM_LEDGER_ACCOUNTS: {
    readonly STUDENT_RECEIVABLE: {
        readonly code: "1100";
        readonly type: LedgerAccountType;
        readonly name: "Student Receivable";
    };
    readonly GATEWAY_CLEARING: {
        readonly code: "1200";
        readonly type: LedgerAccountType;
        readonly name: "Gateway Clearing";
    };
    readonly CASH_IN_HAND: {
        readonly code: "1300";
        readonly type: LedgerAccountType;
        readonly name: "Cash in Hand";
    };
    readonly BANK_ACCOUNT: {
        readonly code: "1400";
        readonly type: LedgerAccountType;
        readonly name: "Bank Account";
    };
    readonly STUDENT_CREDIT: {
        readonly code: "2100";
        readonly type: LedgerAccountType;
        readonly name: "Student Credit Balance";
    };
    readonly SPONSOR_PAYABLE: {
        readonly code: "2200";
        readonly type: LedgerAccountType;
        readonly name: "Sponsor Payable";
    };
    readonly UNAPPLIED_GATEWAY_RECEIPTS: {
        readonly code: "2500";
        readonly type: LedgerAccountType;
        readonly name: "Unapplied Gateway Receipts";
    };
    readonly FEE_INCOME: {
        readonly code: "4000";
        readonly type: LedgerAccountType;
        readonly name: "Fee Income";
    };
    readonly DISCOUNT_CONTRA: {
        readonly code: "4100";
        readonly type: LedgerAccountType;
        readonly name: "Discounts and Concessions";
    };
    readonly SCHOLARSHIP_CONTRA: {
        readonly code: "4200";
        readonly type: LedgerAccountType;
        readonly name: "Scholarships";
    };
    readonly WAIVER_CONTRA: {
        readonly code: "4300";
        readonly type: LedgerAccountType;
        readonly name: "Waivers";
    };
    readonly LATE_FEE_INCOME: {
        readonly code: "4400";
        readonly type: LedgerAccountType;
        readonly name: "Late Fee Income";
    };
    readonly SURCHARGE_INCOME: {
        readonly code: "4500";
        readonly type: LedgerAccountType;
        readonly name: "Surcharge Income";
    };
    readonly TAX_PAYABLE: {
        readonly code: "2300";
        readonly type: LedgerAccountType;
        readonly name: "Tax Payable";
    };
    readonly GATEWAY_FEE_EXPENSE: {
        readonly code: "5100";
        readonly type: LedgerAccountType;
        readonly name: "Gateway Charges";
    };
    readonly REFUND_EXPENSE: {
        readonly code: "5200";
        readonly type: LedgerAccountType;
        readonly name: "Refunds Paid";
    };
    readonly WRITE_OFF_EXPENSE: {
        readonly code: "5300";
        readonly type: LedgerAccountType;
        readonly name: "Bad Debt Write-off";
    };
    readonly ADJUSTMENT_SUSPENSE: {
        readonly code: "2400";
        readonly type: LedgerAccountType;
        readonly name: "Adjustment Suspense";
    };
};
export type SystemLedgerAccountKey = keyof typeof SYSTEM_LEDGER_ACCOUNTS;
export declare const ACADEMIC_UNIT_TYPES: readonly ["COURSE", "PROGRAM", "CLASS", "SECTION", "BATCH", "DEPARTMENT", "HOSTEL", "TRANSPORT_ROUTE"];
export type AcademicUnitType = (typeof ACADEMIC_UNIT_TYPES)[number];
export declare const ASSIGNMENT_TARGET_TYPES: readonly ["STUDENT", "CLASS", "SECTION", "BATCH", "COURSE", "DEPARTMENT", "PROGRAM", "HOSTEL", "TRANSPORT_ROUTE", "CUSTOM_GROUP"];
export type AssignmentTargetType = (typeof ASSIGNMENT_TARGET_TYPES)[number];
export declare const LATE_FEE_MODES: readonly ["NONE", "FLAT", "PER_DAY", "PERCENTAGE", "CUSTOM"];
export type LateFeeMode = (typeof LATE_FEE_MODES)[number];
export declare const PARTIAL_PAYMENT_POLICIES: readonly ["ALLOW", "ALLOW_WITH_APPROVAL", "DISALLOW"];
export type PartialPaymentPolicy = (typeof PARTIAL_PAYMENT_POLICIES)[number];
export declare const OVERPAYMENT_POLICIES: readonly ["REJECT", "CREDIT_BALANCE", "ADVANCE_PAYMENT"];
export type OverpaymentPolicy = (typeof OVERPAYMENT_POLICIES)[number];
export declare const ROUNDING_MODES: readonly ["HALF_UP", "HALF_EVEN", "FLOOR", "CEIL", "NONE"];
export type RoundingModeName = (typeof ROUNDING_MODES)[number];
export declare const APPROVAL_ACTION_TYPES: readonly ["REFUND", "FEE_WAIVER", "MANUAL_ADJUSTMENT", "STUDENT_OVERRIDE", "SCHOLARSHIP", "WRITE_OFF", "FEE_STRUCTURE_CHANGE", "CREDIT_APPLICATION", "PAYMENT_COLLECTION"];
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];
export declare const APPROVAL_STATUSES: readonly ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXECUTED"];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export declare const NOTIFICATION_CHANNELS: readonly ["EMAIL", "SMS", "WHATSAPP", "PUSH", "IN_APP"];
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export declare const NOTIFICATION_EVENTS: readonly ["USER_INVITATION", "USER_PASSWORD_RESET", "PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_PENDING", "RECEIPT_GENERATED", "FEE_DUE", "FEE_OVERDUE", "INSTALLMENT_DUE", "ADMISSION_PAYMENT", "REFUND", "SCHOLARSHIP_APPLIED"];
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export declare const SEQUENCE_KINDS: readonly ["RECEIPT", "INVOICE", "PAYMENT", "DEMAND", "APPLICATION", "STUDENT", "REFUND", "CREDIT_NOTE", "ADJUSTMENT"];
export type SequenceKind = (typeof SEQUENCE_KINDS)[number];
/** Human-facing labels, used by the web app so a value is never shown raw. */
export declare const ENUM_LABELS: Record<string, string>;
export declare function enumLabel(value: string): string;
//# sourceMappingURL=enums.d.ts.map