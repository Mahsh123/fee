# FND-001 — Request-scoped tenant context

## Purpose

Make the dedicated platform hostname or institution hostname resolve the expected workspace before authentication, then require every authenticated token to match that server-resolved workspace. Keep the verified JWT as the authenticated principal and the tenant-scoped Prisma boundary as the data-access enforcement layer.

## Business rules

- `platform.example.com` resolves to the platform workspace. Exactly one other label below `example.com` (for example, `school.example.com`) resolves by tenant slug. Local development uses `platform.localhost` and `school.localhost`; the `platform` label is reserved and the domain apex is not a platform login host.
- A public sign-in request does not include tenant ID, slug, or organization details. The API resolves the host first, then scopes credential and session operations to that tenant.
- On authenticated routes, the request hostname must resolve and the verified access-token tenant claim must equal the resolved tenant. Requests with a valid token on a sibling tenant hostname fail before controller execution.
- Platform-host authentication is restricted to the reserved platform tenant and platform-administrator accounts. Tenant accounts cannot use that host.
- Request bodies, query parameters, and headers cannot select another tenant. A legacy `X-Tenant-Id` header, if present outside browsers, must occur exactly once and equal the signed token; it never establishes context. Browser CORS no longer advertises this header.
- Public requests start without authenticated tenant context; host middleware records a separate expected-workspace resolution. Sign-in and refresh establish a limited operation scope only after validating the host and token/credentials.
- Refresh and logout only accept a refresh token on the hostname for the tenant that issued it.
- Public tenant context exposes only the resolved tenant's institution name, safe logo URL, colors, and configured landing copy. Unknown and inactive hostnames return explicit safe states.
- Tenant-scoped services fail closed when no authenticated tenant is present.
- Request context ends when the request finishes and is isolated from concurrent requests.
- Until tenant-aware composite foreign keys land, Prisma relation reads, nested writes, relation filters, and relation ordering fail closed. Services resolve related tenant-owned rows through separately scoped model operations.
- Declared Prisma relations and every tenant-owned UUID field are generated from the schema plus the explicit reference manifest. Create/update checks use `(reference value, tenantId)` queries; ID arrays are checked element by element, and polymorphic IDs use a closed discriminator-to-model map. Polymorphic ID and discriminator changes must be supplied together.
- Unmodeled grouping values are explicitly classified with a reason. Adding a tenant-owned UUID field without a relation or a manifest classification makes database-client generation fail.
- The two non-UUID historical/event pointer fields are also explicitly classified as opaque; the audit display and outbox publisher do not load records by those values.
- Public tenant-directory access is limited to an exact slug lookup and selected public fields; an authenticated tenant can only read its own directory row unless its verified context is platform-admin.
- Auth work inherits the originating request ID, client address, and user-agent for audit correlation.

## Configuration impact

- `TENANT_BASE_DOMAIN` identifies the shared domain suffix. It defaults to `localhost` for development and must be configured to the production domain in production; the platform host is `platform.<TENANT_BASE_DOMAIN>`.
- CORS accepts the configured platform origin and one-level tenant subdomains using the same protocol/port and same tenant host. The API proxy must preserve the request `Host` header.

## API impact

- Host middleware centrally records `platform`, resolved `tenant`, or `unknown` host state before global guards. The base-domain apex is unknown.
- `GET /api/v1/tenant-context` returns safe public branding without a tenant ID.
- `POST /api/v1/auth/login` accepts only email and password; host resolution selects the tenant.
- Protected API requests require both a valid token and a matching host. Unknown/inactive tenants fail closed.

## Database impact

The tenant landing branding migration adds optional `logoUrl`, `landingTitle`, `landingDescription`, and `landingActionLabel` fields to `TenantBranding`. Existing installation history also includes the additive `InstallmentRuleItem.tenantId → Tenant.id`, nullable `IdempotencyKey.resourceType`, and `COURSE` academic-unit work. Idempotency completion persists and replays the ID/type pair; legacy rows without a resource type remain opaque and must not be dereferenced. The schema-derived reference generator checks that every tenant-owned model has a tenant relation and every nonrelational UUID field has an explicit target or opaque classification.

