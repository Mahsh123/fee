import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTenantRelationInventory, buildTenantRelationViolationQuery, runTenantRelationPreflight, TenantRelationPreflightError } from './tenant-relation-preflight.mjs';

const schema = `
model Tenant {
  id String @id @db.Uuid
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
  id String @id @db.Uuid @map("child_id")
  tenantId String @db.Uuid @map("tenant_id")
  tenant Tenant @relation(fields: [tenantId], references: [id])
  parentId String? @db.Uuid @map("parent_id")
  parent Parent? @relation(fields: [tenantId, parentId], references: [tenantId, id], onDelete: NoAction)
  @@index([tenantId, parentId])
  @@unique([tenantId, id])
  @@map("children")
}
`;

function relationFixture() {
  return buildTenantRelationInventory(schema, ['Parent', 'Child']).find((relation) => relation.sourceModel === 'Child');
}

test('derives mapped table and column names for all explicit tenant relation edges', () => {
  const relations = buildTenantRelationInventory(schema, ['Parent', 'Child']);
  assert.equal(relations.length, 1);
  assert.deepEqual(relations[0], {
    sourceModel: 'Child',
    sourceRelation: 'parent',
    sourceSchema: 'public',
    sourceTable: 'children',
    sourceIdColumn: 'child_id',
    sourceTenantColumn: 'tenant_id',
    sourceReferenceColumn: 'parent_id',
    targetModel: 'Parent',
    targetSchema: 'public',
    targetTable: 'parents',
    targetIdColumn: 'id',
    targetTenantColumn: 'tenant_id',
  });
});

test('quotes mapped identifiers in the generated read-only check query', () => {
  const query = buildTenantRelationViolationQuery(relationFixture());
  assert.match(query, /FROM "public"\."children" AS s/);
  assert.match(query, /s\."parent_id" IS NOT NULL/);
  assert.match(query, /LEFT JOIN "public"\."parents" AS t/);
  assert.match(query, /s\."tenant_id" IS DISTINCT FROM t\."tenant_id"/);
  assert.match(query, /LIMIT \$1$/);
});

test('escapes embedded quotes in Prisma-mapped identifiers', () => {
  const escapedSchema = schema.replace('@@map("children")', '@@map("children\\\"quoted")');
  const relation = buildTenantRelationInventory(escapedSchema, ['Parent', 'Child']).find((edge) => edge.sourceModel === 'Child');
  assert.match(buildTenantRelationViolationQuery(relation), /FROM "public"\."children""quoted" AS s/);
});

test('ignores commented @map text when deriving relation columns', () => {
  const commentedSchema = schema
    .replace(
      'id String @id @db.Uuid\n  tenantId String @db.Uuid @map("tenant_id")',
      'id String @id @db.Uuid // @map("fake_target_id")\n  tenantId String @db.Uuid @map("tenant_id")',
    )
    .replace('parentId String? @db.Uuid @map("parent_id")', 'parentId String? @db.Uuid // @map("fake_source_id")');
  const relation = buildTenantRelationInventory(commentedSchema, ['Parent', 'Child']).find((edge) => edge.sourceModel === 'Child');
  assert.equal(relation.sourceReferenceColumn, 'parentId');
  assert.equal(relation.targetIdColumn, 'id');
  assert.doesNotMatch(buildTenantRelationViolationQuery(relation), /fake_(?:source|target)_id/);
});

test('checks the complete inventory inside one repeatable read-only transaction and rolls it back', async () => {
  const calls = [];
  const client = { query: async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [] };
  } };

  assert.deepEqual(await runTenantRelationPreflight(client, [relationFixture()]), { checkedRelations: 1, sampleLimit: 10 });
  assert.equal(calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(calls[1].values[0], 11);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(calls.some(({ sql }) => /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)), false);
});

test('reports bounded source and target IDs for cross-tenant edges without committing', async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
    return { rows: [{ source_id: 'child-a', target_id: 'parent-b', violation: 'cross_tenant' }] };
  } };

  await assert.rejects(
    runTenantRelationPreflight(client, [relationFixture()]),
    (error) => error instanceof TenantRelationPreflightError &&
      /Child\.parent cross_tenant: source id=child-a; target id=parent-b/.test(error.message) &&
      !/tenant-a|tenant-b/.test(error.message),
  );
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('reports orphan rows and treats nullable relation IDs as valid when the query returns none', async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
    return { rows: [{ source_id: 'child-a', target_id: 'missing-parent', violation: 'orphan' }] };
  } };

  await assert.rejects(runTenantRelationPreflight(client, [relationFixture()]), /Child\.parent orphan: source id=child-a; target id=missing-parent/);
  assert.match(buildTenantRelationViolationQuery(relationFixture()), /WHERE s\."parent_id" IS NOT NULL/);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

test('limits row samples per relation and rejects unsafe sample limits', async () => {
  const client = { query: async (sql) => {
    if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] };
    return { rows: [1, 2, 3].map((id) => ({ source_id: `child-${id}`, target_id: `parent-${id}`, violation: 'cross_tenant' })) };
  } };

  await assert.rejects(
    runTenantRelationPreflight(client, [relationFixture()], { sampleLimit: 2 }),
    (error) => error instanceof TenantRelationPreflightError && /additional violating rows omitted/.test(error.message) && error.findings[0].rows.length === 2,
  );
  await assert.rejects(runTenantRelationPreflight(client, [relationFixture()], { sampleLimit: 0 }), /sampleLimit must be an integer/);
});
