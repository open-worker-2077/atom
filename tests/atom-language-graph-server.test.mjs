import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ATOM_GRAPH_HOST,
  DEFAULT_ATOM_GRAPH_PORT,
  createOneShotTimingObserver,
  createAtomGraphHandlers,
  normalizeOwnProcessPriority,
  parseAtomGraphServerArgs,
  startAtomGraphServer
} from '../work-engine/atom-language/graph-server.mjs';
import * as graphSchema from '../work-engine/atom-language/graph-schema.mjs';
import { resolveAgentContext } from '../work-engine/atom-language/cli.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import {
  applyGraphFourAxisWorldMigration,
  planGraphFourAxisWorldMigration
} from '../src/atom-system/operations/graph-four-axis-migration.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Atom runtime promotes its own inherited below-normal priority without administrator access', () => {
  const calls = [];
  const result = normalizeOwnProcessPriority({
    getPriority: () => 10,
    setPriority: (pid, priority) => calls.push([pid, priority]),
    normalPriority: 0
  });

  assert.deepEqual(calls, [[0, 0]]);
  assert.deepEqual(result, { changed: true, before: 10, after: 0 });
});

test('Atom runtime keeps an already normal or higher own-process priority', () => {
  let called = false;
  const result = normalizeOwnProcessPriority({
    getPriority: () => 0,
    setPriority: () => { called = true; },
    normalPriority: 0
  });

  assert.equal(called, false);
  assert.deepEqual(result, { changed: false, before: 0, after: 0 });
});

test('Atom HTTP handlers translate transport payloads into one interaction runtime', async () => {
  const calls = [];
  const handlers = createAtomGraphHandlers({
    execute: async (intent) => {
      calls.push(['execute', intent]);
      return { ok: true, command: 'transform' };
    },
    updateHumanStatus: async (intent) => {
      calls.push(['human-status', intent]);
      return { ok: true, command: 'transform' };
    },
    updateHumanWorkspace: async (intent) => {
      calls.push(['human-workspace', intent]);
      return { ok: true, command: 'transform' };
    },
    recover: async (intent) => {
      calls.push(['recover-projection', intent]);
      return { sourceRevision: intent.expectedRevision };
    }
  });

  await handlers.atomCommand({
    source: 'transform {}',
    interaction: { id: 'interaction-1', agent: { ref: 'old-ref', path: 'Root/Sol' } },
    history: []
  });
  await handlers.atomHumanStatus({
    key: 'node-key',
    detail: '进行中',
    interactionId: 'interaction-2'
  });
  await handlers.atomWorkspaceEdit({
    operation: { kind: 'node-create', path: 'root', draft: { label: 'New' } },
    interactionId: 'interaction-3'
  });
  await handlers.atomProjectionRecover({ expectedRevision: 'rev-2' });

  assert.deepEqual(calls, [
    ['execute', {
      source: 'transform {}',
      correlationId: 'interaction-1',
      agentPath: 'Root/Sol',
      history: []
    }],
    ['human-status', {
      key: 'node-key',
      detail: '进行中',
      correlationId: 'interaction-2'
    }],
    ['human-workspace', {
      operation: { kind: 'node-create', path: 'root', draft: { label: 'New' } },
      correlationId: 'interaction-3'
    }],
    ['recover-projection', { expectedRevision: 'rev-2' }]
  ]);
});

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'atom-graph-server-'));
}

function removeTemporaryDirectoryAfter(t, directory) {
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
}

function atomFixture() {
  return [
    {
      'thing@agent': '石器工坊',
      'situation#工坊简介': '可核查的正文',
      contain: [],
      support: [{ 'if@current': true, then: [{ thing: '石斧' }] }]
    },
    {
      'thing@item': '石斧',
      'situation#物件简介': '可核查的物件',
      contain: [],
      support: []
    }
  ];
}

