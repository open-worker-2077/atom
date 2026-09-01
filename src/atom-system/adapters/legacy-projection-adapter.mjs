import { projectAtomContext } from '../../../work-engine/atom-language/context-store.mjs';
import { projectAtomGraphToKnowledge } from '../../../work-engine/atom-language/graph-4d-projection.mjs';
import { parseAtomKey } from '../../../work-engine/atom-language/key-parser.mjs';
import { evaluateStrutClausesWithPrograms } from '../../../work-engine/atom-language/strut-runtime.mjs';

const baseKeyOf = (rawKey) => String(rawKey).match(/^[^@#$~]+/u)?.[0] ?? '';

function fieldValue(atom, baseKey) {
  return Object.entries(atom ?? {}).find(([key]) => baseKeyOf(key) === baseKey)?.[1];
}

function atomName(atom) {
  return fieldValue(atom, 'thing');
}

function topDomain(rawPath, rootThing = 'atom.json') {
  if (typeof rawPath !== 'string') return '';
  const parts = rawPath.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts[0] === rootThing) parts.shift();
  return parts[0] ?? '';
}

function affectedTopDomains(affectedPaths, rootThing) {
  return new Set((affectedPaths ?? []).map((path) => topDomain(path, rootThing)).filter(Boolean));
}

function referencedTopDomains(atom, knownDomains, rootThing) {
  const result = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [rawKey, child] of Object.entries(value)) {
      if (baseKeyOf(rawKey) === 'thing' && typeof child === 'string'
        && child !== '.' && !child.startsWith('./')) {
        const domain = topDomain(child, rootThing);
        if (child.includes('/') && knownDomains.has(domain)) result.add(domain);
      }
      visit(child);
    }
  };
  const scanAtom = (current) => {
    for (const [rawKey, value] of Object.entries(current ?? {})) {
      const baseKey = baseKeyOf(rawKey);
      if (baseKey === 'strut') visit(value);
      if (baseKey === 'slot' && Array.isArray(value)) value.forEach(scanAtom);
    }
  };
  scanAtom(atom);
  return result;
}

function projectionDomainFacts(facts, affectedDomains, rootThing) {
  const byDomain = new Map(facts.map((atom) => [atomName(atom), atom]));
  const included = new Set([...affectedDomains].filter((domain) => byDomain.has(domain)));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const domain of [...included]) {
      for (const referenced of referencedTopDomains(byDomain.get(domain), byDomain, rootThing)) {
        if (!included.has(referenced)) {
          included.add(referenced);
          expanded = true;
        }
      }
    }
  }
  return facts.filter((atom) => included.has(atomName(atom)));
}

function mergeIndex(previous, partial, affectedRuleIds) {
  const merged = new Map();
  for (const [path, values] of previous instanceof Map ? previous : []) {
    const kept = values.filter((value) => !affectedRuleIds.has(value.ruleId ?? value));
    if (kept.length) merged.set(path, structuredClone(kept));
  }
  for (const [path, values] of partial instanceof Map ? partial : []) {
    const selected = values.filter((value) => affectedRuleIds.has(value.ruleId ?? value));
    if (selected.length) merged.set(path, [...(merged.get(path) ?? []), ...structuredClone(selected)]);
  }
  return merged;
}

function atomPathMap(graphDocument) {
  const result = new Map();
  const rootThing = atomName(graphDocument.graph);
  const visit = (atom, parentPath = '') => {
    const name = atomName(atom);
    const atomPath = parentPath ? `${parentPath}/${name}` : name;
    result.set(`${rootThing}/${atomPath}`, atomPath);
    for (const child of fieldValue(atom, 'slot') ?? []) visit(child, atomPath);
  };
  for (const atom of fieldValue(graphDocument.graph, 'slot') ?? []) visit(atom);
  return result;
}

