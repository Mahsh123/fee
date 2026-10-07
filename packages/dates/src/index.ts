import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  max as maxDate,
  min as minDate,
  parseISO,
  startOfMonth,
} from 'date-fns';

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

export function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return format(parseISO(trimmed), 'yyyy-MM-dd');
  }
  return format(value, 'yyyy-MM-dd');
}

export function toIsoDateTime(value: Date | string): IsoDateTime {
  return typeof value === 'string' ? value : value.toISOString();
}

export function parseIsoDate(value: IsoDate): Date {
  return parseISO(value);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return format(dfAddDays(parseIsoDate(value), days), 'yyyy-MM-dd');
}

export function addMonths(value: IsoDate, months: number): IsoDate {
  return format(dfAddMonths(parseIsoDate(value), months), 'yyyy-MM-dd');
}

/**
 * Calendar-day difference (`to - from`). Calendar days, not 24-hour periods, so
 * a due date of the 1st and a payment on the 2nd is exactly one day late.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return differenceInCalendarDays(parseIsoDate(to), parseIsoDate(from));
}

/** Positive when `asOf` is past `dueDate` and the grace period has elapsed. */
export function daysLate(dueDate: IsoDate, asOf: IsoDate, graceDays = 0): number {
  const late = daysBetween(dueDate, asOf);
  return late > graceDays ? late - graceDays : 0;
}

export function isBeforeDate(a: IsoDate, b: IsoDate): boolean {
  return isBefore(parseIsoDate(a), parseIsoDate(b));
}

export function isAfterDate(a: IsoDate, b: IsoDate): boolean {
  return isAfter(parseIsoDate(a), parseIsoDate(b));
}

export function isWithinInclusive(value: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return !isBeforeDate(value, from) && !isAfterDate(value, to);
}

export function later(a: IsoDate, b: IsoDate): IsoDate {
  return format(maxDate([parseIsoDate(a), parseIsoDate(b)]), 'yyyy-MM-dd');
}

