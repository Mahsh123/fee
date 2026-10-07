"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FISCAL_YEAR = void 0;
exports.toIsoDate = toIsoDate;
exports.toIsoDateTime = toIsoDateTime;
exports.parseIsoDate = parseIsoDate;
exports.addDays = addDays;
exports.addMonths = addMonths;
exports.daysBetween = daysBetween;
exports.daysLate = daysLate;
exports.isBeforeDate = isBeforeDate;
exports.isAfterDate = isAfterDate;
exports.isWithinInclusive = isWithinInclusive;
exports.later = later;
exports.earlier = earlier;
exports.fiscalYearFor = fiscalYearFor;
exports.monthPeriod = monthPeriod;
exports.monthsIn = monthsIn;
exports.nextPeriodAfter = nextPeriodAfter;
exports.periodKey = periodKey;
exports.resolveDueDate = resolveDueDate;
exports.installmentDueDates = installmentDueDates;
exports.formatDate = formatDate;
exports.todayIso = todayIso;
exports.assertIsoDate = assertIsoDate;
const date_fns_1 = require("date-fns");
function toIsoDate(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed))
            return trimmed;
        return (0, date_fns_1.format)((0, date_fns_1.parseISO)(trimmed), 'yyyy-MM-dd');
    }
    return (0, date_fns_1.format)(value, 'yyyy-MM-dd');
}
function toIsoDateTime(value) {
    return typeof value === 'string' ? value : value.toISOString();
}
function parseIsoDate(value) {
    return (0, date_fns_1.parseISO)(value);
}
function addDays(value, days) {
    return (0, date_fns_1.format)((0, date_fns_1.addDays)(parseIsoDate(value), days), 'yyyy-MM-dd');
}
function addMonths(value, months) {
    return (0, date_fns_1.format)((0, date_fns_1.addMonths)(parseIsoDate(value), months), 'yyyy-MM-dd');
}
/**
 * Calendar-day difference (`to - from`). Calendar days, not 24-hour periods, so
 * a due date of the 1st and a payment on the 2nd is exactly one day late.
 */
function daysBetween(from, to) {
    return (0, date_fns_1.differenceInCalendarDays)(parseIsoDate(to), parseIsoDate(from));
}
/** Positive when `asOf` is past `dueDate` and the grace period has elapsed. */
function daysLate(dueDate, asOf, graceDays = 0) {
    const late = daysBetween(dueDate, asOf);
    return late > graceDays ? late - graceDays : 0;
}
function isBeforeDate(a, b) {
    return (0, date_fns_1.isBefore)(parseIsoDate(a), parseIsoDate(b));
}
function isAfterDate(a, b) {
    return (0, date_fns_1.isAfter)(parseIsoDate(a), parseIsoDate(b));
}
function isWithinInclusive(value, from, to) {
    return !isBeforeDate(value, from) && !isAfterDate(value, to);
}
function later(a, b) {
    return (0, date_fns_1.format)((0, date_fns_1.max)([parseIsoDate(a), parseIsoDate(b)]), 'yyyy-MM-dd');
}
function earlier(a, b) {
    return (0, date_fns_1.format)((0, date_fns_1.min)([parseIsoDate(a), parseIsoDate(b)]), 'yyyy-MM-dd');
}
exports.DEFAULT_FISCAL_YEAR = {
    startMonth: 4,
    startDay: 1,
    labelStyle: 'RANGE_TWO_YEAR',
    separator: '-',
};
function fiscalYearFor(date, config = exports.DEFAULT_FISCAL_YEAR) {
    const startDay = config.startDay ?? 1;
    const parsed = parseIsoDate(date);
    const month = parsed.getMonth() + 1;
    const year = parsed.getFullYear();
    const beforeStart = month < config.startMonth || (month === config.startMonth && parsed.getDate() < startDay);
    const startYear = beforeStart ? year - 1 : year;
    const endYear = startYear + 1;
    const separator = config.separator ?? '-';
    const labelStyle = config.labelStyle ?? 'RANGE_TWO_YEAR';
    let key;
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
        start: (0, date_fns_1.format)(new Date(Date.UTC(startYear, config.startMonth - 1, startDay)), 'yyyy-MM-dd'),
        end: (0, date_fns_1.format)(new Date(Date.UTC(endYear, config.startMonth - 1, startDay - 1)), 'yyyy-MM-dd'),
        key,
        label: key,
    };
}
function monthPeriod(date) {
    const parsed = parseIsoDate(date);
    return {
        start: (0, date_fns_1.format)((0, date_fns_1.startOfMonth)(parsed), 'yyyy-MM-dd'),
        end: (0, date_fns_1.format)((0, date_fns_1.endOfMonth)(parsed), 'yyyy-MM-dd'),
        key: (0, date_fns_1.format)(parsed, 'yyyy-MM'),
        label: (0, date_fns_1.format)(parsed, 'MMM yyyy'),
    };
}
function monthsIn(range) {
    return (0, date_fns_1.eachMonthOfInterval)({ start: parseIsoDate(range.start), end: parseIsoDate(range.end) }).map((d) => monthPeriod((0, date_fns_1.format)(d, 'yyyy-MM-dd')));
}
function nextPeriodAfter(period) {
    return monthPeriod(addDays(period.end, 1));
}
/**
 * Buckets a date into a period key for reporting. Keeps a report's grouping
 * consistent between the SQL aggregate and the in-memory rollup.
 */
