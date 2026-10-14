import type {
  ActionAmountBasis,
  ActionKind,
  CalculationStage,
  ConditionOperator,
  FeeCalculationMethod,
  FeeFrequency,
  FeeOptionality,
  LogicalOperator,
  PolicyType,
  StackingMode,
} from './enums';

/**
 * Fee calculation contracts.
 *
 * These types are the boundary between "what a tenant configured" and "what the
 * engine computed". Everything is expressed with decimal *strings*, not
 * `number`, because these objects cross HTTP, queue and database boundaries and
 * a float would silently round a financial value at any of them.
 */

export type DecimalString = string;

/** Safe, tenant-authored base amount configuration stored on a fee type version. */
export type FeeCalculationConfig =
  | { schemaVersion: 1; kind: 'USAGE'; quantityPath: string }
  | { schemaVersion: 1; kind: 'FORMULA' | 'CUSTOM'; expression: string };

export interface FeeBaseCalculationSnapshot {
  method: FeeCalculationMethod;
  config: FeeCalculationConfig | null;
  resolvedInputs: Record<string, DecimalString>;
  amount: DecimalString;
}

// ---------------------------------------------------------------------------
// Facts available to a rule condition
// ---------------------------------------------------------------------------

export type FactValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM';

export interface FactFieldDefinition {
  /** Dotted path used in conditions, e.g. `student.academicScore`. */
  readonly path: string;
  readonly label: string;
  readonly valueType: FactValueType;
  /** Allowed values for ENUM fields; free text otherwise. */
  readonly options?: readonly string[];
  readonly group: 'Student' | 'Fee' | 'Payment' | 'Academic' | 'History' | 'Custom';
}

/**
 * The catalogue of condition fields. Exposing this as data (rather than as
 * engine internals) is what lets the configuration UI build a rule with a
 * dropdown instead of asking an administrator to type a field name.
 */
export const FEE_RULE_FIELDS: readonly FactFieldDefinition[] = [
  { path: 'student.id', label: 'Student', valueType: 'STRING', group: 'Student' },
  { path: 'student.admissionNumber', label: 'Admission number', valueType: 'STRING', group: 'Student' },
  { path: 'student.class', label: 'Class', valueType: 'STRING', group: 'Student' },
  { path: 'student.section', label: 'Section', valueType: 'STRING', group: 'Student' },
  { path: 'student.batch', label: 'Batch', valueType: 'STRING', group: 'Student' },
  { path: 'student.course', label: 'Course / program', valueType: 'STRING', group: 'Student' },
  { path: 'student.department', label: 'Department', valueType: 'STRING', group: 'Student' },
  { path: 'student.category', label: 'Category', valueType: 'STRING', group: 'Student' },
  { path: 'student.gender', label: 'Gender', valueType: 'STRING', group: 'Student' },
  { path: 'student.hostelStatus', label: 'Hostel resident', valueType: 'BOOLEAN', group: 'Student' },
  { path: 'student.transportStatus', label: 'Uses transport', valueType: 'BOOLEAN', group: 'Student' },
  { path: 'student.transportRoute', label: 'Transport route', valueType: 'STRING', group: 'Student' },
  { path: 'student.scholarshipCategory', label: 'Scholarship category', valueType: 'STRING', group: 'Student' },
  { path: 'student.admissionType', label: 'Admission type', valueType: 'STRING', group: 'Student' },
  { path: 'student.academicScore', label: 'Academic score', valueType: 'NUMBER', group: 'Student' },
  { path: 'student.familyGroup', label: 'Family group', valueType: 'STRING', group: 'Student' },
  { path: 'student.isInternational', label: 'International student', valueType: 'BOOLEAN', group: 'Student' },
  { path: 'student.status', label: 'Student status', valueType: 'STRING', group: 'Student' },
  { path: 'student.siblingCount', label: 'Siblings enrolled', valueType: 'NUMBER', group: 'Student' },
  { path: 'student.tags', label: 'Tags', valueType: 'STRING', group: 'Student' },
  { path: 'fee.type', label: 'Fee type code', valueType: 'STRING', group: 'Fee' },
  { path: 'fee.category', label: 'Fee category code', valueType: 'STRING', group: 'Fee' },
  { path: 'fee.frequency', label: 'Fee frequency', valueType: 'ENUM', group: 'Fee' },
  { path: 'fee.optionality', label: 'Fee optionality', valueType: 'ENUM', group: 'Fee' },
  { path: 'fee.amount', label: 'Fee base amount', valueType: 'NUMBER', group: 'Fee' },
  { path: 'payment.date', label: 'Payment date', valueType: 'DATE', group: 'Payment' },
  { path: 'payment.amount', label: 'Payment amount', valueType: 'NUMBER', group: 'Payment' },
  { path: 'payment.method', label: 'Payment method', valueType: 'STRING', group: 'Payment' },
  { path: 'payment.channel', label: 'Payment channel', valueType: 'ENUM', group: 'Payment' },
  { path: 'payment.isEarlyPayment', label: 'Paid before early-payment cutoff', valueType: 'BOOLEAN', group: 'Payment' },
  { path: 'academicYear.name', label: 'Academic year', valueType: 'STRING', group: 'Academic' },
  { path: 'academicYear.startDate', label: 'Academic year start', valueType: 'DATE', group: 'Academic' },
  { path: 'academicYear.endDate', label: 'Academic year end', valueType: 'DATE', group: 'Academic' },
  { path: 'history.outstandingAmount', label: 'Current outstanding', valueType: 'NUMBER', group: 'History' },
  { path: 'history.arrearsAmount', label: 'Arrears carried forward', valueType: 'NUMBER', group: 'History' },
  { path: 'history.daysLate', label: 'Days late', valueType: 'NUMBER', group: 'History' },
  { path: 'history.installmentsPaid', label: 'Installments paid', valueType: 'NUMBER', group: 'History' },
  { path: 'history.isRenewal', label: 'Continuing student', valueType: 'BOOLEAN', group: 'History' },
  { path: 'evaluationDate', label: 'Evaluation date', valueType: 'DATE', group: 'Academic' },
] as const;

