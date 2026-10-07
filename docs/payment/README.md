# Payment lifecycle

Payment is independent of fee calculation. Nothing about how a student pays should be
able to change what they owe, and nothing about what they owe should depend on which
gateway happened to be selected.

```
Fee demand              what is owed
   ↓
Payment order           intent to pay, gateway-agnostic
   ↓
Gateway selection       method routing, default, fallback
   ↓
Gateway transaction     provider's own record
   ↓
Webhook / provider check authoritative confirmation
   ↓
Payment                 immutable record of money received
   ↓
Allocation              which demand items it settled
   ↓
Ledger                  balanced double entry
   ↓
Receipt                 snapshot document, numbered in-transaction
   ↓
Settlement              gateway → bank, reconciled later
```

## Status is two separate things

A gateway transaction has a status and a fee demand has a status, and they are never the
same field:

```
Gateway payment = SUCCESS
Fee demand      = PARTIALLY_PAID
```

The demand's status is **derived** from its own amounts (`deriveDemandStatus`), so it can
never drift from the numbers. Every code path that moves money ends with the same status
function.

## Payment status machine

```
CREATED ──▶ INITIATED ──▶ PENDING ──▶ PROCESSING ──▶ SUCCESS ──▶ REFUND_PENDING
   │            │            │             │             │              │
   │            │            │             │             │              ▼
   ▼            ▼            ▼             ▼             │      PARTIALLY_REFUNDED
FAILED       CANCELLED    EXPIRED       FAILED          │              │
   │                                                    │              ▼
   └──────────────▶ SUCCESS (late capture)              └──────▶  REFUNDED
```

Two transitions are permissive on purpose:

- **`FAILED → SUCCESS`**: a bank can confirm a capture after the gateway's synchronous
  response said the attempt failed. Rejecting it would force an operator to edit history
  by hand, which is strictly worse.
- **`PAID → PARTIALLY_PAID` for a demand**: a refund or credit reversal legitimately
  re-opens a settled demand. It is never done by changing an amount.

Everything else is rejected. `REFUNDED → SUCCESS` and `CANCELLED → SUCCESS` do not exist.

## Webhooks: never trust the browser

The frontend callback is a hint. A browser can `POST` anything, and a user who has just
paid is the least likely person to have a trustworthy connection. Payment is posted only
after a provider-signed webhook or a server-side provider status response confirms capture.
For an overdue order, a finance user with `payment.verify` can request that authoritative
check; a local deadline and browser return never release a reservation.

```
POST /api/v1/webhooks/{provider}
   ↓
verify signature   over the RAW body, constant-time comparison
   ↓
derive signed event identity; unique verified key (tenantId, provider, environment, externalEventId)
   ↓
store raw event    written before processing, so a crash cannot lose it
   ↓
process            in a serializable transaction
   ↓
allocate + ledger + receipt
```

Three details that decide whether this works under real traffic:

1. **The raw body is signed.** Re-serialising JSON changes byte order and whitespace and
   invalidates the HMAC. The proxy streams webhook bodies untouched and the handler
   verifies bytes, never a parsed object.
2. **Invalid events are rejected before storage.** Only a verified callback is stored;
   unsigned event-ID headers do not choose the deduplication key.
3. **The event is stored before it is processed.** If the handler crashes, the verified
   raw event is still on disk and can be replayed; a handler that stores afterwards loses
   events it did not finish.
4. **Constants are compared in constant time.** A byte-by-byte comparison leaks how much
   of a forged signature was correct, which is enough to forge one incrementally.

### Idempotency, concretely

Providers redeliver. The same webhook arriving three times must not become three
payments. The guarantee is a database unique constraint, not application logic:

```
Request 1  → verified key inserted   → process  → PROCESSED
Request 2  → same key + same payload → DUPLICATE, no side effects
Request 3  → same key + changed payload → CONFLICT, no processing
```

The same pattern protects HTTP endpoints through `idempotency_keys`, keyed on
`(tenantId, scope, key)`. A replay with a *different* payload is rejected rather than
answered with a cached response, because returning the wrong answer is worse than
returning an error.

## Allocation

A payment and a demand item are separate records. One payment may settle many items, and
one item may be paid by many payments.

```
Outstanding:
  Tuition     20,000.00
  Hostel      15,000.00
  Exam         2,000.00
                     -----
  Total       37,000.00

Student pays 10,000.00

Allocation (waterfall, oldest due date first):
  Tuition     10,000.00
```

Waterfall order is tenant policy; `TARGETED` honours the payer's explicit choice;
`PROPORTIONAL` splits by outstanding weight. Proportional splits use largest-remainder
allocation, so the parts always sum to exactly the payment - a percentage-based split of
₹100 three ways cannot lose a paisa.

Partial allocation is fine. `payment.allocatedAmount` and `payment.unallocatedAmount` are
tracked separately from `payment.amount`, so "how much of this receipt has been applied"
is always answerable.

## Overpayment and credit

```
Outstanding   8,000.00
Payment      10,000.00
Allocated     8,000.00
Credit        2,000.00
```

A credit is a **liability**, not income, and it is allocated to future demands exactly
as a payment is (`credit_allocations`). Behaviour is tenant policy:

| `overpaymentPolicy` | Result |
|---|---|
| `REJECT` | the payment is refused before any money moves |
| `CREDIT_BALANCE` | the excess becomes an allocatable credit |
| `ADVANCE_PAYMENT` | the payment is held as `isAdvancePayment` until a demand exists |

## Multiple payers

