-- Partial refunds need amount-level allocation reversals. Original payment and
-- payment-allocation rows remain immutable; every reversal is a new row.
ALTER TABLE "credits" ADD COLUMN "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "refunds" ADD COLUMN "instrumentNumber" TEXT;
ALTER TABLE "refunds" ADD COLUMN "bankName" TEXT;
ALTER TABLE "refunds" ADD COLUMN "methodId" UUID;
CREATE INDEX "refunds_tenantId_methodId_idx" ON "refunds"("tenantId", "methodId");
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenantId_methodId_fkey"
  FOREIGN KEY ("tenantId", "methodId") REFERENCES "payment_methods"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "refund_allocations" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "refundId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "paymentAllocationId" UUID,
  "creditAllocationId" UUID,
  "creditId" UUID,
  "demandId" UUID,
  "demandItemId" UUID,
  "amount" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  CONSTRAINT "refund_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_allocations_one_source_check" CHECK (num_nonnulls("paymentAllocationId", "creditAllocationId", "creditId") = 1)
);

CREATE UNIQUE INDEX "refund_allocations_tenantId_id_key" ON "refund_allocations"("tenantId", "id");
CREATE INDEX "refund_allocations_tenantId_refundId_idx" ON "refund_allocations"("tenantId", "refundId");
CREATE INDEX "refund_allocations_tenantId_paymentId_idx" ON "refund_allocations"("tenantId", "paymentId");
CREATE INDEX "refund_allocations_tenantId_paymentAllocationId_idx" ON "refund_allocations"("tenantId", "paymentAllocationId");
CREATE INDEX "refund_allocations_tenantId_creditAllocationId_idx" ON "refund_allocations"("tenantId", "creditAllocationId");
CREATE INDEX "refund_allocations_tenantId_creditId_idx" ON "refund_allocations"("tenantId", "creditId");
CREATE INDEX "refund_allocations_tenantId_demandId_idx" ON "refund_allocations"("tenantId", "demandId");
CREATE INDEX "refund_allocations_tenantId_demandItemId_idx" ON "refund_allocations"("tenantId", "demandItemId");

ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_refundId_fkey"
  FOREIGN KEY ("tenantId", "refundId") REFERENCES "refunds"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_paymentId_fkey"
  FOREIGN KEY ("tenantId", "paymentId") REFERENCES "payments"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_paymentAllocationId_fkey"
  FOREIGN KEY ("tenantId", "paymentAllocationId") REFERENCES "payment_allocations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_creditAllocationId_fkey"
  FOREIGN KEY ("tenantId", "creditAllocationId") REFERENCES "credit_allocations"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_creditId_fkey"
  FOREIGN KEY ("tenantId", "creditId") REFERENCES "credits"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_demandId_fkey"
  FOREIGN KEY ("tenantId", "demandId") REFERENCES "fee_demands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_allocations" ADD CONSTRAINT "refund_allocations_tenantId_demandItemId_fkey"
  FOREIGN KEY ("tenantId", "demandItemId") REFERENCES "fee_demand_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
