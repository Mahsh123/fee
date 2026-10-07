"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rate = exports.Money = exports.CURRENCIES = exports.MoneyError = exports.BASIS_POINT_PARSE_SCALE = exports.FRACTION_PARSE_SCALE = exports.PERCENT_PARSE_SCALE = exports.RATE_DENOMINATOR = exports.MONEY_UNITS_PER_MAJOR = exports.MONEY_SCALE = void 0;
exports.resolveCurrency = resolveCurrency;
exports.divRound = divRound;
exports.parseDecimalToUnits = parseDecimalToUnits;
exports.unitsToDecimalString = unitsToDecimalString;
exports.decimalStringFromNumber = decimalStringFromNumber;
exports.money = money;
exports.rate = rate;
/** Decimal places carried by every Money value. */
exports.MONEY_SCALE = 4;
/** Units per whole currency unit. */
exports.MONEY_UNITS_PER_MAJOR = 10000n;
/** Denominator for rates: a rate of 1_000_000n == 100%. */
exports.RATE_DENOMINATOR = 1000000n;
/**
 * Scale used when parsing a *percentage* number into ppm.
 *
 * `12.5%` is the fraction 0.125, and ppm is fraction x 1e6, so ppm is
 * (percent x 1e4). Parsing `"12.5"` at scale 4 therefore yields 125_000n
 * directly. These three constants exist so that conversion is never guessed at
 * the call site.
 */
exports.PERCENT_PARSE_SCALE = 4;
/** Scale for fractions: `0.125` -> 125_000n ppm. */
exports.FRACTION_PARSE_SCALE = 6;
/** Scale for basis points: `750` bp -> 75_000n ppm. */
exports.BASIS_POINT_PARSE_SCALE = 2;
class MoneyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MoneyError';
    }
}
exports.MoneyError = MoneyError;
exports.CURRENCIES = Object.freeze({
    INR: { code: 'INR', symbol: '₹', minorUnits: 2 },
    USD: { code: 'USD', symbol: '$', minorUnits: 2 },
    EUR: { code: 'EUR', symbol: '€', minorUnits: 2 },
    GBP: { code: 'GBP', symbol: '£', minorUnits: 2 },
    AED: { code: 'AED', symbol: 'د.إ', minorUnits: 2 },
    SGD: { code: 'SGD', symbol: 'S$', minorUnits: 2 },
    AUD: { code: 'AUD', symbol: 'A$', minorUnits: 2 },
    KES: { code: 'KES', symbol: 'KSh', minorUnits: 2 },
    NGN: { code: 'NGN', symbol: '₦', minorUnits: 2 },
    JPY: { code: 'JPY', symbol: '¥', minorUnits: 0 },
    // Gulf/Asia minor-unit variants that real tenants configure:
    BHD: { code: 'BHD', symbol: 'BD', minorUnits: 3 },
    KWD: { code: 'KWD', symbol: 'KD', minorUnits: 3 },
    TND: { code: 'TND', symbol: 'DT', minorUnits: 3 },
});
const DEFAULT_CURRENCY = { code: 'XXX', symbol: '', minorUnits: 2 };
function resolveCurrency(code) {
    return exports.CURRENCIES[code.toUpperCase()] ?? { ...DEFAULT_CURRENCY, code: code.toUpperCase() };
}
/** Divide two bigints with an explicit rounding mode. Exact when divisible. */
function divRound(numerator, denominator, mode = 'HALF_UP') {
    if (denominator === 0n)
        throw new MoneyError('Division by zero');
    const negative = numerator < 0n !== denominator < 0n;
    const absNum = numerator < 0n ? -numerator : numerator;
    const absDen = denominator < 0n ? -denominator : denominator;
    const quotient = absNum / absDen;
    const remainder = absNum % absDen;
    if (remainder === 0n)
        return negative ? -quotient : quotient;
    let rounded = quotient;
    switch (mode) {
        case 'TRUNCATE':
            break;
        case 'FLOOR':
            // Towards negative infinity: -1.2 -> -2, but magnitudes here are absolute,
            // so the sign is applied after. Floor on a negative value increases magnitude.
            if (negative)
                rounded = quotient + 1n;
            break;
        case 'CEIL':
            if (!negative)
                rounded = quotient + 1n;
            break;
        case 'HALF_UP': {
            const twice = remainder * 2n;
            if (twice >= absDen)
                rounded = quotient + 1n;
            break;
        }
        case 'HALF_EVEN': {
            const twice = remainder * 2n;
            if (twice > absDen)
                rounded = quotient + 1n;
            else if (twice === absDen && quotient % 2n !== 0n)
                rounded = quotient + 1n;
            break;
        }
        default: {
            const exhaustive = mode;
            throw new MoneyError(`Unsupported rounding mode: ${String(exhaustive)}`);
        }
    }
    return negative ? -rounded : rounded;
}
/**
 * An immutable monetary value. Internally a bigint of units at `MONEY_SCALE`.
 */
