# TEN-002 — Hostname-based tenant routing and branded landing pages

## Purpose

Select a tenant automatically from the hostname so institution staff do not enter a tenant ID, slug, or organization name during sign-in. Keep the platform control plane on its own host, separate from every institution subdomain.

## Host contract

- `platform.localhost` and `platform.<configured base domain>` (for example, `platform.example.com`) are platform hosts. The apex itself is not a Super Admin host.
- Exactly one other label under the base domain is treated as a candidate tenant slug: `demo.localhost`, `school.localhost`, `demo.example.com`, or `school.example.com`. The `platform` label is reserved.
- Unknown tenant slugs produce an explicit “workspace not found” state. `SUSPENDED` and `ARCHIVED` tenants produce an inactive state. `TRIAL` and `ACTIVE` tenants can use their public landing page.
- Nested labels, lookalike suffixes, and malformed host values never resolve to a tenant.
- Host routing uses the raw HTTP `Host` header after reverse proxying. The proxy must preserve `$host`; forwarded host headers are not trusted.

## Authentication and isolation

- API middleware resolves the hostname before the global authentication/permission guards and stores this separately from the authenticated tenant context.
- Public sign-in accepts email and password only. A tenant host supplies the candidate tenant from its server-resolved database directory row. The dedicated platform host supplies the reserved platform tenant and only accepts a platform-administrator account.
- Every protected API request requires a verified access token whose tenant claim equals the host-resolved tenant. The platform host only accepts a platform token whose tenant is the reserved platform tenant.
- Refresh and logout validate that the signed refresh token belongs to the current hostname. Refresh cookies remain host-only.
- Provider webhook callbacks retain their existing URL shape for compatibility, but the middleware-resolved active tenant host is authoritative. The URL slug must equal the host tenant slug; platform, apex, unknown, inactive, and sibling-host callbacks are rejected before payment processing.
- Tenant IDs are not returned from the public tenant context endpoint. Browser tenant labels are for display only and never authorize API access.
- The existing scoped Prisma layer continues to bind tenant-owned queries and writes to the verified token context.

## Public tenant branding

`GET /api/v1/tenant-context` returns one of `platform`, `tenant`, `inactive`, or `unknown`. A tenant response contains only its public institution name, slug, logo URL, colors, and landing title/description/action label. It does not create branding records during reads. The logged-in branding settings API is the audited update surface.

Logo values accept same-site root-relative paths or HTTPS URLs. Colors are six-digit hex values and are revalidated before becoming CSS values. Mock development logos are served from `apps/web/public/tenant-brands`.

## Development data

`npm run dev:neon` and the local Compose `development-seed` service run an idempotent seed before starting the API. They use only the restricted `fee_runtime` URL and create/upsert three directory and branding records (`demo`, `school`, `academy`). When a local-only `SEED_DEMO_PASSWORD` of at least 12 characters is set, they also create or link an independent `TENANT_ADMIN` account for each tenant using `SEED_DEMO_EMAIL`, `SEED_SCHOOL_EMAIL`, and `SEED_ACADEMY_EMAIL` (or documented `.test` defaults). Existing account passwords and statuses are preserved; role links are idempotently ensured. The schema preflight requires the branding migration, and tenant, branding, and account changes run in a transaction. The seed creates no students, fee configuration, payments, or other financial records.

## Production routing

- Set `TENANT_BASE_DOMAIN=example.com`, set `WEB_APP_URL` and `CORS_ORIGINS` to `https://platform.example.com`, and point the browser API base at `https://platform.example.com/api/v1`. Tenant origins inherit the configured protocol and port but must match the request's tenant host.
- Point `*.example.com` to the reverse proxy; this covers `platform.example.com` and tenant subdomains. The apex may point to a separate marketing site.
- Install a TLS certificate covering `*.example.com` on the proxy.
- Preserve the original host through Nginx so the API sees `school.example.com`.
- Apply database migrations through the staged migration pipeline. The development tenant seed is never run by production services.

## Verification criteria

- Host parser coverage: local and production platform/tenant subdomains, apex rejection, ports, uppercase normalization, malformed names, nested labels, lookalike suffixes, and bad slugs.
- API guard coverage: matching token/host succeeds; sibling-tenant token/host, inactive tenant, unknown tenant, non-platform token on the platform host, and platform token on a tenant subdomain fail before handlers.
- Public context coverage: only safe branding fields are returned; missing branding falls back without writes; unknown and inactive states are explicit.
- Auth coverage: tenant identity in request payload is stripped/ignored; sign-in and refresh remain host-bound.
- HTTP integration coverage: the actual host middleware resolves the incoming `Host` header, looks up the tenant directory, and runs before guards; platform, apex, matching, sibling, unknown, and inactive cases are covered.
- Provider callback coverage: only an active hostname-resolved tenant may process a callback, and the retained path slug must match that resolved tenant.
- Web behavior: branded tenant landing, platform landing, sign-in without tenant input, unknown and inactive states, and host-local session cleanup.
- Data review: dev seed creates only tenant and branding rows and is idempotent; no financial tables are touched.

## Status

Implementation in progress. Verification and independent architecture, security/tenant-isolation, and QA reviews must pass before this feature is marked complete.
