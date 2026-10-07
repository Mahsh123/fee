# TEN-001 — Tenant branding, document numbering, and audit access

## Scope

Expose tenant branding and document numbering already represented in the domain schema, and provide staff with read access to the tenant's append-only audit history.

## Domain behavior

- Branding fields are versioned in-place as tenant configuration; edits are audited, while issued receipts and invoices retain their own document snapshots.
- Tenant-specific prefixes (including refunds, credit notes, and adjustments), padding, separators, displayed year, and annual counter reset are configurable.
- Numbering edits create a new format version; existing `Sequence` rows and issued document numbers are retained. Reservations happen inside the consuming transaction through a database-owned function. Annual reset begins on the next financial-year boundary after activation, requires the year in displayed numbers, and uses the rendered year as the sequence counter scope. Disabling it stops creating new annual scopes and carries forward the highest prior counter without merging or rewriting sequence history.
- Audit reads support paginated tenant-scoped search and date/entity/action filters. Audit entries are never edited through this API.
- Audit integrity reports the verified chain-link count and the first entry whose `prevHash` does not match the preceding hash.

## Security and tenant isolation

- Branding and numbering reads require tenant settings read access; their writes use separate branding and numbering permissions.
- Audit list, detail, and chain checks require `audit.read` and always filter by the authenticated tenant.
- General audit list responses omit before/after snapshots; a caller must explicitly open an entry to read its full detail.
- Branding audit snapshots omit the logo document identifier and expose only whether a logo reference exists.

## HTTP surface

- `GET/PATCH /settings/branding`
- `GET/PATCH /settings/numbering`; turning on annual reset schedules the safe effective date, and turning it off preserves counter continuity.
- `GET /audit-logs`, `GET /audit-logs/:id`, `GET /audit-logs/integrity`

## UI

- `/settings` includes regional/payment settings, institution identity and receipt/invoice footers, and document numbering.
- `/audit-logs` supports date/action/entity/search filters, paginated history, entry detail, and audit chain-link status.

## Verification status

Implementation and a narrow TEN-001 runtime ACL are assembled, including versioned settings, database reservation functions, restricted runtime RPCs, and configurable prefixes for every document kind. The existing `reset_annually_from` physical column is now mapped explicitly in Prisma so settings reads/writes match the deployed migration. The Prisma client was regenerated. The consolidated API/web checks, PostgreSQL migration/rollback and concurrency scenarios, sequence boundary review, permission review, tenant-isolation review, and audit integrity scenarios remain pending for the final verification pass.
