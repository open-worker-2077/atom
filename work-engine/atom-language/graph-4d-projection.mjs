import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { parseGraphDocument } from '../../cli/lib/graph-json.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const codecFile = path.resolve(here, '..', '..', 'spatial-json-codec.js');

let cachedCodec = null;

async function loadSpatialJsonCodec() {
  if (cachedCodec) return cachedCodec;
  const source = await fs.readFile(codecFile, 'utf8');
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(source, sandbox, { filename: codecFile });
  cachedCodec = sandbox.window.SpatialJsonCodec;
  return cachedCodec;
}

function resolvePartnerPath(sourcePath, target, pathIndex, nameIndex) {
  if (target.includes('/')) {
    const direct = pathIndex.get(target);
    if (direct) return direct;
  } else {
    const siblingPath = [...sourcePath.slice(0, -1), target].join('/');
    const sibling = pathIndex.get(siblingPath);
    if (sibling) return sibling;
  }
  const named = nameIndex.get(target) || [];
  return named.length === 1 ? named[0] : null;
}

/**
 * Atom partners are a directed predicate (verb) from the owning atom to a
 * referenced object, while graph-4d relations are an undirected from/to pair
 * by design (see README: 不推断业务含义、流程或箭头方向). This projection is
 * therefore lossy in one direction only: it turns atom's explicit direction
 * into graph-4d's from/to order (from = owning atom, to = resolved partner),
 * which graph-4d's own renderer does not yet visualise as directional.
 */
export function toGraph4dImportDocument(graph) {
  const pathIndex = new Map();
  const nameIndex = new Map();

  function index(node, parentPath) {
    const visiblePath = [...parentPath, node.name];
    pathIndex.set(visiblePath.join('/'), visiblePath);
    if (!nameIndex.has(node.name)) nameIndex.set(node.name, []);
    nameIndex.get(node.name).push(visiblePath);
    node.children.forEach((child) => index(child, visiblePath));
  }
  index(graph, []);

  const relations = [];
  function collectRelations(node, parentPath) {
    const visiblePath = [...parentPath, node.name];
    for (const partner of node.partners) {
      const targetPath = resolvePartnerPath(visiblePath, partner.object, pathIndex, nameIndex);
      if (!targetPath) continue;
      relations.push({ from: visiblePath, to: targetPath, name: partner.verb });
    }
    node.children.forEach((child) => collectRelations(child, visiblePath));
  }
  collectRelations(graph, []);

  function toGraph4dNode(node) {
    const children = node.children.map(toGraph4dNode);
    const detail = node.detail && node.detail.trim()
      ? node.detail
      : (children.length ? '' : `（来自 Atom：${node.name}，暂无详情）`);
    return { name: node.name, detail, children };
  }

  return {
    format: 'graph-4d',
    version: 1,
    nodes: [toGraph4dNode(graph)],
    relations
  };
}

export async function projectAtomGraphWithPaths(rawGraphDocument, options = {}) {
  const { graph } = parseGraphDocument(rawGraphDocument);
  const importDocument = toGraph4dImportDocument(graph);
  const codec = await loadSpatialJsonCodec();
  const parsed = codec.parse(importDocument);
  const { knowledge } = codec.planImport({}, parsed, { path: 'root' });
  const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
  for (const node of nodes) {
    node.surfaceVisible = false;
    node.detailMode = 'floating';
  }
  const atomPathByKey = new Map();
  const assigned = new Set();
  const childrenByParent = new Map();
  for (const node of nodes) {
    const parentPath = node.path.split('/').slice(0, -1).join('/');
    if (!childrenByParent.has(parentPath)) childrenByParent.set(parentPath, []);
    childrenByParent.get(parentPath).push(node);
  }
  function attachAtomPath(atom, parentKnowledgePath, parentAtomPath, root = false) {
    const candidates = root
      ? nodes.filter((node) => node.path === 'root')
      : (childrenByParent.get(parentKnowledgePath) ?? []);
    const knowledgeNode = candidates.find((node) => node.label === atom.name && !assigned.has(node.key));
    if (!knowledgeNode) return;
    const atomPath = root ? '' : (parentAtomPath ? `${parentAtomPath}/${atom.name}` : atom.name);
    assigned.add(knowledgeNode.key);
    if (atomPath) atomPathByKey.set(knowledgeNode.key, atomPath);
    atom.children.forEach((child) => attachAtomPath(child, knowledgeNode.path, atomPath));
  }
  attachAtomPath(graph, '', '', true);
  const lockByPath = new Map((options.lockState ?? []).map((entry) => [entry.path, entry]));
  for (const node of nodes) {
    const atomPath = atomPathByKey.get(node.key);
    if (atomPath) node.atomPath = atomPath;
    const atomTypes = atomPath ? options.atomTypesByPath?.get(atomPath) : null;
    if (Array.isArray(atomTypes) && atomTypes.length) node.atomTypes = structuredClone(atomTypes);
    if (atomPath && lockByPath.has(atomPath)) node.lockState = structuredClone(lockByPath.get(atomPath));
  }
  const defaultBackupPaths = nodes
    .filter((node) => node.atomTypes?.includes('backup') && node.atomTypes.includes('default'))
    .map((node) => node.atomPath);
  if (defaultBackupPaths.length) {
    const hiddenKeys = new Set(nodes
      .filter((node) => defaultBackupPaths.some((backupPath) => (
        node.atomPath === backupPath || node.atomPath?.startsWith(`${backupPath}/`)
      )))
      .map((node) => node.key));
    knowledge.edges = (knowledge.edges ?? []).filter((edge) => (
      !hiddenKeys.has(edge.from?.key) && !hiddenKeys.has(edge.to?.key)
    ));
  }
  return { knowledge, atomPathByKey };
}

export async function projectAtomGraphToKnowledge(rawGraphDocument, options = {}) {
  return (await projectAtomGraphWithPaths(rawGraphDocument, options)).knowledge;
}
