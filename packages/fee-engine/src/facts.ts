import { parseDecimalToUnits } from '@fee/money';
import type { FeeContext, RuleScopeDefinition } from '@fee/types';

/**
 * Fact resolution.
 *
 * A rule condition names a dotted path such as `student.academicScore`. This
 * module is the only place that knows how to turn such a path into a value, so
 * the answer to "where did this condition read from?" has exactly one answer.
 */

export const CUSTOM_PATH_PREFIX = 'custom.';
export const STUDENT_CUSTOM_PREFIX = 'student.customAttributes.';

/** Resolves a dotted path, returning `undefined` when the fact is absent. */
export function resolveFact(context: FeeContext, path: string): unknown {
  if (!path) return undefined;

  if (path.startsWith(CUSTOM_PATH_PREFIX)) {
    const key = path.slice(CUSTOM_PATH_PREFIX.length);
    return context.custom?.[key] ?? context.student.customAttributes?.[key];
  }
  if (path.startsWith(STUDENT_CUSTOM_PREFIX)) {
    const key = path.slice(STUDENT_CUSTOM_PREFIX.length);
    return context.student.customAttributes?.[key];
  }

  const segments = path.split('.');
  let cursor: unknown = context;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Exact comparison of two decimal strings.
 *
 * Condition operators like `>` are used on money (`payment.amount > 5000`) and
 * a float comparison could flip the outcome at the boundary. Both sides are
 * parsed to scaled integers first.
 */
export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = parseDecimalToUnits(normaliseDecimalInput(left));
  const b = parseDecimalToUnits(normaliseDecimalInput(right));
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normaliseDecimalInput(value: string): string {
  const trimmed = String(value).trim();
  if (trimmed === '' || Number.isNaN(Number(trimmed))) {
    throw new Error(`Cannot compare "${value}" as a decimal`);
  }
  return trimmed;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True when both values look like ISO dates and can be ordered lexically. */
export function isIsoDatePair(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && ISO_DATE_PATTERN.test(left) && ISO_DATE_PATTERN.test(right);
}

/**
 * Orders two fact values, or returns `null` when they are not comparable.
 *
 * Early-payment discounts are expressed as `payment.date < 2026-06-10`, so date
 * ordering has to work as well as numeric ordering. ISO dates sort correctly as
 * plain strings, which avoids parsing a date and re-deriving its timezone.
 */
export function compareFactValues(left: unknown, right: unknown): -1 | 0 | 1 | null {
  if (isIsoDatePair(left, right)) {
    const a = left as string;
    const b = right as string;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (isNumeric(left) && isNumeric(right)) {
    return compareDecimals(toNumericString(left), toNumericString(right));
  }
  return null;
}

/** True when the value is a decimal-representable number or numeric string. */
export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'bigint') return true;
  if (typeof value === 'string') return value.trim() !== '' && !Number.isNaN(Number(value));
  return false;
}

export function toNumericString(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  throw new Error(`Expected a numeric value, received ${typeof value}`);
}

/** Normalises a boolean-ish fact. `"true"`, `1` and `true` all mean true. */
export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'y';
  }
  return false;
}

/** Case-insensitive, whitespace-insensitive string equality for rule matching. */
export function looseEquals(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (typeof left === 'boolean' || typeof right === 'boolean') return toBoolean(left) === toBoolean(right);
  if (isNumeric(left) && isNumeric(right)) return compareDecimals(toNumericString(left), toNumericString(right)) === 0;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

/**
 * Scope matching. Scoping is checked before the condition tree because it is far
 * cheaper and far more selective: a rule scoped to Grade 10 should never even be
 * condition-evaluated for a Grade 9 student.
 *
 * `unitPath` is the student's academic unit ancestry (nearest first), which lets
 * a rule scoped to a PROGRAM match a student in one of its CLASS children.
 */
export function scopeMatches(
  scopes: readonly RuleScopeDefinition[] | undefined,
  unitPath: readonly string[],
  context: FeeContext,
  studentGroupIds: readonly string[] = [],
): boolean {
  // No scope means "everyone the conditions allow".
  if (!scopes || scopes.length === 0) return true;

  return scopes.some((scope) => {
    if (scope.academicYearId && scope.academicYearId !== context.academicYear?.id) return false;
    switch (scope.targetType) {
      case 'STUDENT':
        return scope.targetId ? scope.targetId === context.student.id : true;
      case 'CUSTOM_GROUP':
        return scope.targetId ? studentGroupIds.includes(scope.targetId) : true;
      case 'HOSTEL':
        return scope.targetId ? context.student.hostelStatus === true : true;
      case 'TRANSPORT_ROUTE':
        return scope.targetId ? looseEquals(context.student.transportRoute, scope.targetId) : context.student.transportStatus === true;
      case 'CLASS':
      case 'SECTION':
      case 'BATCH':
      case 'COURSE':
      case 'DEPARTMENT':
      case 'PROGRAM':
        // A unit-scoped rule matches when the student's unit ancestry contains it.
        return scope.targetId
          ? scope.includeChildren === false
            ? unitPath[0] === scope.targetId
            : unitPath.includes(scope.targetId)
          : true;
      default:
        return false;
    }
  });
}
