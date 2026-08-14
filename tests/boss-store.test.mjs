import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBossStore } from '../cli/lib/boss-store.mjs';
import { childDomainPath } from '../cli/lib/probe.mjs';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-4d-boss-store-'));
  const store = createBossStore(directory);
  await store.init();
  return { directory, store };
}

test('each top-level Boss owns one isolated JSON and catalog entry', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'manageboard', label: '个人主库' });
  await store.createBoss({ bossId: 'test', label: '测试库' });

  const catalog = await store.readCatalog();
  assert.deepEqual(catalog.bosses.map((boss) => boss.bossId), ['manageboard', 'test']);

  const manageboard = JSON.parse(await fs.readFile(store.bossFile('manageboard'), 'utf8'));
  const testKnowledge = JSON.parse(await fs.readFile(store.bossFile('test'), 'utf8'));
  assert.equal(manageboard.nodes[0].bossId, 'manageboard');
  assert.equal(manageboard.nodes[0].leaderId, null);
  assert.equal(testKnowledge.nodes[0].bossId, 'test');
});

test('bossId routes storage while leaderId controls the direct hierarchy', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'manageboard', label: '个人主库' });
  await store.createBoss({ bossId: 'test', label: '测试库' });

  const created = await store.execute('manageboard', 'node.create', {
    id: 'goal',
    nodeId: 'goal',
    leaderId: 'manageboard',
    path: 'root/manageboard',
    label: '目标'
  });
  assert.equal(created.node.bossId, 'manageboard');
  assert.equal(created.node.leaderId, 'manageboard');

  await store.execute('manageboard', 'node.update', {
    key: created.node.key,
    leaderId: 'manageboard',
    detail: '只写入个人主库'
  });

  const manageboard = JSON.parse(await fs.readFile(store.bossFile('manageboard'), 'utf8'));
  const testKnowledge = JSON.parse(await fs.readFile(store.bossFile('test'), 'utf8'));
  assert.equal(manageboard.nodes.length, 2);
  assert.equal(testKnowledge.nodes.length, 1);
});

test('history grows immutable before and after snapshot branches for deletion', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'manageboard' });
  const created = await store.execute('manageboard', 'node.create', {
    id: 'task',
    leaderId: 'manageboard',
    path: 'root/manageboard',
    label: '待办'
  });
  await store.execute('manageboard', 'node.delete', { key: created.node.key });

  const history = JSON.parse(await fs.readFile(store.historyFile('manageboard'), 'utf8'));
  assert.equal(history.branches.length, 2);
  const deletion = history.branches[1];
  assert.equal(deletion.operation, 'node.delete');
  assert.equal(deletion.before.history, true);
  assert.equal(deletion.before.knowledge.nodes.some((node) => node.nodeId === 'task'), true);
  assert.equal(deletion.after.history, false);
  assert.equal(deletion.after.knowledge.nodes.some((node) => node.nodeId === 'task'), false);
});

test('a corrupt or missing history blocks interaction writes before current JSON changes', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'manageboard' });
  const before = await fs.readFile(store.bossFile('manageboard'), 'utf8');
  await fs.writeFile(store.historyFile('manageboard'), '{broken', 'utf8');

  await assert.rejects(
    store.execute('manageboard', 'node.create', {
      id: 'unsafe',
      leaderId: 'manageboard',
      path: 'root/manageboard',
      label: '不得写入'
    }),
    (error) => error.code === 'INVALID_HISTORY'
  );
  assert.equal(await fs.readFile(store.bossFile('manageboard'), 'utf8'), before);
});

test('tests and callers cannot overwrite an existing Boss file through createBoss', async () => {
  const { store } = await fixture();
  await fs.mkdir(path.dirname(store.bossFile('manageboard')), { recursive: true });
  await fs.writeFile(store.bossFile('manageboard'), '{"protected":true}\n', 'utf8');

  await assert.rejects(
    store.createBoss({ bossId: 'manageboard' }),
    (error) => error.code === 'BOSS_FILE_EXISTS'
  );
  assert.equal(await fs.readFile(store.bossFile('manageboard'), 'utf8'), '{"protected":true}\n');
});

