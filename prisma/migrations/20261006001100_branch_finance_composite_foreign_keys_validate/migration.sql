-- Generated from prisma/schema.prisma and the explicit additive relation registry.
-- Validate rows after indexes and the NOT VALID constraints are installed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';
ALTER TABLE "adjustments" VALIDATE CONSTRAINT "adjustments_tenantId_branchId_fkey";
ALTER TABLE "credits" VALIDATE CONSTRAINT "credits_tenantId_branchId_fkey";
ALTER TABLE "fee_assignments" VALIDATE CONSTRAINT "fee_assignments_tenantId_branchId_fkey";
ALTER TABLE "fee_demands" VALIDATE CONSTRAINT "fee_demands_tenantId_branchId_fkey";
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_tenantId_branchId_fkey";
ALTER TABLE "late_fee_accruals" VALIDATE CONSTRAINT "late_fee_accruals_tenantId_branchId_fkey";
ALTER TABLE "ledger_entries" VALIDATE CONSTRAINT "ledger_entries_tenantId_branchId_fkey";
ALTER TABLE "payment_orders" VALIDATE CONSTRAINT "payment_orders_tenantId_branchId_fkey";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_tenantId_branchId_fkey";
ALTER TABLE "receipts" VALIDATE CONSTRAINT "receipts_tenantId_branchId_fkey";
ALTER TABLE "refunds" VALIDATE CONSTRAINT "refunds_tenantId_branchId_fkey";
ALTER TABLE "students" VALIDATE CONSTRAINT "students_tenantId_branchId_fkey";
COMMIT;
