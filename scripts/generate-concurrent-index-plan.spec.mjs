import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolve } from 'node:path';
import { generatePrismaSchemaSql, generateTenantCompositeIndexPlan, parseGeneratedIndexes } from './generate-concurrent-index-plan.mjs';

const fixtureSchema = `
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
  parentId String @db.Uuid @map("parent_id")
  tenant Tenant @relation(fields: [tenantId], references: [id])
  parent Parent @relation(fields: [tenantId, parentId], references: [tenantId, id])
  @@unique([tenantId, id])
  @@index([tenantId, parentId])
  @@map("children")
}
`;

const fixtureSql = `
CREATE UNIQUE INDEX "parents_tenant_id_id_key" ON "parents"("tenant_id", "id");
CREATE UNIQUE INDEX "children_tenant_id_id_key" ON "children"("tenant_id", "id");
CREATE INDEX "children_tenant_parent_idx" ON "children"("tenant_id", "parent_id");
`;

test('generates mapped target and child indexes from validated Prisma schema and DDL', () => {
  const result = generateTenantCompositeIndexPlan({
    schema: fixtureSchema,
    schemaSql: fixtureSql,
    tenantModelNames: ['Parent', 'Child'],
  });

  assert.equal(result.tenantModelCount, 2);
  assert.equal(result.tenantRelationCount, 1);
  assert.equal(result.indexCount, 3);
  assert.deepEqual(result.plan.indexes.map((index) => [index.table, index.indexName, index.columns, index.unique]), [
    ['children', 'children_tenant_id_id_key', ['tenant_id', 'id'], true],
    ['children', 'children_tenant_parent_idx', ['tenant_id', 'parent_id'], false],
    ['parents', 'parents_tenant_id_id_key', ['tenant_id', 'id'], true],
  ]);
});

test('restricts a migration barrier to exact schema-derived unique indexes', () => {
  const result = generateTenantCompositeIndexPlan({
    schema: fixtureSchema,
    schemaSql: fixtureSql,
    tenantModelNames: ['Parent', 'Child'],
    indexNames: ['parents_tenant_id_id_key'],
  });
  assert.equal(result.indexCount, 1);
  assert.deepEqual(result.plan.indexes.map(({ indexName }) => indexName), ['parents_tenant_id_id_key']);
  assert.throws(() => generateTenantCompositeIndexPlan({
    schema: fixtureSchema,
    schemaSql: fixtureSql,
    tenantModelNames: ['Parent', 'Child'],
    indexNames: ['made_up_index'],
  }), /absent or ambiguous in Prisma-generated DDL/);
  assert.throws(() => generateTenantCompositeIndexPlan({
    schema: fixtureSchema,
    schemaSql: fixtureSql,
    tenantModelNames: ['Parent', 'Child'],
    indexNames: ['parents_tenant_id_id_key', 'parents_tenant_id_id_key'],
  }), /distinct PostgreSQL index identifiers/);
});

test('derives boolean partial-index predicates from Prisma DDL for staged index barriers', () => {
  const schemaIndexName = 'gateway_webhook_tenant_provider_event_key';
  const buildIndexName = 'gateway_webhook_tenant_provider_event_verified_key';
  const partialIndexSql = `CREATE UNIQUE INDEX "${schemaIndexName}" ON "gateway_webhooks" ("tenantId", "provider", "environment", "externalEventId") WHERE ("signatureValid" = true);`;
  const parsed = parseGeneratedIndexes(partialIndexSql);
  assert.deepEqual(parsed[0], {
    schema: 'public',
    table: 'gateway_webhooks',
    indexName: schemaIndexName,
    columns: ['tenantId', 'provider', 'environment', 'externalEventId'],
    unique: true,
    where: { column: 'signatureValid', equals: true },
  });

  const result = generateTenantCompositeIndexPlan({
    schema: fixtureSchema,
    schemaSql: `${fixtureSql}\n${partialIndexSql}`,
    tenantModelNames: ['Parent', 'Child'],
    indexNames: [{ indexName: buildIndexName, schemaIndexName }],
  });
  assert.deepEqual(result.plan.indexes, [{ ...parsed[0], indexName: buildIndexName, method: 'btree' }]);
});

test('fails closed when Prisma-generated DDL lacks a required target key or child prefix', () => {
  assert.throws(
    () => generateTenantCompositeIndexPlan({
      schema: fixtureSchema,
      schemaSql: 'CREATE INDEX "children_tenant_parent_idx" ON "children"("tenant_id", "parent_id");',
      tenantModelNames: ['Parent', 'Child'],
    }),
    /no supported index for Parent/,
  );

  assert.throws(
    () => generateTenantCompositeIndexPlan({
      schema: fixtureSchema,
      schemaSql: fixtureSql.replace('"children_tenant_parent_idx" ON "children"("tenant_id", "parent_id")', '"children_parent_idx" ON "children"("parent_id")'),
      tenantModelNames: ['Parent', 'Child'],
    }),
    /no supported index for Child.parent/,
  );
});

test('ignores partial indexes as FK coverage and rejects unsupported schema relations', () => {
  const partialOnly = fixtureSql.replace(
    'CREATE INDEX "children_tenant_parent_idx" ON "children"("tenant_id", "parent_id");',
    'CREATE INDEX "children_tenant_parent_idx" ON "children"("tenant_id", "parent_id") WHERE "parent_id" IS NOT NULL;',
  );
  assert.throws(
    () => generateTenantCompositeIndexPlan({ schema: fixtureSchema, schemaSql: partialOnly, tenantModelNames: ['Parent', 'Child'] }),
    /no supported index for Child.parent/,
  );
});

test('generates the production plan for all declared tenant relation keys', async () => {
  const schema = await readFile(resolve('prisma/schema.prisma'), 'utf8');
  const schemaSql = await generatePrismaSchemaSql();
  const generated = generateTenantCompositeIndexPlan({ schema, schemaSql });
  assert.equal(generated.tenantModelCount, 100);
  assert.equal(generated.tenantRelationCount, 138);
  assert.ok(generated.indexCount >= 79 + 29);
});
