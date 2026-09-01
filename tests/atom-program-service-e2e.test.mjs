import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomCommandEndpoint, resolveAgentContext } from '../work-engine/atom-language/cli.mjs';
import { projectAtomGraphToKnowledge } from '../work-engine/atom-language/graph-4d-projection.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  const agentProgram = type === 'agent';
  const storedType = agentProgram ? 'program' : type;
  const storedSituation = agentProgram
    ? `LEGACY_AGENT_SITUATION = ${JSON.stringify(situation)}\nagent({"labels":[],"functions":{"groups":[],"names":["agent","explore","jump","lock","message","shortcut","slot_body","transform","trigger","use_program","work_order"]}})`
    : situation;
  return { [`thing${storedType ? `@${storedType}` : ''}`]: thing, situation: storedSituation, slot, strut: [] };
}

function childPath(node) {
  let hash = 2166136261;
  for (const character of node.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${node.path}/${(hash >>> 0).toString(36)}`;
}

async function waitForKnowledge(url, predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await fetch(`${url}/__spatial/api/state`).then((response) => response.json());
    if (predicate(state.knowledge)) return state.knowledge;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function settleWorkspaceProjection(running, payload, timeoutMs = 2_000) {
  const expectedRevision = payload.result?.projectionRecovery?.expectedRevision;
  if (!expectedRevision) return payload;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = running.interactionRuntime.projectionStatus();
    if (status.status === 'published' && status.expectedRevision === expectedRevision) {
      payload.knowledge = await fetch(`${running.url}/__spatial/api/state`)
        .then((response) => response.json())
        .then((state) => state.knowledge);
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`workspace projection ${expectedRevision} was not published`);
}

test('CLI rejects a stale 4784 runtime instead of trusting a newer local help contract', async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result: { ok: true, command: 'explore', items: [] } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  await assert.rejects(
    executeAtomCommandEndpoint(
      { source: 'explore {"thing":"Target"}', interaction: { agent: { ref: 'agent-ref', path: 'Agent' } } },
      `http://127.0.0.1:${port}/__atom/api/command`
    ),
    (error) => error?.code === 'ATOM_RUNTIME_CONTRACT_MISMATCH'
  );
});

test('4784 command endpoint retains compiled locks without replaying an untriggered Program', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '起点', [], 'agent'),
    atom('起点锁', [
      "origin = explore({})[0]",
      "lock({'targets': {'refs': [origin.ref]}, 'mode': 'write', 'fields': ['situation']})",
      "message({'level': 'info', 'text': f'当前起点:{origin.path}'})"
    ].join('\n'), [], 'program')
  ], null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());
  const endpoint = `${running.url}/__atom/api/command`;
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const first = await executeAtomCommandEndpoint({ source: 'atom', interaction: { agent } }, endpoint);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.messages, [], 'ordinary reads must not replay an untriggered Program');
  assert.equal(first.lockState[0]?.path, '工作Agent', JSON.stringify(first));

  const cached = await executeAtomCommandEndpoint({ source: 'atom', interaction: { agent } }, endpoint);
  assert.equal(cached.ok, true);
  assert.deepEqual(cached.messages, [], '同一长驻scheduler的缓存不重放旧消息');

  const denied = await executeAtomCommandEndpoint({
    source: 'transform {"thing":"工作Agent","situation.rep.篡改"}', interaction: { agent }
  }, endpoint);
  assert.equal(denied.ok, false);
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED');
});

