-- Preserve the payer identity from online order intent through verified capture.
ALTER TABLE "payment_orders"
  ADD COLUMN "payerType" "PayerType" NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN "payerName" TEXT,
  ADD COLUMN "payerPhone" TEXT,
  ADD COLUMN "payerEmail" TEXT,
  ADD COLUMN "payerSponsorId" UUID;

CREATE INDEX "payment_orders_tenantId_payerSponsorId_idx"
  ON "payment_orders"("tenantId", "payerSponsorId");
