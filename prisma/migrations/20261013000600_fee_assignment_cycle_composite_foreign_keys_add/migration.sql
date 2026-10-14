-- Generated from prisma/schema.prisma and the explicit additive billing-cycle relation registry.
-- These relations were introduced with generic recurring fee cycles.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
ALTER TABLE "fee_assignment_cycles" ADD CONSTRAINT "fee_assignment_cycles_tenantId_branchId_fkey" FOREIGN KEY ("tenantId", "branchId") REFERENCES "branches" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_assignment_cycles" ADD CONSTRAINT "fee_assignment_cycles_tenantId_feeAssignmentId_fkey" FOREIGN KEY ("tenantId", "feeAssignmentId") REFERENCES "fee_assignments" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenantId_cycleId_fkey" FOREIGN KEY ("tenantId", "cycleId") REFERENCES "fee_assignment_cycles" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_usage_inputs" ADD CONSTRAINT "fee_usage_inputs_tenantId_cycleId_fkey" FOREIGN KEY ("tenantId", "cycleId") REFERENCES "fee_assignment_cycles" ("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_usage_inputs" ADD CONSTRAINT "fee_usage_inputs_tenantId_feeStructureItemId_fkey" FOREIGN KEY ("tenantId", "feeStructureItemId") REFERENCES "fee_structure_items" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_usage_inputs" ADD CONSTRAINT "fee_usage_inputs_tenantId_personId_fkey" FOREIGN KEY ("tenantId", "personId") REFERENCES "tenant_people" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
COMMIT;