function incrementalGraphProjection({ facts, previous, affectedPaths, projectContext, options }) {
  const rootThing = atomName(previous.graph) ?? 'atom.json';
  const affectedDomains = affectedTopDomains(affectedPaths, rootThing);
  if (!affectedDomains.size) return { value: previous, affectedDomains, partial: previous };
  const partialFacts = projectionDomainFacts(facts, affectedDomains, rootThing);
  const partial = projectContext(partialFacts, options);
  const previousChildren = new Map((fieldValue(previous.graph, 'slot') ?? [])
    .map((atom) => [atomName(atom), atom]));
  const partialChildren = new Map((fieldValue(partial.graph, 'slot') ?? [])
    .map((atom) => [atomName(atom), atom]));
  const graph = {
    ...previous.graph,
    slot: facts.map((atom) => {
      const domain = atomName(atom);
      return affectedDomains.has(domain)
        ? partialChildren.get(domain)
        : previousChildren.get(domain);
    }).filter(Boolean)
  };
  const affectsClause = (clause) => affectedDomains.has(topDomain(clause.sourcePath, rootThing));
  const strutClauses = [
    ...(previous.strutClauses ?? []).filter((clause) => !affectsClause(clause)),
    ...(partial.strutClauses ?? []).filter(affectsClause)
  ].sort((left, right) => left.id.localeCompare(right.id));
  const strutRelations = [
    ...(previous.strutRelations ?? []).filter((relation) => !affectedDomains.has(topDomain(relation.sourcePath, rootThing))),
    ...(partial.strutRelations ?? []).filter((relation) => affectedDomains.has(topDomain(relation.sourcePath, rootThing)))
  ].sort((left, right) => (
    left.clauseId.localeCompare(right.clauseId)
    || left.inputOrdinal - right.inputOrdinal
    || left.thenOrdinal - right.thenOrdinal
  ));
  const affectedRuleIds = new Set([
    ...(previous.strutClauses ?? []).filter(affectsClause),
    ...(partial.strutClauses ?? []).filter(affectsClause)
  ].map((clause) => clause.id));
  const value = {
    ...previous,
    graph,
    strutClauses,
    strutRelations,
    dependencyIndex: mergeIndex(previous.dependencyIndex, partial.dependencyIndex, affectedRuleIds),
    endpointIndex: mergeIndex(previous.endpointIndex, partial.endpointIndex, affectedRuleIds)
  };
  Object.defineProperty(value, 'atomPathByGraphPath', {
    value: atomPathMap(value), enumerable: false
  });
  Object.defineProperties(value, {
    incrementalAffectedDomains: { value: affectedDomains, enumerable: false },
    incrementalPartialDocument: { value: partial, enumerable: false }
  });
  return { value, affectedDomains, partial };
}

function mergeSpatialProjection(previous, partial, affectedDomains, fullGraph) {
  const previousByPath = new Map((previous.nodes ?? [])
    .filter((node) => node.atomPath)
    .map((node) => [node.atomPath, node]));
  const partialByPath = new Map((partial.nodes ?? [])
    .filter((node) => node.atomPath && affectedDomains.has(topDomain(node.atomPath)))
    .map((node) => [node.atomPath, node]));
  const orderedAtomPaths = [];
  const visit = (atom, parent = '') => {
    const name = atomName(atom);
    const current = parent ? `${parent}/${name}` : name;
    orderedAtomPaths.push(current);
    for (const child of fieldValue(atom, 'slot') ?? []) visit(child, current);
  };
  for (const atom of fieldValue(fullGraph.graph, 'slot') ?? []) visit(atom);
  const root = (previous.nodes ?? []).find((node) => !node.atomPath)
    ?? (partial.nodes ?? []).find((node) => !node.atomPath);
  const nodes = [root, ...orderedAtomPaths.map((atomPath) => {
    const updated = partialByPath.get(atomPath);
    const prior = previousByPath.get(atomPath);
    return updated && prior ? { ...updated, position: structuredClone(prior.position) } : updated ?? prior;
  })].filter(Boolean);
  const affectedKeys = new Set([
    ...(previous.nodes ?? []),
    ...(partial.nodes ?? [])
  ].filter((node) => node.atomPath && affectedDomains.has(topDomain(node.atomPath)))
    .map((node) => node.key));
  const edges = [
    ...(previous.edges ?? []).filter((edge) => (
      !affectedKeys.has(edge.from?.key) && !affectedKeys.has(edge.to?.key)
    )),
    ...(partial.edges ?? []).filter((edge) => (
      affectedKeys.has(edge.from?.key) || affectedKeys.has(edge.to?.key)
    ))
  ];
  const affectedClause = (clause) => affectedDomains.has(topDomain(clause.sourcePath));
  return {
    ...previous,
    nodes,
    edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()],
    nodePatches: [],
    deletedNodeKeys: [],
    removedEdgeIds: [],
    strutClauses: [
      ...(previous.strutClauses ?? []).filter((clause) => !affectedClause(clause)),
      ...(partial.strutClauses ?? []).filter(affectedClause)
    ].sort((left, right) => left.id.localeCompare(right.id)),
    strutRelations: [
      ...(previous.strutRelations ?? []).filter((relation) => !affectedDomains.has(topDomain(relation.sourcePath))),
      ...(partial.strutRelations ?? []).filter((relation) => affectedDomains.has(topDomain(relation.sourcePath)))
    ].sort((left, right) => left.clauseId.localeCompare(right.clauseId))
  };
}

