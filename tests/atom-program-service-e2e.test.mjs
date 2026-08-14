import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomCommandEndpoint, resolveAgentContext } from '../work-engine/atom-language/cli.mjs';
import { projectAtomGraphToKnowledge } from '../work-engine/atom-language/graph-4d-projection.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

function childPath(node) {
  let hash = 2166136261;
  for (const character of node.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${node.path}/${(hash >>> 0).toString(36)}`;
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
      { source: 'explore {"name":"Target"}', interaction: { agent: { ref: 'agent-ref', path: 'Agent' } } },
      `http://127.0.0.1:${port}/__atom/api/command`
    ),
    (error) => error?.code === 'ATOM_RUNTIME_CONTRACT_MISMATCH'
  );
});

test('4784 command endpoint owns one scheduler and uses @agent as Program explore origin', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '起点', [], 'agent'),
    atom('起点锁', [
      "origin = explore({})[0]",
      "lock({'targets': {'refs': [origin.ref]}, 'mode': 'write', 'fields': ['detail']})",
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
  assert.equal(first.messages[0].text, '当前起点:工作Agent');

  const cached = await executeAtomCommandEndpoint({ source: 'atom', interaction: { agent } }, endpoint);
  assert.equal(cached.ok, true);
  assert.deepEqual(cached.messages, [], '同一长驻scheduler的缓存不重放旧消息');

  const denied = await executeAtomCommandEndpoint({
    source: 'transform {"name":"工作Agent","detail.rep.篡改"}', interaction: { agent }
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
    atom('工作Agent', '起点', [], 'agent'),
    atom('任务甲', '旧甲'),
    atom('任务乙', '旧乙')
  ], null, 2));

  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());
  const endpoint = `${running.url}/__atom/api/command`;
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const [left, right] = await Promise.all([
    executeAtomCommandEndpoint({
      source: 'transform {"name":"任务甲","detail.rep.新甲"}', interaction: { agent }
    }, endpoint),
    executeAtomCommandEndpoint({
      source: 'transform {"name":"任务乙","detail.rep.新乙"}', interaction: { agent }
    }, endpoint)
  ]);

  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  const context = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(context.find((entry) => entry.name === '任务甲')?.detail, '新甲');
  assert.equal(context.find((entry) => entry.name === '任务乙')?.detail, '新乙');

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

test('4784 Web workspace node creation commits atom.json before returning the rebuilt projection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-web-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Existing', 'keep'),
    atom('Default Backup', '', [], 'backup@default')
  ], null, 2));
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile });
  t.after(() => running.close());

  const applyWebEdit = async (operation) => {
    const response = await fetch(`${running.url}/__atom/api/workspace-edit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation })
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.result.ok, true, JSON.stringify(payload.result.errors));
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
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(world[0].name, 'Existing');
  assert.equal(world[2].name, 'Created in Web');
  assert.equal(payload.knowledge.nodes.some((node) => node.label === 'Created in Web'), true);

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
  const nestedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(nestedWorld[0].children[0].name, 'Nested in Web');

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

  current = (await applyWebEdit({
    kind: 'node-edit', path: renamed.path, nodeKey: renamed.key,
    atomTypesChanged: true,
    draft: { label: 'Renamed in Web', description: 'edited fact', atomTypes: ['agent'] }
  })).knowledge;
  renamed = current.nodes.find((node) => node.label === 'Renamed in Web');
  assert.deepEqual(renamed.atomTypes, ['agent']);

  current = (await applyWebEdit({
    kind: 'node-edit', path: renamed.path, nodeKey: renamed.key,
    draft: { label: 'Agent renamed only', description: 'edited fact', atomTypes: [] }
  })).knowledge;
  renamed = current.nodes.find((node) => node.label === 'Agent renamed only');
  assert.deepEqual(renamed.atomTypes, ['agent']);

  current = (await applyWebEdit({
    kind: 'node-edit', path: renamed.path, nodeKey: renamed.key,
    atomTypesChanged: true,
    draft: { label: 'Agent renamed only', description: 'edited fact', atomTypes: [] }
  })).knowledge;
  renamed = current.nodes.find((node) => node.label === 'Agent renamed only');
  assert.deepEqual(renamed.atomTypes, []);

  current = (await applyWebEdit({
    kind: 'edge-create',
    source: { key: 'stale-edge-source', atomPath: existing.atomPath },
    target: { key: 'stale-edge-target', atomPath: renamed.atomPath }
  })).knowledge;
  existing = current.nodes.find((node) => node.label === 'Existing');
  renamed = current.nodes.find((node) => node.label === 'Agent renamed only');
  assert.equal(current.edges.length, 1);

  current = (await applyWebEdit({
    kind: 'edge-edit', status: 'update',
    edge: {
      from: { key: 'stale-edge-source', atomPath: existing.atomPath },
      to: { key: 'stale-edge-target', atomPath: renamed.atomPath },
      label: 'Changed relation'
    }
  })).knowledge;
  assert.equal(current.edges[0].label, 'Changed relation');
  existing = current.nodes.find((node) => node.label === 'Existing');
  renamed = current.nodes.find((node) => node.label === 'Agent renamed only');

  current = (await applyWebEdit({
    kind: 'edge-edit', status: 'delete',
    edge: {
      from: { key: 'stale-edge-source', atomPath: existing.atomPath },
      to: { key: 'stale-edge-target', atomPath: renamed.atomPath },
      label: 'Changed relation'
    }
  })).knowledge;
  assert.equal(current.edges.length, 0);
  existing = current.nodes.find((node) => node.label === 'Existing');
  renamed = current.nodes.find((node) => node.label === 'Agent renamed only');

  current = (await applyWebEdit({
    kind: 'node-land', source: { key: renamed.key }, target: { path: childPath(existing) }, draft: { id: renamed.id }
  })).knowledge;
  const moved = current.nodes.find((node) => node.label === 'Agent renamed only');
  assert.equal(moved.path, childPath(current.nodes.find((node) => node.label === 'Existing')));

  const nested = current.nodes.find((node) => node.label === 'Nested in Web');
  await applyWebEdit({
    kind: 'node-edit', status: 'delete', path: nested.path, nodeKey: nested.key, node: { id: nested.id }, draft: {}
  });
  const finalWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(JSON.stringify(finalWorld).includes('Nested in Web'), true, 'discard remains recoverable in the backup area');
  assert.equal(finalWorld[0].children.some((child) => child.name === 'Nested in Web'), false);
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
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].detail, 'owned by Atom');
});

test('4784 continues an ordinary command when one Program fails before execution', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-service-isolation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('工作Agent', '旧值', [], 'agent'),
    atom('故障Program', "raise ValueError('broken on purpose')", [], 'program')
  ], null, 2));
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile });
  t.after(() => running.close());
  const agent = await resolveAgentContext(contextFile, '工作Agent');

  const result = await executeAtomCommandEndpoint({
    source: 'transform {"name":"工作Agent","detail.rep.新值"}',
    interaction: { agent }
  }, `${running.url}/__atom/api/command`);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].detail, '新值');
  assert.equal(result.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
    && warning.program === '故障Program'
  )), true, JSON.stringify(result.warnings));
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
