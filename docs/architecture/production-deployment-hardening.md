# Production deployment and recovery

**Status:** deployment configuration and runbooks updated 2026-10-07. The production stack has not been deployed or load-tested from this document.

## Keep the current architecture

The application remains a modular monolith: Next.js, NestJS API, one background worker, Neon PostgreSQL, Redis/BullMQ, and Nginx. The existing provider-neutral gateway adapter, transactional payment/ledger flow, idempotency, audit, and outbox remain the design. The current repository does not need Kubernetes, Kafka, Kong, a service mesh, per-tenant databases, or a GPU host.

Keep one API, one web process, and one worker on a small single VPS. This is a low-cost initial topology, not a high-availability or measured capacity claim. The committed steady-state service memory ceilings sum to about 2.25 GiB; this is a limit total, not reserved/observed use. Migration has its own 1 GiB ceiling and can create short CPU/disk spikes. A 1 GB VPS does not have safe headroom for this stack. Start around 2 vCPU / 4 GB RAM, monitor actual use, and size from traffic, database latency, queue depth, and payment/report workload. Keep Neon external; Redis contains queue/operational state, not the financial record.

`deploy.replicas` is set to one in the production Compose profile. The deployment script uses ordinary Docker Compose on a single host; it is not a multi-host scheduler or a failover setup. Do not increase replica counts as a substitute for moving to a measured, orchestrated deployment.

## Build and deploy an immutable release

The main-branch CI job publishes API, worker, operations, web, and backup images to GHCR after verification succeeds. Each image is tagged with `sha-<full-git-commit>`. The additional `latest` tag is for convenience; production must use the SHA tag from the exact successful commit. CI does not deploy to the VPS.

