import { Money } from '@fee/money';
import type { GatewayProvider, PaymentMethodKind } from '@fee/types';
import {
  GatewayError,
  type CreateOrderInput,
  type CreateOrderResult,
  type GetPaymentStatusInput,
  type PaymentGatewayAdapter,
  type PaymentStatusResult,
  type RefundPaymentInput,
  type RefundResult,
  type VerifyPaymentInput,
  type VerifyPaymentResult,
  type VerifyOrderClosureInput,
  type VerifyOrderClosureResult,
  type VerifyWebhookInput,
  type WebhookResult,
} from './types';
import {
  sha512,
  verifyCashfreeWebhookSignature,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  verifyStripeWebhookSignature,
} from './signatures';

const HTTP_TIMEOUT_MS = 20_000;

interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body?: unknown;
  provider: GatewayProvider;
}

/**
 * Minimal HTTP helper. A gateway call is a financial operation: it gets a hard
 * timeout, its failure is normalised into a `GatewayError` carrying a
 * `retryable` flag, and its raw response is preserved for the transaction row so
 * a dispute can be settled from evidence rather than from memory.
 */
async function request(input: HttpRequest): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...input.headers,
      },
      body: input.body === undefined ? undefined : typeof input.body === 'string' ? input.body : JSON.stringify(input.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Some providers return HTML on a gateway-level failure; keep the raw text.
      parsed = text;
    }
    if (!response.ok) {
      throw new GatewayError({
        message: `Gateway responded ${response.status}`,
        code: 'GATEWAY_ERROR',
        // 5xx and 429 are worth retrying; 4xx is a request problem.
        retryable: response.status >= 500 || response.status === 429,
        provider: input.provider,
        httpStatus: response.status,
        providerErrorCode: extractErrorCode(parsed),
        raw: parsed,
      });
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new GatewayError({
      message: aborted ? 'Gateway request timed out' : `Gateway request failed: ${(error as Error).message}`,
      code: aborted ? 'GATEWAY_TIMEOUT' : 'GATEWAY_ERROR',
      // A timeout may have succeeded server-side; only an idempotent retry is safe.
      retryable: true,
      provider: input.provider,
      raw: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractErrorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === 'object') {
      const nested = error as Record<string, unknown>;
      if (typeof nested.code === 'string') return nested.code;
      if (typeof nested.reason === 'string') return nested.reason;
    }
    if (typeof record.code === 'string') return record.code;
    if (typeof record.message === 'string') return record.message;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

/** Providers express amounts in minor units; this is the one place that converts. */
function toMinorUnits(amount: Money, currency: string): number {
  const minorUnits = Money.fromString('1', currency).currency.minorUnits;
  const text = amount.round(minorUnits).toFixedString();
  return Math.round(Number(text) * 10 ** minorUnits);
}

function fromMinorUnits(amount: number, currency: string): Money {
  const minorUnits = Money.fromString('1', currency).currency.minorUnits;
  return Money.fromString((amount / 10 ** minorUnits).toFixed(minorUnits), currency);
}

function mapMethod(providerMethod: string | undefined): PaymentMethodKind | undefined {
  if (!providerMethod) return undefined;
  switch (providerMethod.toLowerCase()) {
    case 'card':
    case 'credit_card':
    case 'debit_card':
      return 'CARD';
    case 'upi':
    case 'intent':
      return 'UPI';
    case 'netbanking':
    case 'net_banking':
      return 'NETBANKING';
    case 'wallet':
      return 'WALLET';
    case 'bank_transfer':
    case 'banktransfer':
    case 'nach':
      return 'BANK_TRANSFER';
    case 'cash':
      return 'CASH';
    default:
      return 'OTHER';
  }
}

// =====================================================================================
// Razorpay
// =====================================================================================

export class RazorpayAdapter implements PaymentGatewayAdapter {
  readonly provider: GatewayProvider = 'RAZORPAY';
  readonly supportsOrderStatusVerification = true;
  readonly supportedMethods: readonly PaymentMethodKind[] = ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'INTERNATIONAL_CARD'];

  orderReferenceForStatusLookup(_orderNumber: string): string | null { return null; }

  private baseUrl(environment: string): string {
    return environment === 'LIVE' ? 'https://api.razorpay.com/v1' : 'https://api.razorpay.com/v1';
  }

  private auth(credentials: CreateOrderInput['credentials']): string {
    return `Basic ${Buffer.from(`${credentials.keyId}:${credentials.secret}`).toString('base64')}`;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders`,
      method: 'POST',
      headers: { authorization: this.auth(input.credentials) },
      provider: this.provider,
      body: {
        amount: toMinorUnits(input.amount, input.currency),
        currency: input.currency,
        receipt: input.orderNumber,
        notes: { ...input.notes, order_number: input.orderNumber },
        // Razorpay treats a repeated receipt with the same value as a duplicate.
        payment_capture: 1,
      },
    });
    const body = asRecord(response.body);
    const providerOrderId = asString(body.id);
    if (!providerOrderId) {
      throw new GatewayError({ message: 'Razorpay did not return an order id', code: 'GATEWAY_ERROR', provider: this.provider, raw: body });
    }
    return {
      providerOrderId,
      providerStatus: asString(body.status) ?? 'created',
      amount: input.amount,
      currency: input.currency,
      expiresAt: body.expire_by ? new Date(Number(body.expire_by) * 1000).toISOString() : undefined,
      checkout: {
        provider: this.provider,
        environment: input.credentials.environment,
        keyId: input.credentials.keyId,
        providerOrderId,
        amount: String(toMinorUnits(input.amount, input.currency)),
        currency: input.currency,
      },
      raw: body,
    };
  }

  async verifyOrderClosure(input: VerifyOrderClosureInput): Promise<VerifyOrderClosureResult> {
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders/${encodeURIComponent(input.providerOrderId)}`,
      method: 'GET',
      headers: { authorization: this.auth(input.credentials) },
      provider: this.provider,
    });
    const body = asRecord(response.body);
    const rawStatus = asString(body.status);
    const paymentsResponse = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders/${encodeURIComponent(input.providerOrderId)}/payments`,
      method: 'GET',
      headers: { authorization: this.auth(input.credentials) },
      provider: this.provider,
    });
    const paymentsBody = asRecord(paymentsResponse.body);
    const items = Array.isArray(paymentsBody.items) ? paymentsBody.items.map(asRecord) : [];
    const captured = items.filter((payment) => asString(payment.status) === 'captured');
    if (captured.length > 1) return { state: 'UNKNOWN', rawStatus: 'MULTIPLE_CAPTURED_PAYMENTS', raw: { order: body, capturedCount: captured.length } };
    const payment = captured[0];
    const currency = asString(payment?.currency ?? body.currency)?.toUpperCase();
    const capturedAmount = payment?.amount ?? body.amount_paid;
    const amountPaid = typeof capturedAmount === 'number' ? capturedAmount : Number(capturedAmount);
    if (payment && Number.isFinite(amountPaid) && amountPaid > 0) {
      return {
        state: 'CAPTURED', rawStatus: asString(payment.status), amount: currency ? fromMinorUnits(amountPaid, currency) : undefined,
        currency, providerPaymentId: asString(payment.id), providerTxnId: asString(payment.id), raw: { order: body, payment },
      };
    }
    // Razorpay documents created and attempted as non-terminal states. An old
    // local deadline is not proof that Razorpay has stopped accepting attempts.
    if (rawStatus === 'created' || rawStatus === 'attempted') return { state: 'PENDING', rawStatus, raw: body };
    return { state: 'UNKNOWN', rawStatus, raw: body };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    if (!input.providerSignature || !input.providerOrderId) {
      // Without the signature there is nothing to verify; the webhook is then the
      // only acceptable proof and the caller must wait for it.
      return { verified: false, status: 'CREATED', errorCode: 'GATEWAY_SIGNATURE_INVALID', errorMessage: 'Missing signature or order id' };
    }
    const verified = verifyRazorpayPaymentSignature({
      secret: input.credentials.secret,
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      signature: input.providerSignature,
    });
    if (!verified) {
      return { verified: false, status: 'FAILED', errorCode: 'GATEWAY_SIGNATURE_INVALID', errorMessage: 'Payment signature did not verify' };
    }
    // The signature proves authenticity; the status query is what proves capture.
    // Both are required, because a valid signature on an authorised-but-uncaptured
    // payment is not money in the bank.
    const status = await this.getPaymentStatus({
      credentials: input.credentials,
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
    });
    return {
      verified: status.status === 'CAPTURED',
      status: status.status,
      rawStatus: status.rawStatus,
      amount: status.amount,
      currency: status.currency,
      methodKind: status.methodKind,
      providerTxnId: status.providerTxnId,
      raw: status.raw,
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult> {
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/payments/${input.providerPaymentId}`,
      method: 'GET',
      headers: { authorization: this.auth(input.credentials) },
      provider: this.provider,
    });
    const body = asRecord(response.body);
    const currency = asString(body.currency)?.toUpperCase();
    const amount = body.amount && currency ? fromMinorUnits(Number(body.amount), currency) : undefined;
    const status = asString(body.status);
    return {
      status: status === 'captured' ? 'CAPTURED' : status === 'failed' ? 'FAILED' : status === 'refunded' ? 'REFUNDED' : 'AUTHORIZED',
      rawStatus: status,
      amount,
      currency,
      methodKind: mapMethod(asString(body.method)),
      providerTxnId: asString(body.id),
      // Razorpay reports its own fee on the payment object.
      gatewayFee: body.fee && currency ? fromMinorUnits(Number(body.fee), currency) : undefined,
      raw: body,
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/payments/${input.providerPaymentId}/refund`,
      method: 'POST',
      headers: { authorization: this.auth(input.credentials) },
      provider: this.provider,
      body: {
        amount: toMinorUnits(input.amount, input.currency),
        // Provider-side idempotency: a retried refund returns the same refund.
        receipt: input.refundNumber,
        notes: { ...input.notes, refund_number: input.refundNumber },
        speed: input.speed ?? 'normal',
      },
    });
    const body = asRecord(response.body);
    const providerRefundId = asString(body.id);
    if (!providerRefundId) {
      throw new GatewayError({ message: 'Razorpay did not return a refund id', code: 'GATEWAY_ERROR', provider: this.provider, raw: body });
    }
    const status = asString(body.status);
    return {
      providerRefundId,
      status: status === 'processed' ? 'REFUNDED' : status === 'failed' ? 'FAILED' : 'PARTIALLY_REFUNDED',
      rawStatus: status,
      amount: body.amount ? fromMinorUnits(Number(body.amount), input.currency) : input.amount,
      currency: input.currency,
      raw: body,
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookResult> {
    const signature = headerValue(input.headers, 'x-razorpay-signature');
    const webhookSecret = input.credentials.webhookSecret;
    if (!webhookSecret) {
      return { valid: false, status: 'UNKNOWN', error: 'No webhook secret configured', raw: null };
    }
    const valid = verifyRazorpayWebhookSignature({ webhookSecret, rawBody: input.rawBody, signature });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = asRecord(JSON.parse(input.rawBody));
    } catch {
      return { valid: false, status: 'UNKNOWN', error: 'Webhook body was not valid JSON', raw: null };
    }
    if (!valid) {
      return { valid: false, status: 'UNKNOWN', error: 'Signature did not verify', raw: parsed };
    }
    const payload = asRecord(parsed.payload);
    const payment = asRecord(asRecord(payload.payment).entity);
    const refund = asRecord(asRecord(payload.refund).entity);
    const eventType = asString(parsed.event);
    const status = mapRazorpayEvent(eventType);
    return {
      valid: true,
      externalEventId: asString(parsed.id) ?? `${eventType}:${asString(payment.id) ?? 'unknown'}`,
      eventType,
      providerOrderId: asString(payment.order_id),
      providerTxnId: asString(payment.id),
      providerPaymentId: asString(payment.id),
      providerRefundId: asString(refund.id),
      amount: payment.amount && asString(payment.currency) ? fromMinorUnits(Number(payment.amount), asString(payment.currency)!.toUpperCase()) : undefined,
      currency: asString(payment.currency)?.toUpperCase(),
      status,
      rawStatus: asString(payment.status),
      methodKind: mapMethod(asString(payment.method)),
      raw: parsed,
    };
  }
}

function mapRazorpayEvent(eventType: string | undefined): WebhookResult['status'] {
  switch (eventType) {
    case 'payment.captured':
    case 'order.paid':
      return 'CAPTURED';
    case 'payment.authorized':
      return 'AUTHORIZED';
    case 'payment.failed':
      return 'FAILED';
    case 'refund.processed':
      return 'REFUNDED';
    case 'refund.created':
    case 'refund.speed_changed':
      return 'PARTIALLY_REFUNDED';
    default:
      return 'UNKNOWN';
  }
}

// =====================================================================================
// Cashfree
// =====================================================================================

export class CashfreeAdapter implements PaymentGatewayAdapter {
  readonly provider: GatewayProvider = 'CASHFREE';
  readonly supportsOrderStatusVerification = true;
  readonly supportedMethods: readonly PaymentMethodKind[] = ['UPI', 'CARD', 'NETBANKING', 'WALLET'];

  orderReferenceForStatusLookup(orderNumber: string): string { return orderNumber; }

  private baseUrl(environment: string): string {
    return environment === 'LIVE' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  }

  private headers(credentials: CreateOrderInput['credentials']): Record<string, string> {
    return {
      'x-client-id': credentials.keyId,
      'x-client-secret': credentials.secret,
      'x-api-version': asString(credentials.extra?.apiVersion) ?? '2023-08-01',
    };
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders`,
      method: 'POST',
      headers: this.headers(input.credentials),
      provider: this.provider,
      body: {
        order_id: input.orderNumber,
        order_amount: Number(input.amount.round(2).toFixedString()),
        order_currency: input.currency,
        customer_details: {
          customer_id: input.customer?.id ?? `guest-${input.orderNumber}`,
          customer_name: input.customer?.name,
          customer_email: input.customer?.email,
          customer_phone: input.customer?.phone,
        },
        order_meta: input.returnUrl ? { return_url: input.returnUrl } : undefined,
        order_note: input.description,
      },
    });
    const body = asRecord(response.body);
    const providerOrderId = asString(body.order_id) ?? input.orderNumber;
    return {
      providerOrderId,
      providerStatus: asString(body.order_status) ?? 'ACTIVE',
      amount: input.amount,
      currency: input.currency,
      expiresAt: asString(body.order_expiry_time),
      checkout: {
        provider: this.provider,
        environment: input.credentials.environment,
        keyId: input.credentials.keyId,
        providerOrderId,
        amount: input.amount.round(2).toFixedString(),
        currency: input.currency,
        extra: { paymentSessionId: asString(body.payment_session_id) ?? '' },
      },
      raw: body,
    };
  }

  async verifyOrderClosure(input: VerifyOrderClosureInput): Promise<VerifyOrderClosureResult> {
    const headers = this.headers(input.credentials);
    const orderResponse = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders/${encodeURIComponent(input.providerOrderId)}`,
      method: 'GET', headers, provider: this.provider,
    });
    const order = asRecord(orderResponse.body);
    const orderStatus = asString(order.order_status);
    const paymentsResponse = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders/${encodeURIComponent(input.providerOrderId)}/payments`,
      method: 'GET', headers, provider: this.provider,
    });
    const paymentsBody = paymentsResponse.body;
    const attempts = Array.isArray(paymentsBody) ? paymentsBody.map(asRecord) : [];
    const successful = attempts.find((attempt) => asString(attempt.payment_status) === 'SUCCESS');
    if (successful) {
      const currency = asString(successful.payment_currency)?.toUpperCase();
      const amountValue = successful.payment_amount;
      let amount: Money | undefined;
      if (currency && amountValue !== undefined && amountValue !== null && Number.isFinite(Number(amountValue))) {
        amount = Money.fromString(String(amountValue), currency);
      }
      return {
        state: 'CAPTURED', rawStatus: asString(successful.payment_status), amount, currency,
        providerPaymentId: asString(successful.cf_payment_id), providerTxnId: asString(successful.cf_payment_id),
        raw: { order, payment: successful },
      };
    }
    if (attempts.some((attempt) => asString(attempt.payment_status) === 'PENDING')) {
      return { state: 'PENDING', rawStatus: orderStatus, raw: { order, attempts } };
    }
    if (orderStatus === 'EXPIRED' || orderStatus === 'TERMINATED') {
      return { state: 'TERMINAL', rawStatus: orderStatus, raw: { order, attempts } };
    }
    if (orderStatus === 'ACTIVE') return { state: 'PENDING', rawStatus: orderStatus, raw: { order, attempts } };
    return { state: 'UNKNOWN', rawStatus: orderStatus, raw: { order, attempts } };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    // Cashfree is webhook-first: a browser callback is treated as a hint, and the
    // authoritative status comes from a status query.
    const status = await this.getPaymentStatus({
      credentials: input.credentials,
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      providerRefundId: undefined,
    });
    return {
      verified: status.status === 'CAPTURED',
      status: status.status,
      rawStatus: status.rawStatus,
      amount: status.amount,
      currency: status.currency,
      methodKind: status.methodKind,
      providerTxnId: status.providerTxnId,
      raw: status.raw,
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult> {
    if (!input.providerPaymentId) {
      throw new GatewayError({ message: 'Cashfree status lookup needs a payment id', code: 'GATEWAY_ERROR', provider: this.provider });
    }
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders/${input.providerOrderId}/payments/${input.providerPaymentId}`,
      method: 'GET',
      headers: this.headers(input.credentials),
      provider: this.provider,
    });
    const body = asRecord(response.body);
    const rawStatus = asString(body.payment_status);
    const currency = asString(body.payment_currency)?.toUpperCase();
    return {
      status: rawStatus === 'SUCCESS' ? 'CAPTURED' : rawStatus === 'FAILED' ? 'FAILED' : rawStatus === 'USER_DROPPED' ? 'CANCELLED' : 'AUTHORIZED',
      rawStatus,
      amount: body.payment_amount && currency ? Money.fromString(String(body.payment_amount), currency) : undefined,
      currency,
      methodKind: mapMethod(asString(body.payment_group)),
      providerTxnId: asString(body.cf_payment_id) ?? input.providerPaymentId,
      raw: body,
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    const response = await request({
      url: `${this.baseUrl(input.credentials.environment)}/orders/${input.providerOrderId}/refunds`,
      method: 'POST',
      headers: this.headers(input.credentials),
      provider: this.provider,
      body: {
        refund_id: input.refundNumber,
        refund_amount: Number(input.amount.round(2).toFixedString()),
        refund_note: input.reason,
      },
    });
    const body = asRecord(response.body);
    const rawStatus = asString(body.refund_status);
    return {
      providerRefundId: asString(body.cf_refund_id) ?? input.refundNumber,
      status: rawStatus === 'SUCCESS' ? 'REFUNDED' : rawStatus === 'FAILED' ? 'FAILED' : 'PARTIALLY_REFUNDED',
      rawStatus,
      amount: input.amount,
      currency: input.currency,
      raw: body,
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookResult> {
    const webhookSecret = input.credentials.webhookSecret;
    if (!webhookSecret) return { valid: false, status: 'UNKNOWN', error: 'No webhook secret configured', raw: null };
    const valid = verifyCashfreeWebhookSignature({
      webhookSecret,
      timestamp: headerValue(input.headers, 'x-webhook-timestamp'),
      rawBody: input.rawBody,
      signature: headerValue(input.headers, 'x-webhook-signature'),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = asRecord(JSON.parse(input.rawBody));
    } catch {
      return { valid: false, status: 'UNKNOWN', error: 'Webhook body was not valid JSON', raw: null };
    }
    if (!valid) return { valid: false, status: 'UNKNOWN', error: 'Signature did not verify', raw: parsed };

    const data = asRecord(parsed.data);
    const order = asRecord(data.order);
    const payment = asRecord(data.payment);
    const refund = asRecord(data.refund);
    const eventType = asString(parsed.type);
    const rawStatus = asString(payment.payment_status);
    return {
      valid: true,
      externalEventId: asString(parsed.id) ?? `${eventType}:${asString(payment.cf_payment_id) ?? 'unknown'}`,
      eventType,
      providerOrderId: asString(order.order_id),
      providerTxnId: asString(payment.cf_payment_id),
      providerPaymentId: asString(payment.cf_payment_id),
      providerRefundId: asString(refund.cf_refund_id),
      amount: payment.payment_amount && asString(payment.payment_currency) ? Money.fromString(String(payment.payment_amount), asString(payment.payment_currency)!.toUpperCase()) : undefined,
      currency: asString(payment.payment_currency)?.toUpperCase(),
      status:
        eventType?.includes('REFUND')
          ? rawStatus === 'SUCCESS'
            ? 'REFUNDED'
            : 'PARTIALLY_REFUNDED'
          : rawStatus === 'SUCCESS'
            ? 'CAPTURED'
            : rawStatus === 'FAILED'
              ? 'FAILED'
              : 'UNKNOWN',
      rawStatus,
      methodKind: mapMethod(asString(payment.payment_group)),
      raw: parsed,
    };
  }
}

// =====================================================================================
// PayU
// =====================================================================================

export class PayuAdapter implements PaymentGatewayAdapter {
  readonly provider: GatewayProvider = 'PAYU';
  readonly supportsOrderStatusVerification = true;
  readonly supportedMethods: readonly PaymentMethodKind[] = ['UPI', 'CARD', 'NETBANKING', 'WALLET'];

  orderReferenceForStatusLookup(orderNumber: string): string { return orderNumber; }

  private baseUrl(environment: string): string {
    return environment === 'LIVE' ? 'https://info.payu.in/merchant/postservice.php?form=2' : 'https://test.payu.in/merchant/postservice.php?form=2';
  }

  private async verifyTransaction(credentials: VerifyOrderClosureInput['credentials'], txnId: string): Promise<{ root: Record<string, unknown>; transaction: Record<string, unknown>; rawStatus?: string }> {
    const command = 'verify_payment';
    const hash = sha512(`${credentials.keyId}|${command}|${txnId}|${credentials.secret}`);
    const body = new URLSearchParams({ key: credentials.keyId, command, var1: txnId, hash }).toString();
    const response = await request({
      url: this.baseUrl(credentials.environment),
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      provider: this.provider,
    });
    const root = asRecord(response.body);
    const transaction = asRecord(asRecord(root.transaction_details)[txnId]);
    return { root, transaction, rawStatus: asString(transaction.status) };
  }

  private capturedAmount(transaction: Record<string, unknown>, currency?: string): Money | undefined {
    const value = transaction.amt ?? transaction.transaction_amount ?? transaction.net_amount_debit;
    if (!currency || value === undefined || value === null || !Number.isFinite(Number(value))) return undefined;
    try {
      return Money.fromString(String(value), currency);
    } catch {
      return undefined;
    }
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    // PayU is a form-post integration: the "order" is a signed parameter set the
    // browser submits, so this method builds it rather than calling the API.
    const { buildPayuHash } = await import('./signatures');
    const txnId = input.orderNumber;
    const amount = input.amount.round(2).toFixedString();
    const productInfo = input.description ?? 'Fee payment';
    const firstName = input.customer?.name?.split(' ')[0] ?? 'Student';
    const email = input.customer?.email ?? '';
    const hash = buildPayuHash({
      key: input.credentials.keyId,
      salt: input.credentials.secret,
      txnId,
      amount,
      productInfo,
      firstName,
      email,
    });
    return {
      providerOrderId: txnId,
      providerStatus: 'CREATED',
      amount: input.amount,
      currency: input.currency,
      checkout: {
        provider: this.provider,
        environment: input.credentials.environment,
        keyId: input.credentials.keyId,
        providerOrderId: txnId,
        amount,
        currency: input.currency,
        extra: { hash, txnid: txnId, productinfo: productInfo, firstname: firstName, email, surl: input.returnUrl ?? '', furl: input.returnUrl ?? '' },
      },
      raw: { hash, txnId },
    };
  }

  async verifyOrderClosure(input: VerifyOrderClosureInput): Promise<VerifyOrderClosureResult> {
    // PayU's verify_payment API reconciles this txnid against the merchant's
    // records. A success proves capture; a failed attempt is not proof the
    // checkout transaction can no longer be retried, so it stays pending.
    const { root, transaction, rawStatus } = await this.verifyTransaction(input.credentials, input.providerOrderId);
    if (rawStatus?.toLowerCase() === 'success') {
      const amount = this.capturedAmount(transaction, input.currency);
      const providerPaymentId = asString(transaction.mihpayid);
      return { state: 'CAPTURED', rawStatus, amount, currency: input.currency, providerPaymentId, providerTxnId: providerPaymentId, raw: { status: root.status, transaction } };
    }
    if (['failure', 'pending', 'initiated', 'in progress'].includes(rawStatus?.toLowerCase() ?? '')) {
      return { state: 'PENDING', rawStatus, raw: { status: root.status, transaction } };
    }
    return { state: 'UNKNOWN', rawStatus, raw: { status: root.status, transaction } };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const { verifyPayuResponseHash } = await import('./signatures');
    const extra = asRecord(input.credentials.extra);
    const ok = verifyPayuResponseHash({
      key: input.credentials.keyId,
      salt: input.credentials.secret,
      txnId: input.providerOrderId ?? '',
      amount: String(extra.amount ?? '0'),
      productInfo: asString(extra.productInfo) ?? 'Fee payment',
      firstName: asString(extra.firstName) ?? 'Student',
      email: asString(extra.email) ?? '',
      udfs: asRecord(extra.udfs) as Record<string, string | undefined>,
      additionalCharges: asString(extra.additionalCharges),
      hash: input.providerSignature,
    });
    if (!ok) {
      return {
        verified: false,
        status: 'FAILED',
        errorCode: 'GATEWAY_SIGNATURE_INVALID',
        errorMessage: 'PayU response hash did not verify',
        providerTxnId: input.providerPaymentId,
      };
    }
    if (!input.providerOrderId) {
      return { verified: false, status: 'CREATED', rawStatus: 'MISSING_MERCHANT_TRANSACTION_ID', providerTxnId: input.providerPaymentId, errorCode: 'GATEWAY_STATUS_UNAVAILABLE', errorMessage: 'PayU status verification needs the merchant transaction id.' };
    }

    // A signed browser return is still only a callback. Confirm the capture
    // directly against PayU before reporting it as verified.
    const { root, transaction, rawStatus } = await this.verifyTransaction(input.credentials, input.providerOrderId);
    const currency = input.expectedAmount?.currency.code ?? asString(asRecord(input.credentials.extra).currency)?.toUpperCase();
    const amount = this.capturedAmount(transaction, currency);
    const captured = rawStatus?.toLowerCase() === 'success';
    const amountMatches = !input.expectedAmount || (!!amount && amount.equals(input.expectedAmount));
    const amountAvailable = !!amount;
    return {
      verified: captured && amountAvailable && amountMatches,
      status: captured ? 'CAPTURED' : ['failure'].includes(rawStatus?.toLowerCase() ?? '') ? 'FAILED' : 'CREATED',
      rawStatus,
      amount,
      currency,
      providerTxnId: asString(transaction.mihpayid) ?? input.providerPaymentId,
      errorCode: captured && !amountAvailable ? 'PAYMENT_AMOUNT_UNAVAILABLE' : captured && !amountMatches ? 'PAYMENT_AMOUNT_MISMATCH' : undefined,
      errorMessage: captured && !amountAvailable ? 'PayU confirmed the capture but its amount could not be interpreted using the configured currency.' : captured && !amountMatches ? 'PayU capture amount did not match the expected payment amount.' : undefined,
      raw: { callbackHashVerified: true, providerStatusResponse: { status: root.status, transaction } },
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult> {
    const txnId = input.providerOrderId;
    if (!txnId) throw new GatewayError({ message: 'PayU status lookup needs the merchant transaction id', code: 'GATEWAY_ERROR', provider: this.provider });
    const { root, transaction, rawStatus } = await this.verifyTransaction(input.credentials, txnId);
    const currency = asString(asRecord(input.credentials.extra).currency)?.toUpperCase();
    const normalized = rawStatus?.toLowerCase();
    return {
      status: normalized === 'success' ? 'CAPTURED' : normalized === 'failure' ? 'FAILED' : 'CREATED',
      rawStatus,
      amount: this.capturedAmount(transaction, currency),
      currency,
      providerTxnId: asString(transaction.mihpayid) ?? input.providerPaymentId,
      raw: { status: root.status, transaction },
    };
  }

  async refundPayment(): Promise<RefundResult> {
    throw new GatewayError({
      message: 'PayU refunds are initiated through the PayU dashboard or the postservice API with a merchant key; configure a manual refund for this tenant.',
      code: 'GATEWAY_ERROR',
      retryable: false,
      provider: this.provider,
    });
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookResult> {
    const params = new URLSearchParams(input.rawBody);
    const { verifyPayuResponseHash } = await import('./signatures');
    const hash = params.get('hash') ?? undefined;
    const valid =
      !!input.credentials.webhookSecret &&
      verifyPayuResponseHash({
        key: input.credentials.keyId,
        salt: input.credentials.webhookSecret,
        txnId: params.get('txnid') ?? '',
        amount: params.get('amount') ?? '0',
        productInfo: params.get('productinfo') ?? '',
        firstName: params.get('firstname') ?? '',
        email: params.get('email') ?? '',
        udfs: {
          udf1: params.get('udf1') ?? undefined,
          udf2: params.get('udf2') ?? undefined,
          udf3: params.get('udf3') ?? undefined,
          udf4: params.get('udf4') ?? undefined,
          udf5: params.get('udf5') ?? undefined,
        },
        status: params.get('status') ?? undefined,
        additionalCharges: params.get('additionalCharges') ?? undefined,
        hash,
      });
    const currency = params.get('currency')?.toUpperCase() || undefined;
    const amountValue = params.get('amount');
    return {
      valid,
      externalEventId: params.get('mihpayid') ?? params.get('txnid') ?? undefined,
      eventType: params.get('status') ?? undefined,
      providerOrderId: params.get('txnid') ?? undefined,
      providerTxnId: params.get('mihpayid') ?? undefined,
      providerPaymentId: params.get('mihpayid') ?? undefined,
      amount: amountValue && currency ? Money.fromString(amountValue, currency) : undefined,
      currency,
      status: params.get('status') === 'success' ? 'CAPTURED' : params.get('status') === 'failure' ? 'FAILED' : 'UNKNOWN',
      rawStatus: params.get('status') ?? undefined,
      error: valid ? undefined : 'Signature did not verify',
      raw: Object.fromEntries(params.entries()),
    };
  }
}

// =====================================================================================
// Stripe
// =====================================================================================

export class StripeAdapter implements PaymentGatewayAdapter {
  readonly provider: GatewayProvider = 'STRIPE';
  readonly supportsOrderStatusVerification = true;
  readonly supportedMethods: readonly PaymentMethodKind[] = ['CARD', 'INTERNATIONAL_CARD', 'WALLET'];

  orderReferenceForStatusLookup(_orderNumber: string): string | null { return null; }

  private baseUrl(): string {
    return 'https://api.stripe.com/v1';
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const form = new URLSearchParams();
    form.set('amount', String(toMinorUnits(input.amount, input.currency)));
    form.set('currency', input.currency.toLowerCase());
    form.set('description', input.description ?? `Fee payment ${input.orderNumber}`);
    form.set('metadata[order_number]', input.orderNumber);
    if (input.customer?.email) form.set('receipt_email', input.customer.email);

    const response = await request({
      url: `${this.baseUrl()}/payment_intents`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.credentials.secret}`,
        'content-type': 'application/x-www-form-urlencoded',
        // Stripe's idempotency key prevents a duplicate PaymentIntent on retry.
        ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
      },
      provider: this.provider,
      body: Object.fromEntries(form.entries()),
    });
    const body = asRecord(response.body);
    const providerOrderId = asString(body.id);
    if (!providerOrderId) {
      throw new GatewayError({ message: 'Stripe did not return a payment intent id', code: 'GATEWAY_ERROR', provider: this.provider, raw: body });
    }
    return {
      providerOrderId,
      providerStatus: asString(body.status) ?? 'requires_payment_method',
      amount: input.amount,
      currency: input.currency,
      checkout: {
        provider: this.provider,
        environment: input.credentials.environment,
        keyId: input.credentials.keyId,
        providerOrderId,
        amount: String(toMinorUnits(input.amount, input.currency)),
        currency: input.currency,
        extra: { clientSecret: asString(body.client_secret) ?? '' },
      },
      raw: body,
    };
  }

  async verifyOrderClosure(input: VerifyOrderClosureInput): Promise<VerifyOrderClosureResult> {
    const url = `${this.baseUrl()}/checkout/sessions/${encodeURIComponent(input.providerOrderId)}`;
    const headers = { authorization: `Bearer ${input.credentials.secret}` };
    let response = await request({ url, method: 'GET', headers, provider: this.provider });
    let body = asRecord(response.body);
    let status = asString(body.status);
    if (status === 'open') {
      // Stripe allows an open Checkout Session to be expired. If the expiry
      // call races with payment completion, reread authoritative state below.
      try {
        await request({ url: `${url}/expire`, method: 'POST', headers, provider: this.provider });
      } catch {
        // A failed expiry response is ambiguous; the second GET decides whether
        // the session was paid, expired, or remains open.
      }
      response = await request({ url, method: 'GET', headers, provider: this.provider });
      body = asRecord(response.body);
      status = asString(body.status);
    }
    const paymentStatus = asString(body.payment_status);
    const currency = asString(body.currency)?.toUpperCase();
    const amountTotal = body.amount_total;
    const paymentIntent = body.payment_intent;
    const paymentId = typeof paymentIntent === 'string' ? paymentIntent : asString(asRecord(paymentIntent).id);
    if (status === 'complete' && paymentStatus === 'paid') {
      return {
        state: 'CAPTURED', rawStatus: `${status}:${paymentStatus}`,
        amount: currency && amountTotal !== undefined && amountTotal !== null && Number.isFinite(Number(amountTotal))
          ? fromMinorUnits(Number(amountTotal), currency) : undefined,
        currency, providerPaymentId: paymentId, providerTxnId: paymentId ?? input.providerOrderId, raw: body,
      };
    }
    if (status === 'expired') return { state: 'TERMINAL', rawStatus: status, raw: body };
    const rawStatus = status ? `${status}:${paymentStatus ?? 'unknown'}` : undefined;
    if (status === 'open' || (status === 'complete' && paymentStatus === 'unpaid')) return { state: 'PENDING', rawStatus, raw: body };
    return { state: 'UNKNOWN', rawStatus, raw: body };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const status = await this.getPaymentStatus({
      credentials: input.credentials,
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
    });
    return {
      verified: status.status === 'CAPTURED',
      status: status.status,
      rawStatus: status.rawStatus,
      amount: status.amount,
      currency: status.currency,
      methodKind: status.methodKind,
      providerTxnId: status.providerTxnId,
      raw: status.raw,
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult> {
    const id = input.providerPaymentId ?? input.providerOrderId;
    if (!id) throw new GatewayError({ message: 'Stripe status lookup needs an id', code: 'GATEWAY_ERROR', provider: this.provider });
    const response = await request({
      url: `${this.baseUrl()}/payment_intents/${id}`,
      method: 'GET',
      headers: { authorization: `Bearer ${input.credentials.secret}` },
      provider: this.provider,
    });
    const body = asRecord(response.body);
    const rawStatus = asString(body.status);
    const currency = asString(body.currency)?.toUpperCase();
    return {
      status: rawStatus === 'succeeded' ? 'CAPTURED' : rawStatus === 'canceled' ? 'CANCELLED' : 'AUTHORIZED',
      rawStatus,
      amount: body.amount && currency ? fromMinorUnits(Number(body.amount), currency) : undefined,
      currency,
      providerTxnId: asString(body.latest_charge) ?? asString(body.id),
      raw: body,
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    const form = new URLSearchParams();
    form.set('payment_intent', input.providerPaymentId);
    form.set('amount', String(toMinorUnits(input.amount, input.currency)));
    form.set('metadata[refund_number]', input.refundNumber);

    const response = await request({
      url: `${this.baseUrl()}/refunds`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.credentials.secret}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': input.refundNumber,
      },
      provider: this.provider,
      body: Object.fromEntries(form.entries()),
    });
    const body = asRecord(response.body);
    const rawStatus = asString(body.status);
    return {
      providerRefundId: asString(body.id) ?? input.refundNumber,
      status: rawStatus === 'succeeded' ? 'REFUNDED' : rawStatus === 'failed' ? 'FAILED' : 'PARTIALLY_REFUNDED',
      rawStatus,
      amount: body.amount ? fromMinorUnits(Number(body.amount), input.currency) : input.amount,
      currency: input.currency,
      raw: body,
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookResult> {
    const webhookSecret = input.credentials.webhookSecret;
    if (!webhookSecret) return { valid: false, status: 'UNKNOWN', error: 'No webhook secret configured', raw: null };
    const valid = verifyStripeWebhookSignature({
      webhookSecret,
      rawBody: input.rawBody,
      header: headerValue(input.headers, 'stripe-signature'),
    });
    let parsed: Record<string, unknown> = {};
    try {
      parsed = asRecord(JSON.parse(input.rawBody));
    } catch {
      return { valid: false, status: 'UNKNOWN', error: 'Webhook body was not valid JSON', raw: null };
    }
    if (!valid) return { valid: false, status: 'UNKNOWN', error: 'Signature did not verify', raw: parsed };

    const object = asRecord(asRecord(parsed.data).object);
    const eventType = asString(parsed.type);
    const rawStatus = asString(object.status);
    const currency = asString(object.currency)?.toUpperCase();
    return {
      valid: true,
      externalEventId: asString(parsed.id),
      eventType,
      providerOrderId: asString(object.id),
      providerTxnId: asString(object.latest_charge) ?? asString(object.id),
      providerPaymentId: asString(object.id),
      amount: object.amount && currency ? fromMinorUnits(Number(object.amount), currency) : undefined,
      currency,
      status:
        eventType === 'charge.refunded' || eventType === 'refund.updated'
          ? 'REFUNDED'
          : eventType === 'payment_intent.succeeded'
            ? 'CAPTURED'
            : eventType === 'payment_intent.payment_failed'
              ? 'FAILED'
              : eventType === 'payment_intent.canceled'
                ? 'CANCELLED'
                : 'UNKNOWN',
      rawStatus,
      raw: parsed,
    };
  }
}

// =====================================================================================
// Mock - for automated tests and local sandboxing
// =====================================================================================

export interface MockGatewayOptions {
  /** Forces every operation to this outcome. */
  forcedStatus?: 'CAPTURED' | 'FAILED' | 'AUTHORIZED' | 'CANCELLED' | 'EXPIRED';
  /** Simulates a provider outage. */
  throwOnCreate?: GatewayError;
  /** Overrides the refund outcome. */
  forcedRefundStatus?: 'REFUNDED' | 'FAILED' | 'PARTIALLY_REFUNDED';
}

/**
 * Deterministic in-memory gateway.
 *
 * Automated tests never call a real provider. This adapter can be driven to
 * every terminal state, including the two that are hardest to reproduce against
 * a live sandbox: an invalid signature and a duplicate webhook.
 */
export class MockGatewayAdapter implements PaymentGatewayAdapter {
  readonly provider: GatewayProvider = 'MOCK';
  readonly supportsOrderStatusVerification = false;
  readonly supportedMethods: readonly PaymentMethodKind[] = ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH'];

  orderReferenceForStatusLookup(_orderNumber: string): string | null { return null; }

  private readonly orders = new Map<string, { amount: Money; currency: string; status: string }>();

  constructor(private readonly options: MockGatewayOptions = {}) {}

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (this.options.throwOnCreate) throw this.options.throwOnCreate;
    const providerOrderId = `mock_order_${input.orderNumber}`;
    this.orders.set(providerOrderId, { amount: input.amount, currency: input.currency, status: 'created' });
    return {
      providerOrderId,
      providerStatus: 'created',
      amount: input.amount,
      currency: input.currency,
      checkout: {
        provider: this.provider,
        environment: input.credentials.environment,
        keyId: input.credentials.keyId,
        providerOrderId,
        amount: input.amount.round(2).toFixedString(),
        currency: input.currency,
      },
      raw: { id: providerOrderId, status: 'created' },
    };
  }

  async verifyOrderClosure(_input: VerifyOrderClosureInput): Promise<VerifyOrderClosureResult> {
    // The API service creates mock provider orders using its own deterministic
    // reference. The process-local map is not authoritative across workers.
    return { state: 'UNKNOWN', rawStatus: 'MOCK_STATE_NOT_PERSISTED' };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const status = this.options.forcedStatus ?? 'CAPTURED';
    return {
      verified: status === 'CAPTURED',
      status,
      amount: input.expectedAmount,
      providerTxnId: input.providerPaymentId,
      methodKind: 'UPI',
    };
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<PaymentStatusResult> {
    return {
      status: this.options.forcedStatus ?? 'CAPTURED',
      rawStatus: this.options.forcedStatus ?? 'captured',
      providerTxnId: input.providerPaymentId,
      gatewayFee: Money.fromString('2', input.credentials.environment === 'TEST' ? 'INR' : 'INR'),
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
    return {
      providerRefundId: `mock_refund_${input.refundNumber}`,
      status: this.options.forcedRefundStatus ?? 'REFUNDED',
      amount: input.amount,
      currency: input.currency,
      raw: { id: `mock_refund_${input.refundNumber}` },
    };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<WebhookResult> {
    const signature = headerValue(input.headers, 'x-mock-signature');
    const secret = input.credentials.webhookSecret ?? 'mock-webhook-secret';
    const { hmacSha256Hex } = await import('./signatures');
    const expected = hmacSha256Hex(secret, input.rawBody);
    const valid = !!signature && signature === expected;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = asRecord(JSON.parse(input.rawBody));
    } catch {
      return { valid: false, status: 'UNKNOWN', error: 'Webhook body was not valid JSON', raw: null };
    }
    if (!valid) return { valid: false, status: 'UNKNOWN', error: 'Signature did not verify', raw: parsed };
    const currency = asString(parsed.currency)?.toUpperCase();
    return {
      valid: true,
      externalEventId: asString(parsed.event_id),
      eventType: asString(parsed.event_type),
      providerOrderId: asString(parsed.order_id),
      providerTxnId: asString(parsed.payment_id),
      providerPaymentId: asString(parsed.payment_id),
      providerRefundId: asString(parsed.refund_id),
      amount: parsed.amount && currency ? Money.fromString(String(parsed.amount), currency) : undefined,
      currency,
      status: (asString(parsed.status) as WebhookResult['status']) ?? 'UNKNOWN',
      rawStatus: asString(parsed.status),
      raw: parsed,
    };
  }

  /** Builds a correctly signed webhook body, so tests exercise the real verifier. */
  static buildSignedWebhook(
    payload: Record<string, unknown>,
    secret = 'mock-webhook-secret',
  ): { rawBody: string; headers: Record<string, string> } {
    // Imported lazily to keep this helper side-effect free at module load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    return { rawBody, headers: { 'x-mock-signature': signature } };
  }
}

// =====================================================================================

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lowered = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowered) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}
