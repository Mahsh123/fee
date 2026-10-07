-- Store signed operational adjustments separately from the original fee and
-- installment schedule amounts. Existing rows start with a zero delta.
ALTER TABLE "fee_demand_items"
  ADD COLUMN "adjustmentAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "installments"
  ADD COLUMN "adjustmentAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "installment_items"
  ADD COLUMN "adjustmentAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "invoices"
  ADD COLUMN "adjustmentAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "adjustments"
  ADD COLUMN "installmentItemId" UUID;

CREATE INDEX "adjustments_tenantId_installmentItemId_idx"
  ON "adjustments"("tenantId", "installmentItemId");

ALTER TABLE "adjustments"
  ADD CONSTRAINT "adjustments_tenantId_installmentItemId_fkey"
  FOREIGN KEY ("tenantId", "installmentItemId")
  REFERENCES "installment_items"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "adjustments"
  VALIDATE CONSTRAINT "adjustments_tenantId_installmentItemId_fkey";

-- PostgreSQL permits multiple NULL values, while a non-NULL reversal target can
-- only be reversed once even when concurrent requests race.
CREATE UNIQUE INDEX "adjustments_tenantId_reversalOfAdjustmentId_key"
  ON "adjustments"("tenantId", "reversalOfAdjustmentId");
