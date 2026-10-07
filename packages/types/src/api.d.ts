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
    details?: Array<{
        path: string;
        message: string;
        code?: string;
    }>;
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
export declare const DEFAULT_PAGE_SIZE = 25;
export declare const MAX_PAGE_SIZE = 200;
export interface DateRangeQuery {
    from?: string;
    to?: string;
}
export interface Paginated<T> {
    items: T[];
    pagination: PaginationMeta;
}
export declare function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta;
/** Domain error codes the client branches on. */
export declare const ERROR_CODES: {
    readonly VALIDATION_FAILED: "VALIDATION_FAILED";
    readonly UNAUTHENTICATED: "UNAUTHENTICATED";
    readonly TOKEN_EXPIRED: "TOKEN_EXPIRED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly PERMISSION_DENIED: "PERMISSION_DENIED";
    readonly TENANT_NOT_FOUND: "TENANT_NOT_FOUND";
    readonly TENANT_MISMATCH: "TENANT_MISMATCH";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly CONFLICT: "CONFLICT";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly FEE_STRUCTURE_NOT_FOUND: "FEE_STRUCTURE_NOT_FOUND";
    readonly FEE_STRUCTURE_NOT_ACTIVE: "FEE_STRUCTURE_NOT_ACTIVE";
    readonly FEE_POLICY_INVALID: "FEE_POLICY_INVALID";
    readonly FEE_POLICY_CIRCULAR: "FEE_POLICY_CIRCULAR";
    readonly FEE_CALCULATION_NEEDS_ATTENTION: "FEE_CALCULATION_NEEDS_ATTENTION";
    readonly DEMAND_ALREADY_ISSUED: "DEMAND_ALREADY_ISSUED";
    readonly DEMAND_NOT_ISSUED: "DEMAND_NOT_ISSUED";
    readonly PAYMENT_ALREADY_PROCESSED: "PAYMENT_ALREADY_PROCESSED";
    readonly PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND";
    readonly PAYMENT_INVALID_STATE: "PAYMENT_INVALID_STATE";
    readonly PAYMENT_AMOUNT_MISMATCH: "PAYMENT_AMOUNT_MISMATCH";
    readonly PAYMENT_AMOUNT_INVALID: "PAYMENT_AMOUNT_INVALID";
    readonly OVERPAYMENT_NOT_ALLOWED: "OVERPAYMENT_NOT_ALLOWED";
    readonly PARTIAL_PAYMENT_NOT_ALLOWED: "PARTIAL_PAYMENT_NOT_ALLOWED";
    readonly ALLOCATION_EXCEEDS_PAYMENT: "ALLOCATION_EXCEEDS_PAYMENT";
    readonly ALLOCATION_EXCEEDS_OUTSTANDING: "ALLOCATION_EXCEEDS_OUTSTANDING";
    readonly CONCURRENT_PAYMENT_DETECTED: "CONCURRENT_PAYMENT_DETECTED";
    readonly IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED";
    readonly IDEMPOTENCY_IN_PROGRESS: "IDEMPOTENCY_IN_PROGRESS";
    readonly GATEWAY_NOT_CONFIGURED: "GATEWAY_NOT_CONFIGURED";
    readonly GATEWAY_DISABLED: "GATEWAY_DISABLED";
    readonly GATEWAY_ERROR: "GATEWAY_ERROR";
    readonly GATEWAY_TIMEOUT: "GATEWAY_TIMEOUT";
    readonly GATEWAY_SIGNATURE_INVALID: "GATEWAY_SIGNATURE_INVALID";
    readonly WEBHOOK_DUPLICATE: "WEBHOOK_DUPLICATE";
    readonly WEBHOOK_UNKNOWN_ORDER: "WEBHOOK_UNKNOWN_ORDER";
    readonly REFUND_EXCEEDS_PAYMENT: "REFUND_EXCEEDS_PAYMENT";
    readonly REFUND_ALREADY_COMPLETED: "REFUND_ALREADY_COMPLETED";
    readonly CREDIT_INSUFFICIENT: "CREDIT_INSUFFICIENT";
    readonly ADJUSTMENT_REQUIRES_APPROVAL: "ADJUSTMENT_REQUIRES_APPROVAL";
    readonly APPROVAL_REQUIRED: "APPROVAL_REQUIRED";
    readonly APPROVAL_ALREADY_DECIDED: "APPROVAL_ALREADY_DECIDED";
    readonly UNBALANCED_LEDGER_POSTING: "UNBALANCED_LEDGER_POSTING";
    readonly IMMUTABLE_RECORD: "IMMUTABLE_RECORD";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
//# sourceMappingURL=api.d.ts.map