import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createQueryBudget, queryBudgetFile } from '../cli/lib/query-budget.mjs';

async function temporaryLedger(name = 'budget.json') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-budget-'));
  return path.join(directory, name);
}

test('budget file is derived beside the selected knowledge store', () => {
  assert.equal(
    queryBudgetFile(path.join('C:', 'graph', 'knowledge.json')),
    path.resolve(path.join('C:', 'graph', 'knowledge.json.query-budget.json'))
  );
});

test('sliding window retains only spend newer than the configured duration', async () => {
  const file = await temporaryLedger();
  let clock = 1_000;
  const budget = createQueryBudget({
    file,
    windowMs: 10_000,
    maxNodes: 10,
    maxCharacters: 1_000,
    now: () => clock
  });

  const first = await budget.gate({ nodes: 3, characters: 30, request: { query: 'a' } });
  assert.equal(first.allowed, true);
  assert.deepEqual(first.window, { nodes: 0, characters: 0 });

  clock = 6_000;
  const second = await budget.gate({ nodes: 4, characters: 40, request: { query: 'b' } });
  assert.equal(second.allowed, true);
  assert.deepEqual(second.projected, { nodes: 7, characters: 70 });

  clock = 11_001;
  const third = await budget.gate({ nodes: 6, characters: 60, request: { query: 'c' } });
  assert.equal(third.allowed, true);
  assert.deepEqual(third.window, { nodes: 4, characters: 40 });
  assert.deepEqual(third.projected, { nodes: 10, characters: 100 });
});

test('over-limit query creates a one-time challenge and n cancels it', async () => {
  const file = await temporaryLedger();
  const budget = createQueryBudget({ file, maxNodes: 5, maxCharacters: 100 });
  await budget.gate({ nodes: 4, characters: 40, request: { query: 'first' } });

  const denied = await budget.gate({ nodes: 2, characters: 20, request: { query: 'second' } });
  assert.equal(denied.allowed, false);
  assert.match(denied.confirmationId, /^[a-f0-9-]+$/);
  assert.deepEqual(denied.window, { nodes: 4, characters: 40 });
  assert.deepEqual(denied.next, { nodes: 2, characters: 20 });
  assert.deepEqual(denied.projected, { nodes: 6, characters: 60 });
  assert.deepEqual(denied.limits, { windowMs: 10_000, nodes: 5, characters: 100 });

  const cancelled = await budget.takePending(denied.confirmationId, 'n');
  assert.equal(cancelled.confirmed, false);
  assert.deepEqual(cancelled.request, { query: 'second' });
  await assert.rejects(
    budget.takePending(denied.confirmationId, 'y'),
    (error) => error.code === 'CONFIRMATION_NOT_FOUND'
  );
});

test('y consumes the challenge and confirmed spend is recorded even above the limit', async () => {
  const file = await temporaryLedger();
  const budget = createQueryBudget({ file, maxNodes: 3, maxCharacters: 100 });
  const denied = await budget.gate({ nodes: 4, characters: 50, request: { method: 'probe' } });

  const accepted = await budget.takePending(denied.confirmationId, 'y');
  assert.equal(accepted.confirmed, true);
  assert.deepEqual(accepted.request, { method: 'probe' });
  await budget.commitConfirmed({ nodes: 4, characters: 50 });

  const next = await budget.gate({ nodes: 0, characters: 60, request: { method: 'view.get' } });
  assert.equal(next.allowed, false);
  assert.deepEqual(next.window, { nodes: 4, characters: 50 });
  assert.deepEqual(next.projected, { nodes: 4, characters: 110 });
});

test('expired confirmation cannot be replayed', async () => {
  const file = await temporaryLedger();
  let clock = 10;
  const budget = createQueryBudget({
    file,
    maxNodes: 0,
    maxCharacters: 0,
    pendingMs: 100,
    now: () => clock
  });
  const denied = await budget.gate({ nodes: 1, characters: 1, request: { query: 'expires' } });
  clock = 111;
  await assert.rejects(
    budget.takePending(denied.confirmationId, 'y'),
    (error) => error.code === 'CONFIRMATION_NOT_FOUND'
  );
});

test('separate concurrent instances atomically prevent threshold penetration', async () => {
  const file = await temporaryLedger();
  const left = createQueryBudget({ file, maxNodes: 5, maxCharacters: 1_000 });
  const right = createQueryBudget({ file, maxNodes: 5, maxCharacters: 1_000 });

  const results = await Promise.all([
    left.gate({ nodes: 3, characters: 30, request: { query: 'left' } }),
    right.gate({ nodes: 3, characters: 30, request: { query: 'right' } })
  ]);

  assert.equal(results.filter((result) => result.allowed).length, 1);
  assert.equal(results.filter((result) => !result.allowed).length, 1);
  const denied = results.find((result) => !result.allowed);
  assert.deepEqual(denied.window, { nodes: 3, characters: 30 });
  assert.deepEqual(denied.projected, { nodes: 6, characters: 60 });
});

test('invalid decisions are rejected without consuming the challenge', async () => {
  const file = await temporaryLedger();
  const budget = createQueryBudget({ file, maxNodes: 0, maxCharacters: 0 });
  const denied = await budget.gate({ nodes: 1, characters: 1, request: { query: 'keep' } });

  await assert.rejects(
    budget.takePending(denied.confirmationId, 'maybe'),
    (error) => error.code === 'INVALID_CONFIRMATION_DECISION'
  );
  assert.equal((await budget.takePending(denied.confirmationId, 'n')).confirmed, false);
});
