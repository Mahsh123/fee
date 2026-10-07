/**
 * Wire contracts shared by the API and the web client.
 *
 * Every response is wrapped, including errors: a caller can branch on
 * `success` without inspecting the HTTP status, and the `requestId` is always
 * present so a support ticket can be traced to a log line.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  /** Field-level validation detail, keyed by dotted path. */
  details?: Array<{ path: string; message: string; code?: string }>;
  /** Only populated outside production. */
  hint?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
  meta?: ResponseMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ResponseMeta {
  pagination?: PaginationMeta;
  /** Set when a write was accepted but deferred to the worker. */
  jobId?: string;
  warnings?: string[];
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  /** Dotted sort path; prefix with `-` for descending. */
  sort?: string;
  search?: string;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

/** Domain error codes the client branches on. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',

  FEE_STRUCTURE_NOT_FOUND: 'FEE_STRUCTURE_NOT_FOUND',
  FEE_STRUCTURE_NOT_ACTIVE: 'FEE_STRUCTURE_NOT_ACTIVE',
  FEE_POLICY_INVALID: 'FEE_POLICY_INVALID',
  FEE_POLICY_CIRCULAR: 'FEE_POLICY_CIRCULAR',
  FEE_CALCULATION_NEEDS_ATTENTION: 'FEE_CALCULATION_NEEDS_ATTENTION',
  DEMAND_ALREADY_ISSUED: 'DEMAND_ALREADY_ISSUED',
  DEMAND_NOT_ISSUED: 'DEMAND_NOT_ISSUED',

  PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_INVALID_STATE: 'PAYMENT_INVALID_STATE',
  PAYMENT_AMOUNT_MISMATCH: 'PAYMENT_AMOUNT_MISMATCH',
  PAYMENT_AMOUNT_INVALID: 'PAYMENT_AMOUNT_INVALID',
  OVERPAYMENT_NOT_ALLOWED: 'OVERPAYMENT_NOT_ALLOWED',
  PARTIAL_PAYMENT_NOT_ALLOWED: 'PARTIAL_PAYMENT_NOT_ALLOWED',
  ALLOCATION_EXCEEDS_PAYMENT: 'ALLOCATION_EXCEEDS_PAYMENT',
  ALLOCATION_EXCEEDS_OUTSTANDING: 'ALLOCATION_EXCEEDS_OUTSTANDING',
  CONCURRENT_PAYMENT_DETECTED: 'CONCURRENT_PAYMENT_DETECTED',

  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',

  GATEWAY_NOT_CONFIGURED: 'GATEWAY_NOT_CONFIGURED',
  GATEWAY_DISABLED: 'GATEWAY_DISABLED',
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  GATEWAY_SIGNATURE_INVALID: 'GATEWAY_SIGNATURE_INVALID',
  WEBHOOK_DUPLICATE: 'WEBHOOK_DUPLICATE',
  WEBHOOK_UNKNOWN_ORDER: 'WEBHOOK_UNKNOWN_ORDER',

  REFUND_EXCEEDS_PAYMENT: 'REFUND_EXCEEDS_PAYMENT',
  REFUND_ALREADY_COMPLETED: 'REFUND_ALREADY_COMPLETED',
  CREDIT_INSUFFICIENT: 'CREDIT_INSUFFICIENT',
  ADJUSTMENT_REQUIRES_APPROVAL: 'ADJUSTMENT_REQUIRES_APPROVAL',

  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  APPROVAL_ALREADY_DECIDED: 'APPROVAL_ALREADY_DECIDED',

  UNBALANCED_LEDGER_POSTING: 'UNBALANCED_LEDGER_POSTING',
  IMMUTABLE_RECORD: 'IMMUTABLE_RECORD',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
