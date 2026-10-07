-- Validate the new tenant-composite payment guardian reference separately.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_tenantId_payerGuardianId_fkey";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_guardian_payer_check";
COMMIT;
