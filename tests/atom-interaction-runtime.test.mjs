import assert from 'node:assert/strict';
import test from 'node:test';

import { createInteractionRuntime } from '../src/atom-system/public/interaction-runtime.mjs';

function ports() {
  const calls = [];
  const programRuntime = { id: 'program-runtime' };
  return {
    calls,
    programRuntime,
    world: {
      execute: async (request) => {
        calls.push(['world', structuredClone({ ...request, programRuntime: request.programRuntime?.id })]);
        return { ok: true, revisionAfter: 'rev-2', lockState: { revision: 'rev-2' } };
      }
    },
    projections: {
      publish: async (request) => {
        calls.push(['projection', structuredClone(request)]);
        return { sourceRevision: request.expectedRevision };
      },
      recover: async (request) => {
        calls.push(['recover', structuredClone(request)]);
        return { sourceRevision: request.expectedRevision };
      }
    },
    feedback: {
      submit: async (request) => {
        calls.push(['feedback', structuredClone(request)]);
        return { ok: true, command: 'submit', submission: { id: 'feedback-1' } };
      }
    },
    agents: {
      resolve: async (path) => {
        calls.push(['agent', path]);
        return { ref: 'agent-ref', path };
      }
    },
    humanStatus: {
      translate: async (request) => {
        calls.push(['human-status', structuredClone(request)]);
        return `transform {"name":"${request.key}","detail.rep.":"${request.detail}"}`;
      }
    },
    humanWorkspace: {
      translate: async (request) => {
        calls.push(['human-workspace', structuredClone(request)]);
        return 'transform {"name":"Root/Workspace","detail.rep.":"updated"}';
      }
    }
  };
}

test('command follows one agent, Program, world and revision-labelled projection lifecycle', async () => {
  const context = ports();
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'transform {"name":"Root"}',
    correlationId: 'interaction-1',
    agentPath: 'Root/Sol',
    history: []
  });

  assert.equal(result.revisionAfter, 'rev-2');
  assert.deepEqual(context.calls, [
    ['agent', 'Root/Sol'],
    ['world', {
      source: 'transform {"name":"Root"}',
      interaction: { id: 'interaction-1', agent: { ref: 'agent-ref', path: 'Root/Sol' } },
      history: [],
      programRuntime: 'program-runtime'
    }],
    ['projection', { expectedRevision: 'rev-2', lockState: { revision: 'rev-2' } }]
  ]);
});

test('the first use of an Agent prepares its scoped Program projection once and retries the intent', async () => {
  const calls = [];
  let attempts = 0;
  const runtime = createInteractionRuntime({
    world: {
      async execute(request) {
        calls.push(['world', request.source, request.programMode ?? null, request.interaction.id]);
        attempts += 1;
        if (attempts === 1) {
          return {
            ok: false,
            errors: [{ code: 'ATOM_PROGRAM_PROJECTION_MISSING' }]
          };
        }
        return {
          ok: true,
          command: request.source === 'atom' ? 'atom' : 'explore',
          changed: false,
          revisionAfter: 'rev-1',
          lockState: { revision: 'rev-1' },
          messages: request.source === 'atom'
            ? [{ level: 'info', text: 'prepared context' }]
            : []
        };
      }
    },
    projections: {
      async publish(request) {
        calls.push(['projection', request]);
        return { sourceRevision: request.expectedRevision };
      },
      async recover() {}
    },
    feedback: { async submit() {} },
    agents: {
      async resolve(path) {
        return { ref: 'agent-ref', path };
      }
    },
    humanStatus: { async translate() {} },
    humanWorkspace: { async translate() {} },
    programRuntime: 'program-runtime'
  });

  const result = await runtime.execute({
    source: 'explore {"name":"Target"}',
    correlationId: 'interaction-context',
    agentPath: 'Agent A'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, [{ level: 'info', text: 'prepared context' }]);
  assert.deepEqual(calls, [
    ['world', 'explore {"name":"Target"}', null, 'interaction-context'],
    ['world', 'atom', 'reconcile', 'interaction-context:program-context'],
    ['projection', { expectedRevision: 'rev-1', lockState: { revision: 'rev-1' } }],
    ['world', 'explore {"name":"Target"}', null, 'interaction-context']
  ]);
});

test('an ordinary read consumes current projections without rebuilding them', async () => {
  const context = ports();
  context.world.execute = async (request) => {
    context.calls.push(['world', structuredClone({
      ...request,
      programRuntime: request.programRuntime?.id
    })]);
    return {
      ok: true,
      changed: false,
      revisionAfter: 'rev-2',
      lockState: { revision: 'rev-2' }
    };
  };
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'explore {"name":"Root"}',
    correlationId: 'read-current-projection',
    agentPath: 'Root/Sol',
    history: []
  });

  assert.equal(result.changed, false);
  assert.equal(context.calls.some(([kind]) => kind === 'projection'), false);
});

test('an ordinary read records only compact matched Atom paths and duration', async () => {
  const context = ports();
  const diagnostics = [];
  context.diagnostics = {
    async record(value) {
      diagnostics.push(structuredClone(value));
    }
  };
  context.world.execute = async () => ({
    ok: true,
    command: 'explore',
    changed: false,
    revisionAfter: 'rev-2',
    items: [{ matches: [{ path: 'Root/Target', detail: '不得进入诊断' }] }]
  });
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'explore {"name":"Root/Target"}',
    correlationId: 'read-diagnostic',
    history: []
  });

  assert.equal(result.ok, true);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual({ ...diagnostics[0], durationMs: 0 }, {
    id: 'read-diagnostic:read',
    type: 'read',
    durationMs: 0,
    outcome: 'success',
    affectedAtoms: [{ path: 'Root/Target', axes: [] }]
  });
  assert.equal(Number.isFinite(diagnostics[0].durationMs), true);
  assert.equal(JSON.stringify(diagnostics[0]).includes('不得进入诊断'), false);
});