1. Configure GHCR package access for the VPS. For private packages, use a narrowly scoped read-only token and `docker login ghcr.io`; never store a write token on the host.
2. Copy `.env.production.example` to `.env.production`. Set `IMAGE_TAG=sha-<full-commit-sha>` and fill the Neon URLs/roles, domain, TLS files, application secrets, SMTP, and backup values. Keep this file private and outside source control.
3. Provision the Neon `fee_runtime`, `fee_migrator`, and `fee_backup` roles using the [managed Neon database procedure](decisions/20261005-neon-managed-postgres.md). API traffic uses the pooled runtime URL; migration and backup use the direct endpoint. The owner URL is used only by the one-shot bootstrap.
4. Prepare the Nginx certificate files and host configuration. DNS, wildcard DNS, TLS renewal, and custom-domain edge routing remain deployment-specific and are not configured by CI.
5. From the repository checkout on the VPS, run `npm run deploy:production -- --env-file .env.production`. The script validates the rendered Neon target, pulls the selected SHA-tagged images, applies the staged migration/bootstrap dependencies, starts services, and waits for service health checks.
6. Inspect service health and logs before opening traffic:

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml ps
   docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 api worker migration
   docker stats --no-stream
   curl --fail --silent https://platform.example.com/health/ready
   ```

   Also confirm Nginx TLS, Neon health, and queue activity.

For rollback, set `IMAGE_TAG` to the previous known-good commit SHA and run the same deploy command. Only roll application images back when the deployed database migrations remain backward-compatible with that release. Migrations are forward-only; a destructive or incompatible database rollback needs a reviewed recovery plan and restore from backup, not an image rollback.

The image tag is commit-addressed, but a registry administrator could still overwrite tags unless registry policy prevents it. Restrict package write access to CI and operators, and enable immutable-tag protections where the registry supports them.

## Off-site encrypted backups

The production backup sidecar runs `pg_dump`, encrypts the stream with `age`, retains local artifacts in the `backups` Docker volume, and can upload the encrypted artifact to an S3-compatible object store. Configure these optional values together in `.env.production`:

- `BACKUP_S3_ENDPOINT`: provider endpoint, for example an S3-compatible service endpoint.
- `BACKUP_S3_BUCKET` and `BACKUP_S3_PREFIX`: private bucket and object prefix.
- `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION`: dedicated write-only credentials/region for that prefix.
- `BACKUP_AGE_RECIPIENT`: public age recipient; keep its matching private identity in an independent secure location.
- `BACKUP_RETENTION_DAYS`: local retention only. Configure a separate object-store lifecycle policy for off-site retention and deletion.

If all S3 settings are blank, backups remain only on the VPS volume; the script warns on each run. Partial S3 configuration fails closed. Uploads retry five times with backoff; when they still fail, the encrypted local artifact is retained, the failure is logged, and the container waits for its next scheduled dump instead of entering a rapid restart/dump loop. A successful upload updates `/backups/.last-offsite-upload`. Alert on upload-failure logs and stale/missing success timestamps through the host's external monitoring; the repository does not provision that alert destination. Use a private bucket, least-privilege credentials, encryption at rest at the provider in addition to age encryption, and an independent credential/identity vault. The S3 upload is not a substitute for Neon point-in-time recovery.

### Restore drill

Run a restore drill at least quarterly and after changing the backup image or key process. Do not restore over production as a test.

1. Select an encrypted backup from the off-site bucket and retrieve the age private identity from its separate vault.
2. Decrypt to a pipe and list the archive without writing plaintext to disk:

   ```sh
   age --decrypt --identity /secure/backup-identity.txt feeplatform-YYYYMMDDTHHMMSSZ.dump.age \
     | pg_restore --list --file=/tmp/fee-backup-contents.list -
   ```

3. Create an isolated, empty Neon branch/database for recovery, then restore into that target with reviewed ownership and ACL options. Confirm schema/migration state, tenant counts, selected payment/receipt/ledger consistency, audit-chain checks, and application startup against that isolated target.
4. Record the backup timestamp, recovered database target, restore duration, validation results, and any remediation. Delete the temporary branch/database after evidence has been recorded.

The restore drill has not been performed by this change. Off-site configuration, object lifecycle policy, key custody, and a successful restore are production launch requirements.

The S3-compatible settings in this runbook are only for encrypted database backup artifacts. The previous application `S3_*` settings had no storage service or upload/download consumers, so they were removed rather than presented as working document storage. Tenant document/object storage needs its own authenticated, tenant-scoped upload/download flow and is not implemented by backup configuration.

## Database isolation and RLS decision

Neon remains the shared PostgreSQL database with distinct runtime, migration, and backup roles, tenant-aware Prisma constraints, tenant-scoped query enforcement, and audited business logic. Do not enable PostgreSQL row-level security broadly yet: not every standalone Prisma statement establishes a transaction-local `fee.current_tenant` setting. A policy without complete transaction context could either reject normal work or, worse, create a false sense of isolation.

RLS is a staged hardening item. Before piloting it on a disposable Neon branch, route every tenant query through an explicit transaction/context boundary, set and clear the tenant GUC transaction-locally, define behavior for platform support and background jobs, keep migration/backup roles separate, add negative tests for tenant and branch crossing, and measure connection-pool behavior. Add policies only to a small table group after those preconditions pass, then expand using a reviewed migration and rollback plan.

## Refund behavior and limitations

Manual refunds retain their existing approval and ledger process. The tenant fee refund screen can now request a provider refund for supported online payments. The API uses the configured gateway adapter, stable refund number, and source payment references. It only reverses allocations and posts the local ledger when the adapter reports `REFUNDED` and the returned amount/currency exactly match the request. A provider `FAILED` result does not post local accounting. A pending response, mismatched result, or ambiguous network failure remains `PROCESSING`, writes an audit/outbox event, and opens a reconciliation record; the UI warns staff not to submit it again.

The current change does not complete provider refund webhooks or automated refund-status polling. Pending/unknown refunds must be checked against the provider dashboard. An audited reconciliation form records the operator-confirmed provider outcome, exact amount/currency, provider ID, and reason; a confirmed failure never posts the ledger, while a confirmed success completes the local reversal. If local posting fails after provider success, the saved confirmation offers an audited `Finalize ledger` action without issuing another provider request. PayU remains a manual-dashboard refund provider. Full asynchronous provider refund lifecycle support remains open.

## Monitoring and capacity

Existing API readiness/liveness and container health checks, structured application logs, Docker restart policies, audit records, provider reconciliation records, Neon monitoring, and `docker stats` provide the current base. Sentry and OpenTelemetry variables were removed from application configuration because no SDK/exporter consumes them. Do not treat the removed variables as active telemetry.

Before production launch, choose an error-monitoring destination and alert path. At minimum alert on repeated API/worker restarts, failed readiness, sustained host CPU/RAM/disk pressure, Neon connection/latency/storage limits, queue depth or failed jobs, backup upload age/failure, and provider reconciliation/refund failures. A health endpoint alone does not page an operator. The repository currently does not provision an external monitoring service or paging destination.

## Optional AI and new capacity

There is no AI feature or GPU workload in the current runtime. If a later module needs AI, prefer an external API or asynchronous queue-backed integration with tenant quotas, consent/security review, timeout/retry controls, and explicit cost limits. Add a GPU host only after a measured workload requires one.
