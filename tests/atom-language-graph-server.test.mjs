import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ATOM_GRAPH_HOST,
  DEFAULT_ATOM_GRAPH_PORT,
  createAtomGraphHandlers,
  parseAtomGraphServerArgs,
  startAtomGraphServer
} from '../work-engine/atom-language/graph-server.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-graph-server-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function atomFixture() {
  return [
    {
      'name@agent': '石器工坊',
      'detail#工坊简介': '可核查的正文',
      children: [],
      partners: [
        { verb: '产出', object: '石斧' }
      ]
    },
    {
      'name@item': '石斧',
      'detail#物件简介': '可核查的物件',
      children: [],
      partners: []
    }
  ];
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

test('graph server rejects 4783 and colliding context, projection, and store paths before startup', async (t) => {
  const directory = await temporaryDirectory(t);
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
  const directory = await temporaryDirectory(t);
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
  assert.equal(recoveryResponse.status, 200);
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
  assert.equal(graph.graph.name, 'atom.json');
  assert.equal(graph.graph.children[0].name, '石器工坊');
  assert.equal(graph.graph.children[0].detail, '可核查的正文');

  const pageResponse = await fetch(`${running.url}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html/);
  assert.match(await pageResponse.text(), /<canvas\b|Spatial|空间/u);

  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), atomFixture());
  assert.equal(JSON.parse(await fs.readFile(graphFile, 'utf8')).graph.children[0].name, '石器工坊');
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
  assert.ok(labels.includes('石斧'), 'atom partner object projects as its own node');
  assert.equal(state.knowledge.edges.length, 1);
  assert.equal(state.knowledge.edges[0].label, '产出');
});

test('graph server remains available and reports degraded health when only a disposable projection is pending', async (t) => {
  const directory = await temporaryDirectory(t);
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

  const response = await fetch(`${running.url}/__spatial/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.deepEqual(health.atomProjection, projectionState);
});

test('graph server persists compact read diagnostics through the shared interaction runtime', async (t) => {
  const directory = await temporaryDirectory(t);
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const diagnosticFile = path.join(directory, 'runtime-diagnostics.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, diagnosticFile
  });
  t.after(() => running.close());

  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"name":"石器工坊"}',
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

test('graph server queues private backup from a committed operation instead of relying on polling', async (t) => {
  const directory = await temporaryDirectory(t);
  const contextFile = path.join(directory, 'live', 'atom.json');
  const graphFile = path.join(directory, 'live', 'graph.json');
  const storeFile = path.join(directory, 'live', 'knowledge.json');
  await fs.mkdir(path.dirname(contextFile), { recursive: true });
  await fs.writeFile(contextFile, `${JSON.stringify(atomFixture(), null, 2)}\n`, 'utf8');
  const calls = [];
  const trigger = {
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
  assert.deepEqual(calls, ['start']);

  const response = await fetch(`${running.url}/__atom/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'transform {"name":"石斧","detail.rep.已更新"}',
      interaction: {
        id: 'backup-after-write',
        agent: { ref: 'fixture-agent-ref', path: '石器工坊' }
      },
      history: []
    })
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual(calls, ['start', 'schedule']);
});
