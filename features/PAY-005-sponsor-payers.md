# PAY-005 — Sponsor payer records

## Scope

Manage tenant-owned third-party payer records and preserve payer identity on manual and online fee collections.

## Domain behavior

- Sponsor identity, type, contacts, optional credit-limit metadata, and active state are configurable per institution.
- Sponsor records are deactivated rather than deleted so prior payment references remain intelligible.
- Manual and online collection may identify a sponsor as the payer. The sponsor must be active and belong to the authenticated tenant when the order is created; the payment order, settled payment, and receipt retain a payer snapshot and sponsor reference.
- The optional credit limit is informational. Configured fee coverage and per-demand responsibility are managed separately by PAY-006; a sponsor rule can target a fee type, student or group, academic year, and effective period.

## Security and audit

- Sponsor list, create, and update use distinct tenant permissions.
- API queries are tenant-scoped. Sponsor changes record before/after identity metadata in the tenant audit chain.
- Payment collection validates sponsor ownership inside the payment transaction.

## HTTP and UI

- `GET /sponsors`
- `POST /sponsors`
- `PATCH /sponsors/:id`
- `/sponsors` manages contacts, edits, and activation; manual and online collection can select a sponsor payer.
- Online order history displays the saved payer identity and type.

See [PAY-006 — Multi-payer demand responsibility](./PAY-006-multi-payer-responsibility.md) for coverage rules, immutable demand splits, payer-specific collection, and checkout reservations.

## Verification status

Implementation is assembled. Tenant-isolation, payment snapshot, audit, permission-matrix, runtime ACL, API, and frontend checks are pending the consolidated final pass. Sponsor agreements, coverage/funding limits, and splitting one demand's responsibility across multiple payers remain architecture gaps.
