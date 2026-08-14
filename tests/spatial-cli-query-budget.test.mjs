import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runSpatialCli } from '../cli/lib/cli-app.mjs';
import { childDomainPath } from '../cli/lib/probe.mjs';
import { createStore } from '../cli/lib/store.mjs';

const root = path.resolve(import.meta.dirname, '..');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-cli-budget-'));
  const file = path.join(directory, 'knowledge.json');
  const store = createStore(file);
  await store.init();
  const alpha = await store.execute('node.create', {
    path: 'root',
    id: 'alpha',
    label: 'Alpha',
    detail: 'Alpha detail'
  });
  await store.execute('node.create', {
    path: 'root',
    id: 'beta',
    label: 'Beta',
    detail: 'Beta detail'
  });
  await store.execute('node.create', {
    path: childDomainPath(alpha.node),
    id: 'alpha-child',
    label: 'Alpha Child',
    detail: 'Nested detail'
  });
  return { file, store };
}

async function run(file, args, overrides = {}) {
  let standardOutput = '';
  let standardError = '';
  const status = await runSpatialCli([...args, '--store', file, '--json'], {
    env: {
      ...process.env,
      SPATIAL_QUERY_WINDOW_MS: '10000',
      SPATIAL_QUERY_MAX_NODES: '100',
      SPATIAL_QUERY_MAX_CHARS: '100000',
      ...overrides
    },
    interactive: false,
    stdout: { write: (value) => { standardOutput += value; } },
    stderr: { write: (value) => { standardError += value; } }
  });
  return { status, stdout: standardOutput, stderr: standardError };
}

function stdout(result) {
  return JSON.parse(result.stdout.trim());
}

function stderr(result) {
  return JSON.parse(result.stderr.trim());
}

test('probe command exposes recursive direction and step results', async () => {
  const { file } = await fixture();
  const result = await run(file, ['probe', 'Alpha detail', '--dir', 'down', '--steps', '1']);

  assert.equal(result.status, 0, result.stderr);
  const payload = stdout(result);
  assert.equal(payload.ok, true);
  assert.equal(payload.result.query, 'Alpha detail');
  assert.equal(payload.result.direction, 'down');
  assert.equal(payload.result.steps, 1);
  assert.deepEqual(payload.result.domains.map((domain) => domain.nodes.length), [1, 0]);
  assert.equal(payload.result.domains[0].nodes[0].detail, 'Nested detail');
});

test('separate CLI processes accumulate spend and require one-time confirmation', async () => {
  const { file } = await fixture();
  const limits = { SPATIAL_QUERY_MAX_NODES: '3', SPATIAL_QUERY_MAX_CHARS: '1000000' };

  const first = await run(file, ['probe'], limits);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(stdout(first).result.stats.nodeCount, 2);

  const second = await run(file, ['probe'], limits);
  assert.equal(second.status, 5);
  const warning = stderr(second);
  assert.equal(warning.error.code, 'QUERY_BUDGET_CONFIRMATION_REQUIRED');
  assert.deepEqual(warning.error.details.window, { nodes: 2, characters: warning.error.details.window.characters });
  assert.deepEqual(warning.error.details.next.nodes, 2);
  assert.deepEqual(warning.error.details.projected.nodes, 4);
  assert.equal(warning.error.details.alternatives.length, 7);
  assert.ok(warning.error.details.alternatives.every((entry) => entry.steps === 0));
  assert.ok(warning.error.details.alternatives.every((entry) => (
    entry.projected.nodes === warning.error.details.window.nodes + entry.next.nodes
    && entry.projected.characters === warning.error.details.window.characters + entry.next.characters
  )));
  assert.equal('result' in warning.error.details, false);

  const id = warning.error.details.confirmationId;
  const confirmed = await run(file, ['confirm', id, 'y'], limits);
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal(stdout(confirmed).result.stats.nodeCount, 2);

  const replay = await run(file, ['confirm', id, 'y'], limits);
  assert.equal(replay.status, 5);
  assert.equal(stderr(replay).error.code, 'CONFIRMATION_NOT_FOUND');

  const third = await run(file, ['probe'], limits);
  const thirdWarning = stderr(third);
  const cancelled = await run(file, ['confirm', thirdWarning.error.details.confirmationId, 'n'], limits);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.deepEqual(stdout(cancelled), { ok: true, cancelled: true });
});

test('character budget measures the exact compact result payload before returning it', async () => {
  const { file, store } = await fixture();
  const expectedResult = await store.execute('probe', { query: '', direction: 'all', steps: 0 });
  const expectedCharacters = `${JSON.stringify({ ok: true, result: expectedResult })}\n`.length;
  const denied = await run(file, ['probe'], {
    SPATIAL_QUERY_MAX_NODES: '100',
    SPATIAL_QUERY_MAX_CHARS: '0'
  });

  assert.equal(denied.status, 5);
  assert.equal(stderr(denied).error.details.next.characters, expectedCharacters);
  assert.equal(denied.stdout, '');
});

test('existing read commands use the same budget instead of bypassing probe', async () => {
  const { file } = await fixture();
  const denied = await run(file, ['search', 'Alpha'], {
    SPATIAL_QUERY_MAX_NODES: '0',
    SPATIAL_QUERY_MAX_CHARS: '0'
  });

  assert.equal(denied.status, 5);
  const warning = stderr(denied);
  assert.equal(warning.error.code, 'QUERY_BUDGET_CONFIRMATION_REQUIRED');
  assert.equal(warning.error.details.next.nodes, 2);
  assert.equal(warning.error.details.alternatives, undefined);
});
