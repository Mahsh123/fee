/**
 * @fee/dates - date arithmetic for financial periods.
 *
 * All dates that cross a boundary (database, JSON, queue payload) are ISO
 * `YYYY-MM-DD` strings, never `Date` objects. A `Date` carries a timezone and a
 * time, and a fee due on `2026-04-05` must not shift to `2026-04-04` because a
 * server in UTC parsed a local midnight.
 */
export type IsoDate = string;
export type IsoDateTime = string;
export declare function toIsoDate(value: Date | string): IsoDate;
export declare function toIsoDateTime(value: Date | string): IsoDateTime;
export declare function parseIsoDate(value: IsoDate): Date;
export declare function addDays(value: IsoDate, days: number): IsoDate;
export declare function addMonths(value: IsoDate, months: number): IsoDate;
/**
 * Calendar-day difference (`to - from`). Calendar days, not 24-hour periods, so
 * a due date of the 1st and a payment on the 2nd is exactly one day late.
 */
export declare function daysBetween(from: IsoDate, to: IsoDate): number;
/** Positive when `asOf` is past `dueDate` and the grace period has elapsed. */
export declare function daysLate(dueDate: IsoDate, asOf: IsoDate, graceDays?: number): number;
export declare function isBeforeDate(a: IsoDate, b: IsoDate): boolean;
export declare function isAfterDate(a: IsoDate, b: IsoDate): boolean;
export declare function isWithinInclusive(value: IsoDate, from: IsoDate, to: IsoDate): boolean;
export declare function later(a: IsoDate, b: IsoDate): IsoDate;
export declare function earlier(a: IsoDate, b: IsoDate): IsoDate;
export interface Period {
    start: IsoDate;
    end: IsoDate;
    /** Stable key used for reporting buckets, e.g. `2026-27` or `2026-04`. */
    key: string;
    label: string;
}
export interface FiscalYearConfig {
    /** 1-12. 4 for an April-March Indian fiscal year, 1 for a calendar year. */
    startMonth: number;
    startDay?: number;
    /** `2026-27` (two-year label) or `2026` (single-year label). */
    labelStyle?: 'RANGE_TWO_YEAR' | 'START_YEAR' | 'END_YEAR';
    separator?: string;
}
export declare const DEFAULT_FISCAL_YEAR: FiscalYearConfig;
export declare function fiscalYearFor(date: IsoDate, config?: FiscalYearConfig): Period;
export declare function monthPeriod(date: IsoDate): Period;
export declare function monthsIn(range: {
    start: IsoDate;
    end: IsoDate;
}): Period[];
export declare function nextPeriodAfter(period: Period): Period;
/**
 * Buckets a date into a period key for reporting. Keeps a report's grouping
 * consistent between the SQL aggregate and the in-memory rollup.
 */
export declare function periodKey(date: IsoDate, granularity: 'DAY' | 'MONTH' | 'QUARTER' | 'FINANCIAL_YEAR', fiscalConfig?: FiscalYearConfig): string;
export type DueRuleAnchor = 'PERIOD_START' | 'PERIOD_END' | 'ISSUE_DATE' | 'ACADEMIC_YEAR_START' | 'FIXED_DATE';
export interface DueRule {
    anchor: DueRuleAnchor;
    offsetDays?: number;
    offsetMonths?: number;
    fixedDate?: IsoDate;
    /** Push off a Saturday/Sunday onto the next working day. */
    adjustToWorkingDay?: boolean;
    workingDays?: number[];
}
/**
 * Resolves a stored due rule into an actual date. Kept data-driven so a tenant
 * can say "15 days after the period starts, but never on a Sunday" without a
 * code change.
 */
export declare function resolveDueDate(rule: DueRule, anchors: Partial<Record<Exclude<DueRuleAnchor, 'FIXED_DATE'>, IsoDate>>): IsoDate;
export interface InstallmentScheduleInput {
    startDate: IsoDate;
    count: number;
    /** Days between installments. Ignored when `frequency` is set. */
    intervalDays?: number;
    frequency?: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL';
    /** Custom due dates; when present these win and `count` is derived from them. */
    customDates?: IsoDate[];
}
/**
 * Produces the due dates for an installment plan. The last date is clamped so a
 * plan never extends past the academic window when `endDate` is supplied.
 */
export declare function installmentDueDates(input: InstallmentScheduleInput, endDate?: IsoDate): IsoDate[];
export declare function formatDate(value: IsoDate | Date, dateFormat?: string): string;
export declare function todayIso(now?: Date): IsoDate;
/** Guard used by services before persisting a caller-supplied date. */
export declare function assertIsoDate(value: string, label?: string): IsoDate;
//# sourceMappingURL=index.d.ts.map