Composite tenant-aware foreign keys remain a separate reviewed database hardening item and are required before domain modules rely on relational reads or nested writes.

## UI impact

- A `TenantProvider` fetches public tenant context from the current host, applies branding, and exposes explicit loading, platform, tenant, inactive, and unknown states.
- Sign-in has no tenant slug field; platform administration is on `platform.<base-domain>` and each tenant host displays its own landing content.
- Cached browser sessions are cleared/rejected when their tenant does not match the current hostname.

## Security requirements

- Resolve the host using only the validated `Host` header and configured base domain; never use `X-Forwarded-Host` unless a trusted-proxy boundary is explicitly configured.
- Verify JWT before setting authenticated tenant context, and reject a tenant claim that differs from the earlier host-derived expectation.
- Never trust a client-supplied tenant ID as authority.
- Keep public login/refresh unscoped until the host and credentials/signed refresh token resolve a tenant, and keep those operations within that tenant boundary.
- Reject conflicting and repeated tenant headers.
- Disable relation traversal and nested relation writes until database tenant-equality constraints are installed.
- Validate polymorphic IDs against the exact target model selected by their discriminator; never accept a match from a different tenant-owned table just because UUID values can collide across tables.
- Reject polymorphic ID changes that omit their discriminator, and reject discriminator-only updates that could reinterpret an existing ID.
- Keep the global permission catalog readable to application requests, but require verified platform-admin context for mutations.
- Limit global tenant-directory reads to the public slug lookup, current-tenant lookup, and verified platform-admin use.

## Financial invariants

No money is moved in this feature. This establishes the tenant boundary required by all future financial modules.

## Acceptance criteria

- [ ] `platform.localhost` and `platform.example.com` resolve to platform context; the apex is not a platform login host; one-label subdomains such as `demo.localhost` and `school.example.com` resolve only by server-side tenant slug lookup.
- [ ] Public sign-in accepts email and password only; tenant identifiers sent by a client are stripped and ignored.
- [ ] A signed token for tenant A cannot access tenant B's hostname, and refresh/logout remain pinned to the token tenant's hostname.
- [ ] Public tenant branding excludes tenant IDs and financial/customer data; inactive and unknown host states are explicit.
- [ ] Development launcher seeds only three tenant directory and branding records idempotently, using the runtime DB login and no users, students, payments, or financial records.

- [x] Request context survives awaited work inside an HTTP request and is isolated after completion.
- [x] Tenant context is established from the verified access token before protected handlers run.
- [x] Prisma model operations on tenant-owned models add the authenticated tenant predicate; tenant-owned writes are bound to that tenant and conflicting tenant IDs fail closed.
- [x] Every generated tenant-owned Prisma model operation, including `updateManyAndReturn`, is scoped.
- [x] Relation traversal and nested relation writes fail closed until database tenant-equality constraints are installed.
- [x] Declared and manifest-backed tenant-owned scalar references are checked against the authenticated tenant, including array members and discriminator-selected targets, using the active transaction executor when present.
- [x] All 181 nonrelational tenant-owned UUID fields and the two non-UUID historical/event pointer fields are classified, including the new audit request/append nonces; generation fails when a new tenant UUID field is unclassified.
- [x] Polymorphic references use exactly one target model per discriminator value, avoiding cross-table UUID collisions.
- [x] API services receive a client type and a runtime handle that exposes only generated model delegates; raw SQL (including Prisma internals), connection lifecycle, transaction, and extension methods are hidden from property access and reflection. The full client is held in an ECMAScript private field.
- [x] The global permission catalog is read-only to tenant-context requests; writes require verified platform-admin context.
- [x] Additive migrations align the missing `InstallmentRuleItem` tenant FK and add typed idempotency resource IDs and the `COURSE` academic-unit type.
- [x] Global tenant-directory operations are limited to public slug lookup, current-tenant lookup, or verified platform-admin access.
- [x] Missing authenticated tenant context causes tenant-scoped accessors and Prisma model operations to fail closed.
- [x] An absent or matching tenant header succeeds; a conflicting or repeated header is rejected before controller execution over HTTP.
- [x] A protected HTTP route rejects a missing bearer token before controller execution.
- [x] Authentication audit records retain the originating request correlation ID.
- [ ] Independent security review passes.
- [x] API QA passes, including concurrency, missing/malformed token, header, directory, relation, scalar/array reference, discriminator, fluent relation, and bulk-write negative cases.
- [x] API typecheck and production build pass; the monorepo-wide CI gate remains tracked by `FND-000`.

