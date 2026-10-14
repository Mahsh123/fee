# Generic SaaS Core and Optional Module Boundaries

**Reviewed:** 2026-10-13
**Related review:** [Multi-tenant SaaS admin review](./multi-tenant-saas-review.md)

## Product rule

The product is one multi-tenant platform. A tenant is an organization workspace with its own members, branches, groups, roles, assignments, enabled modules, settings, domains, and subscription. Organization type/category is tenant-provided text; it is not a closed list of supported industries.

Industry workflows are optional modules. Enabling a module controls its navigation, API access, roles, and data initialization. A database plan may name a custom module key, but that key does not install executable behavior by itself: a code-backed module manifest, API handlers, UI routes, permissions, migrations, and tests must exist before the module can be offered as an operational feature.

**Implementation update (2026-10-13):** shared `TenantPerson` profiles and configurable people groups give organizations a generic identity for members/employees/clients; a user can link to that profile for portal access. Generic fee assignments now support dated cycles, frozen per-person usage inputs, fixed/configured-quantity/percentage charges, and bounded formula/usage/custom calculations. After a Tenant Admin generates the first period, the API scheduler creates **draft** demands for fixed/configured recurring charges on the next exact period boundary. It never issues demands or collects money. USAGE/FORMULA/CUSTOM cycles pause for staff-entered readings, and missed cycle dates are flagged for review instead of producing surprise catch-up charges. Migrations through `20261013000800_fee_assignment_cycle_identity_guards` were applied to the configured Neon database, and the API/web/worker Docker images were rebuilt. Unit and schema checks pass; the unauthenticated tenant landing and host routing were checked in the browser. An authenticated administrator workflow and real period-boundary run have not been verified, so this remains incomplete for production rollout.

## Repository classification

| Area | Classification | Current repository shape | Boundary decision |
|---|---|---|---|
| Tenant, workspace identity, organization category, domain, branding | Core | `Tenant`, `TenantBranding`, tenant host/domain resolution, and public tenant context are tenant-scoped. `organizationType` is free-form. | Keep generic. Branding now calls the display field `organizationName`; historical invoices/receipts still render their saved `institutionName` snapshots. |
| Branches, organization groups, users, roles, permissions, assignments | Core | Generic `Branch`, `OrganizationUnit`, membership, assignment, and custom-role flows exist. Provisioning always creates generic workspace roles and branches. | Keep industry-neutral. Access scopes may refer to generic branches/units; an industry module can add its own entity scope. |
| Tenant people and people groups | Core identity with module-provided labels | `TenantPerson` stores person number, configurable type key/label, profile/contact data, branch and groups. `Student` is retained as an optional Education profile linked to a tenant person. Category remains free-form; no hardcoded industry list drives the core model. | Keep identity, branch and group membership generic; optional modules can add domain profiles and workflows. |
| User identity and portal access | Core model with Education-specific compatibility links still embedded | `User` can link to one `tenantPersonId`; `studentId`/`guardianId` remain for existing Education flows. A generic `WORKSPACE_PERSON` role uses person-scoped portal services, while shared security still contains Student/Parent adapters. | Remove Education identity links from generic `User` in a compatibility migration and replace role-name detection with an explicit session capability/module adapter. |
| Plans, subscriptions, tenant entitlements, platform billing | Core SaaS control plane | Platform plans, subscription lifecycle metadata, invoices, payments, refunds, module limits, and overrides are distinct from customer financial records. | Keep separate from a tenant's operational billing. Super Admin access should manage SaaS service/plan charges and should not imply access to customer ledgers. |
| Reports, notifications, audit, profile | Core capabilities | Shared services/APIs exist and are tenant scoped where applicable. | Keep generic contracts; modules may publish report definitions and notification templates using the common services. |
| Students, guardians, admissions, academic years/units, student groups | Optional Education/Admissions module | These are explicit domain tables and routes (`Student`, `Guardian`, `AcademicYear`, `AcademicUnit`, `AdmissionApplication`) and are no longer created as universal core roles during generic provisioning. | Keep as an optional module. Do not use these records as the universal workspace user, member, account, or billing subject. |
| Fee rules, fee demands, fee payments, receipts, payer portal | Optional finance capability; generic person billing is implemented with operational limits | Finance records support `TenantPerson`; fixed/configured charges, dated fee cycles, usage/formula/custom quantities, member responsibility, ledger, checkout, receipt, credit, and refund code paths exist. The scheduler drafts the next due cycle for fixed/configured recurring charges; variable cycles wait for readings. Education retains Student/group/academic-year calculations. | This is not yet unattended universal billing: usage data must be entered by staff or supplied by a code-backed module adapter, missed dates require manual review, and generated draft demands still require issue approval. Keep Student-only workflows in Education and extend data collection through installed modules. |
| Attendance | Optional workflow module with generic people support | Branch/group rosters and sessions can target `TenantPerson`; Education sessions can still target academic groups. The portal reads only the signed-in person's attendance. | Keep attendance status/session mechanics reusable; let installed modules provide labels, schedules, and additional attendance rules. |
| `TenantSettings` and numbering | Core model with mixed optional settings | The model includes generic locale/currency fields together with default academic year, late-fee, partial payment, waiver, and fee numbering settings. | This is a known boundary violation. Split generic `WorkspaceSettings` from optional `FinanceSettings`/Education settings with a data-preserving migration and compatibility rollout. |
| Permission catalog and built-in roles | Shared code catalog with module-owned permissions | Permission keys include generic core permissions and education/fee keys. Provisioning now creates finance/admissions/portal roles only when their modules are selected, but permission definitions remain globally seeded. | Move permission definitions/default role grants into module manifests. Keep stable permission strings for old tenant roles and deny routes through module entitlements even if a stale grant exists. |