/** Facts a custom attribute can be referenced through: `custom.<key>`. */
export const CUSTOM_FACT_PREFIX = 'custom.';

export interface StudentFacts {
  id?: string;
  admissionNumber?: string;
  class?: string;
  section?: string;
  batch?: string;
  course?: string;
  department?: string;
  category?: string;
  gender?: string;
  hostelStatus?: boolean;
  transportStatus?: boolean;
  transportRoute?: string;
  scholarshipCategory?: string;
  admissionType?: string;
  academicScore?: DecimalString;
  familyGroup?: string;
  isInternational?: boolean;
  status?: string;
  /** Number of other students sharing this student's family group. */
  siblingCount?: number;
  tags?: string[];
  customAttributes?: Record<string, string | number | boolean | null>;
}

export interface FeeFacts {
  type?: string;
  category?: string;
  frequency?: FeeFrequency;
  optionality?: FeeOptionality;
  amount?: DecimalString;
  quantity?: DecimalString;
  percentBase?: DecimalString;
  dueDate?: string;
}

export interface PaymentFacts {
  date?: string;
  amount?: DecimalString;
  method?: string;
  channel?: string;
  isEarlyPayment?: boolean;
}

export interface AcademicFacts {
  id?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
}

export interface HistoryFacts {
  outstandingAmount?: DecimalString;
  arrearsAmount?: DecimalString;
  daysLate?: number;
  installmentsPaid?: number;
  isRenewal?: boolean;
}

/**
 * Everything a rule may test. The engine resolves a dotted field path against
 * this object; there is no other source of truth, which is what makes a
 * calculation reproducible months later from its stored snapshot.
 */
