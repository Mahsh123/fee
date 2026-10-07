-- Keep benefit assignment order and stacking tenant-configurable.
ALTER TABLE "benefit_assignments"
  ADD COLUMN "stackingMode" "StackingMode" NOT NULL DEFAULT 'STACKABLE',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX "benefit_assignments_tenantId_groupId_status_effectiveFrom_idx"
  ON "benefit_assignments"("tenantId", "groupId", "status", "effectiveFrom");
CREATE INDEX "benefit_assignments_tenantId_studentId_status_effectiveFrom_idx"
  ON "benefit_assignments"("tenantId", "studentId", "status", "effectiveFrom");

ALTER TABLE "surcharges"
  ADD COLUMN "stackingMode" "StackingMode" NOT NULL DEFAULT 'STACKABLE',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;
CREATE INDEX "surcharges_tenantId_active_effectiveFrom_idx"
  ON "surcharges"("tenantId", "active", "effectiveFrom");

CREATE INDEX "fee_overrides_tenantId_studentId_status_effectiveFrom_idx"
  ON "fee_overrides"("tenantId", "studentId", "status", "effectiveFrom");

INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "sensitive")
VALUES
  (gen_random_uuid(), 'benefit.read', 'benefit', 'read', 'benefit read access', false),
  (gen_random_uuid(), 'benefit.configure', 'benefit', 'configure', 'benefit configure access', true),
  (gen_random_uuid(), 'benefit.assign', 'benefit', 'assign', 'benefit assign access', true),
  (gen_random_uuid(), 'benefit.approve', 'benefit', 'approve', 'benefit approve access', true)
ON CONFLICT ("key") DO NOTHING;
