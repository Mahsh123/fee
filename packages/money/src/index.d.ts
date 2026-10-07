/**
 * @fee/money - exact monetary arithmetic.
 *
 * Rules enforced here (not merely documented):
 *   - No `number` ever participates in a monetary calculation. Money is a
 *     bigint count of `SCALE`-denominated units.
 *   - Intermediate scale is 4 decimal places, matching `Decimal(18,4)` in the
 *     database, so a value read from and written back to the database is
 *     bit-for-bit identical.
 *   - Rates (percentages) are integer parts-per-million. `12.5%` is
 *     `12_500_000` ppm, never `0.125`.
 *   - Division rounds deterministically according to an explicit RoundingMode.
 */
/** Decimal places carried by every Money value. */
export declare const MONEY_SCALE = 4;
/** Units per whole currency unit. */
export declare const MONEY_UNITS_PER_MAJOR = 10000n;
/** Denominator for rates: a rate of 1_000_000n == 100%. */
export declare const RATE_DENOMINATOR = 1000000n;
/**
 * Scale used when parsing a *percentage* number into ppm.
 *
 * `12.5%` is the fraction 0.125, and ppm is fraction x 1e6, so ppm is
 * (percent x 1e4). Parsing `"12.5"` at scale 4 therefore yields 125_000n
 * directly. These three constants exist so that conversion is never guessed at
 * the call site.
 */
export declare const PERCENT_PARSE_SCALE = 4;
/** Scale for fractions: `0.125` -> 125_000n ppm. */
export declare const FRACTION_PARSE_SCALE = 6;
/** Scale for basis points: `750` bp -> 75_000n ppm. */
export declare const BASIS_POINT_PARSE_SCALE = 2;
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'TRUNCATE';
export declare class MoneyError extends Error {
    constructor(message: string);
}
export interface Currency {
    /** ISO 4217 code, e.g. `INR`. */
    readonly code: string;
    readonly symbol: string;
    /** Digits after the decimal separator used for display and settlement. */
    readonly minorUnits: number;
}
export declare const CURRENCIES: Readonly<Record<string, Currency>>;
export declare function resolveCurrency(code: string): Currency;
/** Divide two bigints with an explicit rounding mode. Exact when divisible. */
export declare function divRound(numerator: bigint, denominator: bigint, mode?: RoundingMode): bigint;
/**
 * An immutable monetary value. Internally a bigint of units at `MONEY_SCALE`.
 */
