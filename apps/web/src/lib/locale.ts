import { Money } from '@fee/money';

type DateValue = Date | string | number;

function toDate(value: DateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Display calendar dates using the Indian day/month/year convention. */
export function formatIndianDate(value: DateValue): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(toDate(value));
}

/** Display timestamps in Indian date and time conventions. */
export function formatIndianDateTime(value: DateValue): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(toDate(value));
}

/** Group counts and chart labels using Indian lakh/crore digit grouping. */
export function formatIndianNumber(value: number | string | undefined): string | undefined {
  if (typeof value !== 'number') return value;
  return new Intl.NumberFormat('en-IN').format(value);
}

/** Format a stored decimal exactly, using the Indian digit grouping for INR. */
export function formatIndianCurrency(value: string | number, currency = 'INR'): string {
  const amount = String(value);
  const money = Money.fromString(amount, currency);
  const fraction = amount.split('.')[1] ?? '';
  const minorUnits = /[1-9]/.test(fraction) ? money.currency.minorUnits : 0;
  return money.format({ minorUnits });
}