test('multi-level daily flow creates updates and moves one whole Leader subtree', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management', label: 'individual management' });
  const areaA = await store.execute('individual-management', 'node.create', {
    id: 'area-a',
    leaderId: 'individual-management',
    label: '合成领域 A'
  });
  const areaB = await store.execute('individual-management', 'node.create', {
    id: 'area-b',
    leaderId: 'individual-management',
    label: '合成领域 B'
  });
  const project = await store.execute('individual-management', 'node.create', {
    id: 'project',
    leaderId: 'area-a',
    label: '合成项目'
  });
  await store.execute('individual-management', 'node.create', {
    id: 'task',
    leaderId: 'project',
    label: '合成任务'
  });
  await store.execute('individual-management', 'node.update', {
    key: project.node.key,
    label: '合成项目（已修改）',
    detail: '修改后的详情',
    leaderId: 'area-b'
  });

  const current = await store.execute('individual-management', 'field.get', { scope: 'all' });
  const movedProject = current.nodes.find((node) => node.nodeId === 'project');
  const movedTask = current.nodes.find((node) => node.nodeId === 'task');
  assert.equal(movedProject.label, '合成项目（已修改）');
  assert.equal(movedProject.leaderId, 'area-b');
  assert.equal(movedTask.leaderId, 'project');
  assert.equal(movedProject.path, `${areaB.node.path}/${hashId(areaB.node.id)}`);
  assert.equal(movedTask.path, `${movedProject.path}/${hashId(movedProject.id)}`);
  assert.notEqual(movedProject.path, project.node.path);
  assert.equal(areaA.node.bossId, 'individual-management');
});

test('Leader changes reject cycles and unknown leaders without changing current JSON', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  const parent = await store.execute('individual-management', 'node.create', {
    id: 'parent',
    leaderId: 'individual-management',
    label: '合成上级'
  });
  await store.execute('individual-management', 'node.create', {
    id: 'child',
    leaderId: 'parent',
    label: '合成下级'
  });
  const before = await fs.readFile(store.bossFile('individual-management'), 'utf8');

  await assert.rejects(
    store.execute('individual-management', 'node.update', { key: parent.node.key, leaderId: 'child' }),
    (error) => error.code === 'LEADER_CYCLE'
  );
  await assert.rejects(
    store.execute('individual-management', 'node.update', { key: parent.node.key, leaderId: 'missing' }),
    (error) => error.code === 'LEADER_NOT_FOUND'
  );
  assert.equal(await fs.readFile(store.bossFile('individual-management'), 'utf8'), before);
});

test('deleting a populated branch requires explicit recursion and remains recoverable', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  const parent = await store.execute('individual-management', 'node.create', {
    id: 'parent',
    leaderId: 'individual-management',
    label: '合成上级'
  });
  await store.execute('individual-management', 'node.create', {
    id: 'child',
    leaderId: 'parent',
    label: '合成下级'
  });

  await assert.rejects(
    store.execute('individual-management', 'node.delete', { key: parent.node.key }),
    (error) => error.code === 'NODE_HAS_CHILDREN'
  );
  await store.execute('individual-management', 'node.delete', { key: parent.node.key, recursive: true });
  const afterDelete = await store.execute('individual-management', 'field.get', { scope: 'all' });
  assert.deepEqual(afterDelete.nodes.map((node) => node.nodeId), ['individual-management']);

  const history = JSON.parse(await fs.readFile(store.historyFile('individual-management'), 'utf8'));
  const deletion = history.branches.at(-1);
  assert.equal(deletion.operation, 'node.delete');
  assert.equal(deletion.before.knowledge.nodes.length, 3);
  await store.restoreHistory('individual-management', deletion.versionId, 'before');
  const restored = await store.execute('individual-management', 'field.get', { scope: 'all' });
  assert.deepEqual(restored.nodes.map((node) => node.nodeId).sort(), [
    'child',
    'individual-management',
    'parent'
  ]);
});

