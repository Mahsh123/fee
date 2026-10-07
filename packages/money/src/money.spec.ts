import { describe, expect, it } from 'vitest';
import {
  Money,
  MoneyError,
  Rate,
  divRound,
  parseDecimalToUnits,
  unitsToDecimalString,
} from './index';

describe('decimal <-> units conversion', () => {
  it('parses whole and fractional values exactly', () => {
    expect(unitsToDecimalString(parseDecimalToUnits('50000'))).toBe('50000.0000');
    expect(unitsToDecimalString(parseDecimalToUnits('50000.25'))).toBe('50000.2500');
    expect(unitsToDecimalString(parseDecimalToUnits('-12.5'))).toBe('-12.5000');
    expect(unitsToDecimalString(parseDecimalToUnits('1,234.56'))).toBe('1234.5600');
    expect(unitsToDecimalString(parseDecimalToUnits('.5'))).toBe('0.5000');
  });

  it('rounds excess fractional digits instead of silently truncating', () => {
    // 5 decimal places, scale is 4: last digit is discarded by rounding.
    expect(unitsToDecimalString(parseDecimalToUnits('1.00005'))).toBe('1.0001');
    expect(unitsToDecimalString(parseDecimalToUnits('1.00005', 'HALF_EVEN'))).toBe('1.0000');
    expect(unitsToDecimalString(parseDecimalToUnits('1.00005', 'FLOOR'))).toBe('1.0000');
    expect(unitsToDecimalString(parseDecimalToUnits('-1.00005', 'FLOOR'))).toBe('-1.0001');
    expect(unitsToDecimalString(parseDecimalToUnits('1.00005', 'CEIL'))).toBe('1.0001');
    expect(unitsToDecimalString(parseDecimalToUnits('1.00005', 'TRUNCATE'))).toBe('1.0000');
  });

  it('rejects malformed input rather than coercing it to zero', () => {
    expect(() => parseDecimalToUnits('')).toThrow(MoneyError);
    expect(() => parseDecimalToUnits('abc')).toThrow(MoneyError);
    expect(() => parseDecimalToUnits('1.2.3')).toThrow(MoneyError);
  });

  it('raises a MoneyError for a zero denominator', () => {
    expect(() => divRound(1n, 0n)).toThrow(MoneyError);
  });
});

describe('Money construction', () => {
  it('accepts strings, bigints and interop objects but never silently floats', () => {
    expect(Money.fromString('27000').toString()).toBe('27000.0000');
    expect(Money.fromUnits(270000000n).toString()).toBe('27000.0000');
    // Prisma Decimal-like boundary object.
    expect(Money.from({ toString: () => '1234.5678' }).toString()).toBe('1234.5678');
    expect(Money.fromNumber(0.1).add(Money.fromNumber(0.2)).toString()).toBe('0.3000');
  });

  it('refuses to relabel a value in a different currency', () => {
    const inr = Money.fromString('100', 'INR');
    expect(() => Money.from(inr, 'USD')).toThrow(MoneyError);
  });

  it('converts currency only when an explicit rate is supplied', () => {
    const inr = Money.fromString('8300', 'INR');
    const usd = inr.convertTo('USD', Rate.fromFraction('0.00012'));
    expect(usd.currency.code).toBe('USD');
    expect(usd.toFixedString()).toBe('1.00');
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts exactly across many operations', () => {
    let total = Money.zero();
    for (let i = 0; i < 1000; i += 1) total = total.add(Money.fromString('0.01'));
    expect(total.toString()).toBe('10.0000');
  });

  it('rejects arithmetic across currencies', () => {
    expect(() => Money.fromString('1', 'INR').add(Money.fromString('1', 'USD'))).toThrow(MoneyError);
  });

  it('computes percentages exactly, including fractional rates', () => {
    const tuition = Money.fromString('50000');
    expect(tuition.percent('50').toString()).toBe('25000.0000');
    expect(tuition.percent('12.5').toString()).toBe('6250.0000');
    // Rates are integer parts-per-million, so a percentage is quantised to
    // 0.0001%. 33.333333% becomes 333333 ppm (33.3333%), and the product is exact
    // and reproducible rather than dependent on float luck.
    expect(tuition.percent('33.333333').toString()).toBe('16666.6500');
    expect(Rate.fromPercent('33.333333').ppm).toBe(333_333n);
    expect(tuition.percent('0').toString()).toBe('0.0000');
    expect(tuition.percent('100').toString()).toBe('50000.0000');
  });

  it('reads rates from percentages, basis points and fractions consistently', () => {
    expect(Rate.fromPercent('12.5').ppm).toBe(125_000n);
    expect(Rate.fromBasisPoints('750').ppm).toBe(75_000n);
    expect(Rate.fromFraction('0.125').ppm).toBe(125_000n);
    expect(Rate.fromPercent('12.5').percentString).toBe('12.500000');
    expect(Rate.fromPercent('50').complement().ppm).toBe(500_000n);
    expect(Rate.one().ppm).toBe(1_000_000n);
  });

  it('caps amounts instead of allowing a rule to exceed its ceiling', () => {
    const discount = Money.fromString('40000');
    expect(discount.min(Money.fromString('30000')).toString()).toBe('30000.0000');
  });

  it('clamps a value into a floor/ceiling band', () => {
    const value = Money.fromString('120000');
    const floor = Money.fromString('0');
    const cap = Money.fromString('100000');
    expect(value.clamp(floor, cap).toString()).toBe('100000.0000');
    expect(Money.fromString('-500').clamp(floor, cap).toString()).toBe('0.0000');
  });

  it('rounds to currency precision with the requested mode', () => {
    expect(Money.fromString('10.005').round(2, 'HALF_UP').toFixedString()).toBe('10.01');
    expect(Money.fromString('10.005').round(2, 'HALF_EVEN').toFixedString()).toBe('10.00');
    expect(Money.fromString('10.004').round(2, 'HALF_UP').toFixedString()).toBe('10.00');
  });

  it('formats with grouping and symbol', () => {
    expect(Money.fromString('27000', 'INR').format()).toBe('₹27,000.00');
    expect(Money.fromString('1234567.5', 'USD').format()).toBe('$1,234,567.50');
    expect(Money.fromString('-1500', 'INR').format({ showSymbol: false })).toBe('-1,500.00');
    expect(Money.fromString('1000', 'JPY').format()).toBe('¥1,000');
  });

  it('answers "how much is still outstanding" without going negative', () => {
    const due = Money.fromString('10000');
    expect(due.remainingAfter(Money.fromString('4000')).toString()).toBe('6000.0000');
    expect(due.remainingAfter(Money.fromString('10000')).toString()).toBe('0.0000');
    expect(due.remainingAfter(Money.fromString('15000')).toString()).toBe('0.0000');
  });
});

