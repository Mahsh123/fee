# IAM-001 — Tenant user and role administration

## Scope

Give an institution administrator a tenant-scoped user directory, account provisioning, role membership editor, permission catalogue, and role permission editor. The platform permission catalogue is global; role grants and user membership remain tenant-owned.

## Account provisioning

- Admin provides a temporary password of at least 12 characters; only its bcrypt hash is stored.
- New staff users start active with `mustChangePassword=true`.
- First sign-in routes into password change before opening any workspace page.
- Password changes revoke all refresh sessions and append an audit record.
- User reads select explicit safe fields and never return a password hash.

## Role configuration

- Tenant-owned system roles remain the role keys supplied by the platform.
- Permission grants are edited from the grouped shared permission catalogue.
- `roles.permissionsConfigured` distinguishes an untouched role that uses the default matrix from an administrator's intentional grant set, including an empty set.
- Existing roles with permission rows are marked configured in the migration.
- Role/user status changes revoke affected refresh sessions; one active tenant owner must remain.

## Tenant and security controls

- User, role, membership, and audit access is tenant scoped in the API and database boundary.
- `PLATFORM_ADMIN` cannot be assigned as a tenant role.
- Role IDs and permission keys are validated against the current tenant/global catalogue before writes.
- User role changes require role assignment permission; disabling accounts requires user disable permission.

## HTTP surface

- `GET /access/users`, `POST /access/users`
- `PATCH /access/users/:id/roles`, `PATCH /access/users/:id/status`
- `GET /access/roles`, `GET /access/permissions`, `PATCH /access/roles/:id/permissions`
- `POST /auth/change-password`

## UI

- `/access` provisions staff users, edits role membership and permission grants, and activates/disables accounts.
- `/change-password` is required before a new staff account can enter the rest of the workspace.

## Verification status

Implementation is assembled. The consolidated typecheck, tests, tenant/security review, password-flow review, and migration validation remain in the end-of-build pass.