test('Boss root cannot be deleted and duplicate node IDs remain isolated by Boss', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  await store.createBoss({ bossId: 'test' });
  const first = await store.execute('individual-management', 'node.create', {
    id: 'same-id',
    leaderId: 'individual-management',
    label: '主库合成节点'
  });
  await store.execute('test', 'node.create', {
    id: 'same-id',
    leaderId: 'test',
    label: '测试库合成节点'
  });
  await assert.rejects(
    store.execute('individual-management', 'node.delete', { key: 'root::individual-management' }),
    (error) => error.code === 'BOSS_DELETE_FORBIDDEN'
  );
  await assert.rejects(
    store.execute('individual-management', 'node.create', {
      id: 'same-id',
      leaderId: 'individual-management',
      label: '重复'
    }),
    (error) => error.code === 'NODE_EXISTS'
  );
  const individual = await store.execute('individual-management', 'node.get', { key: first.node.key });
  assert.equal(individual.node.label, '主库合成节点');
});

test('direct paths null Leaders and foreign Boss replacement cannot bypass hierarchy routing', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  const child = await store.execute('individual-management', 'node.create', {
    id: 'child',
    leaderId: 'individual-management',
    label: '合成节点'
  });
  const before = await fs.readFile(store.bossFile('individual-management'), 'utf8');

  await assert.rejects(
    store.execute('individual-management', 'node.land', {
      key: child.node.key,
      path: 'root/spoofed',
      position: {}
    }),
    (error) => error.code === 'LEADER_REQUIRED_FOR_MOVE'
  );
  await assert.rejects(
    store.execute('individual-management', 'node.update', {
      key: child.node.key,
      leaderId: null
    }),
    (error) => error.code === 'LEADER_REQUIRED'
  );
  const foreign = JSON.parse(before);
  foreign.nodes[1].bossId = 'test';
  await assert.rejects(
    store.execute('individual-management', 'knowledge.replace', { knowledge: foreign }),
    (error) => error.code === 'BOSS_MISMATCH'
  );
  assert.equal(await fs.readFile(store.bossFile('individual-management'), 'utf8'), before);
});

test('view-only persistence does not grow knowledge history', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  await store.execute('individual-management', 'view.update', {
    view: { path: 'root', selection: null }
  });
  const history = JSON.parse(await fs.readFile(store.historyFile('individual-management'), 'utf8'));
  assert.equal(history.branches.length, 0);
});

test('separate Boss store instances serialize concurrent writes without losing nodes or history', async () => {
  const { directory, store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  const second = createBossStore(directory);
  await second.init();

  await Promise.all([
    store.execute('individual-management', 'node.create', {
      id: 'concurrent-a',
      leaderId: 'individual-management',
      label: '并发合成节点 A'
    }),
    second.execute('individual-management', 'node.create', {
      id: 'concurrent-b',
      leaderId: 'individual-management',
      label: '并发合成节点 B'
    })
  ]);

  const current = await store.execute('individual-management', 'field.get', { scope: 'all' });
  assert.deepEqual(current.nodes.map((node) => node.nodeId).sort(), [
    'concurrent-a',
    'concurrent-b',
    'individual-management'
  ]);
  const history = JSON.parse(await fs.readFile(store.historyFile('individual-management'), 'utf8'));
  assert.equal(history.branches.length, 2);
});

test('Boss data undo and redo restore multi-level edits without discarding history branches', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management' });
  const created = await store.execute('individual-management', 'node.create', {
    id: 'undoable',
    leaderId: 'individual-management',
    label: '修改前'
  });
  await store.execute('individual-management', 'node.update', {
    key: created.node.key,
    label: '修改后'
  });

  await store.undo('individual-management');
  let current = await store.execute('individual-management', 'node.get', { key: created.node.key });
  assert.equal(current.node.label, '修改前');

  await store.undo('individual-management');
  current = await store.execute('individual-management', 'field.get', { scope: 'all' });
  assert.equal(current.nodes.some((node) => node.nodeId === 'undoable'), false);

  await store.redo('individual-management');
  await store.redo('individual-management');
  current = await store.execute('individual-management', 'node.get', { key: created.node.key });
  assert.equal(current.node.label, '修改后');

  const history = JSON.parse(await fs.readFile(store.historyFile('individual-management'), 'utf8'));
  assert.equal(history.branches.filter((branch) => branch.operation === 'history.undo').length, 2);
  assert.equal(history.branches.filter((branch) => branch.operation === 'history.redo').length, 2);
});

