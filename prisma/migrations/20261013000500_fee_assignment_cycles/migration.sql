-- Generic, period-based fee generation for organisation people.
-- Cycle and usage rows are append-only billing inputs; resulting demand amounts
-- remain immutable calculation snapshots.
BEGIN;

CREATE TYPE "FeeAssignmentCycleStatus" AS ENUM ('GENERATING', 'COMPLETED', 'PARTIAL', 'FAILED');

CREATE TABLE "fee_assignment_cycles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "feeAssignmentId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "FeeAssignmentCycleStatus" NOT NULL DEFAULT 'GENERATING',
    "summary" JSONB,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_assignment_cycles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fee_assignment_cycles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "fee_usage_inputs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "feeStructureItemId" UUID NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "fee_usage_inputs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fee_usage_inputs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "fee_demands" ADD COLUMN "cycleId" UUID;

CREATE UNIQUE INDEX "fee_assignment_cycles_tenantId_id_key" ON "fee_assignment_cycles"("tenantId", "id");
CREATE UNIQUE INDEX "fee_assignment_cycles_tenantId_feeAssignmentId_frequency_periodStart_key" ON "fee_assignment_cycles"("tenantId", "feeAssignmentId", "frequency", "periodStart");
CREATE UNIQUE INDEX "fee_assignment_cycles_one_time_per_assignment_key" ON "fee_assignment_cycles"("tenantId", "feeAssignmentId") WHERE "frequency" = 'ONE_TIME';
CREATE INDEX "fee_assignment_cycles_tenantId_feeAssignmentId_periodStart_idx" ON "fee_assignment_cycles"("tenantId", "feeAssignmentId", "periodStart");
CREATE INDEX "fee_assignment_cycles_tenantId_branchId_idx" ON "fee_assignment_cycles"("tenantId", "branchId");
CREATE INDEX "fee_assignment_cycles_tenantId_status_periodStart_idx" ON "fee_assignment_cycles"("tenantId", "status", "periodStart");

CREATE UNIQUE INDEX "fee_usage_inputs_tenantId_id_key" ON "fee_usage_inputs"("tenantId", "id");
CREATE UNIQUE INDEX "fee_usage_inputs_tenantId_cycleId_personId_feeStructureItemId_key" ON "fee_usage_inputs"("tenantId", "cycleId", "personId", "feeStructureItemId");
CREATE INDEX "fee_usage_inputs_tenantId_cycleId_personId_idx" ON "fee_usage_inputs"("tenantId", "cycleId", "personId");
CREATE INDEX "fee_usage_inputs_tenantId_personId_idx" ON "fee_usage_inputs"("tenantId", "personId");
CREATE INDEX "fee_usage_inputs_tenantId_feeStructureItemId_idx" ON "fee_usage_inputs"("tenantId", "feeStructureItemId");

COMMIT;
