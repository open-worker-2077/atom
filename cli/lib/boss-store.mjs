import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { childDomainPath } from './probe.mjs';
import { createStore, emptyKnowledge, SpatialStoreError } from './store.mjs';

const SCHEMA_VERSION = 1;
const WRITE_METHODS = new Set([
  'node.create',
  'node.update',
  'node.land',
  'node.delete',
  'edge.create',
  'edge.delete',
  'knowledge.replace'
]);

function safeId(value, field = 'bossId') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) {
    throw new SpatialStoreError('INVALID_BOSS_ID', `${field} 只能包含字母、数字、点、下划线和连字符`, {
      [field]: value
    });
  }
  return id;
}

function emptyCatalog() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    bosses: []
  };
}

function emptyHistory(bossId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    bossId,
    revision: 0,
    updatedAt: new Date().toISOString(),
    branches: [],
    undoStack: [],
    redoStack: []
  };
}

async function readJson(file, fallback, code) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (error instanceof SyntaxError) {
      throw new SpatialStoreError(code, '安全 JSON 无法解析，已拒绝继续写入', { file });
    }
    throw error;
  }
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(await fs.readFile(temporary, 'utf8'));
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.copyFile(temporary, file);
    await fs.unlink(temporary);
  }
}

async function withFileLock(file, handler) {
  const lockFile = `${file}.lock`;
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      handle = await fs.open(lockFile, 'wx');
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, 'utf8');
      break;
    } catch (error) {
      // Windows can briefly report EPERM instead of EEXIST while another
      // process owns or is closing the lock file. Treat both as contention.
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      try {
        const stat = await fs.stat(lockFile);
        if (Date.now() - stat.mtimeMs > 30_000) {
          await fs.unlink(lockFile).catch(() => {});
          continue;
        }
      } catch (statError) {
        if (!['ENOENT', 'EPERM'].includes(statError.code)) throw statError;
      }
      await delay(4 + (attempt % 7));
    }
  }
  if (!handle) {
    throw new SpatialStoreError('BOSS_LOCK_TIMEOUT', 'Boss 数据正忙，未执行本次写入', { file });
  }
  try {
    return await handler();
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(lockFile).catch(() => {});
  }
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function findNodeById(knowledge, nodeId) {
  return knowledge.nodes.find((node) => node.nodeId === nodeId);
}

function descendantIds(knowledge, nodeId) {
  const found = new Set();
  let frontier = [nodeId];
  while (frontier.length) {
    const leaders = new Set(frontier);
    frontier = knowledge.nodes
      .filter((node) => leaders.has(node.leaderId) && !found.has(node.nodeId))
      .map((node) => {
        found.add(node.nodeId);
        return node.nodeId;
      });
  }
  return found;
}

function validateBossKnowledge(bossId, knowledge) {
  if (!knowledge || !Array.isArray(knowledge.nodes)) {
    throw new SpatialStoreError('INVALID_BOSS_KNOWLEDGE', 'Boss 知识必须包含 nodes 数组', { bossId });
  }
  const ids = new Set();
  for (const node of knowledge.nodes) {
    if (node.bossId !== bossId) {
      throw new SpatialStoreError('BOSS_MISMATCH', '节点不能写入其他 Boss 的 JSON', {
        bossId,
        nodeId: node.nodeId,
        nodeBossId: node.bossId
      });
    }
    if (!node.nodeId || ids.has(node.nodeId)) {
      throw new SpatialStoreError('DUPLICATE_NODE_ID', 'Boss 内的 nodeId 必须存在且唯一', {
        bossId,
        nodeId: node.nodeId
      });
    }
    ids.add(node.nodeId);
  }
  const root = knowledge.nodes.find((node) => node.nodeId === bossId);
  if (!root || root.leaderId !== null) {
    throw new SpatialStoreError('INVALID_BOSS_ROOT', 'Boss 根节点必须存在且 leaderId 为 null', { bossId });
  }
  for (const node of knowledge.nodes) {
    if (node.nodeId === bossId) continue;
    if (!node.leaderId || !ids.has(node.leaderId)) {
      throw new SpatialStoreError('LEADER_NOT_FOUND', '非顶层节点必须指向当前 Boss 内的直属 Leader', {
        bossId,
        nodeId: node.nodeId,
        leaderId: node.leaderId
      });
    }
    if (descendantIds(knowledge, node.nodeId).has(node.leaderId)) {
      throw new SpatialStoreError('LEADER_CYCLE', 'Boss 知识不能包含循环层级', {
        bossId,
        nodeId: node.nodeId,
        leaderId: node.leaderId
      });
    }
  }
}

