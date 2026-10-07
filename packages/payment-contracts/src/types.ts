import type { Money } from '@fee/money';
import type {
  GatewayEnvironment,
  GatewayProvider,
  PaymentChannel,
  PaymentMethodKind,
} from '@fee/types';

/**
 * Gateway adapter contract.
 *
 * The payment engine talks to this interface and never to a provider SDK. That
 * is what makes "switch gateway without a code change" true: a new provider is a
 * new file implementing the provider contract, and a tenant configuration row.
 *
 * Two rules the implementations must respect:
 *   - Money in, Money out. No provider deals in floats here.
 *   - A secret never travels to the client. `CreateOrderResult.checkout` carries
 *     only what a browser may legitimately see.
 */

export type GatewayTransactionStatus =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/** A status the adapter could not map onto the platform's vocabulary. */
export type RawGatewayStatus = string;

export interface GatewayCredentials {
  provider: GatewayProvider;
  environment: GatewayEnvironment;
  /** Public identifier: Razorpay key id, Cashfree app id, Stripe publishable key. */
  keyId: string;
  /** Decrypted secret. Never logged, never serialised into a response. */
  secret: string;
  /** Used to verify inbound webhooks. */
  webhookSecret?: string;
  /** Provider-specific extras (PayU salt, Stripe account, Cashfree API version). */
  extra?: Record<string, unknown>;
}

export interface GatewayCustomer {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface CreateOrderInput {
  credentials: GatewayCredentials;
  /** The platform's payment order number, sent as the provider's receipt/reference. */
  orderNumber: string;
  amount: Money;
  currency: string;
  description?: string;
  customer?: GatewayCustomer;
  /** Where the gateway should send the payer back to. */
  returnUrl?: string;
  /** Provider-specific hints, e.g. a preferred method. */
  notes?: Record<string, string>;
  idempotencyKey?: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
  providerStatus: RawGatewayStatus;
  amount: Money;
  currency: string;
  expiresAt?: string;
  /** Exactly what the browser needs, and nothing more. */
  checkout: {
    provider: GatewayProvider;
    environment: GatewayEnvironment;
    keyId: string;
    providerOrderId: string;
    amount: string;
    currency: string;
    extra?: Record<string, string>;
  };
  raw?: unknown;
}

export interface VerifyPaymentInput {
  credentials: GatewayCredentials;
  providerOrderId?: string;
  providerPaymentId: string;
  providerSignature?: string;
  /** Expected amount, when the caller wants the adapter to assert it. */
  expectedAmount?: Money;
}

export interface VerifyPaymentResult {
  verified: boolean;
  status: GatewayTransactionStatus;
  rawStatus?: RawGatewayStatus;
  amount?: Money;
  currency?: string;
  methodKind?: PaymentMethodKind;
  providerTxnId?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
}

export interface GetPaymentStatusInput {
  credentials: GatewayCredentials;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerRefundId?: string;
}

export interface PaymentStatusResult {
  status: GatewayTransactionStatus;
  rawStatus?: RawGatewayStatus;
  amount?: Money;
  currency?: string;
  methodKind?: PaymentMethodKind;
  providerTxnId?: string;
  /** Provider-reported fee, when it is exposed before settlement. */
  gatewayFee?: Money;
  raw?: unknown;
}

export type ProviderOrderState = 'CAPTURED' | 'PENDING' | 'FAILED' | 'TERMINAL' | 'UNKNOWN';

/**
 * Provider-authenticated order state used before releasing a local payment
 * reservation. `FAILED` describes an order-level failure; attempt failure alone
 * must be returned as `PENDING` unless the provider confirms closure.
 */
export interface VerifyOrderClosureInput {
  credentials: GatewayCredentials;
  providerOrderId: string;
  /** Immutable currency recorded on the local provider order. */
  currency: string;
}

export interface VerifyOrderClosureResult {
  state: ProviderOrderState;
  rawStatus?: RawGatewayStatus;
  amount?: Money;
  currency?: string;
  providerPaymentId?: string;
  providerTxnId?: string;
  raw?: unknown;
}

export interface RefundPaymentInput {
  credentials: GatewayCredentials;
  /** The platform's refund number, used as the provider's idempotency reference. */
  refundNumber: string;
  providerPaymentId: string;
  providerOrderId?: string;
  amount: Money;
  currency: string;
  reason?: string;
  /** `normal` or `optimum` on Razorpay; ignored where unsupported. */
  speed?: string;
  notes?: Record<string, string>;
}

export interface RefundResult {
  providerRefundId: string;
  status: GatewayTransactionStatus;
  rawStatus?: RawGatewayStatus;
  amount: Money;
  currency: string;
  /** Some providers report the payout timeline immediately. */
  expectedAt?: string;
  raw?: unknown;
}

export interface VerifyWebhookInput {
  credentials: GatewayCredentials;
  /** The exact bytes received. Re-serialising the body breaks signature checks. */
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The normalised result of a webhook. `externalEventId` is what makes the
 * handler idempotent: the provider redelivers, and the unique constraint on
 * (tenant, provider, externalEventId) turns the redelivery into a no-op.
 */
export interface WebhookResult {
  valid: boolean;
  /** Provider event id. Required for idempotent processing. */
  externalEventId?: string;
  eventType?: string;
  providerOrderId?: string;
  providerTxnId?: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  amount?: Money;
  currency?: string;
  status: GatewayTransactionStatus | 'UNKNOWN';
  rawStatus?: RawGatewayStatus;
  methodKind?: PaymentMethodKind;
  error?: string;
  raw: unknown;
}

export interface PaymentGatewayAdapter {
  readonly provider: GatewayProvider;
  /** Providers this adapter can describe itself for, used by the settings UI. */
  readonly supportedMethods: readonly PaymentMethodKind[];
  /** Whether an order can be queried server-to-server after its local checkout deadline. */
  readonly supportsOrderStatusVerification: boolean;
  /** Returns a provider lookup ID known before creation completes, if the provider accepts merchant-assigned IDs. */
  orderReferenceForStatusLookup(orderNumber: string): string | null;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  verifyOrderClosure(input: VerifyOrderClosureInput): Promise<VerifyOrderClosureResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  getPaymentStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult>;
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<WebhookResult>;
}

/**
 * Normalised gateway failure.
 *
 * `retryable` is the important field: a timeout may be retried, a signature
 * failure never may. Financial operations are never retried blindly.
 */
export class GatewayError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly provider?: GatewayProvider;
  readonly httpStatus?: number;
  readonly providerErrorCode?: string;
  readonly raw?: unknown;