describe('Money.splitEvenly', () => {
  it('never loses or invents units when the total does not divide evenly', () => {
    const parts = Money.fromString('50000').splitEvenly(3);
    expect(parts.map((p) => p.toString())).toEqual(['16666.6667', '16666.6667', '16666.6666']);
    expect(Money.sum(parts).toString()).toBe('50000.0000');
  });

  it('preserves the sum for negative totals', () => {
    const parts = Money.fromString('-100').splitEvenly(3);
    expect(Money.sum(parts).toString()).toBe('-100.0000');
  });

  it('handles a count larger than the amount', () => {
    const parts = Money.fromString('2').splitEvenly(4);
    expect(parts.map((p) => p.toString())).toEqual(['0.5000', '0.5000', '0.5000', '0.5000']);
    expect(Money.sum(parts).toString()).toBe('2.0000');
  });
});

describe('Money.allocate (largest remainder)', () => {
  it('splits an indivisible amount without leaking a unit', () => {
    // The classic: 100 split 3 ways must still total exactly 100.
    const parts = Money.fromString('100').allocate([
      Rate.fromPercent('33.333333'),
      Rate.fromPercent('33.333333'),
      Rate.fromPercent('33.333333'),
    ]);
    expect(Money.sum(parts).toString()).toBe('100.0000');
  });

  it('allocates a payment across demand items by outstanding weight', () => {
    const payment = Money.fromString('10000');
    const outstanding = [Money.fromString('20000'), Money.fromString('15000'), Money.fromString('2000')];
    const totalWeight = Money.sum(outstanding);
    const ratios = outstanding.map((o) => Rate.fromPpm((o.units * 1_000_000n) / totalWeight.units));
    const parts = payment.allocate(ratios);
    expect(Money.sum(parts).toString()).toBe('10000.0000');
  });

  it('treats ratios as weights, so a 0/100 split gives everything to one side', () => {
    const parts = Money.fromString('750').allocate([Rate.zero(), Rate.fromPercent('100')]);
    expect(parts[0]!.isZero).toBe(true);
    expect(parts[1]!.toString()).toBe('750.0000');
  });

  it('rejects an allocation with no weight at all', () => {
    expect(() => Money.fromString('100').allocate([Rate.zero(), Rate.zero()])).toThrow(MoneyError);
    expect(Money.fromString('100').allocate([])).toEqual([]);
  });

  it('distributes remainder deterministically, largest remainder first', () => {
    const parts = Money.fromString('100').allocate([
      Rate.fromPercent('50'),
      Rate.fromPercent('30'),
      Rate.fromPercent('20'),
    ]);
    expect(parts.map((p) => p.toString())).toEqual(['50.0000', '30.0000', '20.0000']);
  });
});
