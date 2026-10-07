-- Generated from prisma/schema.prisma and the explicit additive relation registry.
-- These relations were introduced after the original tenant-FK rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "credits" ADD CONSTRAINT "credits_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "late_fee_accruals" ADD CONSTRAINT "late_fee_accruals_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "students" ADD CONSTRAINT "students_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
COMMIT;
