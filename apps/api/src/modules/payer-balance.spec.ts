import { describe, expect, it } from 'vitest';
import { Money } from '@fee/money';
import { capPayerShareBalances } from './payer-balance';

const money = (value: string) => Money.fromString(value, 'INR');

describe('payer share capacity', () => {
  it('caps unreserved shares in priority order after a live demand reduction', () => {
    const shares = capPayerShareBalances({
      itemBalance: money('80'),
      activeReservations: money('10'),
      shares: [
        { id: 'z-priority-10', priority: 10, actualOutstanding: money('50'), reserved: money('0'), payer: 'Sponsor Z' },
        { id: 'a-priority-10', priority: 10, actualOutstanding: money('20'), reserved: money('0'), payer: 'Sponsor A' },
        { id: 'later', priority: 20, actualOutstanding: money('30'), reserved: money('0'), payer: 'Parent' },
      ],
      studentResidual: (actualOutstanding) => ({ id: null, priority: 2_147_483_647, actualOutstanding, reserved: money('0'), payer: 'Student' }),
    });

    // The remaining 70 is shared deterministically: priority first, then ID.
    expect(shares.map(({ id, payer, outstanding }) => [id, payer, outstanding.toString()])).toEqual([
      ['a-priority-10', 'Sponsor A', '20.0000'],
      ['z-priority-10', 'Sponsor Z', '50.0000'],
      ['later', 'Parent', '0.0000'],
    ]);
  });

  it('preserves an active payer reservation and exposes the synthetic student residual only from remaining capacity', () => {
    const shares = capPayerShareBalances({
      itemBalance: money('100'),
      activeReservations: money('60'),
      shares: [
        { id: 'sponsor-share', priority: 10, actualOutstanding: money('60'), reserved: money('60'), payer: 'Sponsor' },
      ],
      studentResidual: (actualOutstanding) => ({ id: null, priority: 2_147_483_647, actualOutstanding, reserved: money('0'), payer: 'Student' }),
    });

    expect(shares.map(({ id, payer, actualOutstanding, reserved, outstanding }) => [
      id,
      payer,
      actualOutstanding.toString(),
      reserved.toString(),
      outstanding.toString(),
    ])).toEqual([
      ['sponsor-share', 'Sponsor', '60.0000', '60.0000', '0.0000'],
      [null, 'Student', '40.0000', '0.0000', '40.0000'],
    ]);
    expect(shares.reduce((sum, share) => sum.add(share.outstanding), money('0')).toString()).toBe('40.0000');
  });

  it('keeps reservations from all active orders in the shared cap, even when a reservation has no current share row', () => {
    const shares = capPayerShareBalances({
      itemBalance: money('100'),
      activeReservations: money('50'),
      shares: [
        { id: 'first', priority: 1, actualOutstanding: money('40'), reserved: money('0'), payer: 'First' },
        { id: 'second', priority: 2, actualOutstanding: money('60'), reserved: money('0'), payer: 'Second' },
      ],
      studentResidual: (actualOutstanding) => ({ id: null, priority: 2_147_483_647, actualOutstanding, reserved: money('0'), payer: 'Student' }),
    });

    expect(shares.map((share) => share.outstanding.toString())).toEqual(['40.0000', '10.0000']);
    expect(shares.reduce((sum, share) => sum.add(share.outstanding), money('0')).toString()).toBe('50.0000');
  });
});
