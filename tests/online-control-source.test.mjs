import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RETIRED_CONTROL_PATHS,
  findRetiredControlFiles
} from '../scripts/check-online-control-source.mjs';

test('retired local control files are rejected from active discovery paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-online-control-'));
  const retired = RETIRED_CONTROL_PATHS[0];
  await fs.mkdir(path.dirname(path.join(root, retired)), { recursive: true });
  await fs.writeFile(path.join(root, retired), 'stale local authority', 'utf8');

  assert.deepEqual(await findRetiredControlFiles(root), [retired]);
});

test('current repository contains no retired local control files', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  assert.deepEqual(await findRetiredControlFiles(root), []);
});