async function migratedLegacySupportWorld() {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const legacyFacts = [
    {
      'name@agent': '冰', detail: '上下文', children: [],
      partners: [{ verb: '原关系字符', object: 'test' }]
    },
    { name: 'test', detail: '目标', children: [], partners: [] }
  ];
  await fs.writeFile(contextFile, `${JSON.stringify(legacyFacts, null, 2)}\n`, 'utf8');
  const plan = planGraphFourAxisWorldMigration({
    snapshot: { facts: legacyFacts, revision: revisionOfWorldFacts(legacyFacts) },
    planner: graphSchema.planGraphFourAxisMigration
  });
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile: graphFile, publishLegacyProjection: false
  });
  await applyGraphFourAxisWorldMigration({
    plan,
    confirmation: true,
    backup: {
      create: async () => ({ id: 'verified-test-backup' }),
      verify: async () => true
    },
    persistence,
    correlationId: 'graph-server-agent-manifest-fixture'
  });
  return {
    directory,
    contextFile,
    graphFile,
    storeFile,
    compatibilityManifest: await persistence.compatibilityManifest()
  };
}

test('graph server arguments default to the shared LocalAppData Atom world', () => {
  const runtime = resolveAtomRuntime();
  assert.equal(DEFAULT_ATOM_GRAPH_HOST, '127.0.0.1');
  assert.equal(DEFAULT_ATOM_GRAPH_PORT, 4784);
  assert.deepEqual(parseAtomGraphServerArgs([]), {
    host: '127.0.0.1',
    port: 4784,
    contextFile: runtime.contextFile,
    graphFile: runtime.graphFile,
    storeFile: runtime.storeFile,
    programProjectionFile: path.join(path.dirname(runtime.contextFile), 'program-projection.json'),
    requestDrivenLockFile: path.join(path.dirname(runtime.contextFile), 'request-driven-locks.json'),
    diagnosticFile: path.join(path.dirname(runtime.contextFile), 'runtime-diagnostics.json'),
    help: false
  });

  assert.deepEqual(parseAtomGraphServerArgs([
    '--host', '127.0.0.2',
    '--port=0',
    '--context', 'context.json',
    '--graph=projection.json',
    '--store', 'store.json',
    '--program-projection=program-projection.json',
    '--request-driven-locks=request-driven-locks.json',
    '--runtime-diagnostics=runtime-diagnostics.json'
  ]), {
    host: '127.0.0.2',
    port: 0,
    contextFile: path.resolve('context.json'),
    graphFile: path.resolve('projection.json'),
    storeFile: path.resolve('store.json'),
    programProjectionFile: path.resolve('program-projection.json'),
    requestDrivenLockFile: path.resolve('request-driven-locks.json'),
    diagnosticFile: path.resolve('runtime-diagnostics.json'),
    help: false
  });
});

test('graph server accepts one UUID timing interaction id and rejects duplicate or invalid values', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(parseAtomGraphServerArgs([`--timing-interaction-id=${id}`]).timingInteractionId, id);
  assert.throws(
    () => parseAtomGraphServerArgs(['--timing-interaction-id', 'not-a-uuid']),
    (error) => error.code === 'INVALID_TIMING_INTERACTION_ID'
  );
  assert.throws(
    () => parseAtomGraphServerArgs(['--timing-interaction-id', id, '--timing-interaction-id', id]),
    (error) => error.code === 'DUPLICATE_TIMING_INTERACTION_ID'
  );
});

test('one-shot timing observer records only one matching interaction under concurrent callbacks', async () => {
  const records = [];
  const id = '11111111-1111-4111-8111-111111111111';
  const observe = createOneShotTimingObserver({ interactionId: id, diagnostics: { enqueue: (entry) => records.push(entry) } });
  await Promise.all([
    observe({ interactionId: id, stage: 'interactionOf', durationMs: 1 }),
    observe({ interactionId: id, stage: 'interactionOf', durationMs: 99 }),
    observe({ interactionId: '22222222-2222-4222-8222-222222222222', stage: 'interactionOf', durationMs: 99 }),
    observe({ interactionId: id, stage: 'world.execute', durationMs: 2 }),
    observe({ interactionId: id, stage: 'result.serialize', durationMs: 3 })
  ]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].stages, [
    { stage: 'interactionOf', durationMs: 1 }, { stage: 'world.execute', durationMs: 2 }, { stage: 'result.serialize', durationMs: 3 }
  ]);
});

