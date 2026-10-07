# ADR — Platform subscription metadata

**Status:** Accepted  
**Date:** 2026-10-06

## Context

The platform tenant directory already records workspace lifecycle (`TRIAL`, `ACTIVE`,
`SUSPENDED`, `ARCHIVED`) and a trial end date. It has no subscription plan/status fields,
so the requested operator overview cannot distinguish tenant access state from
subscription state.

## Decision

Add optional subscription plan label, subscription status, and renewal date to the
existing platform-owned `Tenant` directory row. Keep `Tenant.status` as the access
lifecycle and keep `trialEndsAt` as the existing trial deadline. A subscription status
does not itself grant or revoke tenant access.

This change records administrative metadata only. It does not create pricing rules,
subscription invoices, recurring charges, or payment processing. Plan labels remain
operator-entered data rather than customer-specific logic in code.

## Consequences

- The platform console can display and update tenant access and subscription state
  independently.
- Existing tenants migrate with a default `TRIAL` subscription status and no plan or
  renewal date; existing tenant status and trial dates are unchanged.
- A later billing module can replace free-form plan labels with a versioned plan
  catalog and subscription history without changing tenant authentication or routing.

## Migration

An additive migration adds the subscription status enum and nullable plan/renewal
columns to `tenants`. No financial or tenant-owned rows are rewritten.
