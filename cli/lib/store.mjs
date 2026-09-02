import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { childDomainPath, probeKnowledge } from './probe.mjs';

export const SCHEMA_VERSION = 1;

const fileWriteQueues = new Map();
const fileSnapshots = new Map();
const fileSnapshotLoads = new Map();

function enqueueFileWrite(file, handler) {
  const previous = fileWriteQueues.get(file) ?? Promise.resolve();
  const operation = previous.then(handler, handler);
  const tail = operation.then(() => undefined, () => undefined);
  fileWriteQueues.set(file, tail);
  void tail.then(() => {
    if (fileWriteQueues.get(file) === tail) fileWriteQueues.delete(file);
  });
  return operation;
}

export class SpatialStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SpatialStoreError';
    this.code = code;
    this.details = details;
  }
}

export function nodeKey(domainPath, nodeId) {
  return `${domainPath || 'root'}::${nodeId}`;
}

export function parseNodeKey(key) {
  const separator = typeof key === 'string' ? key.lastIndexOf('::') : -1;
  if (separator < 1 || separator === key.length - 2) {
    throw new SpatialStoreError('INVALID_NODE_KEY', '节点键必须是 <域径>::<节点 ID>', { key });
  }
  return { path: key.slice(0, separator), id: key.slice(separator + 2) };
}

export function edgeIdentity(from, to) {
  return `relation:${from}->${to}`;
}

function text(value, maximum = 4000) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').slice(0, maximum) : '';
}

function cleanAttachment(value) {
  if (!value || typeof value !== 'object' || !text(value.name, 240).trim()) return null;
  return {
    name: text(value.name, 240).trim(),
    type: text(value.type, 160) || 'application/octet-stream',
    size: Math.max(0, Number(value.size) || 0)
  };
}

function cleanAliases(values, currentKey = '') {
  if (!Array.isArray(values)) return [];
  const aliases = [];
  for (const value of values) {
    const alias = text(value, 1024).trim();
    if (!alias || alias === currentKey || aliases.includes(alias)) continue;
    try {
      parseNodeKey(alias);
      aliases.push(alias);
    } catch {
      // Invalid historical keys cannot resolve an endpoint and are discarded.
    }
  }
  return aliases;
}

function cleanAtomTypes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => text(value, 80).trim())
    .filter((value) => value && !value.includes('@')))];
}

function cleanNode(input) {
  const parsed = input.key ? parseNodeKey(input.key) : {
    path: text(input.path, 512) || 'root',
    id: text(input.id, 256)
  };
  const id = parsed.id || `node-${crypto.randomUUID()}`;
  const domainPath = parsed.path || 'root';
  const key = nodeKey(domainPath, id);
  return {
    id,
    nodeId: text(input.nodeId, 256) || id,
    bossId: text(input.bossId, 256) || null,
    leaderId: input.leaderId === null ? null : (text(input.leaderId, 256) || null),
    key,
    path: domainPath,
    atomPath: text(input.atomPath, 4000),
    ...(typeof input.graphPath === 'string' && input.graphPath
      ? { graphPath: text(input.graphPath, 4000) }
      : {}),
    label: text(input.label || input.thing || input.name, 80).trim() || '未命名节点',
    detail: text(input.detail ?? input.situation ?? input.description, 4000),
    ...(typeof input.programSource === 'string'
      ? { programSource: text(input.programSource, 1_000_000) }
      : {}),
    ...(typeof input.shortcutTargetPath === 'string' && input.shortcutTargetPath.trim()
      ? { shortcutTargetPath: text(input.shortcutTargetPath, 4000).trim() }
      : {}),
    attachment: cleanAttachment(input.attachment),
    position: {
      x: Number(input.position?.x) || 0,
      y: Number(input.position?.y) || 0,
      z: Number(input.position?.z) || 0
    },
    radius: Math.max(0.4, Number(input.radius) || 0.82),
    carrier: 'tunnel',
    hasChildren: input.hasChildren === true,
    surfaceVisible: input.surfaceVisible === true || input.detailMode === 'surface',
    detailMode: ['name', 'surface', 'floating'].includes(input.detailMode)
      ? input.detailMode
      : (input.surfaceVisible === true ? 'surface' : 'floating'),
    lockState: input.lockState && typeof input.lockState === 'object'
      ? structuredClone(input.lockState)
      : null,
    atomTypes: cleanAtomTypes(input.atomTypes),
    aliases: cleanAliases(input.aliases, key),
    createdAt: text(input.createdAt, 64) || new Date().toISOString(),
    updatedAt: text(input.updatedAt, 64) || new Date().toISOString()
  };
}

