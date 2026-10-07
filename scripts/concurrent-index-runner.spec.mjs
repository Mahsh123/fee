import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderCreateIndexSql,
  renderDropIndexSql,
  renderIndexDefinition,
  validateConcurrentIndexPlan,
} from './concurrent-index-runner.mjs';

test('index plans are canonical across ordering and formatting', () => {
  const first = validateConcurrentIndexPlan({
    version: 1,
    name: 'tenant relation indexes',
    indexes: [
      { schema: 'public', table: 'children', indexName: 'children_parent_tenant_idx', columns: ['tenantId', 'parentId'] },
      { schema: 'public', table: 'parents', indexName: 'parents_tenant_id_key', columns: ['tenantId', 'id'], unique: true },
    ],
  });
  const reordered = validateConcurrentIndexPlan({
    version: 1,
    name: 'tenant relation indexes',
    indexes: [
      { unique: true, indexName: 'parents_tenant_id_key', columns: ['tenantId', 'id'], table: 'parents' },
      { indexName: 'children_parent_tenant_idx', table: 'children', columns: ['tenantId', 'parentId'] },
    ],
  });

  assert.equal(first.checksum, reordered.checksum);
  assert.equal(first.canonicalText, reordered.canonicalText);
  assert.equal(first.indexes.length, 2);
});

test('generated DDL quotes each identifier and only emits supported partial predicates', () => {
  const index = {
    schema: 'school data',
    table: 'sequence',
    indexName: 'seq"scope',
    columns: ['tenantId', 'scope'],
    unique: true,
    where: { column: 'scope', isNull: true },
  };

  assert.equal(
    renderCreateIndexSql(index),
    'CREATE UNIQUE INDEX CONCURRENTLY "seq""scope" ON "school data"."sequence" USING btree ("tenantId", "scope") WHERE "scope" IS NULL',
  );
  assert.equal(renderDropIndexSql(index), 'DROP INDEX CONCURRENTLY "school data"."seq""scope"');
});

test('renders boolean partial unique indexes with predicates outside the indexed key', () => {
  const index = {
    schema: 'public',
    table: 'gateway_webhooks',
    indexName: 'gateway_webhook_verified_key',
    columns: ['tenantId', 'provider', 'environment', 'externalEventId'],
    unique: true,
    where: { column: 'signatureValid', equals: true },
  };
  assert.equal(
    renderCreateIndexSql(index),
    'CREATE UNIQUE INDEX CONCURRENTLY "gateway_webhook_verified_key" ON "public"."gateway_webhooks" USING btree ("tenantId", "provider", "environment", "externalEventId") WHERE "signatureValid" = TRUE',
  );
  assert.equal(
    renderIndexDefinition(index),
    'CREATE UNIQUE INDEX "gateway_webhook_verified_key" ON "public"."gateway_webhooks" USING btree ("tenantId", "provider", "environment", "externalEventId") WHERE ("signatureValid" = TRUE)',
  );
});

test('plans reject SQL predicates and unsupported access methods while safely quoting identifiers', () => {
  assert.throws(() => validateConcurrentIndexPlan({
    version: 1,
    name: 'unsafe predicate',
    indexes: [{ schema: 'public', table: 'sequences', indexName: 'sequence_idx', columns: ['scope'], where: { column: 'scope', isNull: 'true; DROP TABLE tenants' } }],
  }), /where must be/);

  assert.throws(() => validateConcurrentIndexPlan({
    version: 1,
    name: 'unsupported method',
    indexes: [{ schema: 'public', table: 'parents', indexName: 'parents_gin', columns: ['name'], method: 'gin' }],
  }), /only the btree access method/);

  const unusualIdentifier = validateConcurrentIndexPlan({
    version: 1,
    name: 'quoted identifier',
    indexes: [{ schema: 'public', table: 'parents; DROP TABLE tenants', indexName: 'parents_idx', columns: ['id'] }],
  });
  assert.match(renderCreateIndexSql(unusualIdentifier.indexes[0]), /ON "public"\."parents; DROP TABLE tenants"/);

  assert.throws(() => validateConcurrentIndexPlan({
    version: 1,
    name: 'nul identifier',
    indexes: [{ schema: 'public', table: 'parents', indexName: 'bad\0name', columns: ['id'] }],
  }), /identifier/);

  assert.throws(() => validateConcurrentIndexPlan({
    version: 1,
    name: 'ambiguous names',
    indexes: [
      { schema: 'one', table: 'parents', indexName: 'parents_idx', columns: ['id'] },
      { schema: 'two', table: 'parents', indexName: 'parents_idx', columns: ['id'] },
    ],
  }), /appears more than once/);
});
