# Multi-Tenant SaaS Platform Requirements and Design

**Purpose:** define the target product, architecture, security boundaries, user experience, and acceptance criteria for this repository. This document is a requirements baseline, not a claim that every capability is already implemented.

**Scope:** industry-agnostic platform administration, tenant organizations, branches, tenant users, optional product modules, subscriptions, SaaS billing, tenant fee/payment operations, security, deployment, and verification.

**Status vocabulary:**

- **NOT_STARTED:** no usable implementation of the required feature is present.
- **IN_PROGRESS:** implementation exists, but required behavior or one or more layers are missing.
- **BACKEND_COMPLETE:** database, backend/API, business logic, validation, and authorization are complete; frontend integration remains.
- **FRONTEND_COMPLETE:** required UI/UX is complete against the agreed API contract; integration remains.
- **INTEGRATED:** database, backend/API, authorization, frontend, and response flow are connected; required tests remain.
- **TESTED:** connected feature passed its relevant integration and regression tests; production acceptance may remain.
- **COMPLETE:** every required layer and production acceptance criterion is verified.
- **BLOCKED:** delivery or verification depends on an unavailable external system, credential, domain, or business decision.

## 1. Product goal

Provide a generic SaaS control plane that can serve organizations such as schools, colleges, gyms, training centers, companies, clubs, NGOs, and other customers. A tenant's industry or terminology must be configurable data. Industry-specific workflows such as fee collection are optional modules and must not define the tenant, user, or branch architecture.

Neon PostgreSQL is the hosted database. Prisma is the schema, migration, and data-access layer used by the application. The frontend communicates with the backend API; it never connects to Neon directly.

## 2. Required hierarchy

```text
Platform control plane
└── Platform administrators (Super Admins)
    ├── Tenants / customer organizations
    │   ├── Tenant Owner and Tenant Admins
    │   ├── Branches / locations
    │   │   ├── Branch Managers
    │   │   └── Branch Staff
    │   ├── Departments, teams, groups, and other organization units
    │   └── Tenant users and optional portal users
    ├── Plans, subscriptions, billing, payments, and entitlements
    └── Platform analytics, audit, security, and settings
```

Branches and organization units are inside a tenant; they are not separate tenants and do not receive separate subdomains. A user may have memberships in multiple branches where permitted. A tenant may have no branch or one or more branches.

## 3. Host architecture

| Scope | Development | Production | Purpose |
|---|---|---|---|
| Platform | `platform.localhost` | `platform.example.com` | Super Admin authentication and control plane |
| Tenant | `<slug>.localhost` | `<slug>.example.com` | Tenant landing, authentication, and workspace |
| Apex | `localhost` / base domain | base domain | Not a platform-admin host; may serve a public marketing site |

The incoming host is parsed and resolved before authentication. The host determines the allowed account scope and tenant. A user never supplies a tenant ID, tenant slug, or organization ID as authority. Production requires preserved host headers, wildcard DNS, and wildcard TLS for subdomains. Custom domains require verification and resolver integration before they may be accepted.

## 4. Authentication and account scope

Required login matrix:

| Account | Platform host | Own tenant host | Other tenant host |
|---|---:|---:|---:|
| Platform administrator | Allow | Deny | Deny |
| Tenant Owner/Admin | Deny | Allow | Deny |
| Tenant user | Deny | Allow | Deny |

The host-boundary check must apply to login, access-token requests, refresh, and logout. Wrong-host UI must explain the mismatch and link to the correct sign-in host. Role names, frontend route hiding, and client-supplied tenant IDs are not security controls; backend guards and tenant-scoped queries are mandatory.

## 5. Tenant model and provisioning

A tenant represents one customer organization and owns its settings, branding, hostnames, branches, organization units, users, roles, subscriptions, entitlements, usage, audit events, and tenant data. The tenant slug is normalized, unique, collision-safe, and reserved-name aware. A slug change must warn that it changes the sign-in URL and should eventually support a history/redirect policy.

Provisioning acceptance flow:

