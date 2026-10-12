# Wasl Web Application UX Architecture

This review covers the Next.js web application only. The native Flutter application and the backend contract are outside this redesign.

## Existing page map

Wasl resolves the organisation from the request host, so tenant pages live at the tenant host root rather than under a duplicated `/app` prefix. Platform administration uses a separate platform host and `/platform` routes.

| Area | Existing routes and structure | Data source |
| --- | --- | --- |
| Platform | `/platform` overview, `/platform/tenants`, `/platform/tenants/:id`, `/platform/provision`, `/platform/plans`, `/platform/admins` | Platform API endpoints through `apiRequest` |
| Tenant core | `/` dashboard, `/organization`, `/access`, `/reports`, `/notifications`, `/settings`, `/audit-logs`, `/profile`, `/portal` | Tenant APIs through `apiRequest`; the shell applies host and session scope |
| Optional admissions module | `/students`, `/students/:id`, `/admissions`, `/academic` | Tenant APIs; shell only offers module navigation when enabled |
| Fees and payments | `/sponsors`, `/fee-catalog`, `/fee-structures`, `/fee-policies`, `/benefits`, `/payer-responsibilities`, `/fee-assignments`, `/fee-demands`, `/late-fees`, `/installments`, `/credits`, `/adjustments`, `/invoices`, `/payments`, `/gateways`, `/refunds`, `/receipts`, `/reconciliation` | Tenant APIs; navigation is contributed by the enabled Fees and Payments modules |
| Public identity and recovery | `/`, `/login`, `/register`, `/accept-invitation`, `/forgot-password`, `/reset-password`, `/change-password`, `/verify-email-change` | Existing tenant context and authentication APIs |

The platform tenant detail view uses tabs for related tenant-owned configuration: overview, organisation, users, modules and limits, subscription and billing, and domains and security. The provisioning form is already a five-step wizard. Tenant user and role administration are kept together because their access rules are interdependent.

## Changes implemented

- Kept existing tenant-root and `/platform` route conventions; no duplicate route tree or backend API was introduced.
- Added semantic, route-derived breadcrumbs. Nested tenant and platform records now link back to the appropriate directory, and platform tenant tabs use a URL hash so a selected tab survives refresh and can be deep-linked.
- Added accessible expandable navigation groups, with the current page's group opened automatically. The long Fees and Payments lists no longer need to occupy the sidebar at once.
- Filtered tenant navigation by both the enabled module and the permissions already returned for the signed-in user. Platform controls remain separate from tenant controls.
- Added a profile menu with direct profile, password-change, and sign-out actions. The sidebar account identity now opens the profile instead of unexpectedly signing the user out.
- Reduced shared page/card density and aligned common focus, active, and input states to the Wasl emerald palette. The mobile drawer and desktop collapse behavior remain in the shared shell.
- Scoped platform data loading to the active route. The overview loads its metrics and recent tenants; tenant directory, plans, provisioning, and platform-admin pages load their own required datasets. Tenant-detail APIs load when their corresponding tab is opened.

## Route and interaction checks to retain

- Refresh and direct navigation on `/platform/*`, tenant root routes, record routes, and public recovery routes.
- Platform accounts must stay on the platform host; tenant accounts must stay on their tenant host.
- Hidden navigation is only a UX aid. Existing backend authorisation and tenant isolation remain the security boundary.
- Tenant-detail tabs must load from and preserve their hash (`#organization`, `#users`, `#billing`, and the other tab keys).
- Search, filtering, pagination, wizard dirty-state prompts, forms, empty/loading/error states, and existing API persistence must keep working.
- At narrow widths the shell uses a drawer, page content becomes single-column, and tab lists/tables remain independently scrollable.

## Known gaps from the audit

- Platform plans, invoice/refund summary, and tenant subscription/payment actions do not yet have a global SaaS billing API and dedicated billing directory page. They remain on the existing plan route and tenant-specific billing tab; this redesign does not invent a mock page or change the API contract.
- Several independently routed platform screens still share the `PlatformConsole` state controller. Data fetching is now route-scoped, but the controller should be split into feature modules before the platform surface grows further.
- This is a source-level UI audit. A real-browser pass at desktop, tablet, and mobile sizes still depends on the local web/API services being available; component checks and the web build are the automated verification for this change.
