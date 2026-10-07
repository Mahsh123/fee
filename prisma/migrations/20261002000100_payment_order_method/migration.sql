ALTER TABLE "payment_orders" ADD COLUMN "methodId" UUID;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenantId_methodId_fkey"
  FOREIGN KEY ("tenantId", "methodId") REFERENCES "payment_methods"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payment_orders_tenantId_methodId_idx" ON "payment_orders"("tenantId", "methodId");
