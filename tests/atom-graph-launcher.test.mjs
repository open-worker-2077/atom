import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Atom Graph launcher starts 4784, waits for health, and opens the browser', async () => {
  const source = await fs.readFile(
    path.join(root, 'scripts', 'start-atom-graph.ps1'),
    'utf8'
  );

  assert.match(source, /127\.0\.0\.1:4784/);
  assert.match(source, /__spatial\/api\/health/);
  assert.match(source, /Start-Process[\s\S]*graph-server\.mjs/);
  assert.match(source, /Invoke-RestMethod/);
  assert.match(source, /Start-Process\s+\$WebUrl/);
  assert.match(source, /\$PSScriptRoot/);
  assert.doesNotMatch(source, /4783/);
});
