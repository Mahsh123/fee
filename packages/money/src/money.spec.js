"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("./index");
(0, vitest_1.describe)('decimal <-> units conversion', () => {
    (0, vitest_1.it)('parses whole and fractional values exactly', () => {
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('50000'))).toBe('50000.0000');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('50000.25'))).toBe('50000.2500');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('-12.5'))).toBe('-12.5000');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('1,234.56'))).toBe('1234.5600');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('.5'))).toBe('0.5000');
    });
    (0, vitest_1.it)('rounds excess fractional digits instead of silently truncating', () => {
        // 5 decimal places, scale is 4: last digit is discarded by rounding.
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('1.00005'))).toBe('1.0001');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('1.00005', 'HALF_EVEN'))).toBe('1.0000');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('1.00005', 'FLOOR'))).toBe('1.0000');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('-1.00005', 'FLOOR'))).toBe('-1.0001');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('1.00005', 'CEIL'))).toBe('1.0001');
        (0, vitest_1.expect)((0, index_1.unitsToDecimalString)((0, index_1.parseDecimalToUnits)('1.00005', 'TRUNCATE'))).toBe('1.0000');
    });
    (0, vitest_1.it)('rejects malformed input rather than coercing it to zero', () => {
        (0, vitest_1.expect)(() => (0, index_1.parseDecimalToUnits)('')).toThrow(index_1.MoneyError);
        (0, vitest_1.expect)(() => (0, index_1.parseDecimalToUnits)('abc')).toThrow(index_1.MoneyError);
        (0, vitest_1.expect)(() => (0, index_1.parseDecimalToUnits)('1.2.3')).toThrow(index_1.MoneyError);
    });
    (0, vitest_1.it)('raises a MoneyError for a zero denominator', () => {
        (0, vitest_1.expect)(() => (0, index_1.divRound)(1n, 0n)).toThrow(index_1.MoneyError);
    });
});
(0, vitest_1.describe)('Money construction', () => {
    (0, vitest_1.it)('accepts strings, bigints and interop objects but never silently floats', () => {
        (0, vitest_1.expect)(index_1.Money.fromString('27000').toString()).toBe('27000.0000');
        (0, vitest_1.expect)(index_1.Money.fromUnits(270000000n).toString()).toBe('27000.0000');
        // Prisma Decimal-like boundary object.
        (0, vitest_1.expect)(index_1.Money.from({ toString: () => '1234.5678' }).toString()).toBe('1234.5678');
        (0, vitest_1.expect)(index_1.Money.fromNumber(0.1).add(index_1.Money.fromNumber(0.2)).toString()).toBe('0.3000');
    });
    (0, vitest_1.it)('refuses to relabel a value in a different currency', () => {
        const inr = index_1.Money.fromString('100', 'INR');
        (0, vitest_1.expect)(() => index_1.Money.from(inr, 'USD')).toThrow(index_1.MoneyError);
    });
    (0, vitest_1.it)('converts currency only when an explicit rate is supplied', () => {
        const inr = index_1.Money.fromString('8300', 'INR');
        const usd = inr.convertTo('USD', index_1.Rate.fromFraction('0.00012'));
        (0, vitest_1.expect)(usd.currency.code).toBe('USD');
        (0, vitest_1.expect)(usd.toFixedString()).toBe('1.00');
    });
});
(0, vitest_1.describe)('Money arithmetic', () => {
    (0, vitest_1.it)('adds and subtracts exactly across many operations', () => {
        let total = index_1.Money.zero();
        for (let i = 0; i < 1000; i += 1)
            total = total.add(index_1.Money.fromString('0.01'));
        (0, vitest_1.expect)(total.toString()).toBe('10.0000');
    });
    (0, vitest_1.it)('rejects arithmetic across currencies', () => {
        (0, vitest_1.expect)(() => index_1.Money.fromString('1', 'INR').add(index_1.Money.fromString('1', 'USD'))).toThrow(index_1.MoneyError);
    });
    (0, vitest_1.it)('computes percentages exactly, including fractional rates', () => {
        const tuition = index_1.Money.fromString('50000');
        (0, vitest_1.expect)(tuition.percent('50').toString()).toBe('25000.0000');
        (0, vitest_1.expect)(tuition.percent('12.5').toString()).toBe('6250.0000');
        // Rates are integer parts-per-million, so a percentage is quantised to
        // 0.0001%. 33.333333% becomes 333333 ppm (33.3333%), and the product is exact
        // and reproducible rather than dependent on float luck.
        (0, vitest_1.expect)(tuition.percent('33.333333').toString()).toBe('16666.6500');
        (0, vitest_1.expect)(index_1.Rate.fromPercent('33.333333').ppm).toBe(333333n);
        (0, vitest_1.expect)(tuition.percent('0').toString()).toBe('0.0000');
        (0, vitest_1.expect)(tuition.percent('100').toString()).toBe('50000.0000');
    });
    (0, vitest_1.it)('reads rates from percentages, basis points and fractions consistently', () => {
        (0, vitest_1.expect)(index_1.Rate.fromPercent('12.5').ppm).toBe(125000n);
        (0, vitest_1.expect)(index_1.Rate.fromBasisPoints('750').ppm).toBe(75000n);
        (0, vitest_1.expect)(index_1.Rate.fromFraction('0.125').ppm).toBe(125000n);
        (0, vitest_1.expect)(index_1.Rate.fromPercent('12.5').percentString).toBe('12.500000');
        (0, vitest_1.expect)(index_1.Rate.fromPercent('50').complement().ppm).toBe(500000n);
        (0, vitest_1.expect)(index_1.Rate.one().ppm).toBe(1000000n);
    });
    (0, vitest_1.it)('caps amounts instead of allowing a rule to exceed its ceiling', () => {
        const discount = index_1.Money.fromString('40000');
        (0, vitest_1.expect)(discount.min(index_1.Money.fromString('30000')).toString()).toBe('30000.0000');
    });
    (0, vitest_1.it)('clamps a value into a floor/ceiling band', () => {
        const value = index_1.Money.fromString('120000');
        const floor = index_1.Money.fromString('0');
        const cap = index_1.Money.fromString('100000');
        (0, vitest_1.expect)(value.clamp(floor, cap).toString()).toBe('100000.0000');
        (0, vitest_1.expect)(index_1.Money.fromString('-500').clamp(floor, cap).toString()).toBe('0.0000');
    });
    (0, vitest_1.it)('rounds to currency precision with the requested mode', () => {
        (0, vitest_1.expect)(index_1.Money.fromString('10.005').round(2, 'HALF_UP').toFixedString()).toBe('10.01');
        (0, vitest_1.expect)(index_1.Money.fromString('10.005').round(2, 'HALF_EVEN').toFixedString()).toBe('10.00');
        (0, vitest_1.expect)(index_1.Money.fromString('10.004').round(2, 'HALF_UP').toFixedString()).toBe('10.00');
    });
    (0, vitest_1.it)('formats with grouping and symbol', () => {
        (0, vitest_1.expect)(index_1.Money.fromString('27000', 'INR').format()).toBe('₹27,000.00');
        (0, vitest_1.expect)(index_1.Money.fromString('1234567.5', 'USD').format()).toBe('$1,234,567.50');
        (0, vitest_1.expect)(index_1.Money.fromString('-1500', 'INR').format({ showSymbol: false })).toBe('-1,500.00');
        (0, vitest_1.expect)(index_1.Money.fromString('1000', 'JPY').format()).toBe('¥1,000');
    });
    (0, vitest_1.it)('answers "how much is still outstanding" without going negative', () => {
        const due = index_1.Money.fromString('10000');
        (0, vitest_1.expect)(due.remainingAfter(index_1.Money.fromString('4000')).toString()).toBe('6000.0000');
        (0, vitest_1.expect)(due.remainingAfter(index_1.Money.fromString('10000')).toString()).toBe('0.0000');
        (0, vitest_1.expect)(due.remainingAfter(index_1.Money.fromString('15000')).toString()).toBe('0.0000');
    });
});
(0, vitest_1.describe)('Money.splitEvenly', () => {
    (0, vitest_1.it)('never loses or invents units when the total does not divide evenly', () => {
        const parts = index_1.Money.fromString('50000').splitEvenly(3);
        (0, vitest_1.expect)(parts.map((p) => p.toString())).toEqual(['16666.6667', '16666.6667', '16666.6666']);
        (0, vitest_1.expect)(index_1.Money.sum(parts).toString()).toBe('50000.0000');
    });
    (0, vitest_1.it)('preserves the sum for negative totals', () => {
        const parts = index_1.Money.fromString('-100').splitEvenly(3);
        (0, vitest_1.expect)(index_1.Money.sum(parts).toString()).toBe('-100.0000');
    });
    (0, vitest_1.it)('handles a count larger than the amount', () => {
        const parts = index_1.Money.fromString('2').splitEvenly(4);
        (0, vitest_1.expect)(parts.map((p) => p.toString())).toEqual(['0.5000', '0.5000', '0.5000', '0.5000']);
        (0, vitest_1.expect)(index_1.Money.sum(parts).toString()).toBe('2.0000');
    });
});
(0, vitest_1.describe)('Money.allocate (largest remainder)', () => {
    (0, vitest_1.it)('splits an indivisible amount without leaking a unit', () => {
        // The classic: 100 split 3 ways must still total exactly 100.
        const parts = index_1.Money.fromString('100').allocate([
            index_1.Rate.fromPercent('33.333333'),
            index_1.Rate.fromPercent('33.333333'),
            index_1.Rate.fromPercent('33.333333'),
        ]);
        (0, vitest_1.expect)(index_1.Money.sum(parts).toString()).toBe('100.0000');
    });
    (0, vitest_1.it)('allocates a payment across demand items by outstanding weight', () => {
        const payment = index_1.Money.fromString('10000');
        const outstanding = [index_1.Money.fromString('20000'), index_1.Money.fromString('15000'), index_1.Money.fromString('2000')];
        const totalWeight = index_1.Money.sum(outstanding);
        const ratios = outstanding.map((o) => index_1.Rate.fromPpm((o.units * 1000000n) / totalWeight.units));
        const parts = payment.allocate(ratios);
        (0, vitest_1.expect)(index_1.Money.sum(parts).toString()).toBe('10000.0000');
    });
    (0, vitest_1.it)('treats ratios as weights, so a 0/100 split gives everything to one side', () => {
        const parts = index_1.Money.fromString('750').allocate([index_1.Rate.zero(), index_1.Rate.fromPercent('100')]);
        (0, vitest_1.expect)(parts[0].isZero).toBe(true);
        (0, vitest_1.expect)(parts[1].toString()).toBe('750.0000');
    });
    (0, vitest_1.it)('rejects an allocation with no weight at all', () => {
        (0, vitest_1.expect)(() => index_1.Money.fromString('100').allocate([index_1.Rate.zero(), index_1.Rate.zero()])).toThrow(index_1.MoneyError);
        (0, vitest_1.expect)(index_1.Money.fromString('100').allocate([])).toEqual([]);
    });
    (0, vitest_1.it)('distributes remainder deterministically, largest remainder first', () => {
        const parts = index_1.Money.fromString('100').allocate([
            index_1.Rate.fromPercent('50'),
            index_1.Rate.fromPercent('30'),
            index_1.Rate.fromPercent('20'),
        ]);
        (0, vitest_1.expect)(parts.map((p) => p.toString())).toEqual(['50.0000', '30.0000', '20.0000']);
    });
});
//# sourceMappingURL=money.spec.js.map