export function earlier(a: IsoDate, b: IsoDate): IsoDate {
  return format(minDate([parseIsoDate(a), parseIsoDate(b)]), 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Financial / academic periods
// ---------------------------------------------------------------------------

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

export const DEFAULT_FISCAL_YEAR: FiscalYearConfig = {
  startMonth: 4,
  startDay: 1,
  labelStyle: 'RANGE_TWO_YEAR',
  separator: '-',
};

export function fiscalYearFor(date: IsoDate, config: FiscalYearConfig = DEFAULT_FISCAL_YEAR): Period {
  const startDay = config.startDay ?? 1;
  const parsed = parseIsoDate(date);
  const month = parsed.getMonth() + 1;
  const year = parsed.getFullYear();
  const beforeStart = month < config.startMonth || (month === config.startMonth && parsed.getDate() < startDay);
  const startYear = beforeStart ? year - 1 : year;
  const endYear = startYear + 1;
  const separator = config.separator ?? '-';
  const labelStyle = config.labelStyle ?? 'RANGE_TWO_YEAR';

  let key: string;
  switch (labelStyle) {
    case 'START_YEAR':
      key = String(startYear);
      break;
    case 'END_YEAR':
      key = String(endYear);
      break;
    default:
      key = `${startYear}${separator}${String(endYear).slice(-2)}`;
  }

  return {
    start: format(new Date(Date.UTC(startYear, config.startMonth - 1, startDay)), 'yyyy-MM-dd'),
    end: format(new Date(Date.UTC(endYear, config.startMonth - 1, startDay - 1)), 'yyyy-MM-dd'),
    key,
    label: key,
  };
}

export function monthPeriod(date: IsoDate): Period {
  const parsed = parseIsoDate(date);
  return {
    start: format(startOfMonth(parsed), 'yyyy-MM-dd'),
    end: format(endOfMonth(parsed), 'yyyy-MM-dd'),
    key: format(parsed, 'yyyy-MM'),
    label: format(parsed, 'MMM yyyy'),
  };
}

export function monthsIn(range: { start: IsoDate; end: IsoDate }): Period[] {
  return eachMonthOfInterval({ start: parseIsoDate(range.start), end: parseIsoDate(range.end) }).map((d) =>
    monthPeriod(format(d, 'yyyy-MM-dd')),
  );
}

export function nextPeriodAfter(period: Period): Period {
  return monthPeriod(addDays(period.end, 1));
}

/**
 * Buckets a date into a period key for reporting. Keeps a report's grouping
 * consistent between the SQL aggregate and the in-memory rollup.
 */
export function periodKey(date: IsoDate, granularity: 'DAY' | 'MONTH' | 'QUARTER' | 'FINANCIAL_YEAR', fiscalConfig = DEFAULT_FISCAL_YEAR): string {
  const parsed = parseIsoDate(date);
  switch (granularity) {
    case 'DAY':
      return format(parsed, 'yyyy-MM-dd');
    case 'MONTH':
      return format(parsed, 'yyyy-MM');
    case 'QUARTER': {
      const fy = fiscalYearFor(date, fiscalConfig);
      const monthsSinceStart =
        (parsed.getFullYear() - parseIsoDate(fy.start).getFullYear()) * 12 +
        (parsed.getMonth() - parseIsoDate(fy.start).getMonth());
      const quarter = Math.floor(monthsSinceStart / 3) + 1;
      return `${fy.key}-Q${quarter}`;
    }
    case 'FINANCIAL_YEAR':
      return fiscalYearFor(date, fiscalConfig).key;
  }
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

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
export function resolveDueDate(
  rule: DueRule,
  anchors: Partial<Record<Exclude<DueRuleAnchor, 'FIXED_DATE'>, IsoDate>>,
): IsoDate {
  const base = resolveAnchor(rule, anchors);
  let result = base;
  if (rule.offsetMonths) result = addMonths(result, rule.offsetMonths);
  if (rule.offsetDays) result = addDays(result, rule.offsetDays);
  if (rule.adjustToWorkingDay) {
    const workingDays = rule.workingDays ?? [1, 2, 3, 4, 5];
    let guard = 0;
    while (!workingDays.includes(parseIsoDate(result).getDay()) && guard < 7) {
      result = addDays(result, 1);
      guard += 1;
    }
  }
  return result;
}

function resolveAnchor(
  rule: DueRule,
  anchors: Partial<Record<Exclude<DueRuleAnchor, 'FIXED_DATE'>, IsoDate>>,
): IsoDate {
  if (rule.anchor === 'FIXED_DATE') {
    if (!rule.fixedDate) throw new Error('FIXED_DATE due rule requires fixedDate');
    return rule.fixedDate;
  }
  const value = anchors[rule.anchor];
  if (!value) throw new Error(`Due rule anchor ${rule.anchor} was not supplied`);
  return value;
}

// ---------------------------------------------------------------------------
// Installment scheduling
// ---------------------------------------------------------------------------

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
export function installmentDueDates(input: InstallmentScheduleInput, endDate?: IsoDate): IsoDate[] {
  if (input.customDates && input.customDates.length > 0) {
    return [...input.customDates].sort();
  }
  const dates: IsoDate[] = [];
  for (let i = 0; i < input.count; i += 1) {
    let due: IsoDate;
    switch (input.frequency) {
      case 'MONTHLY':
        due = addMonths(input.startDate, i);
        break;
      case 'QUARTERLY':
        due = addMonths(input.startDate, i * 3);
        break;
      case 'HALF_YEARLY':
        due = addMonths(input.startDate, i * 6);
        break;
      case 'ANNUAL':
        due = addMonths(input.startDate, i * 12);
        break;
      default:
        due = addDays(input.startDate, (input.intervalDays ?? 30) * i);
    }
    dates.push(endDate && isAfterDate(due, endDate) ? endDate : due);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function formatDate(value: IsoDate | Date, dateFormat = 'dd-MM-yyyy'): string {
  const iso = toIsoDate(value);
  return format(parseIsoDate(iso), dateFormat);
}

export function todayIso(now: Date = new Date()): IsoDate {
  return format(now, 'yyyy-MM-dd');
}

/** Guard used by services before persisting a caller-supplied date. */
export function assertIsoDate(value: string, label = 'date'): IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD), received "${value}"`);
  }
  const parsed = parseIsoDate(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is not a real date: "${value}"`);
  return value;
}