test('graph server rejects 4783 and colliding context, projection, and store paths before startup', async (t) => {
  const directory = await temporaryDirectory();
  removeTemporaryDirectoryAfter(t, directory);
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  const diagnosticFile = path.join(directory, 'runtime-diagnostics.json');

  assert.throws(
    () => parseAtomGraphServerArgs(['--port', '4783']),
    (error) => error.code === 'RESERVED_ATOM_GRAPH_PORT'
  );
  await assert.rejects(
    startAtomGraphServer({
      host: '127.0.0.1',
      port: 4783,
      contextFile,
      graphFile,
      storeFile
    }),
    (error) => error.code === 'RESERVED_ATOM_GRAPH_PORT'
  );

  for (const paths of [
    { contextFile, graphFile: contextFile, storeFile, programProjectionFile, diagnosticFile },
    { contextFile, graphFile, storeFile: contextFile, programProjectionFile, diagnosticFile },
    { contextFile, graphFile, storeFile: graphFile, programProjectionFile, diagnosticFile },
    { contextFile, graphFile, storeFile, programProjectionFile: contextFile, diagnosticFile },
    { contextFile, graphFile, storeFile, programProjectionFile: graphFile, diagnosticFile },
    { contextFile, graphFile, storeFile, programProjectionFile: storeFile, diagnosticFile },
    { contextFile, graphFile, storeFile, programProjectionFile, diagnosticFile: contextFile },
    { contextFile, graphFile, storeFile, programProjectionFile, diagnosticFile: graphFile },
    { contextFile, graphFile, storeFile, programProjectionFile, diagnosticFile: storeFile },
    { contextFile, graphFile, storeFile, programProjectionFile, diagnosticFile: programProjectionFile }
  ]) {
    await assert.rejects(
      startAtomGraphServer({ host: '127.0.0.1', port: 0, ...paths }),
      (error) => error.code === 'ATOM_GRAPH_PATH_COLLISION'
    );
  }
  assert.deepEqual(await fs.readdir(directory), []);
});

test('graph server initializes the projection, serves the full UI health and Graph API, and stays isolated', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'live', 'atom.json');
  const graphFile = path.join(directory, 'live', 'graph.json');
  const storeFile = path.join(directory, 'live', 'knowledge.json');
  await fs.mkdir(path.dirname(contextFile), { recursive: true });
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');

  const running = await startAtomGraphServer({
    host: '127.0.0.1',
    port: 0,
    contextFile,
    graphFile,
    storeFile
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);

  assert.equal(running.host, '127.0.0.1');
  assert.notEqual(running.port, 4783);
  assert.equal(running.contextFile, path.resolve(contextFile));
  assert.equal(running.graphFile, path.resolve(graphFile));
  assert.equal(running.storeFile, path.resolve(storeFile));

  const healthResponse = await fetch(`${running.url}/__spatial/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.store, path.resolve(storeFile));
  assert.equal(health.graphFile, path.resolve(graphFile));

  const recoveryResponse = await fetch(`${running.url}/__atom/api/recover-projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: running.initialization.revisionAfter })
  });
  assert.equal(recoveryResponse.status, 200, await recoveryResponse.clone().text());
  const recovery = await recoveryResponse.json();
  assert.equal(recovery.ok, true);
  assert.equal(recovery.result.sourceRevision, `sha256:${running.initialization.revisionAfter}`);

  const staleRecoveryResponse = await fetch(`${running.url}/__atom/api/recover-projection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 'stale-revision' })
  });
  assert.equal(staleRecoveryResponse.status, 400);
  const staleRecovery = await staleRecoveryResponse.json();
  assert.equal(staleRecovery.error.code, 'STALE_WORLD_PROJECTION');

  const graphResponse = await fetch(`${running.url}/__spatial/api/graph`);
  assert.equal(graphResponse.status, 200);
  const graph = await graphResponse.json();
  assert.equal(graph.graph.thing, 'atom.json');
  assert.equal(graph.graph.contain[0]['thing@agent'], '石器工坊');
  assert.equal(graph.graph.contain[0]['situation#工坊简介'], '可核查的正文');

  const pageResponse = await fetch(`${running.url}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html/);
  assert.match(await pageResponse.text(), /<canvas\b|Spatial|空间/u);

  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), atomFixture());
  assert.equal(JSON.parse(await fs.readFile(graphFile, 'utf8')).graph.contain[0]['thing@agent'], '石器工坊');
  assert.equal((await fs.stat(storeFile)).isFile(), true);
  await assert.rejects(
    fs.access(path.join(directory, 'data', 'knowledge.json')),
    { code: 'ENOENT' }
  );

  const stateResponse = await fetch(`${running.url}/__spatial/api/state`);
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  const labels = state.knowledge.nodes.map((node) => node.label);
  assert.ok(labels.includes('石器工坊'), 'atom node projects into the spatial knowledge store');
  assert.ok(labels.includes('石斧'), 'support target projects as its own node');
  assert.equal(state.knowledge.edges.length, 1);
  assert.equal(state.knowledge.edges[0].label, 'support');
});