1. Capture organization identity, type, contact, locale, country, currency, and timezone.
2. Generate and validate a slug and display the development/production URL preview.
3. Create an owner/admin through an invitation flow; never expose a durable plaintext credential.
4. Optionally create initial branches and generic organization units.
5. Select a plan/trial, limits, and modules.
6. Review the complete configuration.
7. Create tenant, identity, default tenant roles/permissions, branches, settings, subscription, entitlements, domain, and notification settings transactionally or through an idempotent resumable operation.
8. Send an invitation and show a provisioning result with next actions.

Provisioning must be idempotent, auditable, retryable, and safe after partial external delivery failure. School-specific starter records may only be initialized when the corresponding optional module is enabled.

## 6. Users, roles, and permissions

Platform identities and tenant identities are different scopes. Platform administrators manage the platform and customer tenants. Tenant Owners/Admins manage only their own organization. Tenant users receive tenant-defined roles and branch or organization-unit memberships as appropriate.

The permission model must support view, create, edit, delete, manage, approve, assign, export, and refund actions, with scope constrained to platform, tenant, branch, or own-resource. Built-in role labels may have generic defaults, but tenants must be able to create industry-neutral custom roles. Effective permissions and scopes must be recalculated on the server and stale sessions revoked after access changes.

User lifecycle includes invite, accept, edit profile, activate/deactivate/suspend/archive/restore as appropriate, password recovery, role and branch assignment, department/group assignment, session revocation, and activity history. User profile views must expose only records the current actor is allowed to see.

## 7. Branches and organization units

Branches represent tenant locations and may include name, code, address, contact, manager, status, capacity, settings, and module overrides. Tenant admins can create, update, activate/deactivate, archive, assign managers/staff, and inspect branch activity and usage.

Departments, teams, groups, divisions, and other units use configurable tenant terminology and may form a parent/child tree. The UI must not present membership as enforced isolation until the backend applies branch and unit scope to each relevant query and mutation.

Mandatory authorization order for branch-sensitive operations:

```text
Host and account scope
→ authentication
→ tenant authorization
→ branch membership/scope
→ permission check
→ entitlement check
→ tenant/branch-constrained database operation
```

## 8. Subscription, SaaS billing, and entitlements

Plans are platform-owned catalog entries with versioned price, billing interval, trial policy, user/branch/storage/API limits, enabled modules, feature entitlements, and support level. Each tenant has an authoritative subscription lifecycle: trial, active, renewal, past due/grace, suspended, cancelled, and expired. Upgrade/downgrade, proration, renewal jobs, retries, and notifications must be explicit and auditable.

SaaS subscription billing (platform invoices, payments, fees/tax, refunds, reconciliation, and provider events) is a separate accounting domain from optional tenant fee invoices/payments. Platform billing requires immutable invoice snapshots, idempotent payment/webhook processing, refund approval and reconciliation, and secure provider secrets.

Entitlements resolve from the subscription's plan version plus tenant/subscription/add-on overrides. Every protected API and background task must enforce them. UI visibility is an affordance, not enforcement. Usage must report measured value, limit, warning state, and enforcement outcome consistently.

## 9. Optional tenant fee/payment module

Fee collection is configurable and optional by tenant. When enabled, its generic relationship is:

```text
Tenant → Fee configuration → User/resource charge → Invoice → Payment → Receipt/refund
```

Tenant-facing fee operations remain tenant-scoped and branch-scoped wherever the business record has a branch. Tenant users see only their own permitted financial records. SaaS subscription invoices must never be mixed with tenant-issued fee invoices or ledgers.

## 10. Assignment model

Assignments attach tenant-defined resources to users and may be branch-scoped. Resource type and lifecycle must remain extensible across programs, courses, services, memberships, tasks, training, assessments, modules, and future tenant modules. Statuses include assigned, started, in progress, completed, overdue, and cancelled. The API validates that assignee, branch, and resource belong to the current tenant and that the actor has the required scope.

## 11. Frontend hierarchy and UX

### Platform console

```text
Overview
Tenants
  ├── All tenants
  ├── Provision tenant
  ├── Tenant details and administrators
  └── Tenant activity / audit
Super Admins
Plans and subscriptions
Billing and payments
Features and entitlements
Analytics and usage
Domains
Audit and security
Platform settings
My profile
```