class Money {
    constructor(
    /** Value in 1e-4 units. Always use the accessors rather than reading this. */
    units, currency) {
        this.units = units;
        this.currency = currency;
    }
    // ---------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------
    static zero(currency = 'INR') {
        return new Money(0n, toCurrency(currency));
    }
    /** From an integer count of `MONEY_SCALE` units. */
    static fromUnits(units, currency = 'INR') {
        return new Money(units, toCurrency(currency));
    }
    /**
     * From a decimal string. Accepts `"50000"`, `"50000.25"`, `"-12.5"`, and
     * `"1,234.56"`. More fractional digits than MONEY_SCALE are rounded, not
     * truncated silently.
     */
    static fromString(value, currency = 'INR', mode = 'HALF_UP') {
        return new Money(parseDecimalToUnits(value, mode), toCurrency(currency));
    }
    /**
     * From a legacy number. Permitted for interoperability with JSON payloads and
     * seed data, but the caller must supply the intended rounding mode because a
     * float has already lost precision by the time it arrives here.
     */
    static fromNumber(value, currency = 'INR', mode = 'HALF_UP') {
        if (!Number.isFinite(value))
            throw new MoneyError(`Not a finite number: ${value}`);
        return Money.fromString(decimalStringFromNumber(value), currency, mode);
    }
    /**
     * Reads a value that may be a Money, bigint, number, string or a Prisma
     * `Decimal` (which exposes `toString`). This is the boundary adapter used by
     * repositories so domain code always deals in Money.
     */
    static from(value, currency = 'INR') {
        if (value instanceof Money) {
            const target = toCurrency(currency);
            if (value.currency.code !== target.code) {
                throw new MoneyError(`Refusing to relabel ${value.currency.code} as ${target.code}. Use convertTo() with an explicit Rate ` +
                    'so the exchange rate applied is recorded.');
            }
            return value;
        }
        if (typeof value === 'bigint')
            return Money.fromUnits(value, currency);
        if (typeof value === 'number')
            return Money.fromNumber(value, currency);
        if (typeof value === 'string')
            return Money.fromString(value, currency);
        if (value && typeof value.toString === 'function') {
            return Money.fromString(value.toString(), currency);
        }
        throw new MoneyError(`Cannot construct Money from ${typeof value}`);
    }
    /** Convenience for a major-unit integer amount (₹5,000 -> "5000"). */
    static fromMajor(value, currency = 'INR') {
        return Money.fromString(String(value), currency);
    }
    // ---------------------------------------------------------------------------
    // Arithmetic
    // ---------------------------------------------------------------------------
    assertSameCurrency(other) {
        if (other.currency.code !== this.currency.code) {
            throw new MoneyError(`Currency mismatch: cannot combine ${this.currency.code} with ${other.currency.code}. ` +
                'Convert explicitly so the exchange rate used is recorded.');
        }
    }
    add(other) {
        this.assertSameCurrency(other);
        return new Money(this.units + other.units, this.currency);
    }
    subtract(other) {
        this.assertSameCurrency(other);
        return new Money(this.units - other.units, this.currency);
    }
    /** Sum of many values; empty input yields zero in `currency`. */
    static sum(values, currency = 'INR') {
        return values.reduce((acc, v) => acc.add(v), Money.zero(values[0]?.currency ?? currency));
    }
    negate() {
        return new Money(-this.units, this.currency);
    }
    abs() {
        return this.units < 0n ? this.negate() : this;
    }
    multiply(factor) {
        const rate = factor instanceof Rate ? factor : Rate.from(factor);
        return new Money(divRound(this.units * rate.ppm, exports.RATE_DENOMINATOR, rate.mode), this.currency);
    }
    /** `this * numerator / denominator`, exact to MONEY_SCALE before rounding. */
    scale(numerator, denominator, mode = 'HALF_UP') {
        if (denominator === 0n)
            throw new MoneyError('Scale denominator must not be zero');
        return new Money(divRound(this.units * numerator, denominator, mode), this.currency);
    }
    /** The given percentage of this amount. `Money.percent("12.5")`. */
    percent(rate, mode = 'HALF_UP') {
        const r = rate instanceof Rate ? rate : Rate.fromPercent(rate, mode);
        return this.multiply(r);
    }
    min(other) {
        this.assertSameCurrency(other);
        return this.units <= other.units ? this : other;
    }
    max(other) {
        this.assertSameCurrency(other);
        return this.units >= other.units ? this : other;
    }
    /**
     * Clamps into `[lower, upper]`. Either bound may be omitted.
     * Used to implement SET_MINIMUM_AMOUNT / SET_MAXIMUM_AMOUNT rule actions and
     * the cap on a discount or late fee.
     */
    clamp(lower, upper) {
        let result = this;
        if (lower)
            result = result.max(lower);
        if (upper)
            result = result.min(upper);
        return result;
    }
    /**
     * Rounds to a coarser precision (currency minor units by default) using the
     * supplied mode. Never used for intermediate values, only for presentation
     * and for posting to the ledger at the currency's real precision.
     */
    round(minorUnits = this.currency.minorUnits, mode = 'HALF_UP') {
        if (minorUnits < 0 || minorUnits > exports.MONEY_SCALE) {
            throw new MoneyError(`Cannot round to ${minorUnits} decimals; MONEY_SCALE is ${exports.MONEY_SCALE}`);
        }
        const factor = 10n ** BigInt(exports.MONEY_SCALE - minorUnits);
        return new Money(divRound(this.units, factor, mode) * factor, this.currency);
    }
    /** Currency-precision view, for receipts and reports. */
    toDisplay() {
        return this.round(this.currency.minorUnits, 'HALF_UP');
    }
    // ---------------------------------------------------------------------------
    // Allocation
    // ---------------------------------------------------------------------------
    /**
     * Splits into `parts` chunks with no lost or invented units.
     *
     * Used for installments and for spreading a payment across demand items.
     * The remainder is distributed largest-remainder-first so the sum of the
     * parts is exactly `this`, regardless of how the ratio divides.
     */
    allocate(ratios) {
        if (ratios.length === 0)
            return [];
        const totalPpm = ratios.reduce((acc, r) => acc + r.ppm, 0n);
        if (totalPpm <= 0n) {
            throw new MoneyError('Allocation ratios must sum to a positive value');
        }
        // Allow ratios that do not sum to exactly 100% by treating them as weights.
        const shares = ratios.map((r) => {
            const exact = (this.units * r.ppm) / totalPpm;
            const remainder = (this.units * r.ppm) % totalPpm;
            return { exact, remainder };
        });
        const allocated = shares.reduce((acc, s) => acc + s.exact, 0n);
        let leftover = this.units - allocated;
        // Largest remainder first, ties broken by index for determinism.
        const order = shares
            .map((s, index) => ({ index, remainder: s.remainder }))
            .sort((a, b) => (b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1));
        const result = shares.map((s) => s.exact);
        const step = leftover < 0n ? -1n : 1n;
        let cursor = 0;
        while (leftover !== 0n && order.length > 0) {
            const target = order[cursor % order.length];
            result[target.index] = result[target.index] + step;
            leftover -= step;
            cursor += 1;
        }
        return result.map((units) => new Money(units, this.currency));
    }
    /**
     * Splits into `count` equal parts losing nothing. The first `remainder` parts
     * receive one extra unit, which is the convention used for installment plans.
     */
    splitEvenly(count) {
        if (count <= 0)
            return [];
        const divisor = BigInt(count);
        const base = this.units / divisor;
        const remainder = this.units % divisor;
        // bigint division truncates toward zero, so a negative amount leaves a
        // negative remainder and the extra units must be subtracted, not added.
        const step = remainder < 0n ? -1n : 1n;
        const affected = remainder < 0n ? -remainder : remainder;
        return Array.from({ length: count }, (_, i) => new Money(base + (BigInt(i) < affected ? step : 0n), this.currency));
    }
    // ---------------------------------------------------------------------------
    // Comparison
    // ---------------------------------------------------------------------------
    compare(other) {
        this.assertSameCurrency(other);
        if (this.units < other.units)
            return -1;
        if (this.units > other.units)
            return 1;
        return 0;
    }
    equals(other) {
        return this.currency.code === other.currency.code && this.units === other.units;
    }
    /** True when the magnitudes are equal, ignoring sign. */
    equalsAbsolute(other) {
        return this.units === other.units || this.units === -other.units;
    }
    greaterThan(other) {
        return this.compare(other) === 1;
    }
    greaterThanOrEqual(other) {
        return this.compare(other) >= 0;
    }
    lessThan(other) {
        return this.compare(other) === -1;
    }
    lessThanOrEqual(other) {
        return this.compare(other) <= 0;
    }
    get isZero() {
        return this.units === 0n;
    }
    get isPositive() {
        return this.units > 0n;
    }
    get isNegative() {
        return this.units < 0n;
    }
    // ---------------------------------------------------------------------------
    // Serialisation
    // ---------------------------------------------------------------------------
    /** Exact decimal string with MONEY_SCALE places, e.g. `"27000.0000"`. */
    toString() {
        return unitsToDecimalString(this.units, exports.MONEY_SCALE);
    }
    /** Decimal string trimmed to the currency's precision, e.g. `"27000.00"`. */
    toFixedString() {
        return unitsToDecimalString(this.round(this.currency.minorUnits).units, exports.MONEY_SCALE, this.currency.minorUnits);
    }
    /** The value Prisma should persist (a decimal string, never a float). */
    toDecimalString() {
        return this.toString();
    }
    toJSON() {
        return this.toFixedString();
    }
    toMajorNumber() {
        // Only for display in charts and never for arithmetic.
        return Number(this.toFixedString());
    }
    /** Presentation helper, e.g. `"₹27,000.00"`. */
    format(options = {}) {
        const minorUnits = options.minorUnits ?? this.currency.minorUnits;
        const negative = this.units < 0n;
        const rounded = unitsToDecimalString(this.units < 0n ? -this.units : this.units, exports.MONEY_SCALE, minorUnits);
        const [whole = '0', fraction] = rounded.split('.');
        const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        const body = fraction ? `${withSeparators}.${fraction}` : withSeparators;
        const symbol = options.showSymbol === false ? '' : this.currency.symbol;
        return `${negative ? '-' : ''}${symbol}${body}`;
    }
    convertTo(currency, rate = Rate.one()) {
        const target = toCurrency(currency);
        return new Money(this.multiply(rate).units, target);
    }
    /**
     * What is still owed once `paid` has been applied: `this - paid`, clamped at
     * zero so a settled fee never reports a negative balance. This is the single
     * expression used across demand, installment and receipt balance math.
     */
    remainingAfter(paid) {
        const difference = this.subtract(paid);
        return difference.isNegative ? Money.zero(this.currency) : difference;
    }
}
exports.Money = Money;
function toCurrency(currency) {
    return typeof currency === 'string' ? resolveCurrency(currency) : currency;
}
/**
 * A rate is an integer number of parts per million. 100% == 1_000_000.
 * Integer storage removes the drift that makes `0.1 + 0.2 !== 0.3` a financial
 * bug instead of a curiosity.
 */
