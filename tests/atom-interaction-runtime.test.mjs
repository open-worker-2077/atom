import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createInteractionRuntime } from '../src/atom-system/public/interaction-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

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
        return `transform {"name":"${request.key}","situation.rep.":"${request.detail}"}`;
      }
    },
    humanWorkspace: {
      translate: async (request) => {
        calls.push(['human-workspace', structuredClone(request)]);
        return 'transform {"name":"Root/Workspace","situation.rep.":"updated"}';
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

test('a committed write is exposed before disposable projection publication finishes', async () => {
  let releaseProjection;
  const projectionBlocked = new Promise((resolve) => {
    releaseProjection = resolve;
  });
  const context = ports();
  context.projections.publish = async () => {
    await projectionBlocked;
    return { sourceRevision: 'rev-2' };
  };
  context.world.execute = async () => ({
    ok: true,
    command: 'transform',
    changed: true,
    revisionAfter: 'rev-2',
    lockState: { revision: 'rev-2' }
  });
  const runtime = createInteractionRuntime(context);
  let committed;

  const completion = runtime.execute({
    source: 'transform {"thing":"Root"}',
    correlationId: 'receipt-before-projection',
    history: []
  }, {
    onCommitted(result) {
      committed = result;
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(committed?.revisionAfter, 'rev-2');
  assert.equal(committed?.changed, true);

  releaseProjection();
  const result = await completion;
  assert.equal(result.projectionStatus, 'published');
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
    ['world', 'atom', 'passive', 'interaction-context:program-context'],
    ['projection', { expectedRevision: 'rev-1', lockState: { revision: 'rev-1' } }],
    ['world', 'explore {"name":"Target"}', null, 'interaction-context']
  ]);
});

test('a trusted agentless read prepares its context-free Program projection once and retries', async () => {
  const calls = [];
  let attempts = 0;
  const runtime = createInteractionRuntime({
    world: {
      async execute(request) {
        calls.push(['world', request.source, request.programMode ?? null, request.interaction.agent]);
        attempts += 1;
        if (attempts === 1) return { ok: false, errors: [{ code: 'ATOM_PROGRAM_PROJECTION_MISSING' }] };
        return {
          ok: true,
          command: request.source === 'atom' ? 'atom' : 'explore',
          changed: false,
          revisionAfter: 'rev-1',
          lockState: { revision: 'rev-1' },
          messages: []
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
    agents: { async resolve() { throw new Error('agentless request must not resolve an Agent'); } },
    humanStatus: { async translate() {} },
    humanWorkspace: { async translate() {} },
    programRuntime: 'program-runtime'
  });

  const result = await runtime.execute({
    source: 'explore {"thing":"test"}',
    correlationId: 'trusted-bootstrap-context'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['world', 'explore {"thing":"test"}', null, null],
    ['world', 'atom', 'passive', null],
    ['projection', { expectedRevision: 'rev-1', lockState: { revision: 'rev-1' } }],
    ['world', 'explore {"thing":"test"}', null, null]
  ]);
});

test('an ordinary exact Explore passively prepares projections without replaying an unrelated jump Program', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-read-passive-jump-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Audit', '', [], 'agent'),
    atom('Acceptance', '', [
      atom('Job1'),
      atom('Job2', '', [
        atom('Window', '', [atom('Registration', [
          'point = explore({"thing":"./PriorityWritable"})[0]',
          'jump({})'
        ].join('\n'), [], 'program')], 'agent')
      ])
    ])
  ])], null, 2));
  let storedProjection = null;
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      load: async () => structuredClone(storedProjection),
      save: async (value) => {
        storedProjection = structuredClone(value);
        return structuredClone(value);
      }
    }
  });
  const initialized = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'project', interaction: { id: 'startup', agent: null }
  });
  assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));
  assert.equal(storedProjection.contextIncomplete, true);
  const runtime = createInteractionRuntime({
    world: {
      execute: (request) => executeAtomLanguage({
        ...request, contextFile, projectionFile, programScheduler: request.programRuntime
      })
    },
    projections: {
      publish: async ({ expectedRevision }) => ({ sourceRevision: expectedRevision }),
      recover: async ({ expectedRevision }) => ({ sourceRevision: expectedRevision })
    },
    feedback: { submit: async () => ({ ok: true }) },
    agents: { resolve: async (agentPath) => ({ ref: `agent:${agentPath}`, path: agentPath }) },
    humanStatus: { translate: async () => '' },
    humanWorkspace: { translate: async () => '' },
    programRuntime: scheduler
  });

  const result = await runtime.execute({
    source: 'explore {"thing":"Root/Acceptance/Job2/Window","situation$full":true}',
    correlationId: 'ordinary-read-after-window-reset',
    agentPath: 'Root/Audit'
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].path, 'Root/Acceptance/Job2/Window');
  assert.equal(result.errors.some((error) => error.code === 'WINDOW_JUMP_DESTINATION_INVALID'), false);
});

