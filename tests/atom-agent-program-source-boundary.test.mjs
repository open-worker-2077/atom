import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const scannedRoots = ['src', 'work-engine', 'scripts', 'tests'];
const allowedFiles = new Set([
  'src/atom-system/operations/agent-program-migration.mjs',
  'tests/atom-agent-key-retirement.test.mjs',
  'tests/atom-agent-program-migration.test.mjs',
  'tests/atom-agent-program-source-boundary.test.mjs'
]);

function filesBelow(relativeDirectory) {
  const absolute = path.join(root, relativeDirectory);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? filesBelow(relativePath) : [relativePath];
  });
}

test('retired Agent Key syntax survives only in rejection and migration contracts', () => {
  const offenders = scannedRoots
    .flatMap(filesBelow)
    .filter((file) => /\.(?:js|mjs|json|py)$/u.test(file))
    .filter((file) => !allowedFiles.has(file))
    .filter((file) => /thing@agent|thing@program@agent|program@agent|@agent Atom/u.test(
      fs.readFileSync(path.join(root, file), 'utf8')
    ));
  assert.deepEqual(offenders, []);
});
