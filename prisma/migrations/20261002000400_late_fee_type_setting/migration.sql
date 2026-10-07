ALTER TABLE "tenant_settings"
ADD COLUMN "lateFeeFeeTypeId" UUID;

ALTER TABLE "tenant_settings"
ADD COLUMN "lateFeePaymentTermDays" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "tenant_settings_tenantId_lateFeeFeeTypeId_idx"
ON "tenant_settings" ("tenantId", "lateFeeFeeTypeId");

ALTER TABLE "tenant_settings"
ADD CONSTRAINT "tenant_settings_tenantId_lateFeeFeeTypeId_fkey"
FOREIGN KEY ("tenantId", "lateFeeFeeTypeId") REFERENCES "fee_types" ("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
