# PLAT-001 — Platform administration and tenant provisioning

## Scope

Give platform operators a protected control plane to manage platform operators, tenants, tenant users, tenant administrators, workspace lifecycle, and subscription metadata. New tenant onboarding uses the same authentication, tenant-owned RBAC, settings, payment-method, and ledger abstractions as existing modules.

## Provisioning behavior

- Generates a normalized, unique hostname slug from the institution name; operators do not supply a tenant ID or slug during initial provisioning.
- Creates the tenant and initial `TENANT_ADMIN` account atomically; the administrator must change the supplied temporary password at first sign-in.
- Seeds the complete built-in tenant role set and its configurable default permission matrix from shared role definitions.
- Creates tenant settings, branding, document-number configuration, manual collection methods, and system ledger accounts.
- Writes an initialization event to the new tenant audit log and a provisioning event to the platform audit log in the same transaction.
- Tenant status changes are audited. Suspension and archive revoke outstanding refresh tokens; existing access tokens expire at their normal short access-token deadline.
- Platform tenant, tenant-user, tenant-admin, and platform-admin management routes require the existing platform-admin identity on the reserved platform hostname. Tenant-user actions also execute inside that tenant's scoped context.
- Tenant edits preserve financial history. Archive disables access; it never deletes a tenant or its financial records.
- Subscription plan label, status, and renewal date are control-plane metadata only. They do not charge money or automatically change access status.
- The reserved `fee-platform` workspace is excluded from the tenant directory and cannot be suspended or archived through this API.
- The initial platform operator and global permission catalogue are seeded idempotently from environment credentials. Re-running the seed does not rotate an existing operator's password.

## Security and tenant isolation

- Platform routes require a signed session whose server-issued user claims identify a platform administrator; ordinary tenant permissions cannot reach the controller.
- Tenant provisioning creates each institution's records under that new tenant's explicit request context. Global directory work stays under platform context.
- Tenant lifecycle and onboarding events are recorded in the platform audit chain; the new workspace also records its initial setup event.
- Production bootstrap receives the migration database credential in a one-shot process. API and worker processes do not receive it.
- The database ACL feature still grants the API runtime role only the currently reviewed authentication and audit operations. Application data writes, including this provisioning API, require the operation-level runtime grants and database invariants to be completed before production write paths are available.

## HTTP and UI

- `GET /platform/overview`
- `GET /platform/tenants` (search, lifecycle/subscription filters, pagination, host and usage summary)
- `GET /platform/tenants/:id`
- `POST /platform/tenants`
- `PATCH /platform/tenants/:id` (profile, slug, trial and subscription metadata)
- `PATCH /platform/tenants/:id/status`
- Tenant-scoped user/admin directory and provisioning routes under `/platform/tenants/:id`.
- Platform-operator directory and lifecycle routes under `/platform/super-admins`.
- `/platform` provides platform KPIs, tenant search/filter/pagination, provisioning, clickable tenant URLs, tenant usage, and tenant-user management.

## Verification status

Implementation status is tracked during this task. Completion requires API and browser checks for generated slugs/URLs, tenant-admin provisioning, platform-user separation, backend role guards, tenant-scoped usage and user management, inactive/unknown host handling, seed idempotency, and migration state.