test('4784 serializes concurrent writes as complete world interactions without losing context or projection updates', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-serial-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '起点', [
      atom('任务甲', '旧甲'),
      atom('任务乙', '旧乙')
    ], 'agent')
  ], null, 2));

  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());
  const endpoint = `${running.url}/__atom/api/command`;
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const [left, right] = await Promise.all([
    executeAtomCommandEndpoint({
      source: 'transform {"thing":"工作Agent/任务甲","situation.rep.新甲"}', interaction: { agent }
    }, endpoint),
    executeAtomCommandEndpoint({
      source: 'transform {"thing":"工作Agent/任务乙","situation.rep.新乙"}', interaction: { agent }
    }, endpoint)
  ]);

  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  const context = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(context[0].slot.find((entry) => entry.thing === '任务甲')?.situation, '新甲');
  assert.equal(context[0].slot.find((entry) => entry.thing === '任务乙')?.situation, '新乙');

  const projectionBarrier = await executeAtomCommandEndpoint({
    source: 'explore {"thing":"工作Agent/任务乙","situation$full":true}', interaction: { agent }
  }, endpoint);
  assert.equal(projectionBarrier.ok, true, JSON.stringify(projectionBarrier.errors));

  const graph = JSON.parse(await fs.readFile(graphFile, 'utf8'));
  const expectedKnowledge = await projectAtomGraphToKnowledge(graph);
  const stateResponse = await fetch(`${running.url}/__spatial/api/state`);
  const state = await stateResponse.json();
  assert.equal(state.ok, true);
  const visibleContent = (knowledge) => knowledge.nodes
    .map(({ label, detail }) => ({ label, detail }))
    .sort((leftNode, rightNode) => leftNode.label.localeCompare(rightNode.label));
  assert.equal(
    JSON.stringify(visibleContent(state.knowledge)),
    JSON.stringify(visibleContent(expectedKnowledge))
  );
});