## Changes made in this pass

- Renamed the active core tenant branding field from `institutionName` to `organizationName` in Prisma, validation, API responses, settings, seeds, and tenant UI. The staged migration adds/backfills the generic column and keeps both database columns synchronized for rolling deploy compatibility; remove the legacy column only in a later cleanup migration after all old app versions are gone.
- New invoice and receipt snapshots use an `organization` key. Invoice, receipt, and payer-portal rendering accepts both the new key and the older `institution` key so issued documents remain readable.
- Tenant navigation now starts with generic workspace routes and adds built-in domain navigation from enabled module keys. Education, fee, payment, and payer-portal entries are not part of the core navigation list.
- The shared settings screen and its API load admissions/fee catalogs only when the matching module is enabled; update writes preserve optional settings for modules the tenant has disabled.
- Generic provisioning can select only modules included in its plan, always enables the core workspace modules, and only seeds domain-specific role/payment setup when the related optional modules are selected.
- Reviewed remaining education leakage in the shared user/session contract: `User.studentId`/`guardianId`, `STUDENT`/`PARENT` portal-role checks in the shared shell/security guard, and globally declared education permissions still need migration into module-owned identity adapters and permission manifests.
- Added `TenantPerson` and `TenantPersonGroup` as the generic people identity; existing students are backfilled to a person profile and keep their optional `Student` relation. User access can be linked individually or by validated bulk import using the profile number.
- Added branch/group-scoped people attendance and generic member fee assignment, fixed/configured demand calculation, dated billing cycles, immutable per-person quantities, bounded usage/formula/custom calculations, draft demand creation, ledger, payer balance, checkout-order, receipt, credit, and refund paths.
- Added a tenant-scoped cycle scheduler: it drafts the next fixed/configured recurring cycle on its period boundary after the first cycle; it flags variable charges for readings and missed boundaries for review, and does not issue demands.
- Added tests for person/branch fee assignment and generation, cycle date and idempotency validation, usage/formula calculation, scheduler boundary/quantity pauses, ledger issue accounts, member balance ownership, gateway order ownership, receipt access, CSV profile linking, and attendance marking/feed. The staged cycle/people migrations were applied to Neon and the API/web/worker images rebuilt. Public tenant host routing was checked, but no authenticated cycle generation or real-time scheduler execution was proven in the browser.

## Roles and human workflows

