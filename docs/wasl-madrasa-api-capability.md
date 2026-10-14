# Wasl Madrasa mobile app — API capability matrix

The mobile client in `apps/mobile` uses the versioned API (`/api/v1`) and never
connects to Neon directly. This matrix separates backend availability from
mobile-screen integration.

| Area | Backend/API contract | Mobile integration |
| --- | --- | --- |
| Tenant resolution and branding | `GET /tenant-context` resolves the request hostname and returns active tenant branding, category, enabled modules, and configured timezone. | Workspace URL is resolved before login; tenant branding and timezone format transactions. |
| Sign-in and session | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, and `POST /auth/forgot-password`. Access token is JSON; refresh token is an HttpOnly cookie. | Role choice is presented at login; returned session roles govern access. |
| Student / parent overview | `GET /portal/dashboard` returns linked student fee/payment data and dashboard totals. `GET /portal/profile` returns linked students with academic-unit and branch labels, approved profile fields, and role-authorised guardian contacts. | Existing dashboard supports fee balance/history. The new profile data still needs to be wired into the mobile profile screen. |
| Fee detail | `GET /payments/students/:studentId/open-items` checks linked-student access and returns outstanding fee items/responsibilities. | Student/parent fee lists and online order selections use server-calculated outstanding items. |
| Online payment | `POST /gateways/orders` creates a tenant-configured order; `GET /gateways/orders/:id` returns that order. Existing checkout supports `REDIRECT`, `FORM_POST`, `RAZORPAY`, and `CASHFREE`. | App launches supported provider checkout modes and polls the order endpoint. Test `MOCK` is never presented as successful payment. |
| Staff student lookup | `GET /students?search=...` and `GET /students/:id` require student-read permission and apply staff branch scope. `GET /academic-units` lists permitted groups. | Staff search and student detail are permission-gated. |
| Staff fee collection | `GET /payment-methods`, `GET /payments/students/:studentId/open-items`, and `POST /payments/manual`; validates method, amount, responsibility, partial-payment policy, idempotency, collector, and receipt issuance. | Staff collection submits an idempotent request and displays the API's receipt or pending-approval result. |
| Staff dashboard | `GET /organization/dashboard` returns workspace counts, active members when Admissions is enabled, monthly fee collection and outstanding totals grouped by currency, and today's attendance totals when Attendance is enabled. | The additional totals need to be surfaced in mobile dashboard widgets. Tenant timezone and branch scope are enforced. |
| Attendance | Optional `ATTENDANCE` module (requires `ADMISSIONS`): `GET /attendance/units/:unitId/roster`, idempotent `POST /attendance/sessions`, correction-only `PATCH /attendance/sessions/:id/records`, and `GET /portal/attendance`. | Backend is implemented. Mobile marking, correction, history and portal attendance screens remain to be connected. |
| Parent/student notifications | `GET /portal/notifications?limit=50` returns messages addressed to the signed-in user, student, or linked guardian. `PATCH /portal/notifications/:id/read` marks only an addressed row as read. Provider addresses, payloads and worker errors are omitted. | The mobile inbox and unread indicator remain to be connected. |
| Receipt files | `GET /portal/receipts/:id/download` creates an on-demand PDF from the authorised immutable receipt snapshot. The response is private/no-store and uses INR Indian number formatting for INR receipts. | Receipt PDF download/share actions remain to be connected to the native client. No object-storage persistence is required for the generated PDF. |
| Tenant admin | Existing `students`, `access`, `academic-units`, fee, payment-method, and report APIs enforce their own permissions. | Full tenant setup and role configuration remain in the Wasl web console. |

## Remaining backend gaps

1. **Student photo upload and serving.** The profile endpoint returns class/group, branch, and approved contacts. The document registry exists, but the repository has no tenant-scoped student-photo upload or private object download/signing adapter; the API therefore does not return photo URLs.
2. **Safe checkout capability discovery.** The portal dashboard returns active online method IDs, names and kinds, but not a preflight description of checkout modes. The app can still create an order and handle supported response modes; provider secrets are never returned.
3. **Mobile integration.** New profile, attendance, inbox, receipt-download, and dashboard-total API contracts need native UI integration and mobile tests.

## Backend implementation note

The attendance and notification-read migrations and their tenant identity guards were applied to Neon on 12/10/2026; the staged migration runner also verified the tenant relation indexes and synchronized the database ACL manifest. The new attendance tables use tenant-composite foreign keys. Attendance marking checks staff branch membership and verifies that every student is active, belongs to the requested group and branch on the attendance date, and appears only once. Corrections have a separate permission and audit event. Portal reads resolve only the signed-in student's ID or tenant-scoped guardian links.