  constructor(input: {
    message: string;
    code: string;
    retryable?: boolean;
    provider?: GatewayProvider;
    httpStatus?: number;
    providerErrorCode?: string;
    raw?: unknown;
  }) {
    super(input.message);
    this.name = 'GatewayError';
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.provider = input.provider;
    this.httpStatus = input.httpStatus;
    this.providerErrorCode = input.providerErrorCode;
    this.raw = input.raw;
  }
}

export interface GatewayRouteCandidate {
  id: string;
  provider: GatewayProvider;
  environment: GatewayEnvironment;
  enabled: boolean;
  isDefault: boolean;
  isBackup: boolean;
  priority: number;
  supportedMethods: readonly PaymentMethodKind[];
  minAmount?: Money | null;
  maxAmount?: Money | null;
  /** `[{ "method": "UPI", "upTo": "100000" }, { "method": "CARD" }]` */
  routingRules?: ReadonlyArray<{ method?: PaymentMethodKind; upTo?: string; from?: string }> | null;
}

export interface GatewayRouteContext {
  methodKind?: PaymentMethodKind;
  amount: Money;
  currency: string;
  channel: PaymentChannel;
  /** Card issued outside the tenant's home country. */
  isInternational?: boolean;
  /** Methods the payer is willing to use, most preferred first. */
  preferredMethods?: readonly PaymentMethodKind[];
}

export interface GatewayRouteDecision {
  selected?: GatewayRouteCandidate;
  /** Why this gateway, in words the settings screen can display. */
  reason: string;
  rejected: Array<{ id: string; reason: string }>;
}
