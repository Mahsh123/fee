-- Align the table's required tenant key with the tenant ownership used by every
-- other tenant-owned table in the Prisma schema.
ALTER TABLE "installment_rule_items"
ADD CONSTRAINT "installment_rule_items_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
