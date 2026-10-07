import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPostgresUrlTarget } from './compose-database-target.mjs';

const target = {
  host: 'ep-fee.ap-southeast-1.aws.neon.tech',
  port: '5432',
  database: 'neondb',
  schema: 'public',
};

function url(overrides = '') {
  return `postgresql://fee_migrator:migration%40secret@${target.host}:5432/${target.database}?schema=public&sslmode=verify-full&channel_binding=require${overrides}`;
}

test('accepts a Neon PostgreSQL URL matching the checked target and returns parsed credentials', () => {
  const parsed = verifyPostgresUrlTarget(url(), 'MIGRATION_DATABASE_URL', target);
  assert.deepEqual(
    { host: parsed.host, port: parsed.port, database: parsed.database, schema: parsed.schema, username: parsed.username, password: parsed.password },
    { ...target, username: 'fee_migrator', password: 'migration@secret' },
  );
});

test('defaults an omitted schema to public', () => {
  const parsed = verifyPostgresUrlTarget(
    `postgresql://fee_runtime:runtime-secret@${target.host}/neondb?sslmode=verify-full`,
    'DATABASE_URL',
    target,
  );
  assert.equal(parsed.schema, 'public');
});

test('rejects target host, port, database, or schema drift without disclosing URL secrets', () => {
  const changes = [
    (parsed) => { parsed.hostname = 'other.neon.tech'; },
    (parsed) => { parsed.port = '6543'; },
    (parsed) => { parsed.pathname = '/other'; },
    (parsed) => { parsed.searchParams.set('schema', 'private'); },
  ];
  for (const change of changes) {
    const parsed = new URL(url());
    change(parsed);
    assert.throws(() => verifyPostgresUrlTarget(parsed.href, 'MIGRATION_DATABASE_URL', target), (error) => {
      assert.match(error.message, /does not match the shared database target/);
      assert.equal(error.message.includes('migration@secret'), false);
      return true;
    });
  }
});

test('rejects unsupported or duplicate driver query parameters', () => {
  for (const query of [
    'schema=public&host=attacker.example',
    'schema=public&port=6543',
    'schema=public&user=other',
    'schema=public&password=secret',
    'schema=public&hostaddr=192.0.2.10',
    'schema=public&schema=private',
  ]) {
    const value = `postgresql://fee_migrator:migration-secret@${target.host}/neondb?${query}`;
    assert.throws(() => verifyPostgresUrlTarget(value, 'MIGRATION_DATABASE_URL', target), /unsupported or duplicate query parameters/);
  }
});

test('requires verified TLS for Neon and rejects weaker TLS settings', () => {
  assert.throws(
    () => verifyPostgresUrlTarget(`postgresql://fee_migrator:secret@${target.host}/neondb`, 'MIGRATION_DATABASE_URL', target),
    /verified TLS for a Neon host/,
  );
  assert.throws(() => verifyPostgresUrlTarget(url().replace('channel_binding=require', 'channel_binding=prefer'), 'MIGRATION_DATABASE_URL', target), /channel_binding=require/);
});

test('requires public schema and rejects reserved database path characters consistently', () => {
  assert.throws(
    () => verifyPostgresUrlTarget(url(), 'MIGRATION_DATABASE_URL', { ...target, schema: 'tenant_data' }),
    /currently require the public schema/,
  );
  const reservedTarget = { ...target, database: 'fee%3Fplatform' };
  const reservedUrl = `postgresql://fee_migrator:secret@${target.host}:5432/fee%3Fplatform?schema=public&sslmode=verify-full`;
  assert.equal(verifyPostgresUrlTarget(reservedUrl, 'MIGRATION_DATABASE_URL', reservedTarget).database, 'fee%3Fplatform');
});

test('rejects malformed PostgreSQL URLs and empty target components', () => {
  assert.throws(() => verifyPostgresUrlTarget('not a url', 'DATABASE_URL', target), /not a valid PostgreSQL URL/);
  assert.throws(() => verifyPostgresUrlTarget('https://example.com/db', 'DATABASE_URL', target), /must use PostgreSQL/);
  assert.throws(() => verifyPostgresUrlTarget(`postgresql://user:pass@${target.host}/?sslmode=verify-full`, 'DATABASE_URL', target), /must include a host and database name/);
  assert.throws(() => verifyPostgresUrlTarget(url(), 'DATABASE_URL', { ...target, schema: '' }), /currently require the public schema/);
});
