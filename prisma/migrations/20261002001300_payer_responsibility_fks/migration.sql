-- Install after the concurrent-index phase; the new tables and references are
-- tenant-scoped and all referenced unique keys/child indexes must exist first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_payerSponsorId_fkey" FOREIGN KEY ("tenantId", "payerSponsorId") REFERENCES "sponsors"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "students"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_studentGroupId_fkey" FOREIGN KEY ("tenantId", "studentGroupId") REFERENCES "student_groups"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_academicYearId_fkey" FOREIGN KEY ("tenantId", "academicYearId") REFERENCES "academic_years"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payer_responsibility_rules" ADD CONSTRAINT "payer_responsibility_rules_tenantId_feeTypeId_fkey" FOREIGN KEY ("tenantId", "feeTypeId") REFERENCES "fee_types"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demand_responsibilities" ADD CONSTRAINT "fee_demand_responsibilities_tenantId_demandId_fkey" FOREIGN KEY ("tenantId", "demandId") REFERENCES "fee_demands"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demand_responsibilities" ADD CONSTRAINT "fee_demand_responsibilities_tenantId_demandItemId_fkey" FOREIGN KEY ("tenantId", "demandItemId") REFERENCES "fee_demand_items"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demand_responsibilities" ADD CONSTRAINT "fee_demand_responsibilities_tenantId_payerSponsorId_fkey" FOREIGN KEY ("tenantId", "payerSponsorId") REFERENCES "sponsors"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "fee_demand_responsibilities" ADD CONSTRAINT "fee_demand_responsibilities_tenantId_sourceRuleId_fkey" FOREIGN KEY ("tenantId", "sourceRuleId") REFERENCES "payer_responsibility_rules"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenantId_responsibilityId_fkey" FOREIGN KEY ("tenantId", "responsibilityId") REFERENCES "fee_demand_responsibilities"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_tenantId_responsibilityId_fkey" FOREIGN KEY ("tenantId", "responsibilityId") REFERENCES "fee_demand_responsibilities"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
COMMIT;