function periodKey(date, granularity, fiscalConfig = exports.DEFAULT_FISCAL_YEAR) {
    const parsed = parseIsoDate(date);
    switch (granularity) {
        case 'DAY':
            return (0, date_fns_1.format)(parsed, 'yyyy-MM-dd');
        case 'MONTH':
            return (0, date_fns_1.format)(parsed, 'yyyy-MM');
        case 'QUARTER': {
            const fy = fiscalYearFor(date, fiscalConfig);
            const monthsSinceStart = (parsed.getFullYear() - parseIsoDate(fy.start).getFullYear()) * 12 +
                (parsed.getMonth() - parseIsoDate(fy.start).getMonth());
            const quarter = Math.floor(monthsSinceStart / 3) + 1;
            return `${fy.key}-Q${quarter}`;
        }
        case 'FINANCIAL_YEAR':
            return fiscalYearFor(date, fiscalConfig).key;
    }
}
/**
 * Resolves a stored due rule into an actual date. Kept data-driven so a tenant
 * can say "15 days after the period starts, but never on a Sunday" without a
 * code change.
 */
function resolveDueDate(rule, anchors) {
    const base = resolveAnchor(rule, anchors);
    let result = base;
    if (rule.offsetMonths)
        result = addMonths(result, rule.offsetMonths);
    if (rule.offsetDays)
        result = addDays(result, rule.offsetDays);
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
function resolveAnchor(rule, anchors) {
    if (rule.anchor === 'FIXED_DATE') {
        if (!rule.fixedDate)
            throw new Error('FIXED_DATE due rule requires fixedDate');
        return rule.fixedDate;
    }
    const value = anchors[rule.anchor];
    if (!value)
        throw new Error(`Due rule anchor ${rule.anchor} was not supplied`);
    return value;
}
/**
 * Produces the due dates for an installment plan. The last date is clamped so a
 * plan never extends past the academic window when `endDate` is supplied.
 */
function installmentDueDates(input, endDate) {
    if (input.customDates && input.customDates.length > 0) {
        return [...input.customDates].sort();
    }
    const dates = [];
    for (let i = 0; i < input.count; i += 1) {
        let due;
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
function formatDate(value, dateFormat = 'dd-MM-yyyy') {
    const iso = toIsoDate(value);
    return (0, date_fns_1.format)(parseIsoDate(iso), dateFormat);
}
function todayIso(now = new Date()) {
    return (0, date_fns_1.format)(now, 'yyyy-MM-dd');
}
/** Guard used by services before persisting a caller-supplied date. */
function assertIsoDate(value, label = 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${label} must be an ISO date (YYYY-MM-DD), received "${value}"`);
    }
    const parsed = parseIsoDate(value);
    if (Number.isNaN(parsed.getTime()))
        throw new Error(`${label} is not a real date: "${value}"`);
    return value;
}
//# sourceMappingURL=index.js.map