import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createLegacyRuntimeComposition,
  createLegacyHumanStatusTranslator,
  createLegacyHumanWorkspaceTranslator
} from '../src/atom-system/adapters/legacy-runtime-composition.mjs';
import { createRuntimeCliExecutor } from '../src/atom-system/adapters/runtime-cli-executor.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

function findAtom(atoms, expectedPath, parentPath = []) {
  for (const current of atoms) {
    const thing = Object.entries(current).find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1];
    const currentPath = [...parentPath, thing];
    if (currentPath.join('/') === expectedPath) return current;
    const nested = findAtom(current.contain ?? [], expectedPath, currentPath);
    if (nested) return nested;
  }
  return null;
}

test('maintenance CLI requests enter through the same interaction runtime contract', async () => {
  const intents = [];
  const execute = createRuntimeCliExecutor({
    interactionRuntime: { execute: async (intent) => { intents.push(intent); return { ok: true }; } },
    randomId: () => 'generated-correlation'
  });

  assert.deepEqual(await execute({
    source: 'atom',
    interaction: { agent: { path: 'Root/Maintainer' } },
    history: [{ source: 'explore {}' }]
  }), { ok: true });
  assert.deepEqual(intents, [{
    source: 'atom',
    correlationId: 'generated-correlation',
    agentPath: 'Root/Maintainer',
    history: [{ source: 'explore {}' }]
  }]);
});

test('maintenance CLI refuses an intent before world dispatch when projection preparation fails', async () => {
  let dispatched = false;
  const execute = createRuntimeCliExecutor({
    interactionRuntime: {
      async initialize() {
        throw Object.assign(new Error('projection unavailable'), {
          code: 'RUNTIME_INITIALIZATION_FAILED'
        });
      },
      async execute() {
        dispatched = true;
        return { ok: true };
      }
    }
  });

  await assert.rejects(execute({
    source: 'transform new {"thing":"Must Not Commit","situation":"","contain":[],"support":[]}',
    interaction: { id: 'maintenance-projection-failure' }
  }), (error) => error.code === 'RUNTIME_INITIALIZATION_FAILED');
  assert.equal(dispatched, false);
});

test('maintenance CLI refuses an intent while prepared projection publication is pending', async () => {
  let dispatched = false;
  const execute = createRuntimeCliExecutor({
    interactionRuntime: {
      async initialize() {
        return {
          projectionStatus: 'pending',
          projectionFailure: { projection: 'graph', cause: 'EPERM' }
        };
      },
      async execute() {
        dispatched = true;
        return { ok: true };
      }
    }
  });

  await assert.rejects(execute({
    source: 'transform new {"thing":"Must Not Commit","situation":"","contain":[],"support":[]}',
    interaction: { id: 'maintenance-projection-pending' }
  }), (error) => error.code === 'RUNTIME_INITIALIZATION_FAILED');
  assert.equal(dispatched, false);
});

test('maintenance CLI reloads the persisted context-free Program projection for an agentless read', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-maintenance-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('test', '', [atom('Bootstrap')])]), 'utf8');

  const projectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  const primingScheduler = createProgramRuntimeScheduler({ projectionRepository });
  const primed = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile: graphFile,
    programMode: 'project', interaction: { id: 'prime', agent: null },
    programScheduler: primingScheduler
  });
  assert.equal(primed.ok, true, JSON.stringify(primed.errors));

  const execute = createRuntimeCliExecutor({
    contextFile,
    graphFile,
    storeFile
  });
  const result = await execute({
    source: 'explore {"thing":"test","contain$latitude-1":true}',
    interaction: { id: 'maintenance-read' }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].path, 'test');
});