test('4784 resolves an Agent selector inside the resident world instead of every CLI process', async () => {
  const calls = [];
  const handlers = createAtomGraphHandlers({
    execute: async (intent) => {
      calls.push(intent);
      return { ok: true, command: 'explore' };
    },
    updateHumanStatus: async () => ({}),
    updateHumanWorkspace: async () => ({}),
    recover: async () => ({})
  }, {
    resolveAgent: async (selector) => ({
      ref: 'revision-local-agent-ref',
      path: selector === '冰' ? 'Root/冰' : selector
    })
  });

  const result = await handlers.atomCommand({
    source: 'explore {"thing":"Target"}',
    interaction: { agentSelector: '冰', agent: { path: '冰' } }
  });

  assert.equal(result.agent, 'Root/冰');
  assert.equal(calls[0].agentPath, 'Root/冰');
});

test('deployed Agent resolution reuses the world compatibility manifest for exact explore', async (t) => {
  const files = await migratedLegacySupportWorld();
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, files.directory);

  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"thing":"test"}',
      interaction: { id: 'trusted-legacy-agent-explore', agentSelector: '冰', agent: { path: '冰' } },
      history: []
    })
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.result.ok, true);
  assert.equal(body.result.agent, '冰');
});

test('deployed legacy-support provenance permits a new four-axis Agent transform', async (t) => {
  const files = await migratedLegacySupportWorld();
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, files.directory);

  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'transform new {"thing":"test/写入验收","situation":"四轴","contain":[],"support":[]}',
      interaction: { id: 'trusted-legacy-agent-transform', agentSelector: '冰', agent: { path: '冰' } },
      history: []
    })
  });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.result.ok, true, JSON.stringify(body));
  assert.equal(body.result.changed, true, JSON.stringify(body));
});

