# STU-002 — Academic years, units, and student groups

## Scope

Add tenant-scoped academic year lifecycle, academic unit administration, and reusable static or dynamic student groups. These structures provide assignment targets without baking school-specific classes or fee groups into the code.

## Domain behavior

- An academic year has a tenant-unique name and a validated date range.
- Setting a year current clears the prior current year inside the same transaction.
- Closed academic years are immutable and cannot remain current.
- Academic units use the existing parent tree and unit type catalogue.
- Static groups have tenant-validated current student membership.
- Dynamic groups store guided AND/OR conditions over student facts and custom attributes.
- Assignment generation evaluates dynamic group conditions through the shared fee engine; matched students receive the dynamic group id in their calculation context.
- Group changes only affect future assignments and demands; generated demand snapshots remain unchanged.

## Security and audit

- Queries and writes always include the authenticated `tenantId`.
- Group members must be active students from the same tenant.
- Invalid saved dynamic rules fail closed and stop demand generation with an actionable error.
- Academic year and group creation, updates, closure, and membership replacement write audit records transactionally.

## HTTP surface

- `GET/POST /academic-years`, `PATCH /academic-years/:id`, `POST /academic-years/:id/close`
- `GET/POST /student-groups`, `GET /student-groups/:id`, `PATCH /student-groups/:id`, `PUT /student-groups/:id/members`
- Existing `/academic-units` endpoints back academic unit administration.
- `/fee-assignments` accepts a selected academic year and custom group target.

## UI

- `/academic` manages academic years, unit hierarchy, group criteria, and static members.
- Assignment setup uses actual tenant academic years, matching academic unit types, and group choices.

## Verification status

Implementation is assembled. The consolidated API/web checks, dynamic criteria cases, tenant-isolation review, and migration validation remain pending for the final verification pass.

The least-privilege runtime ACL manifest now includes academic years, academic units, student reads, static/dynamic groups, membership replacement, the membership/profile reads used by assignment resolution, transactional audit inserts, and outbox event inserts. Membership replacement is the only delete privilege in this slice and is limited to `StudentGroupMember`; table-level writes on financial records remain denied. These grants are not yet verified against PostgreSQL 17, and the feature remains open until the consolidated verification pass.