test('maintenance first-window creation prepares the same current context-free projection as the server', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-maintenance-first-window-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  const existingAgentSource = 'agent({"labels":[],"functions":{"groups":[],"names":["explore","transform"]}})';
  const bootstrapSource = 'agent({"functions":{"groups":[],"names":["agent"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Existing', existingAgentSource, [atom('Work', '', [atom('Parent')])], 'program@agent')
  ])]), 'utf8');

  const serverScheduler = createProgramRuntimeScheduler();
  const server = createLegacyRuntimeComposition({
    contextFile, graphFile, storeFile, programScheduler: serverScheduler
  });
  await server.initialize({ correlationId: 'server-startup' });
  const serverRead = await server.execute({
    source: 'explore {"thing":"Root/Existing","situation$full":true}',
    correlationId: 'server-self-read', agentPath: 'Root/Existing'
  });
  assert.equal(serverRead.ok, true, JSON.stringify(serverRead.errors));
  await assert.rejects(fs.stat(programProjectionFile), (error) => error.code === 'ENOENT');

  const journal = createJsonTransactionJournal({ file: journalFile });
  const receiptsBefore = (await journal.readState()).receipts.length;
  const maintenance = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  const created = await maintenance({
    source: `transform new {"thing@program":"Root/Existing/Work/Parent/Bootstrap","situation":${JSON.stringify(bootstrapSource)},"contain":[],"support":[]}`,
    interaction: { id: 'maintenance-create-bootstrap' }
  });

  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const preparedProjection = JSON.parse(await fs.readFile(programProjectionFile, 'utf8'));
  assert.equal(preparedProjection.version, 1);
  assert.equal(typeof preparedProjection.worldKey, 'string');
  const receiptsAfterCreate = (await createJsonTransactionJournal({ file: journalFile }).readState()).receipts.length;
  assert.equal(receiptsAfterCreate, receiptsBefore + 1);
  let world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, 'Root/Existing/Work/Parent/Bootstrap') !== null, true);

  const registered = await maintenance({
    source: 'transform {"thing.run.":"Root/Existing/Work/Parent/Bootstrap"}',
    interaction: { id: 'maintenance-register-bootstrap' }
  });
  assert.equal(registered.ok, true, JSON.stringify(registered.errors));
  world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(Object.hasOwn(findAtom(world, 'Root/Existing/Work/Parent/Bootstrap'), 'thing@program@agent'), true);

  const coldScheduler = createProgramRuntimeScheduler();
  await coldScheduler.rebuildAgentSecurity(world);
  assert.deepEqual(coldScheduler.agentSecurity.get('Root/Existing/Work/Parent/Bootstrap'), {
    labels: [],
    functionScopes: { groups: [], names: ['agent'] },
    functions: ['agent']
  });
});

test('legacy composition binds world, Program, projection and spatial publication behind one runtime', async () => {
  const calls = [];
  const programScheduler = { id: 'scheduler' };
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler,
    worldService: {
      executeLegacy: async (request) => {
        calls.push(['world', { ...request, programScheduler: request.programScheduler?.id }]);
        return { ok: true, revisionAfter: 'rev-2', lockState: { active: true } };
      }
    },
    projectionOrchestrator: {
      projectCurrent: async (request) => {
        calls.push(['project', request]);
        return { sourceRevision: request.expectedRevision, graph: {}, spatial: { nodes: [] } };
      }
    },
    spatialPublisher: {
      publish: async (knowledge) => calls.push(['spatial', knowledge])
    },
    graphPublisher: {
      publish: async (graph) => calls.push(['graph', graph])
    },
    feedbackRecorder: async (request) => ({ ok: true, request }),
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath }),
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  await runtime.execute({
    source: 'transform {}',
    correlationId: 'interaction-1',
    agentPath: 'Root/Sol'
  });

  assert.deepEqual(calls, [
    ['world', {
      source: 'transform {}',
      interaction: { id: 'interaction-1', agent: { ref: 'resolved', path: 'Root/Sol' } },
      history: [],
      contextFile: 'atom.json',
      projectionFile: 'graph.json',
      programScheduler: 'scheduler'
    }],
    ['project', { expectedRevision: 'rev-2', lockState: { active: true } }],
    ['graph', {}],
    ['spatial', { nodes: [] }]
  ]);
});

