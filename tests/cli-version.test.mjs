import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { VERSION } from '../cli/lib/version.mjs';

test('package, cli and server share the same release version', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const cliSource = await fs.readFile(path.join(root, 'cli', 'spatial.mjs'), 'utf8');
  const serverSource = await fs.readFile(path.join(root, 'cli', 'lib', 'server.mjs'), 'utf8');

  assert.equal(VERSION, '0.3.0');
  assert.equal(packageJson.version, VERSION);
  assert.match(cliSource, /import\s*\{\s*VERSION\s*\}\s*from\s*['"]\.\/lib\/version\.mjs['"]/);
  assert.match(serverSource, /import\s*\{\s*VERSION\s*\}\s*from\s*['"]\.\/version\.mjs['"]/);
  assert.doesNotMatch(cliSource, /const\s+VERSION\s*=/);
});
