import { Money, Rate } from '@fee/money';
import { daysLate as daysLateBetween, isAfterDate, type IsoDate } from '@fee/dates';
import type { LateFeeConfig } from '@fee/types';

/**
 * Late fee computation.
 *
 * A late fee is a *financial item*, not a mutation of the original demand. This
 * function only computes the number; the caller persists it as a
 * `LateFeeAccrual` row and an adjustment line so it can be explained, waived,
 * reversed and reported on independently.
 *
 * The base is deliberately the **outstanding** amount rather than the original
 * fee: a student who has paid 80% of a fee and is 10 days late should not be
 * charged a late fee on the 80% they already paid.
 */

export interface LateFeeInput {
  config: LateFeeConfig | null | undefined;
  /** Due date the item was payable by. */
  dueDate: IsoDate | null | undefined;
  /** Date the fee is being computed for. */
  asOfDate: IsoDate;
  /** Amount still unpaid. */
  outstanding: Money;
  currency: string;
}

export interface LateFeeOutcome {
  amount: Money;
  daysLate: number;
  graceDays: number;
  mode: LateFeeConfig['mode'];
  /** Set when `maxAmount` absorbed part of the computed fee. */
  cappedBy?: string;
  /** Human explanation, shown in "Why this fee?". */
  description: string;
}

export function computeLateFee(input: LateFeeInput): LateFeeOutcome {
  const zero: LateFeeOutcome = {
    amount: Money.zero(input.currency),
    daysLate: 0,
    graceDays: input.config?.graceDays ?? 0,
    mode: input.config?.mode ?? 'NONE',
    description: 'No late fee',
  };

  const config = input.config;
  if (!config || config.mode === 'NONE') return zero;
  if (!input.dueDate) {
    return { ...zero, description: 'No late fee: the item has no due date' };
  }
  // A fee that is not yet overdue cannot attract a late fee, regardless of the
  // accrual date the caller passed.
  if (!isAfterDate(input.asOfDate, input.dueDate)) return zero;
  if (!input.outstanding.isPositive) {
    return { ...zero, description: 'No late fee: nothing outstanding' };
  }

  const graceDays = config.graceDays ?? 0;
  const late = daysLateBetween(input.dueDate, input.asOfDate, graceDays);
  if (late <= 0) {
    return {
      ...zero,
      daysLate: 0,
      graceDays,
      description: `No late fee: within the ${graceDays}-day grace period`,
    };
  }

  const flat = config.flatAmount ? Money.fromString(config.flatAmount, input.currency) : Money.zero(input.currency);
  const perDay = config.perDayAmount ? Money.fromString(config.perDayAmount, input.currency) : Money.zero(input.currency);
  const percent = config.percent ? Rate.fromPercent(config.percent) : Rate.zero();

  let amount: Money;
  let description: string;
  switch (config.mode) {
    case 'FLAT':
      amount = flat;
      description = `Flat late fee of ${flat.format()} after ${graceDays} grace day(s) (${late} day(s) late)`;
      break;
    case 'PER_DAY':
      amount = perDay.scale(BigInt(late), 1n);
      description = `${perDay.format()} per day x ${late} day(s) late (${graceDays} grace day(s))`;
      break;
    case 'PERCENTAGE':
      amount = input.outstanding.percent(percent);
      description = `${percent.percentString}% of the ${input.outstanding.format()} outstanding (${late} day(s) late)`;
      break;
    case 'CUSTOM':
    default: {
      // CUSTOM is the additive case: a tenant that charges both a flat penalty
      // and a daily amount can express it without a new mode.
      amount = flat.add(perDay.scale(BigInt(late), 1n)).add(input.outstanding.percent(percent));
      description = `Custom late fee: ${flat.format()} flat + ${perDay.format()}/day x ${late} (${graceDays} grace day(s))`;
      break;
    }
  }

  let cappedBy: string | undefined;
  if (config.maxAmount) {
    const max = Money.fromString(config.maxAmount, input.currency);
    if (amount.greaterThan(max)) {
      amount = max;
      cappedBy = 'lateFee.maxAmount';
      description = `${description}, capped at ${max.format()}`;
    }
  }

  return { amount, daysLate: late, graceDays, mode: config.mode, cappedBy, description };
}

/**
 * Whether a late fee would apply at all, without computing the amount. Used by
 * the reminder scanner to decide if a dunning message should say "late fee
 * applies from tomorrow".
 */
export function lateFeeApplies(config: LateFeeConfig | null | undefined, dueDate: IsoDate | null, asOfDate: IsoDate): boolean {
  if (!config || config.mode === 'NONE' || !dueDate) return false;
  if (!isAfterDate(asOfDate, dueDate)) return false;
  return daysLateBetween(dueDate, asOfDate, config.graceDays ?? 0) > 0;
}