The payer recorded on a payment answers **who sent the money**. A separate, tenant-
configured responsibility rule answers **who owes each part of the demand**. This keeps
a sponsor contribution separate from a discount and limits each payer to their assigned
share. Rules are evaluated for new demands and copied into immutable per-item snapshots;
changing a rule does not change previously issued demands. The student receives any
unassigned balance.

Sponsors, government schemes, scholarship funds, parents and employers can each cover a
configured share:

```
Total fee             50,000.00
  Scholarship fund    20,000.00   PayerType: SCHOLARSHIP_FUND
  Corporate sponsor   15,000.00   PayerType: SPONSOR
  Parent              15,000.00   PayerType: PARENT
```

Every payment records who actually paid, separately from who it was for. Without that,
a sponsor reconciliation report is impossible to produce.

An active online checkout reserves its planned per-item responsibility allocation.
Manual collections, other checkouts, and student credit applications see only the
unreserved balance. A balance-reducing adjustment waits until active checkouts on the
affected fee item finish or expire, so a late gateway capture cannot exceed the demand.

## Manual collection uses the same engine

There is one payment engine. Cash at the counter and UPI online differ only in
`channel`, `methodKind` and which fields are required:

```
CASH          reference optional
UPI_MANUAL    reference required (the UPI reference)
BANK_TRANSFER bank + reference required
CHEQUE/DD     instrument number, bank, date required; clearance tracked separately
CARD_OFFLINE  reference required
```

Same allocation, same ledger, same receipt, same audit trail. A separate "manual payment"
path is how a system ends up with two incompatible ideas of what a payment is.

## Refunds

Refunds never modify the original payment:

```
Original payment   20,000.00
Refund              5,000.00
Net payment        15,000.00   (amount - refundedAmount, derived)
```

A refund either returns money through the gateway (`RefundKind.GATEWAY`) or is recorded
as a manual payout with its own instrument details (`RefundKind.MANUAL`). It may also be
parked as credit instead of leaving the platform, which is the common case when a student
switches cohort mid-year.

Whether the allocation is reduced, and therefore whether the demand re-opens, is recorded
on the refund (`reversalApplied`) so the accounting consequence is explicit rather than
implied. Refunds above the tenant's threshold route through `approval_requests`.

## Reconciliation

```
Payment → Gateway transaction → Settlement
```

A settlement import records gross amount, gateway fee, gateway tax, net amount and
settlement date per provider transaction, and reconciliation produces records for every
discrepancy class:

| Mismatch | Meaning |
|---|---|
| `MISSING_IN_SYSTEM` | the provider settled a transaction the platform never recorded |
| `MISSING_IN_SETTLEMENT` | the platform recorded a payment the provider never settled |
| `GATEWAY_AMOUNT_MISMATCH` | amounts disagree |
| `FEE_MISMATCH` | the charged fee differs from the contracted rate |
| `DUPLICATE_GATEWAY_TXN` | the same transaction was settled twice |

These are surfaced as work items rather than silently adjusted, because a discrepancy is
either a provider error or a genuine bug and both need a human.

## Gateway independence

`packages/payment-contracts` defines the provider-neutral contract:

```ts
interface PaymentGatewayAdapter {
  createOrder(input): Promise<CreateOrderResult>;
  verifyOrderClosure(input): Promise<VerifyOrderClosureResult>;
  verifyPayment(input): Promise<VerifyPaymentResult>;
  getPaymentStatus(input): Promise<PaymentStatusResult>;
  refundPayment(input): Promise<RefundResult>;
  verifyWebhook(input): Promise<WebhookResult>;
}
```

Razorpay, Cashfree, PayU, Stripe and a deterministic Mock adapter implement it. Provider
closure checks return captured, pending, terminal, or unknown; unsupported/ambiguous
states keep the payment reservation held. Stripe Checkout Sessions are explicitly expired
and reread, Cashfree checks order attempts, and Razorpay `created`/`attempted` orders remain
pending. PayU's Verify Payment API confirms capture, while unsuccessful attempts remain
reserved because they do not prove order closure. Mock currently returns unknown. The
payment engine injects the interface, never a provider SDK. Adding a provider is one file
plus one configuration row - no call site changes, which is the entire point.

Provider cryptography is implemented; the current batch's consolidated contract tests are
deferred until backend/frontend assembly is complete. It includes Razorpay's
`HMAC_SHA256(orderId|paymentId)`, Cashfree's `base64(HMAC_SHA256(timestamp + body))`,
Stripe's `t=…,v1=HMAC_SHA256(t + "." + body)` with replay tolerance, and PayU's salted
SHA-512 response hash.

## Gateway selection

```
UPI        → Razorpay
Card       → Cashfree
Intl card  → Stripe
```

Routing is scored in tiers far enough apart that no accumulation of small bonuses can
outvote an explicit rule:

| Signal | Score |
|---|---|
| explicit routing rule for the method | +1000 |
| handles international cards | +500 |
| explicit amount band | +100 |
| generic support for the method | +100 |
| tenant default | +50 |
| backup | −10 |
| priority | −(priority/1000) |

Selection returns a **primary plus ordered fallbacks**, so a provider outage degrades the
payment page instead of blocking the collection counter.

## Tests

The existing scenarios in `packages/payment-contracts/src/payment-contracts.spec.ts` cover every payment
and refund transition including the two permissive ones, demand status derivation, all
five signature schemes including tampered bodies and replayed Stripe timestamps,
constant-time comparison, the mock adapter driven to every terminal state plus an invalid
signature and a duplicate webhook, and the full routing matrix.
