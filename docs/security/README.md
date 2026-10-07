# Security

## Authentication

| Property | Implementation |
|---|---|
| Credentials | bcrypt, cost 12, compared in constant time |
| Access token | JWT, 15 minutes, carries tenant, roles and permissions |
| Refresh token | opaque 48-byte random string, stored as SHA-256, rotated on every use |
| Session revocation | refresh token marked revoked; reuse of a revoked token is recorded as `CRITICAL` |
| Lockout | 8 failed attempts locks the account for 15 minutes |

Sign-in is tenant-scoped by institution slug, because the same person may legitimately
hold accounts at two institutions and must not be able to collide into the wrong one.

Failed sign-in returns one generic message whether the tenant, the email or the password
was wrong, and a dummy bcrypt comparison runs on the not-found path so response timing
does not reveal whether an account exists.

Refresh tokens are high-entropy random values, not passwords, so SHA-256 is the correct
storage hash: bcrypt's cost would be pure latency at no security gain.

Passwords use bcrypt because the input is low-entropy and a slow hash is the defence.

## Authorisation

Permissions are granular and explicitly separate acts that look similar:

```
fee.update          correct a fee name
fee.approve         approve a waiver
payment.collect     take money at a counter
payment.refund      return money
payment.refund.approve   authorise a large refund someone else requested
```

The full catalogue is in `packages/types/src/permissions.ts`, grouped for the role editor
UI. Default role matrices are seeded per tenant from `DEFAULT_ROLE_PERMISSIONS` and then
editable, which is what makes "a collection clerk does not need the reconciliation
ledger on their phone" a configuration choice rather than a code change.

Permissions are resolved from the database at sign-in and embedded in the access token,
so request authorisation costs no query. They are re-resolved on every refresh, which
bounds how long a revoked permission survives to one access-token lifetime.

Authentication is registered **globally**, and a route opts out with `@Public()`. The
opposite convention - opt in per route - makes an unauthenticated endpoint the result of
forgetting something.

## Tenant isolation

Described in full in `docs/database/README.md`. The short version: the tenant comes from
a signed claim, is pinned in an `AsyncLocalStorage` scope for the request, and the scope
throws rather than returning `undefined`. A service that forgets to scope a query fails
loudly instead of reading another institution's data.

## Secrets

Two distinct categories, handled differently.

**Gateway credentials** (key id, secret, webhook secret) are tenant data, stored
encrypted with **AES-256-GCM**, a fresh 96-bit nonce per value, and authenticated so
tampering surfaces as a decryption failure rather than a wrong secret. The only
representation that may leave the API is a mask:

```
••••••••••••4f2a
```

Enough to recognise which key is loaded, not enough to use it. A secret is decrypted
only inside the adapter call that needs it.

**Platform secrets** (JWT signing keys, the encryption key) come from the environment and
are never stored in the database, never logged and never returned. `ENCRYPTION_KEY` must
be 32 bytes; a 64-character hex string is used raw, anything else is hashed to 32 bytes so
a short key cannot be deployed by accident.

Log redaction is configured for `authorization`, `password`, `secret`, `token`,
`refreshToken`, `secretCiphertext` and `webhookSecretCiphertext`.

## Webhook verification

Provider confirmation is the only trusted proof of payment capture. Webhooks are verified
properly, and overdue-order checks use server-side provider credentials from that tenant's
gateway configuration:

- signature computed over the **raw body**, never a re-serialised object;
- compared in **constant time**;
- Stripe's timestamp tolerance rejects replay;
- a signed-body event id (or a fingerprint derived from the verified signature/payload)
  is deduplicated per tenant, provider, and gateway environment;
- callback event-ID headers are not trusted unless covered by the provider signature;
- repeated verified event IDs must have the same stored JSON payload before processing;
- unsigned or badly signed events are structured-logged and rejected before any webhook
  row is written, so an attacker cannot reserve a provider event ID.

## Transport and headers

Helmet with `contentSecurityPolicy` disabled at the API (the API serves JSON, not HTML)
and `crossOriginResourcePolicy: same-site` so branded documents can be embedded by the
tenant's own origin. The proxy adds HSTS, `X-Content-Type-Options`, `X-Frame-Options:
DENY` and `Referrer-Policy`. `server_tokens off` removes the nginx version.

CORS is an explicit allow-list from `CORS_ORIGINS`, with credentials enabled and the
request-id header exposed.

## Rate limiting

| Surface | Budget | Why |
|---|---|---|
| `/auth/login` | 10/min per address | bounded credential guessing |
| `/api/*` | 30/s per address | normal API traffic |
| `/api/v1/webhooks/*` | 50/s per address | generous on purpose: the provider is not an attacker, and throttling a redelivery storm loses payment events |

The webhook budget exists only to bound an unbounded flood, not to police a provider.
The guard depends on a `RateLimitStore` interface so the in-process implementation can be
swapped for the Redis-backed one in a multi-instance deployment.

## Financial integrity as a security property

Some of the most damaging "attacks" on a fee platform are not intrusions:

| Attack | Defence |
|---|---|
| replayed payment callback | webhook signature verification + event id uniqueness |
| double collection from a retried request | idempotency keys with a unique constraint |
| two clerks collecting the same balance | serializable transactions + `SELECT … FOR UPDATE` + balance revalidation |
| tampering with gateway credentials | AES-256-GCM authenticated encryption |
| editing history to hide a waiver | hash-chained audit log + immutable financial rows |
| privilege escalation to refund | `payment.refund` and `payment.refund.approve` are separate permissions, plus a tenant threshold |

## What is deliberately not done

- **No session in a cookie.** The API is token-based; CSRF is not applicable to a
  `Bearer`-authenticated JSON API. If a cookie-based session is ever added, CSRF tokens
  become mandatory and this section must change.
- **No secrets in the frontend.** `packages/types` contains enums and contracts only.
- **No stack traces in production responses.** `GlobalExceptionFilter` emits a code, a
  message and a request id; the trace goes to the log line that the request id joins to.
