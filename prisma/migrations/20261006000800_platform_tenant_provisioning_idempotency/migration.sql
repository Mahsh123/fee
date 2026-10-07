SET lock_timeout = '5s';
BEGIN;

CREATE TABLE "platform_tenant_provisioning_operations" (
  "id" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "createdTenantId" UUID,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_tenant_provisioning_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_tenant_provisioning_operations_createdTenantId_fkey"
    FOREIGN KEY ("createdTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "platform_tenant_provisioning_operations_actorId_idempotencyKey_key"
  ON "platform_tenant_provisioning_operations"("actorId", "idempotencyKey");
CREATE INDEX "platform_tenant_provisioning_operations_createdTenantId_idx"
  ON "platform_tenant_provisioning_operations"("createdTenantId");

COMMIT;