function synchronizeChildState(nodes) {
  const occupiedPaths = new Set(nodes.map((node) => node.path));
  for (const node of nodes) {
    const legacyChildPath = `${node.path}/${node.id}`;
    node.hasChildren = occupiedPaths.has(childDomainPath(node)) || occupiedPaths.has(legacyChildPath);
  }
  return nodes;
}

function cleanEndpoint(value) {
  const key = typeof value === 'string' ? value : value?.key;
  const parsed = parseNodeKey(key);
  return {
    key,
    path: parsed.path,
    nodeId: parsed.id,
    label: text(value?.label, 80) || parsed.id,
    pathLabels: Array.isArray(value?.pathLabels) ? value.pathLabels.map((item) => text(item, 80)) : []
  };
}

function cleanEdge(input) {
  const from = cleanEndpoint(input.from);
  const to = cleanEndpoint(input.to);
  if (from.key === to.key) {
    throw new SpatialStoreError('SELF_EDGE', '关系起点和落脚不能是同一节点', { key: from.key });
  }
  return {
    id: text(input.id, 1200) || edgeIdentity(from.key, to.key),
    from,
    to,
    label: text(input.label, 80).trim() || '关联',
    crossDomain: from.path !== to.path,
    createdAt: text(input.createdAt, 64) || new Date().toISOString()
  };
}

export function emptyKnowledge() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    nodes: [],
    nodePatches: [],
    deletedNodeKeys: [],
    edges: [],
    removedEdgeIds: [],
    view: null
  };
}

export function normalizeKnowledge(value) {
  const input = value && typeof value === 'object' ? value : {};
  const nodes = Array.isArray(input.nodes) ? input.nodes.map(cleanNode) : [];
  const uniqueNodes = synchronizeChildState([...new Map(nodes.map((node) => [node.key, node])).values()]);
  const edges = Array.isArray(input.edges) ? input.edges.map(cleanEdge) : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Number(input.revision) || 0),
    updatedAt: text(input.updatedAt, 64) || new Date().toISOString(),
    nodes: uniqueNodes,
    nodePatches: Array.isArray(input.nodePatches) ? input.nodePatches.filter(Boolean) : [],
    deletedNodeKeys: Array.isArray(input.deletedNodeKeys) ? [...new Set(input.deletedNodeKeys.filter((key) => typeof key === 'string'))] : [],
    edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
    removedEdgeIds: Array.isArray(input.removedEdgeIds) ? [...new Set(input.removedEdgeIds.filter((id) => typeof id === 'string'))] : [],
    strutClauses: Array.isArray(input.strutClauses)
      ? structuredClone(input.strutClauses.slice(0, 10_000))
      : [],
    view: input.view && typeof input.view === 'object' ? input.view : null
  };
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.copyFile(temporary, file);
    await fs.unlink(temporary);
  }
}

