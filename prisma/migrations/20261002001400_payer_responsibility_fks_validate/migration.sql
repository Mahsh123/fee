-- Validation is separate so PostgreSQL can check existing rows with low-impact locks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_tenantId_payerSponsorId_fkey";
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_tenantId_studentId_fkey";
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_tenantId_studentGroupId_fkey";
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_tenantId_academicYearId_fkey";
ALTER TABLE "payer_responsibility_rules" VALIDATE CONSTRAINT "payer_responsibility_rules_tenantId_feeTypeId_fkey";
ALTER TABLE "fee_demand_responsibilities" VALIDATE CONSTRAINT "fee_demand_responsibilities_tenantId_demandId_fkey";
ALTER TABLE "fee_demand_responsibilities" VALIDATE CONSTRAINT "fee_demand_responsibilities_tenantId_demandItemId_fkey";
ALTER TABLE "fee_demand_responsibilities" VALIDATE CONSTRAINT "fee_demand_responsibilities_tenantId_payerSponsorId_fkey";
ALTER TABLE "fee_demand_responsibilities" VALIDATE CONSTRAINT "fee_demand_responsibilities_tenantId_sourceRuleId_fkey";
ALTER TABLE "payment_allocations" VALIDATE CONSTRAINT "payment_allocations_tenantId_responsibilityId_fkey";
ALTER TABLE "credit_allocations" VALIDATE CONSTRAINT "credit_allocations_tenantId_responsibilityId_fkey";
COMMIT;