test('legacy composition primes and revision-binds Agent resolution without caching a denied Agent', async () => {
  let manifestCalls = 0;
  let resolverCalls = 0;
  let revision = 'revision-1';
  const scheduler = { agentSecurityWorldRevision: 'security-1' };
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json', graphFile: 'graph.json', storeFile: 'knowledge.json',
    programScheduler: scheduler,
    worldService: {
      async executeLegacy(request) {
        if (request.source === 'transform {"change":true}') revision = 'revision-2';
        return { ok: true, changed: request.source === 'transform {"change":true}', revisionAfter: revision };
      },
      async compatibilityManifest() {
        manifestCalls += 1;
        return { contract: 'test-manifest', currentWorldRevision: revision };
      }
    },
    projectionOrchestrator: { projectCurrent: async () => ({ sourceRevision: revision, graph: {}, spatial: {} }) },
    graphPublisher: { publish: async () => {} }, spatialPublisher: { publish: async () => {} },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async (_file, agentPath, options) => {
      resolverCalls += 1;
      if (agentPath === 'Root/Missing') throw Object.assign(new Error('missing'), { code: 'AGENT_NOT_FOUND' });
      return { ref: `${options.worldRevision}:${agentPath}`, path: agentPath };
    },
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  await runtime.initialize({ correlationId: 'prime-agent-resolution' });
  await runtime.execute({ source: 'transform {}', correlationId: 'same-1', agentPath: 'Root/Agent', history: [] });
  await runtime.execute({ source: 'transform {}', correlationId: 'same-2', agentPath: 'Root/Agent', history: [] });
  assert.equal(manifestCalls, 1, 'startup proof must be reused for the unchanged world');
  assert.equal(resolverCalls, 1, 'same Agent resolution must be O(1) after priming');

  await runtime.execute({ source: 'transform {"change":true}', correlationId: 'changed', agentPath: 'Root/Agent', history: [] });
  await runtime.execute({ source: 'transform {}', correlationId: 'changed-2', agentPath: 'Root/Agent', history: [] });
  assert.equal(resolverCalls, 2, 'a world revision change must force a fresh resolution');

  scheduler.agentSecurityWorldRevision = 'security-2';
  await runtime.execute({ source: 'transform {}', correlationId: 'security-changed', agentPath: 'Root/Agent', history: [] });
  assert.equal(resolverCalls, 3, 'an Agent-security revision change must force a fresh resolution');
  await assert.rejects(
    runtime.execute({ source: 'transform {}', correlationId: 'missing-agent', agentPath: 'Root/Missing', history: [] }),
    (error) => error.code === 'AGENT_NOT_FOUND'
  );
});

test('legacy composition identifies the disposable projection stage without exposing a file path', async () => {
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    worldService: {
      executeLegacy: async () => ({ ok: true, revisionAfter: 'rev-2', lockState: {} })
    },
    projectionOrchestrator: {
      projectCurrent: async () => ({ sourceRevision: 'rev-2', graph: {}, spatial: { nodes: [] } })
    },
    graphPublisher: {
      publish: async () => {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
    },
    spatialPublisher: { publish: async () => assert.fail('must stop at the failed Graph cache') },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async () => null,
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({ source: 'transform {}', correlationId: 'projection-stage' });

  assert.equal(result.ok, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.deepEqual(result.projectionFailure, { projection: 'graph', cause: 'EPERM' });
  assert.equal(JSON.stringify(result).includes('graph.json'), false);
});

test('legacy composition forwards a content-free closed interaction timing ledger', async () => {
  const stages = [];
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    onStage: (stage) => stages.push(stage),
    worldService: {
      executeLegacy: async () => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return { ok: true, changed: false, revisionAfter: 'rev-1' };
      }
    },
    projectionOrchestrator: { projectCurrent: async () => ({ sourceRevision: 'rev-1', graph: {}, spatial: {} }) },
    graphPublisher: { publish: async () => {} }, spatialPublisher: { publish: async () => {} },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async () => {
      await new Promise((resolve) => setTimeout(resolve, 8));
      return { ref: 'agent-ref', path: 'Root/Agent' };
    },
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const startedAt = performance.now();
  await runtime.execute({ source: 'transform {}', correlationId: 'closed-ledger', agentPath: 'Root/Agent', history: [] });
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(stages.map(({ stage }) => stage), [
    'agents.resolve', 'interactionOf', 'world.execute', 'result.serialize'
  ]);
  assert.equal(stages.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0), true);
  assert.ok(Math.abs(stages.filter(({ stage }) => stage !== 'agents.resolve')
    .reduce((total, { durationMs }) => total + durationMs, 0) - elapsedMs) < 15);
  assert.equal(stages.every((stage) => JSON.stringify(stage).includes('atom.json') === false), true);
});