export function createStore(file) {
  const absoluteFile = path.resolve(file);

  async function loadSnapshot() {
    try {
      return normalizeKnowledge(JSON.parse(await fs.readFile(absoluteFile, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') {
        const initial = emptyKnowledge();
        await atomicWrite(absoluteFile, initial);
        return initial;
      }
      if (error instanceof SyntaxError) {
        throw new SpatialStoreError('INVALID_STORE', '知识库 JSON 无法解析', { file: absoluteFile });
      }
      throw error;
    }
  }

  async function currentSnapshot() {
    if (fileSnapshots.has(absoluteFile)) return fileSnapshots.get(absoluteFile);
    let loading = fileSnapshotLoads.get(absoluteFile);
    if (!loading) {
      loading = loadSnapshot().then((snapshot) => {
        fileSnapshots.set(absoluteFile, snapshot);
        return snapshot;
      });
      fileSnapshotLoads.set(absoluteFile, loading);
      void loading.finally(() => {
        if (fileSnapshotLoads.get(absoluteFile) === loading) fileSnapshotLoads.delete(absoluteFile);
      }).catch(() => {});
    }
    return loading;
  }

  async function read(projector) {
    const snapshot = await currentSnapshot();
    const selected = typeof projector === 'function' ? projector(snapshot) : snapshot;
    return structuredClone(selected);
  }

  async function write(knowledge) {
    const normalized = normalizeKnowledge(knowledge);
    await atomicWrite(absoluteFile, normalized);
    fileSnapshots.set(absoluteFile, normalized);
    return structuredClone(normalized);
  }

  function mutate(handler) {
    return enqueueFileWrite(absoluteFile, async () => {
      const knowledge = structuredClone(await currentSnapshot());
      const result = await handler(knowledge);
      knowledge.revision += 1;
      knowledge.updatedAt = new Date().toISOString();
      await write(knowledge);
      return { ...result, revision: knowledge.revision };
    });
  }

  function findNode(knowledge, key) {
    const node = knowledge.nodes.find((candidate) => (
      candidate.key === key || candidate.aliases.includes(key)
    ));
    if (!node) throw new SpatialStoreError('NODE_NOT_FOUND', '节点不存在', { key });
    return node;
  }

  function nodeIdentityKeys(node) {
    return new Set([node.key, ...node.aliases]);
  }

  async function execute(method, params = {}) {
    if (method === 'field.get') {
      const knowledge = await read();
      const scope = params.scope || (params.path ? 'path' : 'current');
      const currentPath = params.path || knowledge.view?.path || 'root';
      const nodes = scope === 'all' ? knowledge.nodes : knowledge.nodes.filter((node) => node.path === currentPath);
      const visibleKeys = new Set(nodes.flatMap((node) => [node.key, ...node.aliases]));
      const edges = scope === 'all'
        ? knowledge.edges
        : knowledge.edges.filter((edge) => visibleKeys.has(edge.from.key) || visibleKeys.has(edge.to.key));
      return {
        path: currentPath,
        revision: knowledge.revision,
        nodes,
        edges,
        strutClauses: knowledge.strutClauses,
        view: knowledge.view
      };
    }
    if (method === 'view.get') {
      const knowledge = await read();
      return { revision: knowledge.revision, view: knowledge.view };
    }
    if (method === 'node.list') return execute('field.get', params);
    if (method === 'edge.list') {
      const field = await execute('field.get', params);
      return { path: field.path, revision: field.revision, edges: field.edges };
    }
    if (method === 'node.get') {
      const knowledge = await read();
      return { node: findNode(knowledge, params.key), revision: knowledge.revision };
    }
    if (method === 'search') {
      const knowledge = await read();
      const query = text(params.query, 80).trim().toLocaleLowerCase('zh-CN');
      const matches = query ? knowledge.nodes.filter((node) => (
        node.label.toLocaleLowerCase('zh-CN').includes(query)
        || node.detail.toLocaleLowerCase('zh-CN').includes(query)
        || node.path.toLocaleLowerCase('zh-CN').includes(query)
      )) : [];
      const explicitLimit = params.limit === undefined ? null : Number(params.limit);
      const results = Number.isSafeInteger(explicitLimit) && explicitLimit >= 0
        ? matches.slice(0, explicitLimit)
        : matches;
      return { query, revision: knowledge.revision, results };
    }
    if (method === 'probe') {
      return probeKnowledge(await read(), params);
    }
    if (method === 'node.create') {
      return mutate(async (knowledge) => {
        const node = cleanNode(params);
        if (knowledge.nodes.some((candidate) => candidate.key === node.key)) {
          throw new SpatialStoreError('NODE_EXISTS', '节点键已存在', { key: node.key });
        }
        knowledge.nodes.push(node);
        return { node };
      });
    }
    if (method === 'node.update') {
      return mutate(async (knowledge) => {
        const node = findNode(knowledge, params.key);
        if (params.label !== undefined || params.name !== undefined) {
          node.label = text(params.label ?? params.name, 80).trim() || node.label;
        }
        if (params.detail !== undefined || params.description !== undefined) {
          node.detail = text(params.detail ?? params.description, 4000);
        }
        if (params.attachment !== undefined) node.attachment = cleanAttachment(params.attachment);
        if (params.leaderId !== undefined) {
          node.leaderId = params.leaderId === null ? null : text(params.leaderId, 256).trim() || null;
        }
        node.updatedAt = new Date().toISOString();
        return { node };
      });
    }
    if (method === 'node.land') {
      return mutate(async (knowledge) => {
        const node = findNode(knowledge, params.key);
        const targetPath = text(params.path, 512).trim();
        if (!targetPath) {
          throw new SpatialStoreError('INVALID_PATH', '节点落脚需要目标域径', { path: params.path });
        }
        const oldKey = node.key;
        const newKey = nodeKey(targetPath, node.id);
        const collision = knowledge.nodes.find((candidate) => (
          candidate !== node
          && (candidate.key === newKey || candidate.aliases.includes(newKey))
        ));
        if (collision) {
          throw new SpatialStoreError('NODE_EXISTS', '目标域中已经存在相同节点键', {
            key: newKey,
            conflictingNode: collision.key
          });
        }
        const identityKeys = nodeIdentityKeys(node);
        const preservedRelations = knowledge.edges.filter((edge) => (
          identityKeys.has(edge.from.key) || identityKeys.has(edge.to.key)
        )).length;
        node.path = targetPath;
        node.key = newKey;
        node.position = {
          x: Number(params.position?.x) || 0,
          y: Number(params.position?.y) || 0,
          z: Number(params.position?.z) || 0
        };
        node.aliases = cleanAliases([...node.aliases, oldKey], newKey);
        node.updatedAt = new Date().toISOString();
        return { oldKey, newKey, position: { ...node.position }, preservedRelations, node };
      });
    }
    if (method === 'node.delete') {
      return mutate(async (knowledge) => {
        const node = findNode(knowledge, params.key);
        const identityKeys = nodeIdentityKeys(node);
        knowledge.nodes = knowledge.nodes.filter((candidate) => candidate !== node);
        const removedEdges = knowledge.edges
          .filter((edge) => identityKeys.has(edge.from.key) || identityKeys.has(edge.to.key))
          .map((edge) => edge.id);
        knowledge.edges = knowledge.edges.filter((edge) => (
          !identityKeys.has(edge.from.key) && !identityKeys.has(edge.to.key)
        ));
        return { key: node.key, aliases: [...node.aliases], removedEdges };
      });
    }
    if (method === 'edge.create') {
      return mutate(async (knowledge) => {
        const fromNode = findNode(knowledge, typeof params.from === 'string' ? params.from : params.from?.key);
        const toNode = findNode(knowledge, typeof params.to === 'string' ? params.to : params.to?.key);
        const edge = cleanEdge({
          from: { key: fromNode.key, label: fromNode.label },
          to: { key: toNode.key, label: toNode.label },
          label: params.label
        });
        if (knowledge.edges.some((candidate) => candidate.id === edge.id)) {
          throw new SpatialStoreError('EDGE_EXISTS', '关系已经存在', { id: edge.id });
        }
        knowledge.edges.push(edge);
        return { edge };
      });
    }
    if (method === 'edge.delete') {
      return mutate(async (knowledge) => {
        const id = params.id || edgeIdentity(params.from, params.to);
        const edge = knowledge.edges.find((candidate) => candidate.id === id);
        if (!edge) throw new SpatialStoreError('EDGE_NOT_FOUND', '关系不存在', { id });
        knowledge.edges = knowledge.edges.filter((candidate) => candidate.id !== id);
        return { edge };
      });
    }
    if (method === 'knowledge.replace') {
      const expectedRevision = params.expectedRevision;
      return enqueueFileWrite(absoluteFile, async () => {
        const current = await currentSnapshot();
        if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) {
          throw new SpatialStoreError('REVISION_CONFLICT', '知识库已被其他操作更新', {
            expectedRevision: Number(expectedRevision),
            actualRevision: current.revision
          });
        }
        const incoming = normalizeKnowledge(params.knowledge);
        incoming.revision = current.revision + 1;
        incoming.updatedAt = new Date().toISOString();
        await write(incoming);
        return { knowledge: incoming, revision: incoming.revision };
      });
    }
    if (method === 'view.update') {
      return enqueueFileWrite(absoluteFile, async () => {
        const knowledge = structuredClone(await currentSnapshot());
        knowledge.view = params.view && typeof params.view === 'object' ? params.view : null;
        await write(knowledge);
        return { view: knowledge.view, revision: knowledge.revision };
      });
    }
    throw new SpatialStoreError('UNKNOWN_METHOD', '不支持的空间命令', { method });
  }

  return Object.freeze({
    file: absoluteFile,
    async init() {
      return read();
    },
    read,
    execute
  });
}