export declare class Money {
    /** Value in 1e-4 units. Always use the accessors rather than reading this. */
    readonly units: bigint;
    readonly currency: Currency;
    private constructor();
    static zero(currency?: string | Currency): Money;
    /** From an integer count of `MONEY_SCALE` units. */
    static fromUnits(units: bigint, currency?: string | Currency): Money;
    /**
     * From a decimal string. Accepts `"50000"`, `"50000.25"`, `"-12.5"`, and
     * `"1,234.56"`. More fractional digits than MONEY_SCALE are rounded, not
     * truncated silently.
     */
    static fromString(value: string, currency?: string | Currency, mode?: RoundingMode): Money;
    /**
     * From a legacy number. Permitted for interoperability with JSON payloads and
     * seed data, but the caller must supply the intended rounding mode because a
     * float has already lost precision by the time it arrives here.
     */
    static fromNumber(value: number, currency?: string | Currency, mode?: RoundingMode): Money;
    /**
     * Reads a value that may be a Money, bigint, number, string or a Prisma
     * `Decimal` (which exposes `toString`). This is the boundary adapter used by
     * repositories so domain code always deals in Money.
     */
    static from(value: MoneyValue, currency?: string | Currency): Money;
    /** Convenience for a major-unit integer amount (₹5,000 -> "5000"). */
    static fromMajor(value: number | string, currency?: string | Currency): Money;
    private assertSameCurrency;
    add(other: Money): Money;
    subtract(other: Money): Money;
    /** Sum of many values; empty input yields zero in `currency`. */
    static sum(values: readonly Money[], currency?: string | Currency): Money;
    negate(): Money;
    abs(): Money;
    multiply(factor: Rate | bigint | string | number): Money;
    /** `this * numerator / denominator`, exact to MONEY_SCALE before rounding. */
    scale(numerator: bigint, denominator: bigint, mode?: RoundingMode): Money;
    /** The given percentage of this amount. `Money.percent("12.5")`. */
    percent(rate: Rate | string | number, mode?: RoundingMode): Money;
    min(other: Money): Money;
    max(other: Money): Money;
    /**
     * Clamps into `[lower, upper]`. Either bound may be omitted.
     * Used to implement SET_MINIMUM_AMOUNT / SET_MAXIMUM_AMOUNT rule actions and
     * the cap on a discount or late fee.
     */
    clamp(lower?: Money | null, upper?: Money | null): Money;
    /**
     * Rounds to a coarser precision (currency minor units by default) using the
     * supplied mode. Never used for intermediate values, only for presentation
     * and for posting to the ledger at the currency's real precision.
     */
    round(minorUnits?: number, mode?: RoundingMode): Money;
    /** Currency-precision view, for receipts and reports. */
    toDisplay(): Money;
    /**
     * Splits into `parts` chunks with no lost or invented units.
     *
     * Used for installments and for spreading a payment across demand items.
     * The remainder is distributed largest-remainder-first so the sum of the
     * parts is exactly `this`, regardless of how the ratio divides.
     */
    allocate(ratios: readonly Rate[]): Money[];
    /**
     * Splits into `count` equal parts losing nothing. The first `remainder` parts
     * receive one extra unit, which is the convention used for installment plans.
     */
    splitEvenly(count: number): Money[];
    compare(other: Money): -1 | 0 | 1;
    equals(other: Money): boolean;
    /** True when the magnitudes are equal, ignoring sign. */
    equalsAbsolute(other: Money): boolean;
    greaterThan(other: Money): boolean;
    greaterThanOrEqual(other: Money): boolean;
    lessThan(other: Money): boolean;
    lessThanOrEqual(other: Money): boolean;
    get isZero(): boolean;
    get isPositive(): boolean;
    get isNegative(): boolean;
    /** Exact decimal string with MONEY_SCALE places, e.g. `"27000.0000"`. */
    toString(): string;
    /** Decimal string trimmed to the currency's precision, e.g. `"27000.00"`. */
    toFixedString(): string;
    /** The value Prisma should persist (a decimal string, never a float). */
    toDecimalString(): string;
    toJSON(): string;
    toMajorNumber(): number;
    /** Presentation helper, e.g. `"₹27,000.00"`. */
    format(options?: {
        showSymbol?: boolean;
        minorUnits?: number;
    }): string;
    convertTo(currency: string | Currency, rate?: Rate): Money;
    /**
     * What is still owed once `paid` has been applied: `this - paid`, clamped at
     * zero so a settled fee never reports a negative balance. This is the single
     * expression used across demand, installment and receipt balance math.
     */
    remainingAfter(paid: Money): Money;
}
export type MoneyValue = Money | bigint | number | string | {
    toString(): string;
};
/**
 * A rate is an integer number of parts per million. 100% == 1_000_000.
 * Integer storage removes the drift that makes `0.1 + 0.2 !== 0.3` a financial
 * bug instead of a curiosity.
 */
export declare class Rate {
    readonly ppm: bigint;
    readonly mode: RoundingMode;
    private constructor();
    static zero(): Rate;
    /** 100%. */
    static one(): Rate;
    static fromPpm(ppm: bigint, mode?: RoundingMode): Rate;
    /** `12.5` -> 12.5% -> 125_000 ppm. */
    static fromPercent(percent: string | number | bigint, mode?: RoundingMode): Rate;
    /** `750` basis points -> 7.5% -> 75_000 ppm. */
    static fromBasisPoints(bp: string | number | bigint, mode?: RoundingMode): Rate;
    /** Accepts a fraction like `0.125` meaning 12.5% -> 125_000 ppm. */
    static fromFraction(fraction: string | number, mode?: RoundingMode): Rate;
    /**
     * Interprets a bare value as a **percentage**. `Rate.from("12.5")` is 12.5%.
     * A `bigint` argument is always read as raw ppm.
     */
    static from(value: Rate | string | number | bigint): Rate;
    /** Rendered as a percentage, e.g. `"12.500000"`. */
    get percentString(): string;
    toPercentNumber(): number;
    isZero(): boolean;
    /** Remaining rate after taking `other` away from 100%. */
    complement(): Rate;
    plus(other: Rate): Rate;
    times(other: Rate): Rate;
    /** Caps the rate, e.g. "at most 50%". */
    cappedAt(max: Rate): Rate;
}
/**
 * Parses a decimal string into bigint units at `scale`, rounding (never
 * truncating) excess fractional digits.
 */
export declare function parseDecimalToUnits(value: string, mode?: RoundingMode, scale?: number): bigint;
/** Renders bigint units at `scale` as a decimal string. */
export declare function unitsToDecimalString(units: bigint, scale?: number, outputScale?: number): string;
/**
 * Converts a JS number to a decimal string without scientific notation. Used
 * only at integration boundaries (JSON payloads, seeds); monetary arithmetic
 * happens on Money afterwards.
 */
export declare function decimalStringFromNumber(value: number): string;
/** Convenience constructors so call sites read close to the domain language. */
export declare function money(value: MoneyValue, currency?: string | Currency): Money;
export declare function rate(percent: string | number): Rate;
//# sourceMappingURL=index.d.ts.map