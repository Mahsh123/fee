import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompositeTenantConstraintPlan,
  parseForeignKeyDdl,
  renderCompositeTenantConstraintMigration,
} from './generate-composite-tenant-constraints.mjs';

const schema = `
model Tenant {
  id String @id @db.Uuid
  parents Parent[]
  children Child[]
}
model Parent {
  id String @id @db.Uuid
  tenantId String @db.Uuid @map("tenant_id")
  tenant Tenant @relation(fields: [tenantId], references: [id])
  children Child[]
  @@unique([tenantId, id])
  @@map("parents")
}
model Child {
  id String @id @db.Uuid
  tenantId String @db.Uuid @map("tenant_id")
  tenant Tenant @relation(fields: [tenantId], references: [id])
  parentId String? @db.Uuid @map("parent_id")
  parent Parent? @relation(fields: [tenantId, parentId], references: [tenantId, id], onDelete: NoAction)
  @@index([tenantId, parentId])
  @@unique([tenantId, id])
  @@map("children")
}
`;

const targetSql = `
ALTER TABLE "children" ADD CONSTRAINT "children_tenant_id_parent_id_fkey"
  FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "parents" ("tenant_id", "id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "children" ADD CONSTRAINT "children_tenantId_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
`;

const legacySql = `
ALTER TABLE "children" ADD CONSTRAINT "children_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "children" ADD CONSTRAINT "children_tenantId_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
`;

test('foreign-key parser handles wrapped statements, escaped identifiers, and multiword actions', () => {
  const [constraint] = parseForeignKeyDdl(`
    ALTER TABLE "child" ADD CONSTRAINT "fk" FOREIGN KEY ("tenant_id", "parent_id")
      REFERENCES "parent" ("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
    ALTER TABLE "child" ADD CONSTRAINT "fk""quoted" FOREIGN KEY ("parent_id")
      REFERENCES "parent" ("id") ON DELETE SET NULL;
  `);

  assert.deepEqual(constraint, {
    name: 'fk',
    sourceTable: 'child',
    sourceColumns: ['tenant_id', 'parent_id'],
    targetTable: 'parent',
    targetColumns: ['tenant_id', 'id'],
    onDelete: 'NO ACTION',
    onUpdate: 'CASCADE',
  });
  assert.equal(parseForeignKeyDdl('ALTER TABLE "child" ADD CONSTRAINT "fk""quoted" FOREIGN KEY ("parent_id") REFERENCES "parent" ("id") ON DELETE SET NULL;')[0].name, 'fk"quoted');
});

test('plan contains only declared tenant composite edges and preserves the Prisma action across atomic phases', () => {
  const { plan, tenantModelCount, tenantRelationCount } = buildCompositeTenantConstraintPlan({
    schema,
    targetSql,
    legacySql,
    tenantModelNames: ['Parent', 'Child'],
  });

  assert.equal(tenantModelCount, 2);
  assert.equal(tenantRelationCount, 1);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].desired.onDelete, 'NO ACTION');
  assert.equal(plan[0].legacy.name, 'children_parent_id_fkey');

  const migrations = renderCompositeTenantConstraintMigration(plan);
  assert.deepEqual(migrations.map(({ directory }) => directory), [
    '20260930000100_tenant_composite_foreign_keys_add',
    '20260930000200_tenant_composite_foreign_keys_validate',
    '20260930000300_tenant_composite_foreign_keys_drop_legacy',
  ]);
  const [add, validate, dropLegacy] = migrations.map(({ sql }) => sql);
  assert.match(add, /BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s';[\s\S]*ADD CONSTRAINT "children_tenant_id_parent_id_fkey"[\s\S]*NOT VALID;[\s\S]*COMMIT;/);
  assert.match(add, /FOREIGN KEY \("tenant_id", "parent_id"\) REFERENCES "parents" \("tenant_id", "id"\) ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;/);
  assert.match(validate, /BEGIN;[\s\S]*SET LOCAL statement_timeout = '30min';[\s\S]*VALIDATE CONSTRAINT "children_tenant_id_parent_id_fkey";[\s\S]*COMMIT;/);
  assert.match(dropLegacy, /DO \$tenant_fk_phase_c\$[\s\S]*constraint_row\.confdeltype = 'a'[\s\S]*constraint_row\.convalidated[\s\S]*Expected legacy tenant foreign key[\s\S]*END[\s\S]*\$tenant_fk_phase_c\$;[\s\S]*DROP CONSTRAINT "children_parent_id_fkey";[\s\S]*COMMIT;/);
  assert.doesNotMatch(add + validate + dropLegacy, /children_tenantId_fkey/);
});

test('plan fails closed when the old ID-only relation is missing or ambiguous', () => {
  assert.throws(
    () => buildCompositeTenantConstraintPlan({ schema, targetSql, legacySql: '', tenantModelNames: ['Parent', 'Child'] }),
    /needs exactly one existing ID-only foreign key to replace; found 0/,
  );

  assert.throws(
    () => buildCompositeTenantConstraintPlan({
      schema,
      targetSql,
      legacySql: `${legacySql}\nALTER TABLE "children" ADD CONSTRAINT "another_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "parents" ("id") ON DELETE SET NULL;`,
      tenantModelNames: ['Parent', 'Child'],
    }),
    /needs exactly one existing ID-only foreign key to replace; found 2/,
  );
});

test('foreign-key parser rejects statements it cannot classify instead of omitting them', () => {
  assert.throws(
    () => parseForeignKeyDdl('ALTER TABLE child ADD FOREIGN KEY (id) REFERENCES parent(id);'),
    /unsupported foreign key statement/,
  );
});
