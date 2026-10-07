import { Prisma } from './generated/client';

/**
 * Money at the database edge.
 *
 * The database stores `DECIMAL(18,4)`. Prisma hands back a `Decimal` object, not
 * a number, which is the correct default - but a `Decimal` is easy to accidentally
 * coerce with `Number()`, and doing so once silently reintroduces float rounding
 * into a financial figure.
 *
 * These helpers are the only sanctioned crossing points:
 *   - `decimalToMoneyString` on the way out, to hand the engine a string
 *   - `moneyToDecimal` on the way in, to persist a string exactly
 */

export const MONEY_DECIMAL_PRECISION = 18;
export const MONEY_DECIMAL_SCALE = 4;

/** Prisma's Decimal constructor, for building values to write. */
export function asDecimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(typeof value === 'number' ? value.toString() : value);
}

/**
 * Canonical string form with all four decimals, e.g. `"27000.0000"`.
 * Never returns exponential notation, so the value survives a JSON round trip.
 */
export function decimalToMoneyString(value: Prisma.Decimal | string | number | null | undefined): string {
  if (value === null || value === undefined) return zeroString();
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
  return decimal.toFixed(MONEY_DECIMAL_SCALE);
}

export function moneyToDecimal(value: string | Prisma.Decimal): Prisma.Decimal {
  return asDecimal(value).toDecimalPlaces(MONEY_DECIMAL_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

function zeroString(): string {
  return `0.${'0'.repeat(MONEY_DECIMAL_SCALE)}`;
}

/**
 * Rejects anything that is not a plain decimal string. Used on request input so
 * a client cannot send `1e3` or `"1,000"` and have it silently become something
 * other than what the payer entered.
 */
export function normaliseMoneyString(value: string, label = 'amount'): string {
  const trimmed = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`${label} must be a plain decimal string, received "${value}"`);
  }
  return new Prisma.Decimal(trimmed).toFixed(MONEY_DECIMAL_SCALE);
}

/**
 * Sums decimal strings without floating point. Used by report builders that
 * aggregate in application code rather than in SQL.
 */
export function sumDecimalStrings(values: readonly (string | Prisma.Decimal)[]): string {
  return values
    .reduce<Prisma.Decimal>((total, value) => total.add(value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value))), new Prisma.Decimal(0))
    .toFixed(MONEY_DECIMAL_SCALE);
}