function atomTypesByPath(facts) {
  const result = new Map();
  const visit = (atom, parentPath = '') => {
    const nameField = Object.entries(atom).find(([key]) => baseKeyOf(key) === 'thing');
    if (!nameField) return;
    const [key, name] = nameField;
    const path = parentPath ? `${parentPath}/${name}` : name;
    const types = parseAtomKey(key).types.map((type) => type.name);
    if (types.length) result.set(path, types);
    const slotField = Object.entries(atom).find(([rawKey]) => baseKeyOf(rawKey) === 'slot');
    for (const child of slotField?.[1] ?? []) visit(child, path);
  };
  for (const atom of facts) visit(atom);
  return result;
}

export function createLegacyProjectionProjectors(options = {}) {
  const lockState = Array.isArray(options.lockState) ? structuredClone(options.lockState) : [];
  const programScheduler = options.programScheduler ?? null;
  const projectContext = options.projectContext ?? projectAtomContext;
  const projectSpatial = options.projectSpatial ?? projectAtomGraphToKnowledge;
  const graphOptions = {
    allowLegacyStrut: Boolean(options.compatibilityManifest)
  };
  return Object.freeze([
    Object.freeze({
      id: 'graph',
      project: ({ facts }, context = {}) => {
        const previous = context.previousProjection?.value ?? null;
        if (!previous || !Array.isArray(context.affectedPaths)) {
          return projectContext(facts, graphOptions);
        }
        return incrementalGraphProjection({
          facts,
          previous,
          affectedPaths: context.affectedPaths,
          projectContext,
          options: graphOptions
        }).value;
      }
    }),
    Object.freeze({
      id: 'spatial',
      async project({ facts }, context = {}) {
        const graphDocument = context.values?.graph ?? projectContext(facts, {
          allowLegacyStrut: Boolean(options.compatibilityManifest)
        });
        const strutDecisions = await evaluateStrutClausesWithPrograms(graphDocument, {
          evaluateProgram: (selector) => {
            if (!programScheduler?.evaluateStrutProgram) {
              throw Object.assign(new Error('Program strut endpoint requires Program runtime'), {
                code: 'STRUT_PROGRAM_EVALUATOR_REQUIRED'
              });
            }
            const atomPath = graphDocument.atomPathByGraphPath?.get(selector);
            if (!atomPath) {
              throw Object.assign(new Error(`Program strut endpoint has no Atom identity: ${selector}`), {
                code: 'STRUT_PROGRAM_IDENTITY_REQUIRED',
                details: { selector }
              });
            }
            return programScheduler.evaluateStrutProgram(facts, atomPath);
          }
        });
        const spatialOptions = {
          lockState,
          atomTypesByPath: atomTypesByPath(facts),
          strutDecisions
        };
        const affectedDomains = graphDocument.incrementalAffectedDomains;
        const partialDocument = graphDocument.incrementalPartialDocument;
        const previous = context.previousProjection?.value ?? null;
        const knowledge = affectedDomains && partialDocument && previous
          ? mergeSpatialProjection(
              previous,
              await projectSpatial(partialDocument, {
                ...spatialOptions,
                atomTypesByPath: atomTypesByPath(projectionDomainFacts(facts, affectedDomains, atomName(graphDocument.graph)))
              }),
              affectedDomains,
              graphDocument
            )
          : await projectSpatial(graphDocument, spatialOptions);
        if (options.compatibilityMetadata?.relations?.length) {
          knowledge.legacyRelations = structuredClone(options.compatibilityMetadata.relations);
        }
        return knowledge;
      }
    })
  ]);
}
