# ADR — Resolve the workspace from the hostname

**Status:** Accepted
**Date:** 2026-10-05

## Context

The existing application selected a tenant from a public slug submitted at sign-in. This asks users for organization details and lets two institution sign-in flows share one host. The product needs a dedicated platform control-plane host plus `tenant.example.com` and `tenant.localhost` landing pages, with authentication and data isolated to that host.

## Decision

The `platform` subdomain under `TENANT_BASE_DOMAIN` is the platform workspace (`platform.localhost` in development and `platform.example.com` in production). The domain apex is not a platform-admin host. Exactly one other label below the base domain is a candidate tenant slug. The `platform` label is reserved and cannot be assigned to a tenant. API middleware validates the `Host` header and resolves tenant slugs from the existing tenant directory before global guards execute. It stores host selection separately from the verified user tenant. Login receives no tenant field. Refresh/logout verify the token tenant against the current host. Protected requests require equality between the host-resolved tenant and the signed access-token claim.

Only the dedicated platform subdomain accepts platform-admin sessions. The apex and unknown labels are explicit not-found states; suspended and archived tenant labels are explicit inactive states. Public branding is served through a safe projection and uses the existing tenant branding configuration with four additive presentation fields.

Only the dedicated platform subdomain and one-level tenant subdomains are supported in this change. Host selection reads the original `Host` header, so reverse proxies must preserve it. A proxy that rewrites hostnames or uses a separate shared API hostname requires a separately reviewed trusted-proxy routing design.

## Consequences

- Tenant sign-in no longer needs the slug field, and sibling-tenant access tokens fail at the API boundary.
- The UI can render tenant-specific branding before sign-in without reading tenant data beyond the safe public projection.
- Each hostname has a host-only refresh cookie and independent browser storage.
- Production deployments must point `platform.<base-domain>` and `*.<base-domain>` to the reverse proxy, install wildcard TLS coverage, and configure CORS with the platform origin. The apex may serve a separate marketing site.
- The dev launcher seeds tenant directory and branding rows and can create three configured `TENANT_ADMIN` accounts in the existing tenant-scoped identity model; database schema migrations remain staged, reviewed, and append-only.
- Provider callback URLs keep their current path for compatibility, while the resolved active tenant hostname is authoritative; a callback path slug must match it before the signed webhook reaches payment processing.
- Verified custom domains are not automatically mapped by this subdomain resolver. They require a separate domain-ownership verification flow.

## Alternatives considered

- Continue asking for tenant slug: rejected because it conflicts with automatic host selection and permits ambiguous shared sign-in URLs.
- Trust a browser tenant header: rejected because caller-controlled values cannot authorize tenant data access.
- Use host as the authenticated identity: rejected because host routing does not authenticate a user. The JWT remains the authenticated principal and must match the host selection.
- Route using arbitrary forwarded host headers: rejected because they can be spoofed outside a configured trusted-proxy boundary.

## Migration

1. Add optional public landing branding fields with a forward Prisma migration.
2. Add central host middleware and a public context projection.
3. Bind login/refresh/logout and protected API guards to the resolved host.
4. Add host-aware client context, routing, branding settings, and local seed behavior.
5. Apply the staged migration, regenerate Prisma, verify local and production host patterns, and run independent reviews.
