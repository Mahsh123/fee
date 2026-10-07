-- Link financial allocations to the installment schedule that was actually settled.
ALTER TABLE "installment_items" ADD CONSTRAINT "installment_items_tenantId_demandItemId_fkey"
  FOREIGN KEY ("tenantId", "demandItemId") REFERENCES "fee_demand_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "installment_items_tenantId_demandItemId_idx" ON "installment_items"("tenantId", "demandItemId");

ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenantId_installmentId_fkey"
  FOREIGN KEY ("tenantId", "installmentId") REFERENCES "installments"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payment_allocations_tenantId_installmentId_idx" ON "payment_allocations"("tenantId", "installmentId");

ALTER TABLE "credit_allocations" ADD COLUMN "installmentId" UUID;
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_tenantId_installmentId_fkey"
  FOREIGN KEY ("tenantId", "installmentId") REFERENCES "installments"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "credit_allocations_tenantId_installmentId_idx" ON "credit_allocations"("tenantId", "installmentId");