test('a failed projection after automatic Program preparation remains visible on the retried read', async () => {
  let attempts = 0;
  const context = ports();
  context.world.execute = async (request) => {
    attempts += 1;
    if (attempts === 1) {
      return { ok: false, errors: [{ code: 'ATOM_PROGRAM_PROJECTION_MISSING' }] };
    }
    if (request.source === 'atom') {
      return {
        ok: true,
        command: 'atom',
        changed: true,
        revisionAfter: 'rev-2',
        lockState: {}
      };
    }
    return {
      ok: true,
      command: 'explore',
      changed: false,
      revisionAfter: 'rev-2',
      items: []
    };
  };
  context.projections.publish = async () => {
    throw Object.assign(new Error('locked'), {
      code: 'PROJECTION_CACHE_PUBLISH_FAILED',
      details: { projection: 'spatial', cause: 'EPERM' }
    });
  };
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'explore {"name":"Target"}',
    correlationId: 'prepare-pending',
    agentPath: 'Root/Sol'
  });

  assert.equal(result.ok, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.deepEqual(result.projectionFailure, { projection: 'spatial', cause: 'EPERM' });
  assert.equal(result.warnings.some(({ code }) => code === 'PROJECTION_RECOVERY_PENDING'), true);
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
      programMode: 'project',
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
      source: 'transform {"name":"Root/状态","situation.rep.":"进行中"}',
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
      source: 'transform {"name":"Root/Workspace","situation.rep.":"updated"}',
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

test('projection failure preserves the committed result without turning it into a failed write', async () => {
  const context = ports();
  context.projections.publish = async () => {
    throw Object.assign(new Error('projection unavailable'), {
      code: 'PROJECTION_CACHE_PUBLISH_FAILED',
      details: { projection: 'graph', cause: 'EPERM' }
    });
  };
  const runtime = createInteractionRuntime(context);

  const result = await runtime.execute({
    source: 'transform {"name":"Root"}',
    correlationId: 'interaction-5'
  });

  assert.equal(result.ok, true);
  assert.equal(result.revisionAfter, 'rev-2');
  assert.equal(result.projectionStatus, 'pending');
  assert.deepEqual(result.projectionRecovery, { expectedRevision: 'rev-2' });
  assert.deepEqual(result.projectionFailure, { projection: 'graph', cause: 'EPERM' });
  assert.equal(result.warnings.at(-1).code, 'PROJECTION_RECOVERY_PENDING');

  const recovered = await runtime.recover({ expectedRevision: 'rev-2' });
  assert.equal(recovered.sourceRevision, 'rev-2');
  assert.equal(runtime.projectionStatus().status, 'published');
  assert.deepEqual(context.calls.at(-1), ['recover', { expectedRevision: 'rev-2' }]);
});

test('initialization keeps the fact service available when a disposable projection is unavailable', async () => {
  const context = ports();
  context.projections.publish = async () => {
    throw Object.assign(new Error('spatial cache locked'), {
      code: 'PROJECTION_CACHE_PUBLISH_FAILED',
      details: { projection: 'spatial', cause: 'EPERM' }
    });
  };
  const runtime = createInteractionRuntime(context);

  const initialized = await runtime.initialize({ correlationId: 'startup-degraded' });

  assert.equal(initialized.initialization.ok, true);
  assert.equal(initialized.projection, null);
  assert.equal(initialized.projectionStatus, 'pending');
  assert.deepEqual(initialized.projectionFailure, { projection: 'spatial', cause: 'EPERM' });
  assert.deepEqual(runtime.projectionStatus(), {
    status: 'pending',
    expectedRevision: 'rev-2',
    failure: { projection: 'spatial', cause: 'EPERM' }
  });
});