test('4784 applies one Program effect set without cloning the whole world per transform', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-effect-set-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const targets = Array.from({ length: 80 }, (_, index) => atom(
    `Target ${index}`,
    'before',
    Array.from({ length: 20 }, (__, childIndex) => atom(`Child ${index}-${childIndex}`))
  ));
  const ballast = Array.from(
    { length: 2_000 },
    (_, index) => atom(`Ballast ${index}`, 'x'.repeat(200))
  );
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '起点', [
      atom('Switch', 'before'),
      ...targets,
      ...ballast
    ], 'agent')
  ], null, 2));

  const emptyCycle = () => ({
    cached: false,
    records: [],
    locks: [],
    messages: [],
    transforms: [],
    failures: [],
    runtimeWarnings: []
  });
  let refreshCount = 0;
  const agentSecurity = new Map([['工作Agent', {
    labels: [], functionScopes: { groups: [], names: ['explore', 'transform'] },
    functions: ['explore', 'transform']
  }]]);
  const programScheduler = {
    agentSecurity,
    rebuildAgentSecurity: async () => agentSecurity,
    current: async () => emptyCycle(),
    refresh: async () => {
      refreshCount += 1;
      if (refreshCount !== 2) return emptyCycle();
      return {
        ...emptyCycle(),
        transforms: [
          {
            'thing.typ.program': 'Target 0',
            situation: 'invalid implicit replacement',
            sourceProgramRef: 'rejected-partial-program-ref',
            sourceProgramPath: 'Rejected Partial Program'
          },
          ...targets.map((_, index) => ({
            thing: `Target ${index}`,
            'situation.rep.after': null,
            sourceProgramRef: 'bulk-program-ref',
            sourceProgramPath: 'Bulk Program'
          }))
        ]
      };
    }
  };
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, programScheduler
  });
  t.after(() => running.close());
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const startedAt = Date.now();
  const result = await executeAtomCommandEndpoint({
    source: 'transform {"thing":"工作Agent/Switch","situation.rep.after"}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(elapsedMs < 4_000, `one effect set took ${elapsedMs}ms`);
  const projectionBarrier = await executeAtomCommandEndpoint({
    source: 'explore {"thing":"工作Agent/Target 0","situation$full":true}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);
  assert.equal(projectionBarrier.ok, true, JSON.stringify(projectionBarrier.errors));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].slot;
  for (let index = 0; index < targets.length; index += 1) {
    assert.equal(world.find((entry) => entry.thing === `Target ${index}`)?.situation, 'after');
  }
  assert.equal(Object.hasOwn(world.find((entry) => entry.thing === 'Target 0'), 'thing@program'), false);
  const health = await fetch(`${running.url}/__spatial/api/health`);
  assert.equal(health.status, 200);
});

test('4784 keeps one isolated Program effect set fast across structural and rejected effects', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-structural-effect-set-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const targets = Array.from({ length: 80 }, (_, index) => atom(`Target ${index}`, 'before'));
  const ballast = Array.from(
    { length: 5_000 },
    (_, index) => atom(`Ballast ${index}`, 'x'.repeat(400))
  );
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '起点', [
      atom('Switch', 'before'),
      atom('Destination'),
      ...targets,
      ...ballast
    ], 'agent')
  ], null, 2));

  const emptyCycle = () => ({
    cached: false,
    records: [],
    locks: [],
    messages: [],
    transforms: [],
    failures: [],
    runtimeWarnings: []
  });
  let refreshCount = 0;
  const agentSecurity = new Map([['工作Agent', {
    labels: [], functionScopes: { groups: [], names: ['explore', 'transform'] },
    functions: ['explore', 'transform']
  }]]);
  const programScheduler = {
    agentSecurity,
    rebuildAgentSecurity: async () => agentSecurity,
    current: async () => emptyCycle(),
    refresh: async () => {
      refreshCount += 1;
      if (refreshCount !== 2) return emptyCycle();
      return {
        ...emptyCycle(),
        transforms: [
          {
            thing: 'Target 0',
            'thing.mov.Destination': null,
            sourceProgramRef: 'structural-program-ref',
            sourceProgramPath: 'Structural Program'
          },
          {
            thing: 'Missing target',
            'situation.rep.after': null,
            sourceProgramRef: 'rejected-program-ref',
            sourceProgramPath: 'Rejected Program'
          },
          ...targets.slice(1).map((_, index) => ({
            thing: `Target ${index + 1}`,
            'situation.rep.after': null,
            sourceProgramRef: 'bulk-program-ref',
            sourceProgramPath: 'Bulk Program'
          }))
        ]
      };
    }
  };
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, programScheduler
  });
  t.after(() => running.close());
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const startedAt = Date.now();
  const result = await executeAtomCommandEndpoint({
    source: 'transform {"thing":"工作Agent/Switch","situation.rep.after"}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(elapsedMs < 5_000, `structural effect set took ${elapsedMs}ms`);
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].slot;
  assert.equal(world.find((entry) => entry.thing === 'Target 0'), undefined);
  assert.equal(world.find((entry) => entry.thing === 'Destination').slot[0].thing, 'Target 0');
  for (let index = 1; index < targets.length; index += 1) {
    assert.equal(world.find((entry) => entry.thing === `Target ${index}`)?.situation, 'after');
  }
});

