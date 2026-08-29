import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSpatialServer } from '../cli/lib/server.mjs';
import { childDomainPath } from '../cli/lib/probe.mjs';
import { VERSION } from '../cli/lib/version.mjs';

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

test('path state includes one child-domain lookahead without downloading deeper descendants', async (context) => {
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
  await create(grandchildPath, '不应预取的孙级节点');

  const response = await fetch(`${origin}/__spatial/api/state?path=root`);
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.deepEqual(state.scope, { path: 'root' });
  assert.deepEqual(state.knowledge.nodes.map((node) => node.label), ['atom.json', '项目']);
  assert.deepEqual([...new Set(state.knowledge.nodes.map((node) => node.path))], ['root', childPath]);
  assert.equal(state.knowledge.revision, 3);
});
