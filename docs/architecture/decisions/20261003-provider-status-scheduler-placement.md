# Provider status scheduler placement

## Status

Initial modular-monolith implementation choice; pending the consolidated architecture and security review. This decision does not change the system's modular-monolith architecture.

## Context

An overdue gateway order must be checked with the same tenant-configured credentials and the same transactionally verified capture/terminal-state path used by the finance API. The existing standalone worker is intentionally limited to notification delivery and reminder outbox work; it does not receive gateway-decryption material or financial database write access.

## Decision for this implementation batch

Run the scheduled provider-status coordinator in the API process and delegate all provider calls and resulting state transitions to `GatewaysService`. The scheduler first scans active-tenant IDs, then enters a tenant context before querying that tenant's overdue online orders. A conditional update leases each order and advances its next-check time before calling the provider, so multiple API replicas cannot claim the same order concurrently. Captures and explicit terminal results still use the existing verified transaction; unknown, pending, failed-attempt, and ambiguous states keep the payment responsibility reserved.

The polling interval, maximum automatic checks, initial and maximum retry delay, and lease duration are environment-configurable. Automatic retries stop at the configured limit. Manual finance checks remain available and do not consume that automatic retry limit. Adapters declare whether server-to-server order status checks are supported; an adapter without provider-side order state is excluded from automatic polling.

## Impact and limits

- API replicas perform a tenant-directory scan at the configured interval. Per-order tenant-scoped leases bound duplicate provider traffic and the order query is bounded per tenant per scan.
- The scheduler runs only in non-test API environments. It does not grant new database privileges or copy gateway secrets into the standalone notification worker.
- PayU failed attempts and unknown provider responses do not establish terminality. Hitting the automatic retry limit leaves the reservation held for an operator; local expiry never releases it.
- If provider polling volume later requires a dedicated financial worker, extract the status-check application service behind the same lease and verified transaction contract, then provision that worker with a narrowly scoped database role and gateway-secret access. No payment rows need rewriting; the lease columns and retry state remain usable during the move.

## Review gate

Consolidated review must verify API replica contention, tenant context isolation, attempt/lease expiry and restart behavior, provider error backoff, late capture races, and that every capture still posts exactly once with receipt, allocation, and balanced ledger evidence.
