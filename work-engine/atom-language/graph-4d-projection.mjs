import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { parseGraphDocument } from '../../cli/lib/graph-json.mjs';
import { parseAtomKey } from './key-parser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const codecFile = path.resolve(here, '..', '..', 'spatial-json-codec.js');

let cachedCodec = null;

function baseKeyOf(rawKey) {
  return String(rawKey).match(/^[^@#$~]+/u)?.[0] ?? '';
}

function axisValue(node, baseKey) {
  for (const [rawKey, value] of Object.entries(node ?? {})) {
    if (rawKey === baseKey || (rawKey.startsWith(baseKey) && baseKeyOf(rawKey) === baseKey)) return value;
  }
  return undefined;
}

const thingOf = (node) => axisValue(node, 'thing');
const situationOf = (node) => axisValue(node, 'situation');
const containOf = (node) => axisValue(node, 'contain') ?? [];
function thingFieldOf(node) {
  for (const [rawKey, value] of Object.entries(node ?? {})) {
    if (rawKey === 'thing' || (rawKey.startsWith('thing') && baseKeyOf(rawKey) === 'thing')) {
      return { rawKey, value };
    }
  }
  return undefined;
}

function isProgramThingField(field) {
  if (!field?.rawKey?.includes('@program')) return false;
  return parseAtomKey(field.rawKey, { descriptionSymbolWarnings: false })
    .types.some((type) => type.raw === 'program');
}

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
 * Atom support is an ordered directed relation. graph-4d keeps its fixed
 * support label and from/to order; richer trunk/branch grouping stays in the
 * Atom support bundle metadata rather than becoming a second world fact.
 */
export function toGraph4dImportDocument(graph, options = {}) {
  const pathIndex = new Map();
  const nameIndex = new Map();

  function index(node, parentPath) {
    const thing = thingOf(node);
    const visiblePath = [...parentPath, thing];
    pathIndex.set(visiblePath.join('/'), visiblePath);
    if (!nameIndex.has(thing)) nameIndex.set(thing, []);
    nameIndex.get(thing).push(visiblePath);
    containOf(node).forEach((child) => index(child, visiblePath));
  }
  index(graph, []);

  const parsed = options.supportClauses
    ? null
    : parseGraphDocument({ config: { schema_version: '2.0.0' }, graph });
  const supportClauses = options.supportClauses ?? parsed.supportClauses;
  const supportDecisions = options.supportDecisions ?? null;
  const relations = supportClauses.filter((clause) => (
    !supportDecisions || supportDecisions.get(clause.id)?.decision === true
  )).flatMap((clause) => (
    clause.dependencyPaths.flatMap((sourcePath) => clause.then.map((target) => ({
      from: sourcePath.split('/'),
      to: target.targetPath.split('/'),
      name: 'support'
    })))
  ));

  function toGraph4dNode(node, parentPath = []) {
    const currentPath = [...parentPath, thingOf(node)];
    const children = containOf(node).map((child) => toGraph4dNode(child, currentPath));
    const situation = situationOf(node);
    const thingField = thingFieldOf(node);
    const isProgram = isProgramThingField(thingField);
    const detail = isProgram
      ? 'Program'
      : situation && situation.trim()
        ? situation
        : (children.length ? '' : `（来自 Atom：${thingOf(node)}，暂无详情）`);
    return {
      name: thingOf(node), detail, children,
      ...(isProgram ? { programSource: situation ?? '' } : {})
    };
  }

  return {
    format: 'graph-4d',
    version: 1,
    nodes: [toGraph4dNode(graph)],
    relations
  };
}

export async function projectAtomGraphWithPaths(rawGraphDocument, options = {}) {
  const parsedDocument = Array.isArray(rawGraphDocument?.supportClauses)
    && rawGraphDocument?.endpointIndex instanceof Map
    ? rawGraphDocument
    : parseGraphDocument(Array.isArray(rawGraphDocument?.supportClauses)
      ? { config: rawGraphDocument.config, graph: rawGraphDocument.graph }
      : rawGraphDocument);
  const { graph, supportClauses } = parsedDocument;
  const supportDecisions = options.supportDecisions ?? null;
  const importDocument = toGraph4dImportDocument(graph, { supportClauses, supportDecisions });
  const codec = await loadSpatialJsonCodec();
  const parsed = codec.parse(importDocument);
  const { knowledge } = codec.planImport({}, parsed, { path: 'root' });
  const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
  for (const node of nodes) {
    node.surfaceVisible = false;
    node.detailMode = 'floating';
  }
  knowledge.supportClauses = supportClauses.map((clause) => ({
    ...structuredClone(clause),
    ...(supportDecisions?.has(clause.id)
      ? { evaluation: structuredClone(supportDecisions.get(clause.id)) }
      : {})
  }));
  knowledge.supportRelations = parsedDocument.supportRelations.filter((relation) => (
    !supportDecisions || supportDecisions.get(relation.clauseId)?.decision === true
  ));
  const atomPathByKey = new Map();
  const graphPathsRequired = supportClauses.length > 0;
  const assigned = new Set();
  const childrenByParent = new Map();
  for (const node of nodes) {
    const parentPath = node.path.split('/').slice(0, -1).join('/');
    if (!childrenByParent.has(parentPath)) childrenByParent.set(parentPath, []);
    childrenByParent.get(parentPath).push(node);
  }
  const candidateBuckets = new Map();
  function addCandidate(scope, node) {
    const key = `${scope}\u0000${node.label}`;
    if (!candidateBuckets.has(key)) candidateBuckets.set(key, []);
    candidateBuckets.get(key).push(node);
  }
  nodes.filter((node) => node.path === 'root').forEach((node) => addCandidate('$root', node));
  for (const [parentPath, children] of childrenByParent) {
    children.forEach((node) => addCandidate(parentPath, node));
  }
  function attachAtomPath(atom, parentKnowledgePath, parentAtomPath, root = false, parentGraphPath = '') {
    const atomThing = thingOf(atom);
    const candidates = candidateBuckets.get(`${root ? '$root' : parentKnowledgePath}\u0000${atomThing}`) ?? [];
    const knowledgeNode = candidates.find((node) => !assigned.has(node.key));
    if (!knowledgeNode) return;
    const atomPath = root ? '' : (parentAtomPath ? `${parentAtomPath}/${atomThing}` : atomThing);
    const graphPath = graphPathsRequired
      ? (parentGraphPath ? `${parentGraphPath}/${atomThing}` : atomThing)
      : '';
    assigned.add(knowledgeNode.key);
    if (graphPathsRequired) knowledgeNode.graphPath = graphPath;
    const atomThingField = thingFieldOf(atom);
    const isProgram = isProgramThingField(atomThingField);
    if (isProgram) knowledgeNode.programSource = situationOf(atom) ?? '';
    if (atomPath) atomPathByKey.set(knowledgeNode.key, atomPath);
    containOf(atom).forEach((child) => attachAtomPath(
      child,
      knowledgeNode.path,
      atomPath,
      false,
      graphPath
    ));
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