| Role | Core responsibilities | Optional finance/fee responsibilities |
|---|---|---|
| Super Admin | Provision and suspend workspaces; manage plans, limits, entitlements, domains, platform operators, and platform audit. | See SaaS subscription invoices and service billing. Customer ledgers remain hidden unless a separately audited support grant is explicitly used. |
| Tenant Owner / Tenant Admin | Configure organization profile, branches, groups, modules, user access, branding, domains, and workspace settings; review audit events. | Choose enabled finance features, payment methods/gateways, numbering, receipt templates, tax profile, approvals, and refund policy. Sensitive payout credentials must be encrypted and masked. |
| Finance Admin / Accountant | Optional role assigned only when finance/payment modules are enabled. Configure charge catalog/schedules; preview and issue charges; reconcile provider settlements; review arrears and collections; prepare close reports. | Approve waivers, adjustments, and refunds only within assigned authority. Refund initiation and approval should be separated above configured thresholds. |
| Finance Staff / Cashier | Work only in assigned branches and permitted queues; identify the billed account/payer; collect eligible amounts; record offline references; issue receipts; reconcile a shift/day. | Cash, UPI, cheque, bank transfer, card/gateway settlement, partial allocations, reversals, and duplicate retries must have distinct states and audit entries. A cashier's manual “received” action is not proof of gateway settlement. |
| Module Operator | Manage the enabled module's records using a role and branch/group assignment. Examples include admissions staff or a membership operator. | Domain-specific duties are granted by a module and do not enlarge core tenant administration. |
| Tenant User / Member / Payer | Manage own profile and see only self or explicitly assigned workspace data. | View itemized charges, billing periods, due dates, paid/pending status, payment attempts, refunds, credits, and downloadable/printable receipts. A sponsor or external payer sees only their assigned responsibility. |
| Auditor / Report Viewer | Read only the reports and audit records granted by role and branch scope. | Reconciliation exports and personal/billing data should require explicit permissions and remain attributable to the export actor. |

`Student`, `Parent`, and `Guardian` are Education module roles/relations. A generic tenant can instead use its module's names such as member, employee, client, or payer without changing tenant identity, tenancy, RBAC, or branch architecture.

## India fee-collection journeys for the optional Education/Finance module

These are product scenarios, not universal core entities:

1. **Set up charges:** configure one-time admission/enrolment charges, recurring monthly or term/year charges, optional services/add-ons, effective dates, branch applicability, and a preview before publishing.
2. **Issue and explain dues:** create itemized invoices/demands with period, due date, original amount, discounts/concessions, scholarships/sponsor shares, tax treatment, late charge policy, and a clear balance calculation.
3. **Collect part or all:** allow full payment, permitted partial payment, selected eligible items, installments, advance credit, and separate payer/sponsor responsibility. Never silently allocate money to a different person's account.
4. **Handle every payment state:** online order created, pending, captured/verified, failed, expired, refunded, partially refunded, and reversed; idempotent provider callbacks must not create duplicate payments or receipts. Offline UPI, cash, cheque, and bank transfer require a reference/instrument and a separate verification/clearance state where appropriate.
5. **Correct safely:** support waivers/concessions, cancelled demands, credit notes/adjustments, overpayment credits, refund requests/approval/processing, and receipt replacement/void links without deleting ledger history.
6. **Close and reconcile:** compare gateway and bank settlements, identify fees/settlement differences, reconcile cash/cheques, report collections by date/branch/method/charge type, and lock or audit daily close changes.
7. **Payer self service:** show an understandable line-item balance, due dates, what can be paid now, accepted methods, pending/failure reason, retry guidance, transaction reference, refund progress, and a printable/downloadable receipt.

Tax treatment must be configurable per charge and effective period. Do not hardcode a blanket education-fee exemption; applicability depends on the service and institution facts. Have the tenant's tax adviser approve its settings. References: [CBIC Circular 151/07/2021-GST](https://cbic-gst.gov.in/pdf/Circular_Refund_151.pdf) and [Notification 12/2017-CT(Rate), Entry 66](https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification12-CGST.pdf).

## End-to-end architecture checklist

### Core platform

