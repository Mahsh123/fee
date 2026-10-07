import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const systemEnvironment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);

function readEnv(name, required) {
  try {
    return parse(readFileSync(resolve(root, name)));
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return {};
    throw new Error(`Required local environment file is missing or unreadable: ${name}`);
  }
}

const merged = {
  ...readEnv('.env', true),
  ...readEnv('.env.neon.local', true),
  ...readEnv('.env.neon.migration.local', true),
};
const requiredKeys = [
  'MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_ROLE', 'RUNTIME_DATABASE_ROLE', 'BACKUP_DATABASE_ROLE',
  'DATABASE_TARGET_HOST', 'DATABASE_TARGET_PORT', 'DATABASE_TARGET_NAME', 'DATABASE_TARGET_SCHEMA',
];
const missing = requiredKeys.filter((key) => !merged[key]);
if (missing.length) throw new Error(`Staged Neon migration configuration is missing: ${missing.join(', ')}`);

// The migration child receives only its dedicated target and signing-key
// settings. Application credentials, payment secrets, and owner URLs are not
// inherited into the deployment process.
const migrationEnvironment = { ...systemEnvironment };
for (const key of [
  ...requiredKeys,
  'AUDIT_ACTIVE_SIGNING_KEY_VERSION',
  'AUDIT_SIGNING_KEYS_JSON',
]) {
  if (merged[key] !== undefined) migrationEnvironment[key] = merged[key];
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'db:deploy'], {
  cwd: root,
  env: migrationEnvironment,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});
child.once('error', (error) => {
  process.stderr.write(`Could not start the staged Neon migration: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code) => { process.exitCode = code ?? 1; });
