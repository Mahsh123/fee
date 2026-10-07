ALTER TABLE "late_fee_accruals"
ADD COLUMN "resultDemandId" UUID;

CREATE INDEX "late_fee_accruals_tenantId_demandItemId_idx"
ON "late_fee_accruals" ("tenantId", "demandItemId");

CREATE INDEX "late_fee_accruals_tenantId_resultDemandId_idx"
ON "late_fee_accruals" ("tenantId", "resultDemandId");

CREATE UNIQUE INDEX "late_fee_accruals_tenantId_demandItemId_calculatedFor_key"
ON "late_fee_accruals" ("tenantId", "demandItemId", "calculatedFor");

ALTER TABLE "late_fee_accruals"
ADD CONSTRAINT "late_fee_accruals_tenantId_demandItemId_fkey"
FOREIGN KEY ("tenantId", "demandItemId") REFERENCES "fee_demand_items" ("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "late_fee_accruals"
ADD CONSTRAINT "late_fee_accruals_tenantId_resultDemandId_fkey"
FOREIGN KEY ("tenantId", "resultDemandId") REFERENCES "fee_demands" ("tenantId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