test('4784 Web workspace edits commit atom.json before asynchronously publishing the exact projection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-web-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Existing', 'keep'),
    atom('Default Backup', '', [], 'backup@default')
  ], null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, projectionDelayMs: 0
  });
  t.after(() => running.close());

  const applyWebEdit = async (operation) => {
    const response = await fetch(`${running.url}/__atom/api/workspace-edit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation })
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.result.ok, true, JSON.stringify(payload.result.errors));
    return settleWorkspaceProjection(running, payload);
  };
  const rejectWebEdit = async (operation) => {
    const response = await fetch(`${running.url}/__atom/api/workspace-edit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation })
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.result.ok, false, JSON.stringify(payload.result));
    return payload;
  };

  const response = await fetch(`${running.url}/__atom/api/workspace-edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: { kind: 'node-create', path: 'root', draft: { label: 'Created in Web', description: 'saved fact' } }
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.result.ok, true, JSON.stringify(payload.result.errors));
  await settleWorkspaceProjection(running, payload);
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(world[0].thing, 'Existing');
  assert.equal(world[2].thing, 'Created in Web');
  const createdKnowledge = await waitForKnowledge(
    running.url,
    (knowledge) => knowledge.nodes.some((node) => node.label === 'Created in Web'),
    'created node projection was not published'
  );
  payload.knowledge = createdKnowledge;

  const refreshedState = await (await fetch(`${running.url}/__spatial/api/state`)).json();
  const refreshedCreated = refreshedState.knowledge.nodes.find((node) => node.label === 'Created in Web');
  assert.equal(refreshedCreated.atomPath, 'Created in Web');
  const refreshedKnowledge = (await applyWebEdit({
    kind: 'node-edit', path: refreshedCreated.path, nodeKey: 'stale-browser-key', node: refreshedCreated,
    draft: { label: 'Created after refresh', description: 'saved after refresh', atomTypes: [] }
  })).knowledge;
  const refreshedRenamed = refreshedKnowledge.nodes.find((node) => node.label === 'Created after refresh');
  assert.equal(refreshedRenamed.detail, 'saved after refresh');

  const parent = payload.knowledge.nodes.find((node) => node.label === 'Existing');
  const nestedResponse = await fetch(`${running.url}/__atom/api/workspace-edit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: { kind: 'node-create', path: childPath(parent), draft: { label: 'Nested in Web', description: 'nested fact' } }
    })
  });
  const nestedPayload = await nestedResponse.json();
  assert.equal(nestedPayload.result.ok, true, JSON.stringify(nestedPayload));
  await settleWorkspaceProjection(running, nestedPayload);
  const nestedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(nestedWorld[0].slot[0].thing, 'Nested in Web');

  const returnable = (await applyWebEdit({
    kind: 'node-create', path: childPath(parent), draft: { label: 'Return to top', description: 'root move' }
  })).knowledge.nodes.find((node) => node.label === 'Return to top');
  const returnedToTop = (await applyWebEdit({
    kind: 'node-land',
    source: { key: returnable.key, nodeId: returnable.id },
    sourceNode: returnable,
    target: { path: 'root' },
    draft: { id: returnable.id }
  })).knowledge.nodes.find((node) => node.label === 'Return to top');
  assert.equal(returnedToTop.atomPath, 'Return to top');

  const movable = (await applyWebEdit({
    kind: 'node-create', path: 'root', draft: { label: 'Move after refresh', description: 'movable' }
  })).knowledge.nodes.find((node) => node.label === 'Move after refresh');
  const movedAfterRefresh = (await applyWebEdit({
    kind: 'node-land',
    source: { key: 'stale-browser-key', nodeId: movable.id },
    sourceNode: movable,
    target: { path: childPath(parent) },
    draft: { id: movable.id }
  })).knowledge.nodes.find((node) => node.label === 'Move after refresh');
  assert.equal(movedAfterRefresh.atomPath, 'Existing/Move after refresh');

  const adoptedLegacyNode = (await applyWebEdit({
    kind: 'node-land',
    source: { key: 'root::legacy-local-only', nodeId: 'legacy-local-only' },
    sourceNode: {
      id: 'legacy-local-only', label: 'Legacy local inspiration', description: 'preserve this detail', atomTypes: []
    },
    target: { path: childPath(parent) },
    draft: {
      id: 'legacy-local-only', label: 'Legacy local inspiration', description: 'preserve this detail', atomTypes: []
    }
  })).knowledge.nodes.find((node) => node.label === 'Legacy local inspiration');
  assert.equal(adoptedLegacyNode.atomPath, 'Existing/Legacy local inspiration');
  assert.equal(adoptedLegacyNode.detail, 'preserve this detail');

  let current = nestedPayload.knowledge;
  let created = current.nodes.find((node) => node.label === 'Created after refresh');
  current = (await applyWebEdit({
    kind: 'node-edit', path: created.path, nodeKey: created.key,
    draft: { label: 'Renamed in Web', description: 'edited fact' }
  })).knowledge;
  let renamed = current.nodes.find((node) => node.label === 'Renamed in Web');
  let existing = current.nodes.find((node) => node.label === 'Existing');
  assert.equal(renamed.detail, 'edited fact');

  const rejectedAgentType = await rejectWebEdit({
    kind: 'node-edit', path: renamed.path, nodeKey: renamed.key,
    atomTypesChanged: true,
    draft: { label: 'Renamed in Web', description: 'edited fact', atomTypes: ['agent'] }
  });
  assert.ok(rejectedAgentType.result.errors.some((error) => (
    error.code === 'AGENT_REGISTRATION_REQUIRED'
  )), JSON.stringify(rejectedAgentType));

  current = (await applyWebEdit({
    kind: 'node-edit', path: renamed.path, nodeKey: renamed.key,
    draft: { label: 'Node renamed only', description: 'edited fact', atomTypes: [] }
  })).knowledge;
  renamed = current.nodes.find((node) => node.label === 'Node renamed only');
  assert.deepEqual(renamed.atomTypes, []);

  current = (await applyWebEdit({
    kind: 'node-edit', path: renamed.path, nodeKey: renamed.key,
    atomTypesChanged: true,
    draft: { label: 'Node renamed only', description: 'edited fact', atomTypes: [] }
  })).knowledge;
  renamed = current.nodes.find((node) => node.label === 'Node renamed only');
  assert.deepEqual(renamed.atomTypes, []);

  current = (await applyWebEdit({
    kind: 'edge-create',
    source: { key: 'stale-edge-source', atomPath: existing.atomPath },
    target: { key: 'stale-edge-target', atomPath: renamed.atomPath }
  })).knowledge;
  existing = current.nodes.find((node) => node.label === 'Existing');
  renamed = current.nodes.find((node) => node.label === 'Node renamed only');
  assert.equal(current.edges.length, 1);

  const labelEdit = await fetch(`${running.url}/__atom/api/workspace-edit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: {
        kind: 'edge-edit', status: 'update',
        edge: {
          from: { key: 'stale-edge-source', atomPath: existing.atomPath },
          to: { key: 'stale-edge-target', atomPath: renamed.atomPath },
          label: 'Changed relation'
        }
      }
    })
  });
  assert.equal(labelEdit.status, 400);
  assert.equal((await labelEdit.json()).error.code, 'INVALID_HUMAN_WORKSPACE_REQUEST');
  assert.equal(current.edges[0].label, 'strut');
  existing = current.nodes.find((node) => node.label === 'Existing');
  renamed = current.nodes.find((node) => node.label === 'Node renamed only');

  current = (await applyWebEdit({
    kind: 'edge-edit', status: 'delete',
    edge: {
      from: { key: 'stale-edge-source', atomPath: existing.atomPath },
      to: { key: 'stale-edge-target', atomPath: renamed.atomPath },
      label: 'strut'
    }
  })).knowledge;
  assert.equal(current.edges.length, 0);
  existing = current.nodes.find((node) => node.label === 'Existing');
  renamed = current.nodes.find((node) => node.label === 'Node renamed only');

  current = (await applyWebEdit({
    kind: 'node-land', source: { key: renamed.key }, target: { path: childPath(existing) }, draft: { id: renamed.id }
  })).knowledge;
  const moved = current.nodes.find((node) => node.label === 'Node renamed only');
  assert.equal(moved.path, childPath(current.nodes.find((node) => node.label === 'Existing')));

  const nested = current.nodes.find((node) => node.label === 'Nested in Web');
  await applyWebEdit({
    kind: 'node-edit', status: 'delete', path: nested.path, nodeKey: nested.key, node: { id: nested.id }, draft: {}
  });
  const finalWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(JSON.stringify(finalWorld).includes('Nested in Web'), true, 'discard remains recoverable in the backup area');
  assert.equal(finalWorld[0].slot.some((child) => child.thing === 'Nested in Web'), false);
});

test('cold-start state includes deep Graph facts on first entry and refreshes an authoritative Web rename', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-deep-cold-start-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [atom('Level 1', '', [atom('Level 2', '', [atom('Level 3', 'cold-start fact')])])])
  ], null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, projectionDelayMs: 0
  });
  t.after(() => running.close());

  const firstState = await fetch(`${running.url}/__spatial/api/state`).then((response) => response.json());
  const deep = firstState.knowledge.nodes.find((node) => node.atomPath === 'Root/Level 1/Level 2/Level 3');
  assert.ok(deep, JSON.stringify(firstState.knowledge));
  assert.equal(deep.detail, 'cold-start fact');

  const response = await fetch(`${running.url}/__atom/api/workspace-edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: {
        kind: 'node-edit', path: deep.path, nodeKey: deep.key,
        draft: { label: 'Level 3 renamed', description: 'authoritative detail', atomTypes: [] }
      }
    })
  });
  const edited = await response.json();
  assert.equal(response.status, 200, JSON.stringify(edited));
  assert.equal(edited.result.ok, true, JSON.stringify(edited.result.errors));

  const refreshedKnowledge = await waitForKnowledge(
    running.url,
    (knowledge) => knowledge.nodes.some((node) => (
      node.atomPath === 'Root/Level 1/Level 2/Level 3 renamed'
    )),
    'renamed deep node projection was not published'
  );
  const refreshed = { knowledge: refreshedKnowledge };
  const renamed = refreshed.knowledge.nodes.find((node) => node.atomPath === 'Root/Level 1/Level 2/Level 3 renamed');
  assert.ok(renamed, JSON.stringify(refreshed.knowledge));
  assert.equal(renamed.detail, 'authoritative detail');
  assert.equal(refreshed.knowledge.nodes.some((node) => node.atomPath === 'Root/Level 1/Level 2/Level 3'), false);
});