test('deployed legacy-support provenance remains valid while a new Program seals a slot body', async (t) => {
  const files = await migratedLegacySupportWorld();
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, files.directory);
  const execute = async (source, id) => {
    const response = await fetch(`${running.url}/__atom/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source,
        interaction: { id, agentSelector: '冰', agent: { path: '冰' } },
        history: []
      })
    });
    return response.json();
  };

  const created = await execute(
    'transform new {"thing":"test/合成槽体验收","situation":"合成验收","contain":[{"thing":"槽体","situation":"","contain":[{"thing":"候选流","situation":"","contain":[{"thing":"原文","situation":"待填写","contain":[],"support":[]},{"thing":"结论","situation":"待计算","contain":[],"support":[]}],"support":[]}],"support":[]},{"thing@program":"封装","situation":"slot_body({\\"action\\":\\"seal\\",\\"body\\":\\"test/合成槽体验收/槽体\\"})","contain":[],"support":[]}],"support":[]}',
    'trusted-legacy-slot-create'
  );
  assert.equal(created.result.ok, true, JSON.stringify(created));

  const sealed = await execute(
    'transform {"thing.run.":"test/合成槽体验收/封装"}',
    'trusted-legacy-slot-seal'
  );
  assert.equal(sealed.result.ok, true, JSON.stringify(sealed));
});

test('directionless legacy relations stay inert while forged provenance is rejected', async (t) => {
  const files = await migratedLegacySupportWorld();
  removeTemporaryDirectoryAfter(t, files.directory);
  await assert.doesNotReject(resolveAgentContext(files.contextFile, '冰'));
  await assert.rejects(resolveAgentContext(files.contextFile, '冰', {
    compatibilityManifest: {
      ...files.compatibilityManifest,
      legacySupport: [{ fingerprint: `sha256:${'0'.repeat(64)}`, occurrences: 1 }]
    }
  }), { code: 'GRAPH_COMPATIBILITY_PROVENANCE_MISMATCH' });
});

test('graph server remains available and reports degraded health when only a disposable projection is pending', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const projectionState = {
    status: 'pending',
    expectedRevision: 'rev-2',
    failure: { projection: 'graph', cause: 'EPERM' }
  };
  const interactionRuntime = {
    async initialize() {
      return {
        initialization: { ok: true, revisionAfter: 'rev-2' },
        projection: null,
        projectionStatus: 'pending'
      };
    },
    async execute() { return { ok: true, changed: false }; },
    async updateHumanStatus() { return { ok: true, changed: false }; },
    async updateHumanWorkspace() { return { ok: true, changed: false }; },
    async recover() { return { sourceRevision: 'rev-2' }; },
    projectionStatus() { return structuredClone(projectionState); }
  };

  const running = await startAtomGraphServer({
    host: '127.0.0.1',
    port: 0,
    contextFile,
    graphFile,
    storeFile,
    interactionRuntime
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);

  const response = await fetch(`${running.url}/__spatial/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.deepEqual(health.atomProjection, projectionState);
});

test('graph server persists compact read diagnostics through the shared interaction runtime', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const diagnosticFile = path.join(directory, 'runtime-diagnostics.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, diagnosticFile
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);

  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"thing":"石器工坊"}',
      interaction: {
        id: 'service-read-diagnostic',
        agent: { ref: 'transport-ref', path: '石器工坊' }
      },
      history: []
    })
  });
  assert.equal(response.status, 200, await response.text());
  const persisted = JSON.parse(await fs.readFile(diagnosticFile, 'utf8'));
  assert.equal(running.diagnosticFile, path.resolve(diagnosticFile));
  assert.deepEqual(persisted.diagnostics.map((item) => item.id), ['service-read-diagnostic:read']);
  assert.deepEqual(persisted.diagnostics[0].affectedAtoms, [{
    path: '石器工坊',
    axes: []
  }]);
  assert.equal(JSON.stringify(persisted).includes('可核查的正文'), false);
});

test('unchanged explore does not load, republish, or rewrite the complete spatial projection', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);

  const beforeState = await (await fetch(`${running.url}/__spatial/api/state`)).json();
  const beforeStat = await fs.stat(storeFile);
  await fs.rename(graphFile, `${graphFile}.offline`);
  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"thing":"石器工坊"}',
      interaction: {
        id: 'read-without-projection-write',
        agent: { ref: 'transport-ref', path: '石器工坊' }
      },
      history: []
    })
  });
  assert.equal(response.status, 200, await response.text());

  const afterState = await (await fetch(`${running.url}/__spatial/api/state`)).json();
  const afterStat = await fs.stat(storeFile);
  assert.equal(afterState.knowledge.revision, beforeState.knowledge.revision);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
});

test('independent explore requests execute concurrently against one initialized runtime', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  let active = 0;
  let maximumActive = 0;
  const interactionRuntime = {
    async initialize() {
      return { initialization: { ok: true, changed: false } };
    },
    async execute() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 80));
      active -= 1;
      return { ok: true, command: 'explore', changed: false, items: [], errors: [], warnings: [] };
    },
    async updateHumanStatus() { return { ok: true, changed: false }; },
    async updateHumanWorkspace() { return { ok: true, changed: false }; },
    async recover() { return { sourceRevision: 'revision' }; },
    projectionStatus() { return { status: 'published' }; }
  };
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, interactionRuntime
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);
  const request = (id) => fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"thing":"石器工坊"}',
      interaction: { id, agent: { ref: 'transport-ref', path: '石器工坊' } },
      history: []
    })
  });

  const responses = await Promise.all([request('concurrent-read-a'), request('concurrent-read-b')]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(maximumActive, 2);
});

