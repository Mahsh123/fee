import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const BACKUP_IMAGE = process.env.BACKUP_TEST_IMAGE ?? 'fee-platform-backup:ci';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function docker(args, { env = process.env, timeout = 30000 } = {}) {
  return execFileAsync('docker', args, { env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
}

function adminClient() {
  return new Client({
    host: required('DATABASE_TARGET_HOST'),
    port: Number(required('DATABASE_TARGET_PORT')),
    database: required('DATABASE_TARGET_NAME'),
    user: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD'),
    connectionTimeoutMillis: 5000,
    application_name: 'fee-encrypted-backup-integration-test',
  });
}

test('backup fails closed when a large object is added after ACL sync', async () => {
  const admin = adminClient();
  const volume = `fee-backup-large-object-${randomUUID()}`;
  let largeObjectId;
  let volumeCreated = false;
  await admin.connect();
  try {
    const identity = await docker(['run', '--rm', '--entrypoint', 'age-keygen', BACKUP_IMAGE]);
    const recipient = identity.stdout.match(/^# public key:\s*(age1\S+)/m)?.[1];
    assert.ok(recipient, 'age-keygen should return a public recipient without exposing the private identity');

    const createdVolume = await docker(['volume', 'create', volume]);
    volumeCreated = createdVolume.stdout.trim() === volume;
    assert.equal(volumeCreated, true);

    const object = await admin.query('SELECT lo_create(0)::text AS oid');
    largeObjectId = object.rows[0].oid;
    await admin.query('SELECT lo_put($1::oid, 0, $2::bytea)', [largeObjectId, Buffer.from('backup regression fixture')]);

    const dockerEnv = {
      ...process.env,
      PGHOST: required('DATABASE_TARGET_HOST'),
      PGPORT: required('DATABASE_TARGET_PORT'),
      PGUSER: required('BACKUP_DATABASE_ROLE'),
      PGPASSWORD: required('BACKUP_DATABASE_PASSWORD'),
      PGDATABASE: required('DATABASE_TARGET_NAME'),
    };
    let rawDumpError;
    try {
      await docker([
        'run', '--rm', '--network', 'host',
        '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE',
        'postgres:17-alpine', 'pg_dump', '--no-password', '--format=custom', '--file=/dev/null',
      ], { env: dockerEnv });
    } catch (error) {
      rawDumpError = error;
    }
    assert.ok(rawDumpError, 'pg_dump should reject the unclassified large object');
    assert.match(`${rawDumpError.stderr ?? ''}\n${rawDumpError.stdout ?? ''}`, /large object/i);

    let backupError;
    try {
      await docker([
        'run', '--rm', '--network', 'host', '--volume', `${volume}:/backups`,
        '-e', 'PGHOST', '-e', 'PGPORT', '-e', 'PGUSER', '-e', 'PGPASSWORD', '-e', 'PGDATABASE',
        '-e', `BACKUP_AGE_RECIPIENT=${recipient}`,
        BACKUP_IMAGE,
      ], { env: dockerEnv, timeout: 30000 });
    } catch (error) {
      backupError = error;
    }
    assert.ok(backupError, 'encrypted backup must fail when pg_dump cannot read a large object');
    assert.equal(backupError.killed, false, 'backup must exit on the dump error rather than pass by timing out');
    assert.match(`${backupError.stderr ?? ''}\n${backupError.stdout ?? ''}`, /large object/i);

    const volumeContents = await docker([
      'run', '--rm', '--volume', `${volume}:/backups`, '--entrypoint', '/bin/sh',
      BACKUP_IMAGE, '-c', 'find /backups -type f -print -quit',
    ]);
    assert.equal(volumeContents.stdout.trim(), '', 'failed backup must leave no partial or accepted artifact');
  } finally {
    if (largeObjectId) await admin.query('SELECT lo_unlink($1::oid)', [largeObjectId]).catch(() => {});
    await admin.end();
    if (volumeCreated) await docker(['volume', 'rm', volume]).catch(() => {});
  }
});