test('4784 Web batch landing moves every selected sibling into one nested Atom container', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-web-batch-land-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('work', '', [
      atom('项目'),
      atom('工业气系统说明书-旧图冻结备份-20260817'),
      atom('工业气系统说明书-分级学习详情暂存-v10')
    ]),
    atom('工作Agent', '', [], 'agent')
  ], null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, projectionDelayMs: 0
  });
  t.after(() => running.close());

  const initial = (await (await fetch(`${running.url}/__spatial/api/state`)).json()).knowledge;
  const target = initial.nodes.find((node) => node.atomPath === 'work/项目');
  const sources = initial.nodes.filter((node) => [
    'work/工业气系统说明书-旧图冻结备份-20260817',
    'work/工业气系统说明书-分级学习详情暂存-v10'
  ].includes(node.atomPath));
  assert.equal(sources.length, 2);

  const response = await fetch(`${running.url}/__atom/api/workspace-edit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation: {
        kind: 'node-land-batch',
        target: { path: childPath(target) },
        landings: sources.map((source) => ({
          kind: 'node-land',
          source: { key: source.key, nodeId: source.id },
          sourceNode: source,
          target: { path: childPath(target) },
          draft: source
        }))
      }
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.result.ok, true, JSON.stringify(payload.result.errors));
  const movedKnowledge = await waitForKnowledge(
    running.url,
    (knowledge) => sources.every((source) => knowledge.nodes.some((node) => (
      node.atomPath === `work/项目/${source.label}`
    ))),
    'batch landing projection was not published'
  );
  const movedPaths = movedKnowledge.nodes
    .filter((node) => node.label.startsWith('工业气系统说明书-'))
    .map((node) => node.atomPath)
    .sort();
  assert.deepEqual(movedPaths, [
    'work/项目/工业气系统说明书-分级学习详情暂存-v10',
    'work/项目/工业气系统说明书-旧图冻结备份-20260817'
  ].sort());
});

test('4784 rejects direct projection replacement so Web edits cannot bypass atom.json', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-projection-read-only-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Fact', 'owned by Atom')], null, 2));
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile });
  t.after(() => running.close());

  const state = await fetch(`${running.url}/__spatial/api/state`).then((response) => response.json());
  const response = await fetch(`${running.url}/__spatial/api/state`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ knowledge: { ...state.knowledge, nodes: [] } })
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, 'ATOM_PROJECTION_READ_ONLY');
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].situation, 'owned by Atom');
});

test('4784 continues an ordinary command without replaying an unrelated startup failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-isolation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '', [
      atom('目标', '旧值'),
      atom('故障Program', "raise ValueError('broken on purpose')", [], 'program')
    ], 'agent')
  ], null, 2));
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile });
  t.after(() => running.close());
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const result = await executeAtomCommandEndpoint({
    source: 'transform {"thing":"工作Agent/目标","situation.rep.新值"}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].slot[0].situation, '新值');
  assert.equal(result.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
    && warning.program === '故障Program'
  )), false, JSON.stringify(result.warnings));

  const created = await executeAtomCommandEndpoint({
    source: 'transform new {"thing@program":"工作Agent/新增Program","situation":"def main(arguments):\\n    return None","slot":[],"strut":[]}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  assert.equal(created.warnings.some((warning) => warning.program === '故障Program'), false);

  const readBack = await executeAtomCommandEndpoint({
    source: 'explore {"thing":"工作Agent/新增Program","situation$full":true}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);
  assert.equal(readBack.ok, true, JSON.stringify(readBack.errors));
  assert.equal(readBack.warnings.some((warning) => warning.program === '故障Program'), false);
});

test('4784 exact Explore does not replay an unrelated slot effect after an explicit Program changes the world', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-post-run-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '', [
      atom('目标', 'before'),
      atom('改值Program', "transform({'thing':'工作Agent/目标','situation.rep.after':None})", [], 'program'),
      atom('无关槽体Program', [
        "origin = explore({})[0]",
        "slot_body({'action':'print','body':'不存在槽体','revision':'synthetic','name':'不应创建'})"
      ].join('\n'), [], 'program')
    ], 'agent')
  ], null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());
  const endpoint = `${running.url}/__atom/api/command`;
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const changed = await executeAtomCommandEndpoint({
    source: 'transform {"thing.run.":"工作Agent/改值Program"}', interaction: { agent }
  }, endpoint);
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(changed.changed, true, JSON.stringify(changed));

  const readBack = await executeAtomCommandEndpoint({
    source: 'explore {"thing":"工作Agent/目标","situation$full":true}', interaction: { agent }
  }, endpoint);
  assert.equal(readBack.ok, true, JSON.stringify(readBack));
  assert.equal(readBack.items[0].matches[0].situation, 'after');
  assert.equal(readBack.warnings.some((warning) => (
    warning.code === 'INVALID_SLOT_BODY_EFFECT'
    || warning.program === '无关槽体Program'
  )), false, JSON.stringify(readBack.warnings));
});

test('4784 submit endpoint records the current agent and supplied CLI history', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-feedback-service-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('工作Agent', '', [], 'agent')], null, 2));
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile });
  t.after(() => running.close());
  const endpoint = `${running.url}/__atom/api/command`;
  const agent = await resolveAgentContext(contextFile, '工作Agent');
  const result = await executeAtomCommandEndpoint({
    source: 'submit {"type":"pain","detail":"锁提示不便理解"}',
    interaction: { agent },
    history: [{ source: 'atom', ok: true }]
  }, endpoint);
  assert.equal(result.ok, true);
  assert.equal(result.command, 'submit');
  const record = JSON.parse((await fs.readFile(path.join(directory, 'submissions.jsonl'), 'utf8')).trim());
  assert.equal(record.agentPath, '工作Agent');
  assert.equal(record.type, 'pain');
  assert.deepEqual(record.history, [{ source: 'atom', ok: true }]);
});
