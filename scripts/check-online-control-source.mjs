import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETIRED_CONTROL_PATHS = Object.freeze([
  'docs/architecture/HANDOFF-work-order-form-runtime-20260820.md',
  'docs/architecture/NIGHT-WATCH-CONTROL-20260826.md',
  'openspec/requirements-ledger.md',
  'openspec/changes/converge-atom-requirement-ledger',
  'openspec/changes/add-compound-push-projection'
]);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function findRetiredControlFiles(root) {
  const found = [];
  for (const relativePath of RETIRED_CONTROL_PATHS) {
    if (await exists(path.join(root, ...relativePath.split('/')))) found.push(relativePath);
  }
  return found;
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const found = await findRetiredControlFiles(root);
  if (found.length === 0) return;
  process.stderr.write([
    'GitHub Issues/Project is the sole Atom development control source.',
    'Retired local control files must not exist in active discovery paths:',
    ...found.map((entry) => `- ${entry}`),
    'Restore the requirement or status in GitHub instead of recreating a local ledger, watch file, handoff, or superseded OpenSpec.'
  ].join('\n') + '\n');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
