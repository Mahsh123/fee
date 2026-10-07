-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "delete_eligible" BOOLEAN NOT NULL DEFAULT false,
    "parentId" UUID,

    CONSTRAINT "academic_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_applications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "delete_eligible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "admission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "applicationId" UUID,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "delete_eligible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_demands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "delete_eligible" BOOLEAN NOT NULL DEFAULT false,
    "feeAssignmentId" UUID,

    CONSTRAINT "fee_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "delete_eligible" BOOLEAN NOT NULL DEFAULT false,
    "paymentOrderId" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_transactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentOrderId" UUID,
    "settlementId" UUID,

    CONSTRAINT "gateway_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credits" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentId" UUID,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "demandId" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_chain_heads" (
    "tenantId" UUID NOT NULL,
    "last_sequence" BIGINT NOT NULL DEFAULT 0,
    "last_hash" TEXT NOT NULL DEFAULT 'GENESIS',

    CONSTRAINT "audit_chain_heads_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "tenantId" UUID NOT NULL,
    "chain_sequence" BIGINT NOT NULL,
    "entity_table" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "before_image" JSONB NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'DATABASE',
    "previous_hash" TEXT NOT NULL,
    "event_hash" TEXT NOT NULL,
    "append_nonce" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("tenantId","chain_sequence")
);

-- CreateIndex
CREATE INDEX "academic_units_tenant_parent_idx" ON "academic_units"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "academic_units_tenantId_id_key" ON "academic_units"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_applications_tenantId_id_key" ON "admission_applications"("tenantId", "id");

-- CreateIndex
CREATE INDEX "admissions_tenant_application_idx" ON "admissions"("tenantId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "admissions_tenantId_id_key" ON "admissions"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_assignments_tenantId_id_key" ON "fee_assignments"("tenantId", "id");

-- CreateIndex
CREATE INDEX "fee_demands_tenant_assignment_idx" ON "fee_demands"("tenantId", "feeAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_demands_tenantId_id_key" ON "fee_demands"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_tenantId_id_key" ON "payment_orders"("tenantId", "id");

-- CreateIndex
CREATE INDEX "payments_tenant_order_idx" ON "payments"("tenantId", "paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_id_key" ON "payments"("tenantId", "id");

-- CreateIndex
CREATE INDEX "gateway_transactions_tenant_order_idx" ON "gateway_transactions"("tenantId", "paymentOrderId");

-- CreateIndex
CREATE INDEX "gateway_transactions_tenant_settlement_idx" ON "gateway_transactions"("tenantId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_transactions_tenantId_id_key" ON "gateway_transactions"("tenantId", "id");

-- CreateIndex
CREATE INDEX "credits_tenant_payment_idx" ON "credits"("tenantId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "credits_tenantId_id_key" ON "credits"("tenantId", "id");

-- CreateIndex
CREATE INDEX "invoices_tenant_demand_idx" ON "invoices"("tenantId", "demandId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_id_key" ON "invoices"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_tenantId_id_key" ON "settlements"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_tenantId_append_nonce_key" ON "audit_log"("tenantId", "append_nonce");

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_tenantId_parentId_fkey" FOREIGN KEY ("tenantId", "parentId") REFERENCES "academic_units"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "admission_applications"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_assignments" ADD CONSTRAINT "fee_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_demands" ADD CONSTRAINT "fee_demands_tenantId_feeAssignmentId_fkey" FOREIGN KEY ("tenantId", "feeAssignmentId") REFERENCES "fee_assignments"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_paymentOrderId_fkey" FOREIGN KEY ("tenantId", "paymentOrderId") REFERENCES "payment_orders"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_tenantId_paymentOrderId_fkey" FOREIGN KEY ("tenantId", "paymentOrderId") REFERENCES "payment_orders"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_transactions" ADD CONSTRAINT "gateway_transactions_tenantId_settlementId_fkey" FOREIGN KEY ("tenantId", "settlementId") REFERENCES "settlements"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credits" ADD CONSTRAINT "credits_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "payments"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_demandId_fkey" FOREIGN KEY ("tenantId", "demandId") REFERENCES "fee_demands"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