Only functional screens may appear as active navigation. Unimplemented APIs must not be disguised by empty placeholder pages. Tenant detail navigation must separate organization, admins/users, branches/units, subscription, billing, features/limits, domains, security/activity, and settings when those workflows are end-to-end available.

### Tenant workspace

```text
Dashboard
People: users, invitations, roles/permissions, groups/departments
Organization: profile, branches, settings
Assignments
Optional modules: fees, payments, invoices, and related operations
Reports, notifications, activity/audit, and My profile
```

Show only modules enabled for that tenant and permitted for the current user. Show the current organization and branch scope clearly. Do not render a branch selector unless selection changes the backend-enforced scope. Platform accounts must not see tenant fee navigation on the platform host; tenant accounts must not see platform controls.

Every major screen requires clear titles, useful breadcrumbs, primary actions, loading/error/empty/success states, validation, responsive layout, accessible controls, and table search/filter/sort/pagination where relevant. Destructive or high-impact changes require confirmation and audit attribution.

## 12. API and backend request architecture

```text
Request
→ validated host resolution
→ authentication and host/account binding
→ tenant context
→ branch/resource scope
→ RBAC permission check
→ subscription/entitlement check
→ controller validation
→ service/business transaction
→ tenant-scoped Prisma client
→ Neon PostgreSQL
→ response projection
→ UI state
```

Controllers validate inputs and delegate business rules to services. The API owns trusted tenant IDs from context. Composite tenant foreign keys, scoped query infrastructure, least-privilege database roles, and reviewed migrations provide defense in depth. Raw SQL is limited to reviewed migration/operations use.

## 13. Database and persistence architecture

Neon PostgreSQL is the database. Prisma owns the relational schema, generated client, and migrations. Tenant-owned records carry a tenant foreign key and appropriate composite relationships. Branch-sensitive records carry a branch relationship where required. Monetary values use exact decimal types and immutable financial history uses compensating records rather than destructive edits.

The frontend must never connect directly to Neon. Production migration deployment, tenant relation/index preflight, least-privilege grants, backups, restore, and rollback strategy must be documented and verified for the target Neon branch.

## 14. Security, audit, and notifications

Audit events record actor, tenant, branch when relevant, action, resource, timestamp, IP, user agent, and before/after state. Important events include authentication failures, invitations, user/role/permission changes, tenant/provisioning changes, branch changes, subscription/billing/payment changes, and security settings. Sensitive secrets and credentials are never written to logs.

Notifications support invitation and security events, trial/renewal/payment lifecycle, tenant/user changes, and important administrative events through a transactional outbox and idempotent delivery. MFA, recovery, rate limits, session revocation, signing-key rotation, and incident response remain production security requirements.

## 15. Development and production environments

Development must resolve `platform.localhost` and arbitrary one-label tenant hosts such as `demo.localhost`, `gym.localhost`, `academy.localhost`, and `company.localhost`. Seed data should demonstrate generic organization types and only seed optional fee data where the module is enabled. Database connectivity must not be required during container image compilation.

Production must configure the real base domain, platform URL, API URL, CORS allowlist, wildcard DNS, wildcard TLS, host-preserving reverse proxy, health checks, external Neon connection, secrets, migration process, and observability. A production deployment cannot be called complete until an actual domain and deployment target have been configured and smoke-tested.

## 16. Test and verification requirements

Required coverage includes:

- Platform login, tenant login, refresh/logout binding, and wrong-host rejection.
- Tenant A versus Tenant B isolation.
- Branch A versus unauthorized Branch B isolation for each branch-sensitive domain.
- RBAC, scope checks, and entitlement-denied API behavior.
- Idempotent provisioning including admin, branch, subscription, entitlements, and hostname.
- Trial/active/renewal/past-due/suspended/cancelled subscription transitions.
- Tenant fee invoice/payment/refund access, distinct from SaaS billing.
- Domain/slug availability and tenant host resolution.
- Platform and tenant navigation, wrong-scope UI, role-specific menu visibility, forms, tables, loading/error/empty states.
- Docker Compose configuration, container health, and frontend→API→Prisma→Neon integration.

For every feature, record which parts were actually run. A passing schema/typecheck alone is not end-to-end proof.

## 17. Existing implementation and gap tracking