test('aggregate browser flow infers Boss and Leader while keeping the other Boss unchanged', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management', label: 'individual management' });
  await store.createBoss({ bossId: 'test', label: 'test' });
  const initial = await store.readAll();
  const individualRoot = initial.knowledge.nodes.find((node) => node.nodeId === 'individual-management');
  const testBefore = await fs.readFile(store.bossFile('test'), 'utf8');

  const withParent = structuredClone(initial.knowledge);
  withParent.nodes.push({
    id: 'synthetic-parent',
    nodeId: 'synthetic-parent',
    path: childDomainPath(individualRoot),
    key: `${childDomainPath(individualRoot)}::synthetic-parent`,
    label: '合成上级',
    detail: '',
    aliases: [],
    position: { x: 0, y: 0, z: 0 }
  });
  let replaced = await store.replaceAll(withParent);
  assert.equal(replaced.changedBossId, 'individual-management');

  const parent = replaced.nodes.find((node) => node.nodeId === 'synthetic-parent');
  assert.equal(parent.bossId, 'individual-management');
  assert.equal(parent.leaderId, 'individual-management');

  const withChild = structuredClone(replaced);
  withChild.nodes.push({
    id: 'synthetic-child',
    nodeId: 'synthetic-child',
    path: childDomainPath(parent),
    key: `${childDomainPath(parent)}::synthetic-child`,
    label: '合成下级',
    detail: '',
    aliases: [],
    position: { x: 0, y: 0, z: 0 }
  });
  replaced = await store.replaceAll(withChild);
  const child = replaced.nodes.find((node) => node.nodeId === 'synthetic-child');
  assert.equal(child.bossId, 'individual-management');
  assert.equal(child.leaderId, 'synthetic-parent');
  assert.equal(await fs.readFile(store.bossFile('test'), 'utf8'), testBefore);
});

test('aggregate Leader deletion requires confirmation and confirmed deletion removes the whole branch', async () => {
  const { store } = await fixture();
  await store.createBoss({ bossId: 'individual-management', label: 'individual management' });
  const parent = await store.execute('individual-management', 'node.create', {
    id: 'synthetic-parent',
    leaderId: 'individual-management',
    label: '合成上级'
  });
  await store.execute('individual-management', 'node.create', {
    id: 'synthetic-child',
    leaderId: parent.node.nodeId,
    label: '合成下级'
  });
  const aggregate = (await store.readAll()).knowledge;
  const requested = structuredClone(aggregate);
  requested.nodes = requested.nodes.filter((node) => node.nodeId !== 'synthetic-parent');

  await assert.rejects(
    store.replaceAll(requested),
    (error) => error.code === 'DELETE_CONFIRMATION_REQUIRED' && error.details.descendantCount === 1
  );
  const unchanged = (await store.readAll()).knowledge;
  assert.equal(unchanged.nodes.some((node) => node.nodeId === 'synthetic-parent'), true);
  assert.equal(unchanged.nodes.some((node) => node.nodeId === 'synthetic-child'), true);

  const result = await store.replaceAll(requested, {
    confirmedRecursiveDeleteNodeIds: ['synthetic-parent']
  });
  assert.equal(result.nodes.some((node) => node.nodeId === 'synthetic-parent'), false);
  assert.equal(result.nodes.some((node) => node.nodeId === 'synthetic-child'), false);
});

function hashId(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
