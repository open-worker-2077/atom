import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimePort } from '../src/atom-system/world-runtime/program-runtime-port.mjs';
import { createLegacyProgramRuntimePort } from '../src/atom-system/adapters/legacy-program-runtime-adapter.mjs';

function snapshot() {
  return {
    contract: 'atom.world-snapshot',
    version: 1,
    worldId: 'primary',
    revision: 'rev-program',
    facts: [{ name: 'Agent', detail: '', children: [], partners: [] }]
  };
}

test('Program evaluation is bound to one immutable world revision and explicit interaction context', async () => {
  let received;
  const runtime = createProgramRuntimePort({
    evaluate: async (request) => {
      received = request;
      request.snapshot.facts[0].name = 'worker-local';
      return { fingerprint: 'fp-1', cached: false, records: [], locks: [], messages: [], transforms: [] };
    }
  });
  const source = snapshot();
  const result = await runtime.evaluateRevision({
    snapshot: source,
    interaction: { agent: { ref: 'agent-ref', path: 'Agent' } },
    explore: async () => []
  });

  assert.equal(source.facts[0].name, 'Agent');
  assert.deepEqual(received.interaction, { agent: { ref: 'agent-ref', path: 'Agent' } });
  assert.equal(result.worldId, 'primary');
  assert.equal(result.sourceRevision, 'rev-program');
  assert.equal(result.fingerprint, 'fp-1');
});

test('Program result collections are validated before entering the world runtime', async () => {
  const runtime = createProgramRuntimePort({
    evaluate: async () => ({ fingerprint: '', cached: false, records: [], locks: 'invalid', messages: [], transforms: [] })
  });

  await assert.rejects(
    runtime.evaluateRevision({ snapshot: snapshot(), interaction: {}, explore: async () => [] }),
    (error) => error.code === 'INVALID_PROGRAM_CYCLE'
  );
});

test('Program errors retain their operational code without publishing a partial cycle', async () => {
  const runtime = createProgramRuntimePort({
    evaluate: async () => { throw Object.assign(new Error('timed out'), { code: 'ATOM_PROGRAM_TIMEOUT' }); }
  });

  await assert.rejects(
    runtime.evaluateRevision({ snapshot: snapshot(), interaction: {}, explore: async () => [] }),
    (error) => error.code === 'ATOM_PROGRAM_TIMEOUT'
  );
});

test('legacy scheduler is isolated behind the Program port and receives only facts plus capabilities', async () => {
  let received;
  const scheduler = {
    refresh: async (facts, options) => {
      received = { facts, options };
      return { fingerprint: 'legacy-fp', cached: true, records: [], locks: [], messages: [], transforms: [] };
    }
  };
  const explore = async () => [];
  const runtime = createLegacyProgramRuntimePort({ scheduler });
  const result = await runtime.evaluateRevision({
    snapshot: snapshot(),
    interaction: { agent: { ref: 'agent-ref', path: 'Agent' } },
    explore
  });

  assert.deepEqual(received.facts, snapshot().facts);
  assert.deepEqual(received.options.agentOrigin, { ref: 'agent-ref', path: 'Agent' });
  assert.equal(received.options.executeExplore, explore);
  assert.equal(result.sourceRevision, 'rev-program');
  assert.equal(result.cached, true);
});

test('Program port enforces its wall-clock timeout and aborts the evaluator capability', async () => {
  let aborted = false;
  const runtime = createProgramRuntimePort({
    timeoutMs: 10,
    evaluate: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    })
  });

  await assert.rejects(
    runtime.evaluateRevision({ snapshot: snapshot(), interaction: {}, explore: async () => [] }),
    (error) => error.code === 'ATOM_PROGRAM_TIMEOUT'
  );
  assert.equal(aborted, true);
});

test('Program port respects caller cancellation before starting evaluation', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const runtime = createProgramRuntimePort({
    evaluate: async () => { calls += 1; }
  });

  await assert.rejects(
    runtime.evaluateRevision({
      snapshot: snapshot(), interaction: {}, explore: async () => [], signal: controller.signal
    }),
    (error) => error.code === 'ATOM_PROGRAM_CANCELLED'
  );
  assert.equal(calls, 0);
});

test('Program port bounds concurrent evaluations independent of worker implementation', async () => {
  let active = 0;
  let maximum = 0;
  const releases = [];
  const runtime = createProgramRuntimePort({
    maxConcurrent: 1,
    evaluate: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return { fingerprint: `fp-${releases.length}`, cached: false, records: [], locks: [], messages: [], transforms: [] };
    }
  });
  const first = runtime.evaluateRevision({ snapshot: snapshot(), interaction: {}, explore: async () => [] });
  const second = runtime.evaluateRevision({ snapshot: snapshot(), interaction: {}, explore: async () => [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases.shift()();
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
});

test('Program evaluator cannot publish a cycle for another world revision', async () => {
  const runtime = createProgramRuntimePort({
    evaluate: async () => ({
      sourceRevision: 'wrong-revision',
      fingerprint: 'fp', cached: false, records: [], locks: [], messages: [], transforms: []
    })
  });

  await assert.rejects(
    runtime.evaluateRevision({ snapshot: snapshot(), interaction: {}, explore: async () => [] }),
    (error) => error.code === 'PROGRAM_REVISION_MISMATCH'
  );
});
