import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../prisma/migrations/20261005000200_verified_webhook_event_deduplication/migration.sql', import.meta.url);

test('verified webhook dedupe migration performs only a bounded atomic index swap', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const setLockTimeout = sql.indexOf("SET lock_timeout = '5s';");
  const beginSwap = sql.indexOf('BEGIN;');
  const dropOldIndex = sql.indexOf('DROP INDEX "gateway_webhook_tenant_provider_event_key";');
  const renameVerifiedIndex = sql.indexOf('ALTER INDEX "gateway_webhook_tenant_provider_event_verified_key"');
  const commitSwap = sql.indexOf('COMMIT;');
  const resetLockTimeout = sql.indexOf('RESET lock_timeout;');

  assert.ok(setLockTimeout >= 0 && setLockTimeout < beginSwap);
  assert.ok(beginSwap < dropOldIndex && dropOldIndex < renameVerifiedIndex && renameVerifiedIndex < commitSwap && commitSwap < resetLockTimeout);
  assert.doesNotMatch(sql, /(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);

  const stages = JSON.parse(await readFile(new URL('../prisma/migration-stages.json', import.meta.url), 'utf8'));
  assert.ok(stages.postIndexIndexBarriers.some((barrier) =>
    barrier.beforeMigration === '20261005000200_verified_webhook_event_deduplication'
    && barrier.indexes.some((index) => (typeof index === 'string' ? index : index.indexName)
      === 'gateway_webhook_tenant_provider_event_verified_key')));
});
