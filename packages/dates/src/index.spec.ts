import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysLate,
  fiscalYearFor,
  installmentDueDates,
  monthPeriod,
  resolveDueDate,
} from './index';

describe('financial date helpers', () => {
  it('uses calendar dates for day and month arithmetic', () => {
    expect(addDays('2026-04-01', 1)).toBe('2026-04-02');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(monthPeriod('2026-02-14')).toMatchObject({ start: '2026-02-01', end: '2026-02-28', key: '2026-02' });
  });

  it('supports configurable fiscal year boundaries and late-day grace periods', () => {
    expect(fiscalYearFor('2026-03-31')).toMatchObject({ start: '2025-04-01', end: '2026-03-31', key: '2025-26' });
    expect(fiscalYearFor('2026-07-01', { startMonth: 1, labelStyle: 'START_YEAR' }).key).toBe('2026');
    expect(daysLate('2026-04-01', '2026-04-06', 3)).toBe(2);
  });

  it('resolves configurable due dates and installment schedules', () => {
    expect(resolveDueDate(
      { anchor: 'PERIOD_START', offsetDays: 2, adjustToWorkingDay: true },
      { PERIOD_START: '2026-10-02' },
    )).toBe('2026-10-05');
    expect(installmentDueDates({ startDate: '2026-01-31', count: 3, frequency: 'MONTHLY' }))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(installmentDueDates({ startDate: '2026-01-01', count: 3, intervalDays: 30 }, '2026-01-15'))
      .toEqual(['2026-01-01', '2026-01-15', '2026-01-15']);
  });
});
