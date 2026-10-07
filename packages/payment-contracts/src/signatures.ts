import { createHash, createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/**
 * Signature verification.
 *
 * The frontend callback is never trusted: a browser can post anything. The only
 * evidence that money actually moved is a provider-signed webhook, verified
 * against the tenant's own webhook secret.
 *
 * All comparisons are constant-time. A byte-by-byte comparison leaks how much of
 * a forged signature was correct, which is enough to forge one incrementally.
 */

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacSha256Base64(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

/**
 * A bare SHA-512 digest (no HMAC) over a salted concatenation. PayU signs this
 * way, which is weaker than an HMAC but is what the provider expects.
 */
export function sha512(input: string): string {
  return createHash('sha512').update(input).digest('hex');
}

/** Constant-time string comparison that tolerates unequal lengths. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Still perform a comparison so the timing does not reveal the length check.
    nodeTimingSafeEqual(bufferA, bufferA);
    return false;
  }
  return nodeTimingSafeEqual(bufferA, bufferB);
}

function normaliseSignature(signature: string | undefined): string {
  return (signature ?? '').trim().replace(/^sha256=/i, '');
}

// ---------------------------------------------------------------------------
// Razorpay
// ---------------------------------------------------------------------------

/**
 * Checkout handler verification: `HMAC_SHA256(order_id + "|" + payment_id)`.
 * This is what proves the browser's success callback came from Razorpay.
 */
export function verifyRazorpayPaymentSignature(input: {
  secret: string;
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}): boolean {
  const expected = hmacSha256Hex(input.secret, `${input.providerOrderId}|${input.providerPaymentId}`);
  return timingSafeEqualStrings(expected, normaliseSignature(input.signature));
}

/** Webhook verification: `HMAC_SHA256(rawBody)` against the `X-Razorpay-Signature` header. */
export function verifyRazorpayWebhookSignature(input: {
  webhookSecret: string;
  rawBody: string | Buffer;
  signature: string | undefined;
}): boolean {
  if (!input.signature) return false;
  const expected = hmacSha256Hex(input.webhookSecret, input.rawBody);
  return timingSafeEqualStrings(expected, normaliseSignature(input.signature));
}

// ---------------------------------------------------------------------------
// Cashfree
// ---------------------------------------------------------------------------

/** `base64(HMAC_SHA256(timestamp + rawBody))` against `x-webhook-signature`. */
export function verifyCashfreeWebhookSignature(input: {
  webhookSecret: string;
  timestamp: string | undefined;
  rawBody: string | Buffer;
  signature: string | undefined;
}): boolean {
  if (!input.signature || !input.timestamp) return false;
  const expected = hmacSha256Base64(input.webhookSecret, `${input.timestamp}${input.rawBody.toString()}`);
  return timingSafeEqualStrings(expected, input.signature.trim());
}

// ---------------------------------------------------------------------------
// PayU
// ---------------------------------------------------------------------------

/**
 * PayU's reverse hash: `SHA512(key|txnid|amount|productinfo|firstname|email|...|salt)`.
 * Underscore-separated UDF fields must be contributed in order, with a blank for
 * any that are absent - omitting a blank silently changes the digest.
 */
export function buildPayuHash(input: {
  key: string;
  salt: string;
  txnId: string;
  amount: string;
  productInfo: string;
  firstName: string;
  email: string;
  udfs?: Record<string, string | undefined>;
  status?: string;
  additionalCharges?: string;
  /** PayU's own fields are concatenated in a fixed order; overrides for tests. */
  order?: readonly string[];
}): string {
  const udfValues = ['udf1', 'udf2', 'udf3', 'udf4', 'udf5'].map((name) => input.udfs?.[name] ?? '');
  const segments =
    input.order ??
    [
      input.key,
      input.txnId,
      input.amount,
      input.productInfo,
      input.firstName,
      input.email,
      ...udfValues,
      ...(input.status ? [input.status] : []),
      ...(input.additionalCharges ? [input.additionalCharges] : []),
    ];
  return sha512([...segments, input.salt].join('|'));
}

export function verifyPayuResponseHash(input: Parameters<typeof buildPayuHash>[0] & { hash: string | undefined }): boolean {
  if (!input.hash) return false;
  return timingSafeEqualStrings(buildPayuHash(input).toLowerCase(), input.hash.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

export interface StripeSignatureParts {
  timestamp?: string;
  signatures: string[];
}

/** Parses `t=1492774577,v1=5257a86...,v0=...` from the `stripe-signature` header. */
export function parseStripeSignatureHeader(header: string | undefined): StripeSignatureParts {
  const parts: StripeSignatureParts = { signatures: [] };
  if (!header) return parts;
  for (const segment of header.split(',')) {
    const [key, value] = segment.split('=');
    if (!key || value === undefined) continue;
    if (key.trim() === 't') parts.timestamp = value.trim();
    else if (key.trim() === 'v1') parts.signatures.push(value.trim());
  }
  return parts;
}

/**
 * Stripe signs `timestamp + "." + rawBody`, then compares against every `v1`
 * value. `toleranceSeconds` rejects a replayed old payload; the default of five
 * minutes matches Stripe's own recommendation.
 */
export function verifyStripeWebhookSignature(input: {
  webhookSecret: string;
  rawBody: string | Buffer;
  header: string | undefined;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean {
  const parsed = parseStripeSignatureHeader(input.header);
  if (!parsed.timestamp || parsed.signatures.length === 0) return false;

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - timestampSeconds) > tolerance) return false;

  const expected = hmacSha256Hex(input.webhookSecret, `${parsed.timestamp}.${input.rawBody.toString()}`);
  return parsed.signatures.some((candidate) => timingSafeEqualStrings(expected, candidate));
}
