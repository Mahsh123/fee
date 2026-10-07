import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { buildNeonDevelopmentEnvironments } from './dev-neon-env.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const systemEnvironment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);

function readEnvFile(name, required = false) {
  const path = resolve(root, name);
  try {
    return parse(readFileSync(path));
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return {};
    throw new Error(`Required local environment file is missing or unreadable: ${name}`);
  }
}

const { apiEnvironment, workerEnvironment, webEnvironment, developmentTenantSeedEnvironment } = buildNeonDevelopmentEnvironments({
  systemEnvironment,
  applicationEnvironment: readEnvFile('.env', true),
  runtimeEnvironment: readEnvFile('.env.neon.local', true),
  localInfrastructure: readEnvFile('.env.docker.local'),
});

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const services = [
  ['api', apiEnvironment],
  ['web', webEnvironment],
  ['worker', workerEnvironment],
];
const children = [];
let shuttingDown = false;

async function seedDevelopmentTenants() {
  if (apiEnvironment.NODE_ENV !== 'development' || apiEnvironment.SEED_DEVELOPMENT_TENANTS === 'false') return;
  await new Promise((resolveSeed, rejectSeed) => {
    const seed = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed-development-tenants.ts'], {
      cwd: root,
      env: developmentTenantSeedEnvironment,
      stdio: 'inherit',
      windowsHide: true,
    });
    seed.once('error', rejectSeed);
    seed.once('exit', (code) => code === 0 ? resolveSeed() : rejectSeed(new Error(`Development tenant seed exited with status ${code ?? 'unknown'}.`)));
  });
}

function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }
}

try {
  await seedDevelopmentTenants();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Development tenant seed failed.'}\n`);
  process.exit(1);
}

for (const [service, env] of services) {
  const child = spawn(npm, ['run', `dev:${service}`], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  children.push(child);
  child.on('error', () => {
    process.exitCode = 1;
    stopChildren();
  });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.exitCode = code ?? 1;
      stopChildren();
    }
  });
}

process.once('SIGINT', stopChildren);
process.once('SIGTERM', stopChildren);
