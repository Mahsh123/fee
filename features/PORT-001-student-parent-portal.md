# PORT-001 — Student and parent financial portal

## Scope

Provision linked student and guardian accounts and provide a read-only family finance view with tenant-owned online fee checkout.

## Domain and security rules

- A student portal identity is linked to exactly one active student. A parent portal identity is linked to one guardian whose student links define the accessible family records.
- Portal accounts cannot be mixed with staff roles. The API rejects portal-only identities from staff-wide routes; portal-capable shared routes enforce the linked student scope in the service layer.
- Online payment order creation validates the student against the authenticated student/guardian link, and the order-status endpoint returns only orders for those linked students.
- Portal dashboard data is loaded with explicit tenant and subject filters. Monetary balances are calculated with exact decimal arithmetic from saved fee and payment records.
- Portal checkout creates a payment order and uses the shared provider checkout adapter. It does not create a payment or receipt until a verified gateway event settles the order.

## Database and API

- Add nullable `User.studentId` and `User.guardianId` uniqueness per tenant so one person record cannot acquire duplicate portal logins.
- Extend the signed access token with the already stored guardian identity so the API can scope parent access without trusting a request-supplied subject ID.
- Add portal subject options to access administration and a tenant-scoped `GET /portal/dashboard` read endpoint.
- Permit portal roles on the open-item and gateway-order routes only; check student/guardian ownership inside the relevant domain service.

## UI

- Access administration can create a student account linked to a student, or a parent account linked to a guardian.
- The family portal displays linked students, open demands, installments, confirmed payments/receipts, credits, and enabled online methods.

## Verification status

Implementation is assembled. Authorization, household-boundary, token/refresh, online checkout, tenant-isolation, database uniqueness, and frontend checks remain in the final consolidated review pass. Parent accounts can see every student linked to their guardian record; more granular payer-specific demand responsibility is a separate domain feature.
