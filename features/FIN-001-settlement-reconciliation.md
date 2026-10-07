# FIN-001 — Gateway settlement matching

## Scope

Tenant finance operators can import a settlement summary and its provider transaction references, compare each line with captured gateway transactions, and resolve open reconciliation exceptions.

## Import rules

- Imports select a tenant-owned gateway configuration and inherit its provider/environment.
- Transaction line totals must equal gross; net must equal gross less gateway fee and tax, using exact four-decimal money arithmetic.
- The settlement's tenant/provider/environment/reference uniqueness makes repeated imports idempotent.
- Provider references match only within the selected tenant gateway configuration. Matches require one captured transaction and exact currency and gross amount agreement.
- The import creates a reconciliation record for every matched or exceptional line, including provider reference and amount evidence. Ambiguous, missing, duplicate, already-settled, non-captured, currency, and amount cases stay visible for review.
- Settlement state is derived from its reconciliation records. An operator can resolve or ignore ordinary matching exceptions with a required explanation; the decision is audited.
- A verified provider-success exception (late capture, success after failure, or successful amount/currency mismatch) cannot be marked resolved or ignored until the captured money has a tenant-scoped confirmed payment and ledger entry. Closing the exception is not a substitute for posting or refunding money.
- A same-currency capture held in unapplied gateway liability can be assigned to student credit only by a reconciliation operator with a required reason. The transfer debits the gateway suspense liability and credits student-credit liability; the existing credit application flow can then apply that balance to open demands.
- A capture cannot be marked resolved or ignored while any payment-linked unapplied gateway liability remains. Captures with missing/invalid amounts or incompatible currencies cannot be released as student credit.

## API and workspace

- `GET /reconciliation/settlements`
- `GET /reconciliation/records`
- `POST /reconciliation/settlements/import`
- `PATCH /reconciliation/records/:id`
- `POST /reconciliation/records/:id/release-capture-as-student-credit`
- The finance workspace provides settlement import, match totals, exception review, and resolution notes.
- The workspace shows linked payment/ledger state and separately labels the provider-reported currency and amount. A reconciliation operator can release a fully booked, same-currency capture into student credit with a reason; the liability transfer is audited and the existing credit workspace handles later fee allocation.

Same-currency verified provider captures are now booked to a payment and balanced ledger entry. Late, amount-mismatched, or unsafe-to-allocate captures use the tenant's unapplied gateway liability account. A reconciliation operator can explicitly transfer that balance to student-credit liability with a reason; the standard credit application flow can then apply it to open student responsibility, and reconciliation cannot close while the gateway liability remains. Captures with missing/invalid amounts or a currency incompatible with tenant accounting remain evidence-only and cannot be released through this route. Provider-side order-closure verification remains open; see [the provider expiry and late-capture architecture issue](../docs/architecture/decisions/20261003-provider-expiry-and-late-capture.md).

Settlement rows and all related transactions remain tenant-scoped by composite relations. The import currently accepts provider line text in the UI; file-object storage and archival remain part of the storage/deployment foundation.