## Test cases

- Tenant context survives a promise continuation.
- Tenant context is not visible outside the request scope.
- Tenant-scoped access without authentication throws.
- Tenant-owned model operations include bulk-returning writes.
- Nested relation selectors, predicates, ordering, and writes fail closed.
- Direct and filtered relation counts fail closed; scalar foreign-key references are resolved only within the current tenant.
- Cross-tenant scalar references and UUID-array elements fail closed; polymorphic IDs are checked against their exact discriminator-selected target.
- Fluent Prisma relation access fails before a database query can bypass the relation guard.
- Scalar foreign-key checks inside an interactive transaction use that transaction executor and remain isolated from parallel transactions.
- Auth login audit entries retain the request ID, IP address, and user-agent.
- Tenant-directory public and tenant-scoped lookups enforce their allowlist.
- Global permission reads remain available while tenant-context mutations fail and verified platform-admin mutations pass.
- Runtime database and transaction handles expose only generated model delegates, hide raw SQL/internal methods from property access and reflection, and the full Prisma client is not a runtime property of `PrismaService`.
- Correct tenant header succeeds; mismatching and repeated headers fail.
- Missing and malformed bearer tokens fail before controller invocation.
- Two concurrent request scopes cannot observe each other's tenant IDs.

## Known limitations

- Several database foreign keys still reference tenant-owned rows by ID alone and do not enforce tenant equality. Relation operations remain disabled at the Prisma boundary until an additive migration installs composite tenant-aware foreign keys. Scalar writes are checked in the active tenant transaction; database-level tenant equality remains necessary for direct database writers and future relational operations.
- `Student.familyGroupId` remains an opaque grouping key because the schema has no family-group entity. It is only compared within tenant-scoped student queries. If it becomes a record lookup or policy target, a tenant-owned family-group model must be added first.
- `AuditLog.entityId` preserves a deleted record’s historical identifier, and `OutboxEvent.aggregateId` is published with its event payload. Neither is used to load a record; any future dereference must first add a discriminator-backed tenant lookup.
- `AssignmentTargetType.COURSE` now maps to `AcademicUnitType.COURSE`. Assignment endpoints must still enforce that the target type agrees with the selected unit kind.
- Fixed internal raw SQL helpers bypass Prisma query extensions and must keep a closed table allowlist plus explicit tenant predicates. API services can reach only generated model operations through nested empty-target proxies; the full Prisma client and transaction executor context are held inside `PrismaService` ECMAScript-private fields, and the context is not a Nest provider. Framework health checks use the private client.
- Global `Permission` rows remain a platform-wide catalog; any future mutation path must run under verified platform-admin context or through an isolated bootstrap path.
- The worker application exists as an idle lifecycle shell, but it has no queue consumers yet; tenant context rehydration must be implemented and reviewed before any tenant-owned background work is enabled.

## Verification record

- Architecture review: PASS. Reference manifest, discriminator rules, migrations, and typed idempotency completion/replay align with the architecture.
- Security/tenant review: PASS. Verified permission writes, nested delegate `$parent`/internal-method closure, raw-SQL isolation, and private transaction context reviewed; no remaining tenant-isolation blocker.
- QA: PASS. API suite 7 files / 27 tests; API typecheck/build; database build; Prisma schema validation all pass. Generated-client checks reject direct and nested undefined polymorphic updates before database access. Direct and `{set: [...]}` UUID-array writes pass on create and update. All nine permission mutation operations are denied without platform-admin context and allowed with it. Runtime and returned-query reflection checks show no raw client path.
- Financial/domain review: PASS for the idempotency reference contract. The feature moves no money; typed references persist and replay together, and legacy null-type identifiers stay opaque.
- Architecture implementation review: PASS.
