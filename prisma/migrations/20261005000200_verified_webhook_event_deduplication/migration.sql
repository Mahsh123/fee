-- The staged deployment runner builds and verifies the replacement partial
-- unique index concurrently before this transaction is applied.
SET lock_timeout = '5s';
BEGIN;
DROP INDEX "gateway_webhook_tenant_provider_event_key";
ALTER INDEX "gateway_webhook_tenant_provider_event_verified_key"
  RENAME TO "gateway_webhook_tenant_provider_event_key";
COMMIT;
RESET lock_timeout;
