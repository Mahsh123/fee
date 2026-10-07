# PAY-004: Gateway orders and webhooks

## Architecture source

The architecture requires gateway adapters, payment orders distinct from confirmed payments, encrypted tenant secrets, webhook signature verification, duplicate protection, provider event storage, safe retries, state transitions, and transactional financial posting.

## Domain rules

- Tenant secrets are encrypted at rest and never returned; API responses expose only masked key IDs and configured flags.
- A payment order is an intent. It does not create a payment, receipt, allocation, or ledger entry until a verified provider success event reports a usable amount and currency.
- A verified provider capture remains money received even if the local order expired or previously failed. It must be posted once as a payment with balanced ledger evidence; unresolved allocation or payer identity stays as an explicit liability/reconciliation case rather than being discarded or marked resolved without accounting evidence.
- Gateway selection follows the payment method's preferred gateway, supported methods, amount limits, active environment, and configured priority.
- Webhooks are associated using tenant URL scope plus gateway configuration ID, verified against raw bytes before storage, and deduplicated by signature-covered event identity within tenant, provider, and gateway environment. Unsigned event-ID headers are ignored, and an event key cannot be reused with a different JSON payload. Invalid signatures are structured-logged without storing provider-controlled event IDs or payloads.
- Provider callbacks never select a tenant from payload data. The configured webhook URL and signature determine the tenant and provider.

## Database changes

Add an optional tenant-equality `PaymentOrder.methodId` relation so each order preserves the selected tenant-defined online payment method. This additive migration leaves existing orders intact.

## Acceptance criteria

- Order creation is idempotent and stores provider correlation separately from payment facts.
- Invalid signatures cannot create webhook rows or change payments; an invalid callback cannot reserve a provider-controlled event ID and suppress a later valid event.
- Duplicate valid events do not duplicate payment, receipt, allocation, or ledger entries.
- Success events must match the order's amount, currency, tenant, and state.
- Secrets are encrypted using the configured key and never serialized in API responses or logs.
- Manual payments remain independent from provider adapters.
- Overdue provider checks require `payment.verify`, use the order's tenant-scoped encrypted gateway configuration, and append the actor/provider result to audit history.
- Pending, failed-attempt, unknown, timeout, and ambiguous states retain the existing reservation; only a captured result or explicit provider-terminal result changes the financial lifecycle.
- Overdue non-MOCK orders with provider correlation are checked automatically using durable per-order leases, configurable polling/backoff limits, and the same capture/terminal-state transaction path as manual checks; exhaustion never releases the reservation.
- Provider-verified captures and signed webhook captures share one transactionally idempotent payment, allocation, ledger, and receipt path.
- The finance UI exposes the overdue-order check and clearly reports whether evidence is pending, captured, or terminal.

**Implementation status: in progress; consolidated tests and independent reviews are deferred until the backend/frontend batch is assembled.** Same-currency captures that arrive after local failure/expiry, have an amount mismatch, or cannot be safely allocated are persisted as a confirmed payment, receipt, and balanced posting to the tenant's `UNAPPLIED_GATEWAY_RECEIPTS` liability account, with an open reconciliation record. A reconciliation operator can transfer this liability to student-credit liability with an audited reason; the existing credit workflow can then apply it to open demands. The captured amount is preserved as the payment amount; demand balances are not guessed while the capture is held. A verified event with missing/invalid amount or incompatible currency remains open with raw signed event evidence and is not booked using the order's intended amount. The provider status contract and tenant-scoped finance action are now implemented: Stripe retrieves and expires an open Checkout Session, Cashfree checks the order and its payment attempts, Razorpay retrieves captured payment identity/amount while keeping created/attempted orders pending, and PayU queries `verify_payment` to confirm captures. PayU has no proven terminal-order response in this integration; failed attempts therefore keep reservations held. Verified captures reuse the webhook's payment/receipt/ledger posting path. MOCK remains unknown because this deployment does not persist API-created mock orders; unknown/pending results keep reservations held. The Payments screen exposes the manual check for overdue orders to users with `payment.read` and `payment.verify`. Consolidated automated tests and resolution of incompatible-currency/unusable-amount cases remain open; see [the provider expiry and late-capture architecture issue](../docs/architecture/decisions/20261003-provider-expiry-and-late-capture.md). Reconciliation refuses to close captured-payment exceptions until the gateway suspense liability is cleared and tenant-scoped payment and ledger evidence exist.

API reads no longer mark an order `EXPIRED` solely because its local `expiresAt` passed, and active payment reservations remain in force until the provider confirms a terminal state or a capture is recorded. A failed payment attempt does not fail its whole provider order. Ambiguous provider-create responses are stored as pending, audited, and emitted for provider-status reconciliation so a timeout cannot silently release the reservation. Adapters can now expose a merchant-assigned lookup reference before checkout creation completes; that reference is stored with the provider transaction so a timeout can be reconciled by Cashfree/PayU without guessing a provider-generated ID. Adapters that cannot provide a stable early reference keep the reservation pending for their supported follow-up path. Manual status checks append tenant-scoped audit evidence; provider request failures remain unknown and held. An API-resident modular-monolith scheduler now scans overdue online orders and reuses the same verified provider-check/payment-posting path. Durable per-order leases coordinate API replicas; scheduled checks use configurable exponential backoff and stop after a configurable attempt limit, while manual checks remain available. Adapters declare whether server-to-server order status checks are supported; unsupported adapters are excluded from automatic polling. Pending/unknown, PayU failed-attempt, and unresolved capture-evidence cases continue to hold reservations and require provider confirmation or an operator workflow; no local timeout releases money responsibility. The scheduler and the expanded payment UI are assembled but remain untested and unreviewed until the consolidated backend/frontend gate.

The scheduler's placement, retry controls, lease behavior, and future extraction path are documented in [the provider-status scheduler decision](../docs/architecture/decisions/20261003-provider-status-scheduler-placement.md).
