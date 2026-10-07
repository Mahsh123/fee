-- The payment's payer guardian must belong to the same tenant as the payment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_payerGuardianId_fkey" FOREIGN KEY ("tenantId", "payerGuardianId") REFERENCES "guardians"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
COMMIT;
