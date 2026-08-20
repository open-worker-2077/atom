import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8'
  }).split('\0').filter(Boolean).map((file) => file.replaceAll('\\', '/'));
}

test('public repository excludes local worlds, projections, backups and context data', () => {
  const forbiddenNames = new Set([
    'atom.json',
    'graph.json',
    'knowledge.json',
    'advance_context.json'
  ]);
  const forbiddenDirectories = new Set([
    'backups',
    'data',
    'local-history',
    'worlds'
  ]);
  const violations = trackedFiles().filter((file) => {
    const parts = file.toLowerCase().split('/');
    return forbiddenNames.has(parts.at(-1)) || parts.some((part) => forbiddenDirectories.has(part));
  });

  assert.deepEqual(violations, []);
});

test('tracked JSON is limited to source manifests, public schemas and reviewed architecture contracts', () => {
  const allowed = new Set([
    'docs/architecture/atom-capability-graph.json',
    'package-lock.json',
    'package.json',
    'work-engine/atom-language/package.json',
    'work-engine/atom-language/program-function-registry.json',
    'work-engine/atom-language/work-order-registry.json'
  ]);
  const violations = trackedFiles().filter((file) =>
    file.endsWith('.json') && !allowed.has(file) && !/^schemas\/[^/]+\.schema\.json$/.test(file)
  );

  assert.deepEqual(violations, []);
});
