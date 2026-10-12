import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verifyComposeFile } from './verify-compose-neon-target.mjs';

function environmentFile(args) {
  if (args.length === 0) return '.env.production';
  if (args.length !== 2 || args[0] !== '--env-file' || !args[1]) {
    throw new Error('Usage: npm run deploy:production -- [--env-file PATH]');
  }
  return args[1];
}

const envFile = environmentFile(process.argv.slice(2));
const composeFile = 'docker-compose.prod.yml';

// Check the exact env file and inherited overrides that the subsequent Compose
// command will use. The verifier captures Compose's rendered config and reports
// only its non-secret target/role summary.
const result = verifyComposeFile({ envFiles: [envFile], composeFile });
console.log(`Production config verified for ${result.target.host}:${result.target.database}?schema=${result.target.schema}; roles ${result.migrationRole}, ${result.runtimeRole}, and ${result.backupRole} are distinct.`);

const composeArgs = ['compose', '--env-file', resolve(envFile), '-f', resolve(composeFile)];
console.log('Pulling the immutable image tag configured in the production environment file.');
execFileSync('docker', [...composeArgs, 'pull'], {
  stdio: 'inherit',
});

console.log('Applying migrations and starting the production stack; waiting for health checks.');
execFileSync('docker', [...composeArgs, 'up', '-d', '--wait', '--wait-timeout', '240'], {
  stdio: 'inherit',
});