class Rate {
    constructor(ppm, mode = 'HALF_UP') {
        this.ppm = ppm;
        this.mode = mode;
    }
    static zero() {
        return new Rate(0n);
    }
    /** 100%. */
    static one() {
        return new Rate(exports.RATE_DENOMINATOR);
    }
    static fromPpm(ppm, mode = 'HALF_UP') {
        return new Rate(ppm, mode);
    }
    /** `12.5` -> 12.5% -> 125_000 ppm. */
    static fromPercent(percent, mode = 'HALF_UP') {
        return new Rate(parseDecimalToUnits(String(percent), mode, exports.PERCENT_PARSE_SCALE), mode);
    }
    /** `750` basis points -> 7.5% -> 75_000 ppm. */
    static fromBasisPoints(bp, mode = 'HALF_UP') {
        return new Rate(parseDecimalToUnits(String(bp), mode, exports.BASIS_POINT_PARSE_SCALE), mode);
    }
    /** Accepts a fraction like `0.125` meaning 12.5% -> 125_000 ppm. */
    static fromFraction(fraction, mode = 'HALF_UP') {
        return new Rate(parseDecimalToUnits(String(fraction), mode, exports.FRACTION_PARSE_SCALE), mode);
    }
    /**
     * Interprets a bare value as a **percentage**. `Rate.from("12.5")` is 12.5%.
     * A `bigint` argument is always read as raw ppm.
     */
    static from(value) {
        if (value instanceof Rate)
            return value;
        if (typeof value === 'bigint')
            return Rate.fromPpm(value);
        return Rate.fromPercent(value);
    }
    /** Rendered as a percentage, e.g. `"12.500000"`. */
    get percentString() {
        return unitsToDecimalString(this.ppm, exports.PERCENT_PARSE_SCALE, 6);
    }
    toPercentNumber() {
        return Number(this.percentString);
    }
    isZero() {
        return this.ppm === 0n;
    }
    /** Remaining rate after taking `other` away from 100%. */
    complement() {
        return new Rate(exports.RATE_DENOMINATOR - this.ppm, this.mode);
    }
    plus(other) {
        return new Rate(this.ppm + other.ppm, this.mode);
    }
    times(other) {
        return new Rate(divRound(this.ppm * other.ppm, exports.RATE_DENOMINATOR, this.mode), this.mode);
    }
    /** Caps the rate, e.g. "at most 50%". */
    cappedAt(max) {
        return this.ppm > max.ppm ? max : this;
    }
}
exports.Rate = Rate;
// ---------------------------------------------------------------------------
// Decimal string parsing / formatting
// ---------------------------------------------------------------------------
/**
 * Parses a decimal string into bigint units at `scale`, rounding (never
 * truncating) excess fractional digits.
 */
