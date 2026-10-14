-- Generated from prisma/schema.prisma and the explicit additive billing-cycle relation registry.
-- Validate cycle/person and fee-item ownership after constraints are installed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';
ALTER TABLE "fee_assignment_cycles" VALIDATE CONSTRAINT "fee_assignment_cycles_tenantId_branchId_fkey";
ALTER TABLE "fee_assignment_cycles" VALIDATE CONSTRAINT "fee_assignment_cycles_tenantId_feeAssignmentId_fkey";
ALTER TABLE "fee_demands" VALIDATE CONSTRAINT "fee_demands_tenantId_cycleId_fkey";
ALTER TABLE "fee_usage_inputs" VALIDATE CONSTRAINT "fee_usage_inputs_tenantId_cycleId_fkey";
ALTER TABLE "fee_usage_inputs" VALIDATE CONSTRAINT "fee_usage_inputs_tenantId_feeStructureItemId_fkey";
ALTER TABLE "fee_usage_inputs" VALIDATE CONSTRAINT "fee_usage_inputs_tenantId_personId_fkey";
COMMIT;
