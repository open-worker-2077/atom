import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createStore, edgeIdentity } from '../cli/lib/store.mjs';
import { childDomainPath } from '../cli/lib/probe.mjs';

test('creating a node in a child domain makes its parent expandable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-child-state-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();

  const parent = await store.execute('node.create', {
    path: 'root',
    id: 'parent',
    label: '母球'
  });
  await store.execute('node.create', {
    path: childDomainPath(parent.node),
    id: 'child',
    label: '子节点'
  });

  const persistedParent = await store.execute('node.get', { key: parent.node.key });
  assert.equal(persistedParent.node.hasChildren, true);
});

test('parent expandability follows child deletion and cross-domain landing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-child-mutations-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();

  const firstParent = await store.execute('node.create', {
    path: 'root',
    id: 'first-parent',
    label: '第一母球'
  });
  const secondParent = await store.execute('node.create', {
    path: 'root',
    id: 'second-parent',
    label: '第二母球'
  });
  const child = await store.execute('node.create', {
    path: childDomainPath(firstParent.node),
    id: 'moving-child',
    label: '移动节点'
  });

  await store.execute('node.land', {
    key: child.node.key,
    path: childDomainPath(secondParent.node),
    position: { x: 1, y: 2, z: 3 }
  });
  assert.equal((await store.execute('node.get', { key: firstParent.node.key })).node.hasChildren, false);
  assert.equal((await store.execute('node.get', { key: secondParent.node.key })).node.hasChildren, true);

  await store.execute('node.delete', { key: child.node.key });
  assert.equal((await store.execute('node.get', { key: secondParent.node.key })).node.hasChildren, false);
});

test('persistent store round-trips nodes and a cross-domain relation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-store-'));
  const file = path.join(directory, 'knowledge.json');
  const store = createStore(file);
  await store.init();

  const source = await store.execute('node.create', { path: 'root', label: '起点' });
  const target = await store.execute('node.create', { path: 'root/tunnel-a', label: '落脚' });
  const relation = await store.execute('edge.create', { from: source.node.key, to: target.node.key, label: '跨域关联' });

  assert.equal(relation.edge.crossDomain, true);
  assert.equal(relation.edge.id, edgeIdentity(source.node.key, target.node.key));
  const reopened = createStore(file);
  const field = await reopened.execute('field.get', { scope: 'all' });
  assert.deepEqual(field.nodes.map((node) => node.label), ['起点', '落脚']);
  assert.equal(field.edges.length, 1);
  assert.equal(field.revision, 3);
});

test('edge identity is directional so a reverse relation is a distinct edge, not a duplicate', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-store-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();

  const first = await store.execute('node.create', { path: 'root', label: '甲' });
  const second = await store.execute('node.create', { path: 'root', label: '乙' });

  const forward = await store.execute('edge.create', { from: first.node.key, to: second.node.key, label: '产出' });
  const backward = await store.execute('edge.create', { from: second.node.key, to: first.node.key, label: '消耗' });

  assert.notEqual(forward.edge.id, backward.edge.id);
  assert.equal(forward.edge.id, edgeIdentity(first.node.key, second.node.key));
  assert.equal(backward.edge.id, edgeIdentity(second.node.key, first.node.key));

  const field = await store.execute('field.get', { scope: 'all' });
  assert.equal(field.edges.length, 2);

  await assert.rejects(
    store.execute('edge.create', { from: first.node.key, to: second.node.key, label: '再次产出' }),
    (error) => error.code === 'EDGE_EXISTS'
  );
});

test('updates, search, delete and revisions are explicit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-store-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();
  const created = await store.execute('node.create', { path: 'root', label: '临时知识', detail: '原始' });
  const updated = await store.execute('node.update', { key: created.node.key, label: '深空知识', detail: '更新' });
  assert.equal(updated.node.detail, '更新');
  const matches = await store.execute('search', { query: '深空' });
  assert.equal(matches.results[0].key, created.node.key);
  await store.execute('node.delete', { key: created.node.key });
  const field = await store.execute('field.get', { scope: 'all' });
  assert.equal(field.nodes.length, 0);
  assert.equal(field.revision, 3);
});

test('search returns every match by default and only limits when explicitly requested', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-search-all-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();
  await store.execute('knowledge.replace', {
    knowledge: {
      nodes: Array.from({ length: 30 }, (_, index) => ({
        path: 'root',
        id: `bulk-${index}`,
        label: `Bulk ${index}`,
        detail: 'same keyword'
      }))
    }
  });

  assert.equal((await store.execute('search', { query: 'Bulk' })).results.length, 30);
  assert.equal((await store.execute('search', { query: 'Bulk', limit: 5 })).results.length, 5);
});