test('diagnostic persistence failure warns but never changes a successful read outcome', async () => {
  const context = ports();
  context.diagnostics = {
    async record() {
      throw Object.assign(new Error('disk unavailable'), { code: 'EIO' });
    }
  };
  context.world.execute = async () => ({
    ok: true, command: 'explore', changed: false, revisionAfter: 'rev-2', items: []
  });
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'explore {}', correlationId: 'read-diagnostic-failure', history: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.warnings.some((warning) => (
    warning.code === 'READ_DIAGNOSTIC_RECORD_FAILED' && warning.details.cause === 'EIO'
  )), true);
});

test('initialization publishes the exact initialized revision before reporting ready', async () => {
  const context = ports();
  const runtime = createInteractionRuntime(context);

  const result = await runtime.initialize({ correlationId: 'startup-1' });

  assert.equal(result.initialization.revisionAfter, 'rev-2');
  assert.equal(result.projection.sourceRevision, 'rev-2');
  assert.deepEqual(context.calls, [
    ['world', {
      source: 'atom',
      interaction: { id: 'startup-1', agent: null },
      history: [],
      programMode: 'reconcile',
      programRuntime: 'program-runtime'
    }],
    ['projection', { expectedRevision: 'rev-2', lockState: { revision: 'rev-2' } }]
  ]);
});

test('feedback stays in the same interaction boundary without entering world mutation', async () => {
  const context = ports();
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'submit {"type":"bug","detail":"broken"}',
    correlationId: 'interaction-2',
    agentPath: 'Root/Sol',
    history: [{ source: 'atom', receipt: { ok: true } }]
  });

  assert.equal(result.submission.id, 'feedback-1');
  assert.deepEqual(context.calls, [
    ['agent', 'Root/Sol'],
    ['feedback', {
      source: 'submit {"type":"bug","detail":"broken"}',
      interaction: { id: 'interaction-2', agent: { ref: 'agent-ref', path: 'Root/Sol' } },
      history: [{ source: 'atom', receipt: { ok: true } }]
    }]
  ]);
});

test('human status translation re-enters the same world lifecycle as an explicit privileged intent', async () => {
  const context = ports();
  const runtime = createInteractionRuntime(context);

  await runtime.updateHumanStatus({
    key: 'Root/状态',
    detail: '进行中',
    correlationId: 'interaction-3'
  });

  assert.deepEqual(context.calls, [
    ['human-status', { key: 'Root/状态', atomPath: '', detail: '进行中' }],
    ['world', {
      source: 'transform {"name":"Root/状态","detail.rep.":"进行中"}',
      interaction: { id: 'interaction-3', agent: null },
      history: [],
      bypassProgramLocks: true,
      programMode: 'reconcile',
      programRuntime: 'program-runtime'
    }],
    ['projection', { expectedRevision: 'rev-2', lockState: { revision: 'rev-2' } }]
  ]);
});

test('human workspace changes rebuild the context-free Program projection in the same world lifecycle', async () => {
  const context = ports();
  const runtime = createInteractionRuntime(context);

  await runtime.updateHumanWorkspace({
    operation: { type: 'move', sourcePath: 'Root/A', targetPath: 'Root/B' },
    correlationId: 'interaction-workspace'
  });

  assert.deepEqual(context.calls, [
    ['human-workspace', {
      operation: { type: 'move', sourcePath: 'Root/A', targetPath: 'Root/B' }
    }],
    ['world', {
      source: 'transform {"name":"Root/Workspace","detail.rep.":"updated"}',
      interaction: { id: 'interaction-workspace', agent: null },
      history: [],
      programMode: 'reconcile',
      programRuntime: 'program-runtime'
    }],
    ['projection', { expectedRevision: 'rev-2', lockState: { revision: 'rev-2' } }]
  ]);
});

test('runtime rejects malformed intents before any capability is called', async () => {
  const context = ports();
  const runtime = createInteractionRuntime(context);

  await assert.rejects(
    runtime.execute({ source: '', correlationId: 'interaction-4' }),
    (error) => error.code === 'INVALID_INTERACTION_SOURCE'
  );
  await assert.rejects(
    runtime.execute({ source: 'atom', correlationId: '' }),
    (error) => error.code === 'INVALID_CORRELATION_ID'
  );
  assert.deepEqual(context.calls, []);
});

test('projection failure preserves the committed result and exposes explicit recovery', async () => {
  const context = ports();
  context.projections.publish = async () => {
    throw Object.assign(new Error('projection unavailable'), { code: 'PROJECTOR_DOWN' });
  };
  const runtime = createInteractionRuntime(context);

  await assert.rejects(
    runtime.execute({
      source: 'transform {"name":"Root"}',
      correlationId: 'interaction-5'
    }),
    (error) => error.code === 'WORLD_COMMITTED_PROJECTION_PENDING'
      && error.details.result.revisionAfter === 'rev-2'
      && error.details.cause === 'PROJECTOR_DOWN'
  );

  const recovered = await runtime.recover({ expectedRevision: 'rev-2' });
  assert.equal(recovered.sourceRevision, 'rev-2');
  assert.deepEqual(context.calls.at(-1), ['recover', { expectedRevision: 'rev-2' }]);
});
