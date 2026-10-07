# STU-003 — Student financial profile and guardian workspace

## Scope

Connect the student directory to an individual student profile. The profile brings contact details and guardian/payer links together with the existing demand, payment, installment, and credit records.

## Domain behavior

- Profile records are read from their owning domain APIs; the profile does not introduce a second financial balance or copy financial history.
- Contact edits use the existing student update path and its optimistic concurrency, audit, and outbox behavior.
- Typed, tenant-defined student custom attributes can be maintained from the profile and are available as versioned fee calculation facts; changes are audited and only affect future demand calculations.
- Guardian and payer contacts are created through the tenant-scoped student/guardian API. Primary payer is a relationship to that student, not a global property of a guardian.
- Payment list filtering accepts a validated student ID so the profile cannot show another student's payment rows.
- Amounts and statuses displayed on the profile come from the existing financial records. Balances remain derived in the finance domain.

## Security and tenant isolation

- Student, demand, payment, credit, installment, and guardian requests all resolve under the authenticated tenant.
- The screen checks the relevant session permissions and makes independent optional finance requests so a limited staff role only sees data it can read.
- The payment student filter is validated and is combined with the mandatory tenant filter.

## HTTP surface

- Existing student profile and guardian routes are reused.
- `GET /fee-demands?studentId=...`, `GET /payments?studentId=...`, `GET /credits?studentId=...`, and `GET /installments/students/:studentId` supply the financial panels.

## UI

- `/students/:id` shows student details, linked guardians/payers, demands, payment history, installments, and available credits.
- Contact fields can be edited with the tenant's student update permission; guardians can be added with the guardian create permission.

## Verification status

Implementation is assembled. The consolidated API/web checks, authorization and tenant-isolation review, financial presentation review, and E2E profile scenarios remain pending for the final verification pass.