test('node.land rekeys one node while preserving old edge endpoints and alias lookup', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-land-'));
  const file = path.join(directory, 'knowledge.json');
  const store = createStore(file);
  await store.init();
  const source = await store.execute('node.create', {
    path: 'root',
    id: 'source-a',
    label: '起点',
    detail: '保留详情',
    position: { x: 1, y: 2, z: 3 }
  });
  const firstPeer = await store.execute('node.create', { path: 'root', id: 'peer-b', label: '旧关系一' });
  const secondPeer = await store.execute('node.create', { path: 'root', id: 'peer-c', label: '旧关系二' });
  await store.execute('edge.create', { from: source.node.key, to: firstPeer.node.key, label: '一号关联' });
  await store.execute('edge.create', { from: source.node.key, to: secondPeer.node.key, label: '二号关联' });

  const landed = await store.execute('node.land', {
    key: source.node.key,
    path: 'root/child',
    position: { x: 4, y: 5, z: 6 }
  });

  assert.equal(landed.oldKey, 'root::source-a');
  assert.equal(landed.newKey, 'root/child::source-a');
  assert.equal(landed.preservedRelations, 2);
  assert.deepEqual(landed.node.aliases, ['root::source-a']);
  assert.deepEqual(landed.node.position, { x: 4, y: 5, z: 6 });
  assert.equal(landed.node.detail, '保留详情');

  const oldLookup = await store.execute('node.get', { key: 'root::source-a' });
  assert.equal(oldLookup.node.key, 'root/child::source-a');
  const currentField = await store.execute('field.get', { path: 'root/child' });
  assert.equal(currentField.nodes.length, 1);
  assert.equal(currentField.edges.length, 2);
  assert.equal(currentField.edges[0].from.key, 'root::source-a');
  assert.equal(currentField.edges[0].from.path, 'root');

  const reopened = createStore(file);
  const persisted = await reopened.execute('node.get', { key: 'root::source-a' });
  assert.equal(persisted.node.key, 'root/child::source-a');
  assert.deepEqual(persisted.node.aliases, ['root::source-a']);
});

test('persistent store retains mirror visibility when a node lands and reopens', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-mirror-land-'));
  const file = path.join(directory, 'knowledge.json');
  const store = createStore(file);
  await store.init();
  const source = await store.execute('node.create', {
    path: 'root',
    id: 'mirror-a',
    label: 'Mirror',
    surfaceVisible: false
  });

  await store.execute('node.land', {
    key: source.node.key,
    path: 'root/child',
    position: { x: 2, y: 3, z: 4 }
  });

  const reopened = createStore(file);
  const persisted = await reopened.execute('node.get', { key: 'root::mirror-a' });
  assert.equal(persisted.node.surfaceVisible, false);
});

test('knowledge replacement preserves projected Atom registration types', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-atom-types-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();

  await store.execute('knowledge.replace', {
    knowledge: { nodes: [{ path: 'root', id: 'agent', label: 'Work Agent', atomTypes: ['agent'] }] }
  });

  const state = await store.execute('field.get', { scope: 'all' });
  assert.deepEqual(state.nodes[0].atomTypes, ['agent']);
});

test('new spatial nodes default to floating details instead of mirror surfaces', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-floating-default-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();
  const created = await store.execute('node.create', { path: 'root', id: 'floating', label: 'Floating' });
  assert.equal(created.node.surfaceVisible, false);
  assert.equal(created.node.detailMode, 'floating');
});

test('node.land accumulates referenced aliases and rejects another node current or historical key', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spatial-land-alias-'));
  const store = createStore(path.join(directory, 'knowledge.json'));
  await store.init();
  await store.execute('node.create', { path: 'root', id: 'a', label: 'A' });
  await store.execute('node.create', { path: 'root/occupied', id: 'a', label: '占位' });

  await assert.rejects(
    store.execute('node.land', { key: 'root::a', path: 'root/occupied', position: {} }),
    (error) => error.code === 'NODE_EXISTS'
  );

  await store.execute('node.land', { key: 'root::a', path: 'root/child', position: {} });
  const twice = await store.execute('node.land', { key: 'root::a', path: 'root/grandchild', position: {} });
  assert.deepEqual(twice.node.aliases, ['root::a', 'root/child::a']);
  assert.equal((await store.execute('node.get', { key: 'root/child::a' })).node.key, 'root/grandchild::a');
});