test('duplicate HTTP requests with one interaction id execute one authoritative command', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  let executions = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const interactionRuntime = {
    async initialize() { return { initialization: { ok: true, changed: false } }; },
    async execute(_intent, { onCommitted } = {}) {
      executions += 1;
      const committed = {
        ok: true, command: 'transform', changed: true, revisionAfter: 'rev-2'
      };
      onCommitted?.(committed);
      await blocked;
      return { ...committed, projectionStatus: 'published' };
    },
    async updateHumanStatus() { return { ok: true, changed: false }; },
    async updateHumanWorkspace() { return { ok: true, changed: false }; },
    async recover() { return { sourceRevision: 'revision' }; },
    projectionStatus() { return { status: 'published' }; }
  };
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, interactionRuntime
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);
  const request = (source = 'transform new {"thing":"Root","situation":"","contain":[],"support":[]}') => fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source,
      interaction: {
        id: 'same-authoritative-request',
        agent: { ref: 'transport-ref', path: 'Root' }
      },
      history: []
    })
  }).then((response) => response.json());

  const first = request();
  const retry = request();
  const [firstReceipt, retriedReceipt] = await Promise.all([first, retry]);
  assert.deepEqual(retriedReceipt, firstReceipt);
  assert.equal(executions, 1);
  assert.equal(firstReceipt.result.projectionStatus, undefined);
  const conflicting = await request('transform {"thing":"Other","situation.rep.changed"}');
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.error.code, 'ATOM_INTERACTION_ID_CONFLICT');
  assert.equal(executions, 1);
  release();
});

test('graph server queues private backup from a committed operation instead of relying on polling', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'live', 'atom.json');
  const graphFile = path.join(directory, 'live', 'graph.json');
  const storeFile = path.join(directory, 'live', 'knowledge.json');
  await fs.mkdir(path.dirname(contextFile), { recursive: true });
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  const calls = [];
  const trigger = {
    flush: async () => calls.push('flush'),
    start: () => calls.push('start'),
    schedule: () => calls.push('schedule'),
    close: () => calls.push('close')
  };

  const running = await startAtomGraphServer({
    host: '127.0.0.1',
    port: 0,
    contextFile,
    graphFile,
    storeFile,
    backupRepository: path.join(directory, 'private-backup'),
    backupTriggerFactory: () => trigger
  });
  t.after(() => running.close());
  removeTemporaryDirectoryAfter(t, directory);
  assert.deepEqual(calls, ['flush', 'start']);

  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'transform {"thing":"石斧","situation.rep.已更新"}',
      interaction: {
        id: 'backup-after-write',
        agent: { ref: 'fixture-agent-ref', path: '石器工坊' }
      },
      history: []
    })
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual(calls, ['flush', 'start', 'schedule']);
  const barrier = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"thing":"石斧","situation$full":true}',
      interaction: {
        id: 'backup-after-write-read-barrier',
        agent: { ref: 'fixture-agent-ref', path: '石器工坊' }
      },
      history: []
    })
  });
  assert.equal(barrier.status, 200, await barrier.text());
});

test('CLI commit notifies Web only after the affected Spatial projection is current', async (t) => {
  const directory = await temporaryDirectory();
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1',
    port: 0,
    contextFile,
    graphFile,
    storeFile,
    projectionDelayMs: 25
  });

  const before = await fetch(`${running.url}/__spatial/api/state?path=root`)
    .then((response) => response.json());
  const abort = new AbortController();
  t.after(async () => {
    abort.abort();
    await running.close();
  });
  removeTemporaryDirectoryAfter(t, directory);
  const events = await fetch(`${running.url}/__spatial/api/events`, { signal: abort.signal });
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();

  const commit = (detail, id) => fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: `transform {"thing":"石斧","situation.rep.${detail}"}`,
      interaction: {
        id,
        agent: { ref: 'fixture-agent-ref', path: '石器工坊' }
      },
      history: []
    })
  });
  const first = await commit('局部刷新中间值', 'cli-web-local-freshness-first');
  assert.equal(first.status, 200, await first.text());
  const final = await commit('局部刷新后的正文', 'cli-web-local-freshness-final');
  assert.equal(final.status, 200, await final.text());

  const noticeText = decoder.decode((await reader.read()).value);
  const notice = JSON.parse(noticeText.match(/data: (\{[^\n]+\})/u)[1]);
  const after = await fetch(`${running.url}/__spatial/api/state?path=root`)
    .then((stateResponse) => stateResponse.json());
  const updated = after.knowledge.nodes.find((node) => node.label === '石斧');

  assert.ok(notice.revision > before.knowledge.revision);
  assert.equal(notice.revision, after.knowledge.revision);
  assert.equal(updated.detail, '局部刷新后的正文');
  abort.abort();
  await reader.cancel().catch(() => {});
});