- [x] Keep organization type free-form and generic.
- [x] Provision a tenant, owner/admin, generic roles, core workspace modules, initial branch, branding, settings defaults, and subscription atomically; optional module setup follows selected entitlements.
- [x] Generate a tenant slug and resolve tenant/custom domains through the request host; verify ownership before custom-domain routing.
- [x] Enforce tenant-scoped composite relations, request authorization, generic RBAC, and tenant/branch-aware assignment checks on implemented core APIs.
- [x] Keep Super Admin SaaS subscriptions/billing distinct from tenant operational fee/payment ledgers.
- [x] Build core navigation from generic routes and module navigation from enabled module keys.
- [ ] Make provisioning resumable/idempotent across external invite, DNS, and payment-provider side effects; display stage progress and safe retry.
- [ ] Make branch-level authorization a required scope on every branch-owned read/write/export/background job, with route-coverage tests (not just a membership selector in the UI).
- [ ] Add invitations, verified email changes, MFA/recovery, session revocation UX, and safe ownership transfer.
- [ ] Add platform-level usage metering/history, alerts, and API/storage quota enforcement in workers as well as HTTP requests.

### Module contract

- [ ] Define a code-backed manifest per module: stable key/version, dependency keys, migrations, API routes, permission definitions, default roles, navigation/pages, settings schema, report cards, notification templates, and teardown/data-retention rules.
- [ ] Remove Education identity fields (`studentId`, `guardianId`) and role-name portal detection from generic `User`/session/security contracts; preserve current portal isolation with module-owned identity adapters and an explicit generic self-service access capability.
- [ ] Move Education/Finance permission declarations and default role grants out of the global core catalog while retaining compatibility for existing tenant grants during migration.
- [ ] Validate a plan's module key against installed manifests before Super Admin can provision or enable it. Database custom keys stay unavailable until a code module is installed.
- [ ] Run module entitlement checks consistently in controllers, services invoked by jobs, exports, and event handlers; default to deny for missing/stale entitlements.
- [ ] Make module enable/disable transactional: check dependencies/data retention, update effective entitlements, role grants, menu cache, and audit event together.
- [ ] Add contract tests proving that a new module can add tables and routes without modifying `Tenant`, workspace membership, tenant resolution, or core RBAC.

### Finance module and legacy education migration

- [ ] Split `TenantSettings`: preserve generic locale/currency/rounding/time-zone in `WorkspaceSettings`; move academic year and fee/payment policy to module-owned settings.
- [~] Create a generic tenant-person and responsibility identity. Student records link to person profiles and generic member responsibility/payment paths exist; migrations are applied to Neon, but preserve/verify all existing Student/Guardian/Sponsor account behavior in an authenticated live flow before declaring the adapter complete.
- [ ] Separate generic charge catalog/schedule, invoice/demand, line item, payment, allocation, credit, refund, and receipt lifecycle from student/group/academic-year selectors.
- [ ] Keep the existing Education module migration path and API contracts working; backfill generic accounts with stable IDs and prove before/after ledger totals match before cutover.
- [ ] Move `studentPrefix`, admission numbering, `AcademicYear`, scholarship/concession tax assumptions, student custom attributes, and Student/Parent roles into the Education module settings/manifest.
- [ ] Add an explicit tax profile and effective-dated per-charge tax decision fields; record operator/source/reason for changes and preserve the original tax snapshot on issued documents.
- [ ] Add provider abstraction, idempotency keys, signed webhooks, retries, reconciliation, settlement fees, refund execution, and sandbox-to-live operational checks before claiming automated payments are live.

### Verification gate for any feature

For each feature, trace and test **module manifest/entitlement → UI route → API route → tenant and branch authorization → service transition → Prisma transaction/constraints → Neon migration → response mapping → UI state**. A schema field or hidden navigation item alone does not pass this gate.

## Current completion statement

The core supports free-form organization categories, generic people/groups, branch attendance, and generic person-linked fee/payment flows without making School, Gym, or Company the tenant architecture. Fixed/configured recurring demand drafting and staff-entered usage/formula/custom cycles are implemented in source and the migrations are applied to Neon. It is **not yet production-ready for every industry**: authenticated end-to-end cycle/payment workflows and an actual scheduler boundary run remain unverified; variable usage readings have no universal module-ingestion adapter; missed cycles need manual recovery; the scheduler creates draft demands that still need authorized issue approval; the mixed `TenantSettings` model and Education identity/portal-role coupling remain; global Education permissions are not module-owned; and arbitrary custom module manifests are not installed dynamically. A plan may store an arbitrary module key, but it is operational only when matching code is installed. Verify signed-in tenant/branch authorization, ledger, payment, and receipt paths before customer rollout.