function parseDecimalToUnits(value, mode = 'HALF_UP', scale = exports.MONEY_SCALE) {
    const raw = value.trim().replace(/,/g, '').replace(/\s/g, '');
    if (raw === '')
        throw new MoneyError('Cannot parse an empty decimal string');
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(raw))
        throw new MoneyError(`Not a valid decimal: "${value}"`);
    const negative = raw.startsWith('-');
    const unsigned = raw.replace(/^[+-]/, '');
    const [wholePart = '0', fractionPart = ''] = unsigned.split('.');
    const padded = (fractionPart + '0'.repeat(scale + 1)).slice(0, scale + 1);
    const kept = padded.slice(0, scale);
    const nextDigit = padded.charAt(scale) || '0';
    let units = BigInt(wholePart + kept);
    if (nextDigit !== '0') {
        const remainderDigit = BigInt(nextDigit);
        const half = 5n;
        if (mode === 'CEIL')
            units += negative ? 0n : 1n;
        else if (mode === 'FLOOR')
            units += negative ? 1n : 0n;
        else if (mode === 'HALF_UP')
            units += remainderDigit >= half ? 1n : 0n;
        else if (mode === 'HALF_EVEN') {
            if (remainderDigit > half)
                units += 1n;
            else if (remainderDigit === half && units % 2n !== 0n)
                units += 1n;
        }
        // TRUNCATE: nothing to add.
    }
    return negative ? -units : units;
}
/** Renders bigint units at `scale` as a decimal string. */
function unitsToDecimalString(units, scale = exports.MONEY_SCALE, outputScale = scale) {
    const negative = units < 0n;
    const abs = negative ? -units : units;
    const divisor = 10n ** BigInt(scale);
    const whole = abs / divisor;
    const fraction = abs % divisor;
    const fractionStr = fraction.toString().padStart(scale, '0');
    const trimmed = outputScale >= scale ? fractionStr.padEnd(outputScale, '0') : fractionStr.slice(0, outputScale);
    const body = outputScale === 0 ? whole.toString() : `${whole}.${trimmed}`;
    return negative ? `-${body}` : body;
}
/**
 * Converts a JS number to a decimal string without scientific notation. Used
 * only at integration boundaries (JSON payloads, seeds); monetary arithmetic
 * happens on Money afterwards.
 */
function decimalStringFromNumber(value) {
    if (!Number.isFinite(value))
        throw new MoneyError(`Not a finite number: ${value}`);
    const asString = String(value);
    if (!/e/i.test(asString))
        return asString;
    // Expand exponential notation.
    const [mantissa = '0', exponentPart = '0'] = asString.split(/e/i);
    const exponent = Number(exponentPart);
    const negative = mantissa.startsWith('-');
    const [intPart = '0', fracPart = ''] = mantissa.replace(/^[+-]/, '').split('.');
    const digits = intPart + fracPart;
    const pointIndex = intPart.length + exponent;
    let result;
    if (pointIndex <= 0) {
        result = `0.${'0'.repeat(-pointIndex)}${digits}`;
    }
    else if (pointIndex >= digits.length) {
        result = `${digits}${'0'.repeat(pointIndex - digits.length)}`;
    }
    else {
        result = `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
    }
    return negative ? `-${result}` : result;
}
/** Convenience constructors so call sites read close to the domain language. */
function money(value, currency = 'INR') {
    return Money.from(value, currency);
}
function rate(percent) {
    return Rate.fromPercent(percent);
}
//# sourceMappingURL=index.js.map