function rebuildBossHierarchy(bossId, knowledge) {
  const copy = snapshot(knowledge);
  const byId = new Map(copy.nodes.map((node) => [node.nodeId, node]));
  const root = byId.get(bossId);
  if (!root) return copy;
  const visited = new Set();
  const queue = [{ node: root, path: 'root' }];
  while (queue.length) {
    const { node, path: expectedPath } = queue.shift();
    if (visited.has(node.nodeId)) continue;
    visited.add(node.nodeId);
    const oldKey = node.key || `${node.path || 'root'}::${node.id}`;
    node.path = expectedPath;
    node.key = `${expectedPath}::${node.id}`;
    node.aliases = [...new Set([
      ...(Array.isArray(node.aliases) ? node.aliases : []),
      ...(oldKey !== node.key ? [oldKey] : [])
    ])].filter((alias) => alias !== node.key);
    const childPath = childDomainPath(node);
    for (const child of copy.nodes.filter((candidate) => candidate.leaderId === node.nodeId)) {
      queue.push({ node: child, path: childPath });
    }
  }
  return copy;
}

function comparableKnowledge(knowledge) {
  return JSON.stringify({
    nodes: [...knowledge.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: [...knowledge.edges].sort((left, right) => left.id.localeCompare(right.id))
  });
}

export function createBossStore(directory) {
  const root = path.resolve(directory);
  const catalogFile = path.join(root, 'catalog.json');
  const bossesDirectory = path.join(root, 'bosses');
  const historyDirectory = path.join(root, 'history');
  let queue = Promise.resolve();

  const bossFile = (bossId) => path.join(bossesDirectory, `${safeId(bossId)}.json`);
  const historyFile = (bossId) => path.join(historyDirectory, `${safeId(bossId)}.history.json`);

  async function readCatalog() {
    const catalog = await readJson(catalogFile, emptyCatalog(), 'INVALID_CATALOG');
    if (!Array.isArray(catalog.bosses)) {
      throw new SpatialStoreError('INVALID_CATALOG', 'catalog.json 缺少 bosses 数组', { file: catalogFile });
    }
    return catalog;
  }

  async function requireBoss(bossId) {
    const id = safeId(bossId);
    const catalog = await readCatalog();
    const boss = catalog.bosses.find((candidate) => candidate.bossId === id);
    if (!boss) throw new SpatialStoreError('BOSS_NOT_FOUND', '顶层 Boss 不存在', { bossId: id });
    return { id, boss, catalog };
  }

  async function appendHistory(bossId, method, before, after) {
    const file = historyFile(bossId);
    const history = await readJson(file, emptyHistory(bossId), 'INVALID_HISTORY');
    if (!Array.isArray(history.branches) || history.bossId !== bossId) {
      throw new SpatialStoreError('INVALID_HISTORY', '历史树与 Boss 不匹配', { bossId, file });
    }
    const at = new Date().toISOString();
    const branch = {
      versionId: crypto.randomUUID(),
      previousVersionId: history.branches.at(-1)?.versionId || null,
      operation: method,
      changedAt: at,
      before: { history: true, lifecycle: 'superseded', knowledge: snapshot(before) },
      after: { history: false, lifecycle: 'live', knowledge: snapshot(after) }
    };
    history.branches.push(branch);
    history.undoStack = Array.isArray(history.undoStack) ? history.undoStack : [];
    history.redoStack = [];
    history.undoStack.push(branch.versionId);
    history.revision += 1;
    history.updatedAt = at;
    await atomicWrite(file, history);
    return branch;
  }

  function serialized(handler) {
    const operation = queue.then(handler);
    queue = operation.catch(() => {});
    return operation;
  }

  async function createBoss(params = {}) {
    return serialized(() => withFileLock(catalogFile, async () => {
      const bossId = safeId(params.bossId);
      const catalog = await readCatalog();
      if (catalog.bosses.some((boss) => boss.bossId === bossId)) {
        throw new SpatialStoreError('BOSS_EXISTS', '顶层 Boss 已存在', { bossId });
      }
      const file = bossFile(bossId);
      try {
        await fs.access(file);
        throw new SpatialStoreError('BOSS_FILE_EXISTS', 'Boss 数据文件已存在，拒绝覆盖', { bossId, file });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      const knowledge = emptyKnowledge();
      knowledge.nodes.push({
        id: bossId,
        nodeId: bossId,
        bossId,
        leaderId: null,
        path: 'root',
        label: typeof params.label === 'string' && params.label.trim() ? params.label.trim() : bossId
      });
      const store = createStore(file);
      await store.init();
      const created = await store.execute('knowledge.replace', { knowledge });
      const now = new Date().toISOString();
      catalog.bosses.push({
        bossId,
        label: knowledge.nodes[0].label,
        file: `bosses/${bossId}.json`,
        historyFile: `history/${bossId}.history.json`,
        status: 'active',
        createdAt: now,
        updatedAt: now
      });
      catalog.revision += 1;
      catalog.updatedAt = now;
      await atomicWrite(historyFile(bossId), emptyHistory(bossId));
      await atomicWrite(catalogFile, catalog);
      return { boss: catalog.bosses.at(-1), knowledge: created.knowledge };
    }));
  }

  async function execute(bossId, method, params = {}) {
    const { id } = await requireBoss(bossId);
    const store = createStore(bossFile(id));
    await store.init();
    if (!WRITE_METHODS.has(method)) return store.execute(method, params);

    return serialized(() => withFileLock(bossFile(id), async () => {
      const history = await readJson(historyFile(id), undefined, 'INVALID_HISTORY');
      if (!history || history.bossId !== id || !Array.isArray(history.branches)) {
        throw new SpatialStoreError('INVALID_HISTORY', '安全历史不存在或与 Boss 不匹配', {
          bossId: id,
          file: historyFile(id)
        });
      }
      const before = await store.read();
      const nextParams = { ...params };
      if (method === 'node.create') {
        nextParams.bossId = id;
        nextParams.id = safeId(nextParams.id || `node-${crypto.randomUUID()}`, 'nodeId');
        nextParams.nodeId = nextParams.id;
        if (!nextParams.leaderId) {
          throw new SpatialStoreError('LEADER_REQUIRED', '非顶层节点必须指定 leaderId', { bossId: id });
        }
        const leader = before.nodes.find((node) => node.nodeId === nextParams.leaderId);
        if (!leader) {
          throw new SpatialStoreError('LEADER_NOT_FOUND', '直属 Leader 不存在于当前 Boss', {
            bossId: id,
            leaderId: nextParams.leaderId
          });
        }
        if (findNodeById(before, nextParams.nodeId)) {
          throw new SpatialStoreError('NODE_EXISTS', '当前 Boss 中已经存在相同 nodeId', {
            bossId: id,
            nodeId: nextParams.nodeId
          });
        }
        nextParams.path = childDomainPath(leader);
      }
      if (method === 'node.update' && nextParams.leaderId !== undefined) {
        const target = before.nodes.find((node) => node.key === nextParams.key || node.aliases.includes(nextParams.key));
        if (target?.nodeId === id && nextParams.leaderId !== null) {
          throw new SpatialStoreError('BOSS_CANNOT_HAVE_LEADER', '顶层 Boss 的 leaderId 必须为 null', { bossId: id });
        }
        if (target?.nodeId !== id && nextParams.leaderId === null) {
          throw new SpatialStoreError('LEADER_REQUIRED', '非顶层节点的 leaderId 不能为 null', {
            bossId: id,
            nodeId: target?.nodeId
          });
        }
        if (nextParams.leaderId !== null) {
          const leader = before.nodes.find((node) => node.nodeId === nextParams.leaderId);
          if (!leader) {
            throw new SpatialStoreError('LEADER_NOT_FOUND', '直属 Leader 不存在于当前 Boss', {
              bossId: id,
              leaderId: nextParams.leaderId
            });
          }
          if (target && descendantIds(before, target.nodeId).has(nextParams.leaderId)) {
            throw new SpatialStoreError('LEADER_CYCLE', '节点不能挂到自己的下级', {
              nodeId: target.nodeId,
              leaderId: nextParams.leaderId
            });
          }
        }
      }
      if (method === 'node.land') {
        throw new SpatialStoreError(
          'LEADER_REQUIRED_FOR_MOVE',
          'Boss 隔离模式必须通过 node.update --leader 移动层级',
          { bossId: id }
        );
      }
      if (method === 'knowledge.replace') validateBossKnowledge(id, nextParams.knowledge);
      if (method === 'node.delete') {
        const target = before.nodes.find((node) => node.key === nextParams.key || node.aliases.includes(nextParams.key));
        if (target?.nodeId === id) {
          throw new SpatialStoreError('BOSS_DELETE_FORBIDDEN', '顶层 Boss 不能通过节点删除命令删除', { bossId: id });
        }
        const descendants = target ? descendantIds(before, target.nodeId) : new Set();
        if (descendants.size && nextParams.recursive !== true) {
          throw new SpatialStoreError('NODE_HAS_CHILDREN', '节点仍有下级；必须显式递归删除', {
            nodeId: target.nodeId,
            descendantCount: descendants.size
          });
        }
        if (descendants.size) {
          const pending = before.nodes
            .filter((node) => descendants.has(node.nodeId))
            .sort((left, right) => right.path.length - left.path.length);
          for (const child of pending) await store.execute('node.delete', { key: child.key });
        }
      }
      let result = await store.execute(method, nextParams);
      if (method === 'node.update' && nextParams.leaderId !== undefined) {
        let current = await store.read();
        const movedRoot = findNodeById(current, result.node.nodeId);
        const ordered = [movedRoot];
        for (let index = 0; index < ordered.length; index += 1) {
          const currentLeader = ordered[index];
          ordered.push(...current.nodes.filter((node) => node.leaderId === currentLeader.nodeId));
        }
        for (const node of ordered) {
          current = await store.read();
          const latest = findNodeById(current, node.nodeId);
          const leader = latest.leaderId === null ? null : findNodeById(current, latest.leaderId);
          const expectedPath = leader ? childDomainPath(leader) : 'root';
          if (latest.path !== expectedPath) {
            const landed = await store.execute('node.land', {
              key: latest.key,
              path: expectedPath,
              position: latest.position
            });
            if (latest.nodeId === result.node.nodeId) result = { ...result, node: landed.node };
          }
        }
      }
      const after = await store.read();
      try {
        await appendHistory(id, method, before, after);
      } catch (error) {
        await atomicWrite(bossFile(id), before);
        throw error;
      }
      return result;
    }));
  }

  async function readAll() {
    const catalog = await readCatalog();
    const knowledge = emptyKnowledge();
    for (const boss of catalog.bosses.filter((candidate) => candidate.status !== 'archived')) {
      const current = await createStore(path.join(root, boss.file)).read();
      knowledge.nodes.push(...current.nodes);
      knowledge.edges.push(...current.edges);
      knowledge.revision += current.revision;
      if (current.updatedAt > knowledge.updatedAt) knowledge.updatedAt = current.updatedAt;
    }
    return { catalog, knowledge };
  }

  async function replaceAll(incoming, options = {}) {
    const current = await readAll();
    const catalog = current.catalog;
    const currentNodes = current.knowledge.nodes;
    const incomingNodes = Array.isArray(incoming?.nodes) ? snapshot(incoming.nodes) : [];
    const currentByKey = new Map();
    const currentByBossAndId = new Map();
    const ownerByDomain = new Map();
    for (const node of currentNodes) {
      currentByKey.set(node.key, node);
      for (const alias of node.aliases || []) currentByKey.set(alias, node);
      currentByBossAndId.set(`${node.bossId}::${node.nodeId}`, node);
      ownerByDomain.set(childDomainPath(node), node);
    }

    for (const node of incomingNodes) {
      const existing = currentByKey.get(node.key)
        || (node.bossId && currentByBossAndId.get(`${node.bossId}::${node.nodeId || node.id}`));
      const owner = ownerByDomain.get(node.path);
      node.nodeId = node.nodeId || existing?.nodeId || node.id;
      node.bossId = node.bossId || existing?.bossId || owner?.bossId || null;
      if (node.path === 'root' && node.nodeId === node.bossId) {
        node.leaderId = null;
      } else if (owner && (!existing || node.path !== existing.path || !node.leaderId)) {
        node.leaderId = owner.nodeId;
      } else {
        node.leaderId = node.leaderId || existing?.leaderId || null;
      }
    }

    const confirmed = new Set(Array.isArray(options.confirmedRecursiveDeleteNodeIds)
      ? options.confirmedRecursiveDeleteNodeIds
      : []);
    for (const boss of catalog.bosses) {
      const present = new Set(incomingNodes
        .filter((node) => node.bossId === boss.bossId)
        .map((node) => node.nodeId));
      const previous = currentNodes.filter((node) => node.bossId === boss.bossId);
      if (!present.has(boss.bossId)) {
        throw new SpatialStoreError('BOSS_DELETE_FORBIDDEN', '顶层 Boss 不能通过聚合编辑删除', {
          bossId: boss.bossId
        });
      }
      for (const deleted of previous.filter((node) => !present.has(node.nodeId))) {
        const descendants = descendantIds({ nodes: previous }, deleted.nodeId);
        if (descendants.size && !confirmed.has(deleted.nodeId)) {
          throw new SpatialStoreError('DELETE_CONFIRMATION_REQUIRED', 'Leader 仍有下级，必须先确认递归删除', {
            bossId: boss.bossId,
            nodeId: deleted.nodeId,
            descendantCount: descendants.size
          });
        }
        if (descendants.size) {
          for (let index = incomingNodes.length - 1; index >= 0; index -= 1) {
            if (incomingNodes[index].bossId === boss.bossId && descendants.has(incomingNodes[index].nodeId)) {
              incomingNodes.splice(index, 1);
            }
          }
        }
      }
    }

    const groups = new Map();
    for (const boss of catalog.bosses) {
      groups.set(boss.bossId, {
        ...emptyKnowledge(),
        nodes: incomingNodes.filter((node) => node.bossId === boss.bossId),
        edges: [],
        view: incoming.view && typeof incoming.view === 'object' ? incoming.view : null
      });
    }
    const endpointBoss = new Map();
    for (const [bossId, group] of groups) {
      const rebuilt = rebuildBossHierarchy(bossId, group);
      groups.set(bossId, rebuilt);
      for (const node of rebuilt.nodes) {
        endpointBoss.set(node.key, bossId);
        for (const alias of node.aliases || []) endpointBoss.set(alias, bossId);
      }
    }
    for (const edge of Array.isArray(incoming?.edges) ? incoming.edges : []) {
      const fromBoss = endpointBoss.get(edge.from?.key);
      const toBoss = endpointBoss.get(edge.to?.key);
      if (!fromBoss || !toBoss) continue;
      if (fromBoss !== toBoss) {
        throw new SpatialStoreError('CROSS_BOSS_EDGE_UNSUPPORTED', '跨 Boss 关系需要独立事务设计，当前拒绝写入', {
          fromBoss,
          toBoss,
          edgeId: edge.id
        });
      }
      groups.get(fromBoss).edges.push(snapshot(edge));
    }

    const changed = [];
    for (const boss of catalog.bosses) {
      const existing = await createStore(bossFile(boss.bossId)).read();
      const next = groups.get(boss.bossId);
      validateBossKnowledge(boss.bossId, next);
      if (comparableKnowledge(existing) !== comparableKnowledge(next)) {
        changed.push({ bossId: boss.bossId, knowledge: next });
      }
    }
    if (changed.length > 1) {
      throw new SpatialStoreError('MULTI_BOSS_TRANSACTION_FORBIDDEN', '一次界面提交只能修改一个 Boss', {
        bossIds: changed.map((entry) => entry.bossId)
      });
    }
    if (!changed.length) return { changedBossId: null, ...(await readAll()).knowledge };
    const target = changed[0];
    await execute(target.bossId, 'knowledge.replace', { knowledge: target.knowledge });
    return { changedBossId: target.bossId, ...(await readAll()).knowledge };
  }

  async function restoreHistory(bossId, versionId, side = 'before') {
    const id = safeId(bossId);
    return serialized(() => withFileLock(bossFile(id), async () => {
      await requireBoss(id);
      const file = historyFile(id);
      const history = await readJson(file, undefined, 'INVALID_HISTORY');
      if (!history || history.bossId !== id || !Array.isArray(history.branches)) {
        throw new SpatialStoreError('INVALID_HISTORY', '安全历史不存在或与 Boss 不匹配', { bossId: id, file });
      }
      const branch = history.branches.find((candidate) => candidate.versionId === versionId);
      if (!branch) {
        throw new SpatialStoreError('HISTORY_VERSION_NOT_FOUND', '历史版本不存在', { bossId: id, versionId });
      }
      if (!['before', 'after'].includes(side)) {
        throw new SpatialStoreError('INVALID_HISTORY_SIDE', '恢复侧必须是 before 或 after', { side });
      }
      const selected = branch[side]?.knowledge;
      if (!selected || !Array.isArray(selected.nodes)) {
        throw new SpatialStoreError('INVALID_HISTORY', '历史版本缺少可恢复知识快照', {
          bossId: id,
          versionId,
          side
        });
      }
      if (selected.nodes.some((node) => node.bossId !== id)) {
        throw new SpatialStoreError('HISTORY_BOSS_MISMATCH', '历史版本包含其他 Boss 的节点，已拒绝恢复', {
          bossId: id,
          versionId
        });
      }
      const store = createStore(bossFile(id));
      const before = await store.read();
      const restored = await store.execute('knowledge.replace', { knowledge: snapshot(selected) });
      const after = await store.read();
      try {
        await appendHistory(id, `history.restore.${side}`, before, after);
      } catch (error) {
        await atomicWrite(bossFile(id), before);
        throw error;
      }
      return { versionId, side, knowledge: restored.knowledge };
    }));
  }

  async function navigateHistory(bossId, direction) {
    const id = safeId(bossId);
    return serialized(() => withFileLock(bossFile(id), async () => {
      await requireBoss(id);
      const file = historyFile(id);
      const history = await readJson(file, undefined, 'INVALID_HISTORY');
      if (!history || history.bossId !== id || !Array.isArray(history.branches)) {
        throw new SpatialStoreError('INVALID_HISTORY', '安全历史不存在或与 Boss 不匹配', { bossId: id, file });
      }
      history.undoStack = Array.isArray(history.undoStack) ? history.undoStack : [];
      history.redoStack = Array.isArray(history.redoStack) ? history.redoStack : [];
      const source = direction === 'undo' ? history.undoStack : history.redoStack;
      const destination = direction === 'undo' ? history.redoStack : history.undoStack;
      const versionId = source.at(-1);
      if (!versionId) {
        throw new SpatialStoreError(
          direction === 'undo' ? 'NOTHING_TO_UNDO' : 'NOTHING_TO_REDO',
          direction === 'undo' ? '没有可撤销的数据操作' : '没有可重做的数据操作',
          { bossId: id }
        );
      }
      const branch = history.branches.find((candidate) => candidate.versionId === versionId);
      const selected = branch?.[direction === 'undo' ? 'before' : 'after']?.knowledge;
      if (!selected) {
        throw new SpatialStoreError('INVALID_HISTORY', '撤销/重做目标缺少知识快照', {
          bossId: id,
          versionId
        });
      }
      validateBossKnowledge(id, selected);
      const store = createStore(bossFile(id));
      const current = await store.read();
      const restored = await store.execute('knowledge.replace', { knowledge: snapshot(selected) });
      const at = new Date().toISOString();
      history.branches.push({
        versionId: crypto.randomUUID(),
        previousVersionId: history.branches.at(-1)?.versionId || null,
        operation: `history.${direction}`,
        changedAt: at,
        targetVersionId: versionId,
        before: { history: true, lifecycle: 'superseded', knowledge: snapshot(current) },
        after: { history: false, lifecycle: 'live', knowledge: snapshot(restored.knowledge) }
      });
      source.pop();
      destination.push(versionId);
      history.revision += 1;
      history.updatedAt = at;
      try {
        await atomicWrite(file, history);
      } catch (error) {
        await atomicWrite(bossFile(id), current);
        throw error;
      }
      return { direction, targetVersionId: versionId, knowledge: restored.knowledge };
    }));
  }

  return Object.freeze({
    directory: root,
    catalogFile,
    bossFile,
    historyFile,
    async init() {
      await fs.mkdir(bossesDirectory, { recursive: true });
      await fs.mkdir(historyDirectory, { recursive: true });
      try {
        await fs.access(catalogFile);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await atomicWrite(catalogFile, emptyCatalog());
      }
      return readCatalog();
    },
    readCatalog,
    readAll,
    replaceAll,
    createBoss,
    execute,
    restoreHistory,
    undo(bossId) {
      return navigateHistory(bossId, 'undo');
    },
    redo(bossId) {
      return navigateHistory(bossId, 'redo');
    }
  });
}