This is the current source-audit snapshot for this implementation phase. Detailed area-by-area findings remain in [multi-tenant-saas-review.md](./multi-tenant-saas-review.md); industry boundaries are in [generic-platform-and-india-fee-module.md](./generic-platform-and-india-fee-module.md). The repository contains 16 npm workspaces, a NestJS API, Next.js frontends, Prisma schema/migrations, Neon-oriented Compose/deployment scripts, and CI database/security checks. The workspace snapshot has no `.git` directory, so branch/status/diff inspection was unavailable; this phase changes documentation only.

The audit confirms that the platform has a real tenant/control-plane foundation and substantial connected Education/Finance workflows. The current `apps/web` platform and tenant screens call real APIs. Provisioning has a five-step review wizard and an idempotency-backed atomic retry path, but it is not invite-backed. Migration `20261006000800_platform_tenant_provisioning_idempotency` is now applied to Neon; staged deployment preflight, indexes, signing-key provisioning, and ACL synchronization passed. Plan/subscription CRUD and scheduled lifecycle, platform invoice/manual payment/refund flows, feature overrides, and custom-domain TXT verification exist; they are not provider-backed SaaS collection or complete universal entitlement enforcement. Production DNS/TLS, deployment health, backup restore, and complete browser-to-Neon flows remain unverified.

The main remaining architectural gaps are branch scoping for legacy financial records, incomplete organization-unit/branch scope evaluation, invitations/MFA/recovery, a code-backed module registry, generic industry-neutral billing, education identity/permissions embedded in shared user/auth contracts, and parity/testing gaps in `apps/web-preview`. Known document drift is recorded in the handoff below and must not be interpreted as missing source functionality when a newer implementation is verified.

Use this layer-by-layer matrix after every feature phase. `IN_PROGRESS` is deliberately used when production behavior or full-stack evidence is incomplete; do not promote a row based on schema or compilation alone.

