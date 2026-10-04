import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'work-engine/atom-language/cli.mjs');

test('linked executable still prints Help when realpath is denied', async () => {
  await fs.mkdir(path.join(root, 'runtime-data'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'runtime-data', 'cli-entry-'));
  const alias = path.join(directory, 'linked-atom');
  await fs.symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const preload = path.join(directory, 'deny-realpath.mjs');
  await fs.writeFile(preload, `import fs from 'node:fs/promises';
fs.realpath = async () => { throw Object.assign(new Error('restricted realpath'), { code: 'EPERM' }); };
process.argv[1] = ${JSON.stringify(path.join(alias, 'work-engine/atom-language/cli.mjs'))};
`);
  const result = await execute(process.execPath, ['--import', pathToFileURL(preload).href, entry, '--help'], { timeout: 15000 });
  assert.match(result.stdout, /--agent/);
  assert.match(result.stdout, /--stdin/);
  assert.equal(result.stderr, '');
});

test('importing CLI stays inert when realpath is denied', async () => {
  const script = `import fs from 'node:fs/promises';
fs.realpath = async () => { throw Object.assign(new Error('restricted realpath'), { code: 'EPERM' }); };
await import(${JSON.stringify(pathToFileURL(entry).href)});
console.log('import complete');`;
  const result = await execute(process.execPath, ['--input-type=module', '-e', script, '--', '--help'], { timeout: 15000 });
  assert.equal(result.stdout.trim(), 'import complete');
  assert.equal(result.stderr, '');
});
