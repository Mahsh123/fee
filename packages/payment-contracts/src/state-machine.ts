import type { DemandStatus, PaymentStatus, RefundStatus } from '@fee/types';

/**
 * Explicit state machines.
 *
 * Transitions are declared rather than inferred from status comparisons, because
 * "is this payment already successful?" is not the same question as "may this
 * payment become refunded?". Centralising the answer means an invalid transition
 * is rejected instead of writing a plausible-looking but impossible row.
 *
 * Two transitions here are deliberately permissive, and both are real-world
 * cases rather than oversights:
 *
 *   - FAILED -> CAPTURED/SUCCESS: a bank can confirm a capture after the
 *     gateway's own synchronous response said the attempt failed. The alternative
 *     is an operator editing history by hand, which is strictly worse.
 *   - PAID -> PARTIALLY_PAID/OVERDUE for a demand: a refund or a credit reversal
 *     legitimately re-opens a settled demand. It is never done by editing amounts.
 */

export class InvalidTransitionError extends Error {
  readonly code = 'PAYMENT_INVALID_STATE';
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
    message?: string,
  ) {
    super(message ?? `Cannot move ${entity} from ${from} to ${to}.`);
    this.name = 'InvalidTransitionError';
  }
}

// ---------------------------------------------------------------------------
// Payment / gateway transaction
// ---------------------------------------------------------------------------

const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ['INITIATED', 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  INITIATED: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING: ['PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  // A sync failure that the bank later confirms is a real case, not a bug.
  FAILED: ['SUCCESS', 'PROCESSING'],
  SUCCESS: ['REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  CANCELLED: [],
  EXPIRED: [],
  REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED', 'SUCCESS'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  REFUNDED: [],
};

export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = ['CANCELLED', 'EXPIRED', 'REFUNDED'];

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  return (PAYMENT_TRANSITIONS[from] ?? []).includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === to) return; // idempotent re-application of the same status is harmless
  if (!canTransitionPayment(from, to)) {
    throw new InvalidTransitionError('payment', from, to);
  }
}

export function isPaymentSettled(status: PaymentStatus): boolean {
  return status === 'SUCCESS' || status === 'PARTIALLY_REFUNDED' || status === 'REFUND_PENDING';
}

/** True when the payment has received money that may be allocated. */
export function isPaymentAllocatable(status: PaymentStatus): boolean {
  return isPaymentSettled(status);
}

export function paymentTransitionsFrom(status: PaymentStatus): readonly PaymentStatus[] {
  return PAYMENT_TRANSITIONS[status] ?? [];
}

/**
 * Maps a gateway status onto the platform's payment status. Kept here so every
 * provider uses the same mapping and reconciliation cannot disagree with the
 * payment record.
 */
export function gatewayStatusToPaymentStatus(
  gatewayStatus: 'CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED',
): PaymentStatus {
  switch (gatewayStatus) {
    case 'CREATED':
      return 'CREATED';
    case 'AUTHORIZED':
      return 'PROCESSING';
    case 'CAPTURED':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'PARTIALLY_REFUNDED':
      return 'PARTIALLY_REFUNDED';
    default: {
      const exhaustive: never = gatewayStatus;
      throw new Error(`Unhandled gateway status: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Fee demand
// ---------------------------------------------------------------------------

const DEMAND_TRANSITIONS: Record<DemandStatus, readonly DemandStatus[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED', 'CREDITED'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'WAIVED', 'CANCELLED', 'CREDITED'],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'WAIVED', 'CANCELLED', 'CREDITED'],
  // Re-opened by a refund, credit reversal or adjustment - never by editing.
  PAID: ['PARTIALLY_PAID', 'OVERDUE', 'CREDITED'],
  WAIVED: ['CANCELLED'],
  CANCELLED: [],
  CREDITED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE'],
};

export function canTransitionDemand(from: DemandStatus, to: DemandStatus): boolean {
  if (from === to) return false;
  return (DEMAND_TRANSITIONS[from] ?? []).includes(to);
}

export function assertDemandTransition(from: DemandStatus, to: DemandStatus): void {
  if (from === to) return;
  if (!canTransitionDemand(from, to)) {
    throw new InvalidTransitionError(
      'fee demand',
      from,
      to,
      `Cannot move the fee demand from ${from} to ${to}. Issued financial records are corrected with a refund, ` +
        'credit or adjustment rather than by changing status directly.',
    );
  }
}

export function demandTransitionsFrom(status: DemandStatus): readonly DemandStatus[] {
  return DEMAND_TRANSITIONS[status] ?? [];
}

/**
 * The single rule for deriving a demand's status from its own amounts.
 *
 * Deriving rather than assigning means the status can never drift from the
 * numbers, and every code path that moves money ends with the same status logic.
 */
export function deriveDemandStatus(input: {
  current: DemandStatus;
  netAmount: string;
  adjustmentAmount?: string;
  paidAmount: string;
  waivedAmount: string;
  creditedAmount: string;
  dueDate: string;
  asOfDate: string;
}): DemandStatus {
  if (input.current === 'DRAFT' || input.current === 'CANCELLED') return input.current;

  const net = toMinor(input.netAmount) + toMinor(input.adjustmentAmount ?? '0');
  const settled = toMinor(input.paidAmount) + toMinor(input.waivedAmount) + toMinor(input.creditedAmount);
  if (net <= 0n) return input.current === 'WAIVED' ? 'WAIVED' : 'PAID';
  if (settled >= net) return 'PAID';
  if (settled === 0n) return input.asOfDate > input.dueDate ? 'OVERDUE' : 'ISSUED';
  return input.asOfDate > input.dueDate ? 'OVERDUE' : 'PARTIALLY_PAID';
}

/** Comparison helper: decimal strings to integer minor units, without floats. */
function toMinor(value: string): bigint {
  const trimmed = String(value).trim();
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = trimmed.replace(/^[+-]/, '').split('.');
  const units = BigInt(`${whole}${(fraction + '0000').slice(0, 4)}`);
  return negative ? -units : units;
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  REQUESTED: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'COMPLETED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  // A failed gateway refund is retried, which is a new attempt on the same row.
  FAILED: ['PROCESSING', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

export function canTransitionRefund(from: RefundStatus, to: RefundStatus): boolean {
  if (from === to) return false;
  return (REFUND_TRANSITIONS[from] ?? []).includes(to);
}

export function assertRefundTransition(from: RefundStatus, to: RefundStatus): void {
  if (from === to) return;
  if (!canTransitionRefund(from, to)) throw new InvalidTransitionError('refund', from, to);
}