| Feature | Current implementation | Required behavior | Database | Backend/API | Authorization | Frontend/UI | Integration | Tests | Status | Known issues / dependencies |
|---|---|---|---|---|---|---|---|---|---|---|
| Authentication and host/account scope | Configurable platform-host routing; login/access/refresh account-host binding; deleted/inactive account rejection; browser credential clearing and wrong-host recovery | Enforce platform vs own-tenant host for login, refresh, logout, and every request | Existing tenant/user/session schema; no new schema required for this host-scope slice | Resolver uses configured `PLATFORM_SUBDOMAIN`; API validates account flag, role, host and tenant before issuing/accepting sessions | Platform guard and token/host match; tenant-scoped Prisma | Main shell shows accessible recovery and canonical platform/tenant sign-in links; sign-in copy is generic | Web UI and API paths are connected; live proxy/browser-to-Neon proof remains absent | API suite 144/144, config 21/21, web suite 27/27 across 7 files; these are not full browser E2E | IN_PROGRESS | Host/account-scope slice is verified. Invite/email verification, MFA/recovery, more security events, live edge configuration, and generic identity cleanup remain |
| Super Admin dashboard and admin management | `/platform` shows summaries, tenant directory/detail, platform admins, plans and billing actions | Operational health, complete platform-admin lifecycle, audit and safe recovery | Platform admin user, subscription, invoice/payment/refund, audit models | Platform overview and admin/tenant APIs | Platform-only guards; re-check active admin/session version | Real API-backed but consolidated into a long page | Forms call APIs; no page-level E2E | Platform service tests; limited UI tests | IN_PROGRESS | MFA/invitations, health/dunning/provisioning failure metrics, clearer standalone console UX and some lifecycle actions remain |
| Tenant management and provisioning | Tenant CRUD/status/usage/admin/domain management; guided five-step wizard; provisioning creates tenant/admin/core roles/settings/branding/trial/Main branch; slug collision handling | Invitation-backed reviewed onboarding, idempotent retries, optional initial branches/units, resumable delivery, archive/retention and owner transfer | `TenantProvisioningOperation` migration `20261006000800` applied to Neon; existing tenant/core models reused | Existing platform-only endpoint requires `Idempotency-Key`; tenant and result persist atomically; same-key replay returns prior result, mismatched non-secret request data conflicts | Platform guard; request key is scoped by actor; tenant entities created in existing transaction | `/platform` wizard validates organization, plan/modules, locale/billing, first admin and review; success shows generated workspace URL and explains that no email invitation was sent | UI request header and backend replay contract are connected; Neon migration, relation preflight, index verification, signing-key provisioning and runtime/backup ACL synchronization passed; live concurrent retries remain unverified | Provisioning service 20/20 platform tests, API suite 144/144, web 27/27, schema/migration checks 81/81; no browser-to-Neon test | IN_PROGRESS | No invitation/acceptance delivery; temporary password is manually conveyed; no configurable starting branches or organization units; live concurrent replay remains unverified. Older review text incorrectly says plan/module choices are unavailable. |
| Tenant Admin dashboard and organization | Generic API-backed overview; branch/unit/member/assignment management | Permission- and branch-scoped onboarding, activity, limits, settings and operational health | Tenant, branch, organization unit, membership, assignment | Dashboard and organization CRUD/member APIs | Tenant scope; some branch/manager checks | `/`, `/organization`, `/settings` connect to APIs | Main app paths are connected; no full-stack browser proof | Organization/dashboard API and limited page tests | IN_PROGRESS | Unit scope is incomplete; the preview app lacks route parity; legacy domain records need branch IDs/predicates |
| Branches, groups and assignments | Branch/member CRUD; non-admin branch mutation and generic assignment reads/writes now require actor branch membership or own-resource access | Branch and unit access must constrain every relevant record, job, export and report | Generic branch/unit/membership/assignment tables; Education/Finance roots still lack branch ownership | `OrganizationService` enforces branch membership for branch managers and bounds assignments; this is not applied to financial services | Branch mutation and assignments are scoped for this slice; no universal branch row policy | `/organization` remains connected and permission-limited | Organization API→Prisma paths verified; finance records remain tenant-wide | Organization scope tests cover cross-branch assignment/branch denial; no finance branch tests | IN_PROGRESS | Finance audit confirmed Student, FeeAssignment, FeeDemand, Payment, refund, invoice, adjustment, and report records have no reliable branch ownership/filter. `Role.scopeUnitIds` is not enforced. |
| Users and profiles | Tenant CRUD, role/status assignment, temporary-password reset, self name/phone profile | Invites, verified email change, recovery, archive/restore, activity and generic identity | User, role, membership; `User` still contains student/guardian IDs | Access/profile APIs | Tenant permission guards and self-profile identity pinning | `/access` and `/profile` are API-backed | No complete invitation or recovery chain | Access/auth service tests; few page tests | IN_PROGRESS | Portal identity fields/role checks belong to an optional module, not shared user/auth core |
| RBAC and tenant isolation | Custom tenant roles/grants, permission guards, tenant-scoped Prisma, composite tenant constraints | Generic module-owned permissions plus tenant/branch/unit/resource scopes and fail-closed route coverage | Tenant composite relations; role/unit scope storage | Guards and scoped query infrastructure | Tenant isolation is stronger than branch/unit isolation | Permission/role UI exists; navigation filtering is not universal | Existing negative tenant tests; no route-wide branch proof | Scoped-Prisma, security and organization tests | IN_PROGRESS | Education/fee permissions are global; branch-scoped financial access is a material data-isolation gap |
| Plans and subscription lifecycle | Plan catalog/assignment, trial expiry, renewal invoice, past due, scheduled cancel and grace suspension | Versioned plans, proration, dunning, provider reconciliation and tenant self-service | Plan/module/entitlement/subscription and platform invoice models | Platform CRUD plus scheduled lifecycle service | Platform mutations; audited/idempotent lifecycle transitions | Plan and tenant subscription controls on `/platform` | Unit/service paths connected; live scheduler health not verified | Plan/lifecycle service tests | IN_PROGRESS | Legacy subscription metadata may diverge; no provider-driven subscription or plan versioning |
| Entitlements and usage | Effective modules and overrides; user/branch count caps; mapped API module guards | Central resolver enforces module/state/limits across routes, services, workers, exports, and APIs | Plan modules/entitlements, overrides, tenant module projection | Read/update APIs and selected quota/route checks | Platform controls; enforcement is not universal | Feature/limit UI and module-filtered navigation | Selected controller→DB paths connected | Override, quota, guard and dashboard tests | IN_PROGRESS | Custom keys are not installed modules; arbitrary override keys/core modules/dependencies require stronger validation; no storage/API metering history |
| Tenant fee/payment module | Extensive Education flows: catalog/assignments/demands, invoices, payments, receipts, refunds, credits, gateway/webhook and payer portal | Optional module with strict branch scope; generic billing only if separately modeled | Most finance obligations link to Student/StudentGroup/AcademicYear; financial root and payment records lack branch IDs | Real APIs/services, transactional ledger and provider/webhook paths; fee/payment reads and writes remain tenant-wide for finance staff | Tenant permissions and payer restrictions exist; branch isolation is not enforced on finance APIs | Many API-backed operational and payer pages | Some domain/provider flows exist; no branch-safe whole-journey browser/Neon evidence | Extensive domain tests, no branch finance coverage and no whole-journey E2E | IN_PROGRESS | Finance staff with tenant finance permissions can cross branch boundaries until branch ownership, migration/backfill policy, service predicates, reports, and negative tests are implemented. Generic billing for gyms/companies/NGOs is also absent. |
| Generic industry modules and billing | Free-form organization category and generic tenant foundation; hardcoded known module navigation | Manifest-driven installed modules; generic billable account/charge/invoice/payment contract; Education adapter | No generic billable-party layer; no module installation registry | No complete manifest/discovery/dependency lifecycle | Module permission definitions remain global | Main UI maps only known module keys; preview is behind | New industry module contract is unimplemented | No module contract tests | NOT_STARTED | Adding a tenant category does not add domain workflows; avoid claiming gym/company/NGO modules exist |
| SaaS invoices, payments and refunds | Separate platform invoices, manual payment reconciliation, refund request/decision | Provider checkout, signed webhooks, tax/accounting, automated refunds, reconciliation and idempotent retry | Separate PlatformInvoice/Payment/Refund models | Invoice issue, manual payment, refund APIs and scheduled renewal invoicing | Platform-only and audited | Platform tenant detail has forms/actions | APIs connect to Prisma; no live payment provider | Platform/lifecycle unit tests | IN_PROGRESS | Manual recording is not collection; no provider checkout/webhooks, tax, dunning, credit notes or provider reconciliation |
| Domains and subdomains | Slug resolver, `<slug>.localhost`, configured wildcard subdomains, custom-domain DNS TXT challenges/verification/primary host | Verified ownership plus deployed routing/TLS health before cutover | TenantDomain and verification fields; deployed migrations recorded | Domain CRUD/verify and fail-closed resolver | Platform controls; only verified mappings resolve | Platform domain workflow; tenant URLs are host-aware | API/browser host tests and migration record; live edge not checked | Domain resolver/HTTP tests | IN_PROGRESS | Production wildcard DNS, TLS automation, proxy health and live controlled-domain challenge remain |
| Notifications, audit and security | Outbox/delivery infrastructure, tenant templates/events, audit/hash chain, security/session foundations | Cover invite, billing, domain, quota, lifecycle and security events with delivery health and actor/branch context | Notification, outbox, audit/chain/key models | Existing APIs/workers and audit operations | Tenant/platform scoped; event coverage incomplete | `/notifications`, `/audit-logs` and platform views | Existing operation paths, not complete event coverage | Security/event tests partial | IN_PROGRESS | MFA/invite flows and billing/domain/security event catalogue, retry visibility and branch attribution remain |
| Reports and analytics | Education/fee reports plus generic dashboard summary | Generic configurable report definitions, branch-safe filters/exports, usage/operational analytics | Report/export jobs and domain records | Report APIs and tenant dashboard | Permission-scoped; branch coverage incomplete | Reports/dashboard routes exist in main app | No universal export-to-UI E2E | Limited domain/API/UI tests | IN_PROGRESS | Generic report registry, usage trends, export access checks and branch filtering require completion |
| Docker, Neon and production operations | Neon-targeted launcher/Compose, staged migration, ACL, tenant-constraint and backup scripts | Deployed host/TLS, runtime health, monitoring, tested backup restore and release/rollback procedure | Neon migration count is 55; `20261006000800_platform_tenant_provisioning_idempotency` is applied; runtime/migrator/backup roles and indexes verified | Deployment/verification scripts and CI database checks | Least-privilege role synchronization completed; production runtime evidence incomplete | Dockerized web/API and deployment proxy config | Staged Neon migration, tenant-relation preflight, index verification, signing-key provisioning and exact ACL synchronization passed | CI database/schema/Compose suites pass; no production restore proof | IN_PROGRESS | Production DNS/TLS/deployment/health/restore remain unverified; the Docker guide labels its older 45-migration snapshot historical |
| Full-stack integration/QA | Workspace-wide unit/component/schema tests; host recovery and provisioning wizard/idempotency specs | Browser/API/database journeys for host, tenant/branch isolation, RBAC, provisioning, billing and recovery | Neon has the staged provisioning migration; CI builds staged PostgreSQL schemas | API service/guard tests and real application routes | Host/account scope has negative tests; branch finance coverage incomplete | Main and preview UI have component tests | No Playwright/Cypress browser suite proving UI→API→Neon→UI | Latest: 16 workspace typechecks pass; root `npm test` passes (16 workspace test tasks plus 81 schema/migration checks); API 144/144, web 27/27, preview 2/2 | IN_PROGRESS | Add disposable-DB API integration and browser E2E; verify provisioning retry concurrency against Neon; exercise branch/tenant isolation and payment paths end to end |

