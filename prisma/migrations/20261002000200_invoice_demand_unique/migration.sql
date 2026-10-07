CREATE UNIQUE INDEX "invoices_tenantId_demandId_key"
ON "invoices" ("tenantId", "demandId");
