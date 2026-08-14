import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBossStore } from '../cli/lib/boss-store.mjs';
import { childDomainPath } from '../cli/lib/probe.mjs';
import { createSpatialServer } from '../cli/lib/server.mjs';

test('Boss server supports aggregate edits recursive confirmation and Z/X history endpoints', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-4d-boss-server-'));
  const bossStore = createBossStore(directory);
  await bossStore.init();
  await bossStore.createBoss({ bossId: 'individual-management', label: 'individual management' });
  await bossStore.createBoss({ bossId: 'test', label: 'test' });

  const instance = await createSpatialServer({
    root: path.resolve(import.meta.dirname, '..'),
    bossDirectory: directory
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => instance.server.close(resolve)));
  const origin = `http://127.0.0.1:${instance.server.address().port}`;

  const health = await (await fetch(`${origin}/__spatial/api/health`)).json();
  assert.equal(health.mode, 'boss');

  let state = await (await fetch(`${origin}/__spatial/api/state`)).json();
  const root = state.knowledge.nodes.find((node) => node.nodeId === 'individual-management');
  const parentPath = childDomainPath(root);
  state.knowledge.nodes.push({
    id: 'synthetic-parent',
    nodeId: 'synthetic-parent',
    path: parentPath,
    key: `${parentPath}::synthetic-parent`,
    label: '合成上级',
    aliases: [],
    position: { x: 0, y: 0, z: 0 }
  });
  let response = await fetch(`${origin}/__spatial/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ knowledge: state.knowledge })
  });
  assert.equal(response.status, 200);
  let payload = await response.json();
  let parent = payload.result.knowledge.nodes.find((node) => node.nodeId === 'synthetic-parent');

  const childPath = childDomainPath(parent);
  payload.result.knowledge.nodes.push({
    id: 'synthetic-child',
    nodeId: 'synthetic-child',
    path: childPath,
    key: `${childPath}::synthetic-child`,
    label: '合成下级',
    aliases: [],
    position: { x: 0, y: 0, z: 0 }
  });
  response = await fetch(`${origin}/__spatial/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ knowledge: payload.result.knowledge })
  });
  payload = await response.json();
  assert.equal(response.status, 200);

  const deletion = structuredClone(payload.result.knowledge);
  deletion.nodes = deletion.nodes.filter((node) => node.nodeId !== 'synthetic-parent');
  response = await fetch(`${origin}/__spatial/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ knowledge: deletion })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'DELETE_CONFIRMATION_REQUIRED');

  response = await fetch(`${origin}/__spatial/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      knowledge: deletion,
      confirmedRecursiveDeleteNodeIds: ['synthetic-parent']
    })
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.knowledge.nodes.some((node) => node.nodeId === 'synthetic-child'), false);

  response = await fetch(`${origin}/__spatial/api/boss/undo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bossId: 'individual-management' })
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.knowledge.nodes.some((node) => node.nodeId === 'synthetic-parent'), true);
  assert.equal(payload.knowledge.nodes.some((node) => node.nodeId === 'synthetic-child'), true);

  response = await fetch(`${origin}/__spatial/api/boss/redo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bossId: 'individual-management' })
  });
  payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.knowledge.nodes.some((node) => node.nodeId === 'synthetic-parent'), false);
});