### Feature dependency map

```text
Host resolution + authentication + tenant context
  └── tenant CRUD and provisioning
      ├── users and profiles
      │   └── generic RBAC and role scopes
      ├── branches + organization units
      │   └── branch-aware assignments and record access
      └── tenant settings + domain/branding

Plans + subscription lifecycle
  └── entitlement resolver + usage enforcement
      └── optional module installation and API/UI access
          └── Education fees today; future Fitness/HR/CRM/etc. modules

Generic billable accounts + charge/payment contracts (not yet built)
  ├── Education adapter → current student fee records
  └── future industry billing workflows

Notifications + audit are cross-cutting dependencies for provisioning,
security, subscription, domain, permission, and payment changes.
Docker/Neon operations and full-stack QA gate every production feature.
```

### Audit handoff and known document drift

- The prior review's findings table still contains stale statements that provisioning cannot select plans/modules and that group UI is missing. Current source supports plan/module selection, optional domain setup, and organization-unit management; remaining gaps are invitation/idempotency/retry, guided setup, scopes, and branch isolation.
- The detailed review findings and status matrix now reflect plan/module selection and organization-unit UI. Platform SaaS billing remains manual reconciliation, and organization units are not enforced row-level scope.
- `ARCHITECTURE_AND_DOCKER.md` labels its earlier 45-migration snapshot historical. The 2026-10-06 staged deployment applied migration `20261006000800` and synchronized ACLs; production DNS/TLS, restore, and live application flows still need independent release verification.
- Backend review found no clear accidental duplication: platform SaaS invoices/payments/refunds and tenant operational fee records are separate domains by design.
- The workspace snapshot contains no `.git` directory. Branch, dirty-file status, and diff could not be inspected before this documentation-only audit update.

## 18. Acceptance criteria

The platform is production-ready only when:

1. The platform, tenant, branch, and user hierarchy is understandable in the UI and enforced in the API/database.
2. Platform and tenant accounts can only authenticate and operate on their matching host and scope.
3. Provisioning is complete, idempotent, auditable, and creates all selected organization, admin, branch, subscription, entitlement, domain, and notification records without manual database steps.
4. Plans, subscription lifecycle, SaaS billing, usage, and entitlements operate end-to-end and are separate from tenant fee operations.
5. Every branch-sensitive record/API is actually branch-scoped or clearly documented as organization-wide; membership-only UI is not represented as data isolation.
6. Domain ownership and SSL readiness are verified before custom domains are routed.
7. Required API, UI, integration, migration, isolation, Docker, and security tests pass.
8. Neon migration/deployment, DNS/TLS, backups/restore, secrets, and runtime health are verified for the actual production environment.
9. The review matrix is updated with evidence and no schema-only capability is labeled complete.
