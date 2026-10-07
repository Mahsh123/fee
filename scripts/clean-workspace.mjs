import { lstat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const directoryTargets = new Set(['dist', '.next', 'out', 'build', 'coverage', '.turbo']);
const fileTargets = new Set(['tsbuildinfo']);
const specialTargets = new Set(['node_modules-cache']);
const targets = process.argv.slice(2);
const workspaceRoot = resolve(process.cwd());

if (targets.length === 0 || targets.some((target) =>
  !directoryTargets.has(target) && !fileTargets.has(target) && !specialTargets.has(target),
)) {
  throw new Error('Specify only approved cleanup targets: dist, .next, out, build, coverage, .turbo, tsbuildinfo, node_modules-cache.');
}

function assertWithinWorkspace(path) {
  const rel = relative(workspaceRoot, path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || rel === '') {
    throw new Error(`Refusing to clean path outside the workspace: ${path}`);
  }
}

async function ensureNoSymlinkParents(path) {
  const rel = relative(workspaceRoot, path);
  let cursor = workspaceRoot;
  for (const part of rel.split(sep).slice(0, -1)) {
    cursor = resolve(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to follow a symbolic link while cleaning: ${cursor}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return;
    }
  }
}

async function remove(path) {
  assertWithinWorkspace(path);
  await ensureNoSymlinkParents(path);
  try {
    const stat = await lstat(path);
    // fs.rm unlinks a symlink itself; it never traverses its target.
    await rm(path, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

for (const target of targets) {
  if (directoryTargets.has(target)) {
    await remove(resolve(workspaceRoot, target));
  } else if (target === 'node_modules-cache') {
    await remove(resolve(workspaceRoot, 'node_modules', '.cache'));
  } else if (target === 'tsbuildinfo') {
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) {
        await remove(resolve(workspaceRoot, entry.name));
      }
    }
  }
}