test('legacy composition routes feedback through the configured recorder with world paths', async () => {
  const calls = [];
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    worldService: { executeLegacy: async () => assert.fail('feedback must not mutate world') },
    projectionOrchestrator: { projectCurrent: async () => assert.fail('feedback must not publish') },
    spatialPublisher: { publish: async () => assert.fail('feedback must not publish') },
    graphPublisher: { publish: async () => assert.fail('feedback must not publish') },
    feedbackRecorder: async (request) => {
      calls.push(request);
      return { ok: true, submission: { id: 'feedback-1' } };
    },
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath }),
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({
    source: 'submit {"type":"bug","detail":"broken"}',
    correlationId: 'interaction-2',
    agentPath: 'Root/Sol',
    history: []
  });

  assert.equal(result.submission.id, 'feedback-1');
  assert.equal(calls[0].contextFile, 'atom.json');
  assert.deepEqual(calls[0].interaction, {
    id: 'interaction-2',
    agent: { ref: 'resolved', path: 'Root/Sol' }
  });
});

test('human status translator accepts only projected 状态 nodes and returns one transform intent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-status-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const translator = createLegacyHumanStatusTranslator({
    graphFile,
    projectGraph: async () => ({ atomPathByKey: new Map([['node-key', 'Root/状态']]) })
  });

  assert.equal(
    await translator.translate({ key: 'node-key', detail: '进行中' }),
    'transform {"thing":"Root/状态","situation.rep.进行中"}'
  );
  assert.equal(
    await translator.translate({ key: 'stale-node-key', atomPath: 'Root/状态', detail: '已完成' }),
    'transform {"thing":"Root/状态","situation.rep.已完成"}'
  );
  await assert.rejects(
    translator.translate({ key: 'missing', detail: '进行中' }),
    (error) => error.code === 'INVALID_HUMAN_STATUS_REQUEST'
  );
});

test('human workspace translator treats the single synthetic root domain as the top-level Atom container', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-workspace-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const rootDomain = {
    id: 'synthetic-root', key: 'root::synthetic-root', path: 'root', atomPath: '',
    label: 'atom.json', hasChildren: true
  };
  let hash = 2166136261;
  for (const character of rootDomain.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const rootDomainPath = `root/${(hash >>> 0).toString(36)}`;
  const translator = createLegacyHumanWorkspaceTranslator({
    graphFile,
    projectGraph: async () => ({
      knowledge: { nodes: [rootDomain], edges: [] },
      atomPathByKey: new Map()
    })
  });

  assert.equal(
    await translator.translate({
      operation: {
        kind: 'node-create', path: rootDomainPath,
        draft: { label: 'Top-level from Web', description: 'saved' }
      }
    }),
    'transform new {"thing":"Top-level from Web","situation":"saved","contain":[],"support":[]}'
  );
});

test('human workspace translator emits one atomic Transform for a batch landing', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-batch-landing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const targetNode = { id: 'target', key: 'root::target', path: 'root', label: '目标域' };
  let hash = 2166136261;
  for (const character of targetNode.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const targetSpatialPath = `root/${(hash >>> 0).toString(36)}`;
  const translator = createLegacyHumanWorkspaceTranslator({
    graphFile,
    projectGraph: async () => ({
      knowledge: { nodes: [targetNode], edges: [] },
      atomPathByKey: new Map([
        ['root::a', '来源甲'],
        ['root::b', '来源乙'],
        [targetNode.key, '目标域']
      ])
    })
  });

  assert.equal(
    await translator.translate({
      operation: {
        kind: 'node-land-batch',
        landings: [
          { source: { key: 'root::a' }, target: { path: targetSpatialPath } },
          { source: { key: 'root::b' }, target: { path: targetSpatialPath } }
        ]
      }
    }),
    'transform [{"thing.mov.目标域":"来源甲"},{"thing.mov.目标域":"来源乙"}]'
  );
});