export interface FeeContext {
  student: StudentFacts;
  fee?: FeeFacts;
  payment?: PaymentFacts;
  academicYear?: AcademicFacts;
  history?: HistoryFacts;
  /** Evaluation date (ISO `YYYY-MM-DD`). Rule effective dates are compared to it. */
  evaluationDate: string;
  custom?: Record<string, string | number | boolean | null>;
  /**
   * The student's academic unit ancestry, nearest first. A rule scoped to a
   * PROGRAM matches a student in one of its CLASS children because the parent
   * id is present in this list.
   */
  scopeUnits?: string[];
  /** Custom group ids the student belongs to, for CUSTOM_GROUP scoped rules. */
  studentGroupIds?: string[];
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export interface ConditionLeaf {
  readonly kind: 'condition';
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  valueType?: FactValueType;
  negate?: boolean;
}

export interface ConditionGroup {
  readonly kind: 'group';
  op: LogicalOperator;
  children: ConditionNode[];
  negate?: boolean;
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

/** Row shape as stored in `fee_policy_conditions`. */
export interface FlatCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  valueType?: FactValueType;
  groupIndex?: number;
  logicalWith?: LogicalOperator;
  negate?: boolean;
}

/**
 * Builds a condition tree from flat rows. Rows sharing a `groupIndex` are
 * AND-ed; groups are combined with each row's `logicalWith`, letting a tenant
 * express `(A AND B) OR (C AND D)` without a bespoke tree editor.
 */
export function conditionsFromFlatRows(rows: readonly FlatCondition[]): ConditionNode | undefined {
  if (rows.length === 0) return undefined;
  const groups = new Map<number, FlatCondition[]>();
  for (const row of rows) {
    const index = row.groupIndex ?? 0;
    const bucket = groups.get(index);
    if (bucket) bucket.push(row);
    else groups.set(index, [row]);
  }
  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);

  const nodes: ConditionNode[] = ordered.map(([, bucket]) => {
    const leaves: ConditionNode[] = bucket.map((row) => ({
      kind: 'condition',
      field: row.field,
      operator: row.operator,
      value: row.value,
      valueType: row.valueType,
      negate: row.negate,
    }));
    if (leaves.length === 1) return leaves[0]!;
    return { kind: 'group', op: 'AND', children: leaves };
  });

