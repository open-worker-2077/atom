import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSpatialServer } from '../cli/lib/server.mjs';
import { childDomainPath } from '../cli/lib/probe.mjs';
import { VERSION } from '../cli/lib/version.mjs';

for (const exceedDeadline of [false, true]) {
test(`Atom HTTP receipt advances from committed pending to final failure without rerunning its operation (deadline ${exceedDeadline})`, async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-atom-final-receipt-'));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const instance = await createSpatialServer({
    atomInteractionTimeoutMs: 40,
    root: path.resolve(import.meta.dirname, '..'), storeFile: path.join(directory, 'knowledge.json'),
    async atomCommand(payload, { onCommitted }) {
      calls += 1;
      const base = { ok: true, changed: true, interactionId: payload.interaction.id, errors: [] };
      await onCommitted({ ...base, subsequentExecution: { status: 'pending', errors: [] } });
      await gate;
      return { ...base, subsequentExecution: { status: 'failed', errors: [{ code: 'SUBSCRIBER_FAILED' }] } };
    }
  });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => { release(); return new Promise(resolve => instance.server.close(resolve)); });
  const url = `http://127.0.0.1:${instance.server.address().port}/__atom/api/command`;
  const post = async (source = 'transform source') => (await fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, interaction: { id: 'pending-final' } }) })).json();
  assert.equal((await post()).result.subsequentExecution.status, 'pending');
  assert.equal((await post()).result.subsequentExecution.status, 'pending');
  if (exceedDeadline) await new Promise(resolve => setTimeout(resolve, 80));
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await post()).result.subsequentExecution.status, 'failed');
  assert.equal(calls, 1);
  assert.equal((await post('different source')).error.code, 'ATOM_INTERACTION_ID_CONFLICT');
});
}

test('local server exposes one store to the page bridge and command API', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-server-'));
  const instance = await createSpatialServer({
    root: path.resolve(import.meta.dirname, '..'),
    storeFile: path.join(directory, 'knowledge.json')
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => instance.server.close(resolve)));
  const address = instance.server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await (await fetch(`${origin}/__spatial/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.version, VERSION);

  const created = await (await fetch(`${origin}/__spatial/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'node.create', params: { path: 'root', label: '服务节点' } })
  })).json();
  assert.equal(created.result.node.label, '服务节点');

  const state = await (await fetch(`${origin}/__spatial/api/state`)).json();
  assert.equal(state.knowledge.nodes.length, 1);
  assert.equal(state.knowledge.revision, 1);

  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  const build = pageHtml.match(/data-build="([^"]+)"/)[1];
  assert.match(pageHtml, new RegExp(`spatial-browser-bridge\\.js\\?v=${build.replaceAll('.', '\\.')}`));
});

test('local server notifies connected pages immediately after a committed operation', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-events-'));
  const instance = await createSpatialServer({
    root: path.resolve(import.meta.dirname, '..'),
    storeFile: path.join(directory, 'knowledge.json')
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => instance.server.close(resolve)));
  const address = instance.server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const abort = new AbortController();
  context.after(() => abort.abort());
  const events = await fetch(`${origin}/__spatial/api/events`, { signal: abort.signal });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  await reader.read();

  await fetch(`${origin}/__spatial/api/command`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'node.create', params: { path: 'root', label: '另一端提交' } })
  });
  const notice = decoder.decode((await reader.read()).value);
  assert.match(notice, /"revision":1/u);
  abort.abort();
  await reader.cancel().catch(() => {});
});

test('path state includes two bounded child-domain lookaheads for rapid consecutive entry', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-path-state-'));
  const instance = await createSpatialServer({
    root: path.resolve(import.meta.dirname, '..'),
    storeFile: path.join(directory, 'knowledge.json')
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => instance.server.close(resolve)));
  const address = instance.server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const create = async (pathValue, label) => (await fetch(`${origin}/__spatial/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'node.create', params: { path: pathValue, label } })
  })).json();
  const rootNode = (await create('root', 'atom.json')).result.node;
  const childPath = childDomainPath(rootNode);
  const childNode = (await create(childPath, '项目')).result.node;
  const grandchildPath = childDomainPath(childNode);
  await create(grandchildPath, '连续进入所需孙级节点');

  const response = await fetch(`${origin}/__spatial/api/state?path=root`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.deepEqual(state.scope, { path: 'root' });
  assert.deepEqual(state.knowledge.nodes.map((node) => node.label), ['atom.json', '项目', '连续进入所需孙级节点']);
  assert.deepEqual([...new Set(state.knowledge.nodes.map((node) => node.path))], ['root', childPath, grandchildPath]);
  assert.equal(state.knowledge.revision, 3);
});

test('path state includes the minimal remote route required by a visible linked shortcut', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-shortcut-scope-'));
  const instance = await createSpatialServer({
    root: path.resolve(import.meta.dirname, '..'),
    storeFile: path.join(directory, 'knowledge.json')
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => instance.server.close(resolve)));
  const address = instance.server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const create = async (params) => (await fetch(`${origin}/__spatial/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'node.create', params })
  })).json();

  const west = (await create({ path: 'root', atomPath: '西部', label: '西部', hasChildren: true })).result.node;
  const westPath = childDomainPath(west);
  const district = (await create({
    path: westPath, atomPath: '西部/城区', label: '城区', hasChildren: true
  })).result.node;
  const districtPath = childDomainPath(district);
  const building = (await create({
    path: districtPath, atomPath: '西部/城区/大楼', label: '大楼', hasChildren: true
  })).result.node;
  const buildingPath = childDomainPath(building);
  const room = (await create({
    path: buildingPath, atomPath: '西部/城区/大楼/房间', label: '房间', hasChildren: true
  })).result.node;
  const roomPath = childDomainPath(room);
  await create({
    path: roomPath, atomPath: '西部/城区/大楼/房间/目标', label: '目标'
  });
  await create({
    path: 'root', atomPath: '东部快捷入口', label: '东部快捷入口',
    atomTypes: ['shortcut'], shortcutTargetPath: '西部/城区/大楼/房间/目标'
  });

  const response = await fetch(`${origin}/__spatial/api/state?path=root`);
  assert.equal(response.status, 200);
  const state = await response.json();
  const returned = new Map(state.knowledge.nodes.map((node) => [node.atomPath, node]));

  assert.equal(returned.get('东部快捷入口')?.shortcutTargetPath, '西部/城区/大楼/房间/目标');
  assert.equal(returned.get('西部/城区/大楼')?.path, districtPath);
  assert.equal(returned.get('西部/城区/大楼/房间')?.path, buildingPath);
  assert.equal(returned.get('西部/城区/大楼/房间/目标')?.path, roomPath);
});