  if (nodes.length === 1) {
    const only = nodes[0]!;
    // The first group's logicalWith applies to how it combines with the rest;
    // with a single group there is nothing to combine, so return it directly.
    return only;
  }
  const rootOp: LogicalOperator = ordered[1]?.[1][0]?.logicalWith ?? 'AND';
  return { kind: 'group', op: rootOp, children: nodes };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface RuleActionDefinition {
  id?: string;
  kind: ActionKind;
  amountBasis?: ActionAmountBasis;
  /** Absolute amount for *_FIXED_AMOUNT / SET_* / CAP actions. */
  amount?: DecimalString | null;
  /** Percentage for *_PERCENTAGE actions, e.g. `"50"` meaning 50%. */
  percentage?: DecimalString | null;
  /** Restrict to specific fee type codes; empty or absent means all items. */
  feeTypeCodes?: string[];
  capAmount?: DecimalString | null;
  floorAmount?: DecimalString | null;
  dueDate?: string | null;
  sortOrder?: number;
  parameters?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface RuleScopeDefinition {
  targetType: 'PERSON' | 'STUDENT' | 'CLASS' | 'SECTION' | 'BATCH' | 'COURSE' | 'DEPARTMENT' | 'PROGRAM' | 'HOSTEL' | 'TRANSPORT_ROUTE' | 'CUSTOM_GROUP';
  targetId?: string | null;
  /** Human label for the explain output, e.g. "Grade 10 (2026-27)". */
  targetLabel?: string | null;
  includeChildren?: boolean;
  academicYearId?: string | null;
}

export interface RuleLimits {
  /** Never remove more than this in total, in absolute money terms. */
  maxTotalDiscount?: DecimalString | null;
  minNetAmount?: DecimalString | null;
  maxNetAmount?: DecimalString | null;
}

/**
 * A single evaluated rule, flattened from
 * FeePolicy + FeePolicyVersion + conditions + actions + scopes.
 */
export interface RuleDefinition {
  id: string;
  versionId?: string;
  code: string;
  name: string;
  policyType: PolicyType;
  stage: CalculationStage;
  /** Lower runs first; ties break by code so ordering is total and stable. */
  priority: number;
  stackingMode: StackingMode;
  /** Rules sharing a group arbitrate against each other (EXCLUSIVE / HIGHEST_BENEFIT). */
  arbitrationGroup?: string | null;
  conditions?: ConditionNode;
  actions: RuleActionDefinition[];
  scopes?: RuleScopeDefinition[];
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'RETIRED' | 'ARCHIVED';
  requiresApproval?: boolean;
  approvalThreshold?: DecimalString | null;
  limits?: RuleLimits | null;
  /**
   * Which instrument backs this rule, when it is a per-student award rather
   * than a blanket policy. Recorded on every adjustment so a discount report can
   * name the scholarship that produced it.
   */
  instrument?: {
    type: 'SCHOLARSHIP' | 'DISCOUNT' | 'CONCESSION' | 'WAIVER' | 'SURCHARGE' | 'OVERRIDE' | 'LATE_FEE';
    id?: string | null;
    name?: string | null;
    reason?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
    taxable?: boolean;
    taxPercent?: DecimalString | null;
  } | null;
  /** Populated when the rule exists because of a per-student override. */
  override?: { originalAmount: DecimalString; overrideAmount: DecimalString; reason: string } | null;
  explainTemplate?: string | null;
}

// ---------------------------------------------------------------------------
// Calculation input
// ---------------------------------------------------------------------------

export interface FeeCalculationItemInput {
  /** Stable identifier for this line within the calculation. */
  key: string;
  feeTypeId?: string;
  feeTypeCode: string;
  feeTypeName: string;
  feeCategoryCode?: string;
  feeTypeVersionId?: string;
  sequence: number;
  frequency: FeeFrequency;
  optionality: FeeOptionality;
  /** Base amount before any adjustment. */
  baseAmount: DecimalString;
  /** Immutable calculation provenance copied into the result/demand snapshot. */
  baseCalculation?: FeeBaseCalculationSnapshot;
  quantity?: DecimalString;
  rate?: DecimalString;
  taxable?: boolean;
  taxPercent?: DecimalString;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  /**
   * Amount still unpaid on this item. Defaults to the item's net payable, which
   * is correct at demand-generation time. A late-fee accrual run passes the real
   * outstanding figure so a partially paid item is only charged on the balance.
   */
  outstandingAmount?: DecimalString;
}

export interface LateFeeConfig {
  mode: 'NONE' | 'FLAT' | 'PER_DAY' | 'PERCENTAGE' | 'CUSTOM';
  graceDays?: number;
  flatAmount?: DecimalString;
  perDayAmount?: DecimalString;
  percent?: DecimalString;
  maxAmount?: DecimalString | null;
  /** ISO date; late fee accrues from the day after this. */
  dueDate?: string;
  /** ISO date the late fee is computed for. */
  asOfDate?: string;
  /** Create the late fee as a separate traceable line instead of embedding it. */
  separateLine?: boolean;
}

export interface FeeCalculationRequest {
  currency: string;
  roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'NONE';
  /** ISO date rules are evaluated for. */
  asOfDate: string;
  context: FeeContext;
  items: FeeCalculationItemInput[];
  rules: RuleDefinition[];
  lateFee?: LateFeeConfig | null;
  /** Tenant-level floor applied to the final payable amount. */
  minimumPayable?: DecimalString | null;
  /** Cap applied to the *total* of all credits, e.g. "never discount past zero". */
  allowNegativeTotal?: boolean;
}

// ---------------------------------------------------------------------------
// Calculation output
// ---------------------------------------------------------------------------

export interface AdjustmentLine {
  /** Stable code, e.g. `SCHOLARSHIP:MERIT50`. */
  code: string;
  label: string;
  stage: CalculationStage;
  direction: 'DEBIT' | 'CREDIT';
  amount: DecimalString;
  percent?: DecimalString | null;
  basisAmount?: DecimalString | null;
  runningTotalAfter?: DecimalString;
  sequence: number;
  policyId?: string | null;
  policyVersionId?: string | null;
  policyName?: string | null;
  policyType?: PolicyType | null;
  stackingMode?: StackingMode | null;
  instrumentType?: string | null;
  instrumentId?: string | null;
  reason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  /** Set when a cap/floor absorbed part of the requested adjustment. */
  cappedBy?: string | null;
  notes?: string | null;
}

export interface FeeCalculationItemResult {
  key: string;
  feeTypeId?: string;
  feeTypeCode: string;
  feeTypeName: string;
  feeCategoryCode?: string;
  feeTypeVersionId?: string;
  sequence: number;
  frequency: FeeFrequency;
  optionality: FeeOptionality;
  quantity?: DecimalString;
  rate?: DecimalString;
  baseCalculation?: FeeBaseCalculationSnapshot;

  baseAmount: DecimalString;
  surchargeAmount: DecimalString;
  scholarshipAmount: DecimalString;
  discountAmount: DecimalString;
  concessionAmount: DecimalString;
  waiverAmount: DecimalString;
  overrideAmount: DecimalString;
  taxAmount: DecimalString;
  lateFeeAmount: DecimalString;

  /** base + surcharges + taxes, before any relief. */
  grossAmount: DecimalString;
  /** Total relief granted (scholarship + discount + concession + waiver + override reduction). */
  totalRelief: DecimalString;
  /** The amount actually payable for this item. */
  netAmount: DecimalString;

  /** Amount suppressed because of a cap/floor, for transparency. */
  cappedAmount: DecimalString;

  lines: AdjustmentLine[];
  appliedRuleIds: string[];
  skippedRules: SkippedRule[];
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  /** Flags a line that could not be computed confidently. */
  needsAttention?: boolean;
  attentionReasons?: string[];
}

export interface FeeCalculationTotals {
  baseAmount: DecimalString;
  surchargeAmount: DecimalString;
  scholarshipAmount: DecimalString;
  discountAmount: DecimalString;
  concessionAmount: DecimalString;
  waiverAmount: DecimalString;
  overrideAmount: DecimalString;
  lateFeeAmount: DecimalString;
  taxAmount: DecimalString;
  grossAmount: DecimalString;
  totalRelief: DecimalString;
  netAmount: DecimalString;
  cappedAmount: DecimalString;
}

export interface SkippedRule {
  ruleId: string;
  code: string;
  name: string;
  stage: CalculationStage;
  reason:
    | 'NOT_EFFECTIVE'
    | 'CONDITIONS_UNMET'
    | 'SCOPE_MISMATCH'
    | 'LOST_ARBITRATION'
    | 'NON_STACKABLE_ALREADY_APPLIED'
    | 'NO_TARGET_ITEM'
    | 'ZERO_EFFECT'
    | 'APPROVAL_REQUIRED'
    | 'CAP_REACHED';
  detail?: string;
  /** For LOST_ARBITRATION: who won, so the outcome is explainable. */
  winnerCode?: string;
}

export interface CalculationDiagnostic {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  message: string;
  itemKey?: string;
  ruleCode?: string;
}

export type FeeCalculationStatus = 'OK' | 'NEEDS_ATTENTION' | 'FAILED';

export interface FeeCalculationResult {
  status: FeeCalculationStatus;
  currency: string;
  /** Engine + rule-set version, so a stored result can be attributed. */
  calculationVersion: string;
  asOfDate: string;
  items: FeeCalculationItemResult[];
  totals: FeeCalculationTotals;
  diagnostics: CalculationDiagnostic[];
  appliedRuleIds: string[];
  skippedRules: SkippedRule[];
}

/**
 * A human-readable view of one line's derivation, which is what the
 * "Why this fee?" screen renders.
 */
export interface WhyThisFeeExplanation {
  feeTypeCode: string;
  feeTypeName: string;
  steps: Array<{ label: string; amount: DecimalString; direction: 'DEBIT' | 'CREDIT'; detail?: string }>;
  baseAmount: DecimalString;
  finalAmount: DecimalString;
  totalRelief: DecimalString;
}
