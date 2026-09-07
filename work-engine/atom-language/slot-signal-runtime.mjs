import { atomTypes, walkAtoms } from './slot-graph-semantics.mjs';

function pathKey(path) {
  return path.join('/');
}

function hasPathPrefix(path, prefix) {
  return prefix.every((part, index) => path[index] === part);
}

function sourceProgram(matches, sourceProgramPath) {
  return matches.find((match) => (
    pathKey(match.path) === sourceProgramPath && atomTypes(match.atom).includes('program')
  )) ?? null;
}

function sourceNotFound(sourceProgramPath) {
  return Object.assign(
    new Error(`Slot signal source Program no longer exists: ${sourceProgramPath}`),
    { code: 'SLOT_SIGNAL_SOURCE_NOT_FOUND' }
  );
}

function slotTagError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function collectLinePrograms(expression, result = []) {
  if (!expression || typeof expression !== 'object') return result;
  if (expression.kind === 'program') result.push(expression);
  for (const child of expression.children ?? []) collectLinePrograms(child, result);
  return result;
}

function graphPathToAtomPath(graphDocument, graphPath) {
  const indexed = graphDocument.atomPathByGraphPath?.get(graphPath);
  if (typeof indexed === 'string') return indexed;
  const root = graphDocument.graph?.thing;
  return typeof root === 'string' && graphPath.startsWith(`${root}/`)
    ? graphPath.slice(root.length + 1)
    : graphPath;
}

function freezeTagInvocation(value) {
  value.lineProgram = Object.freeze(value.lineProgram);
  value.sourcePackets = Object.freeze(value.sourcePackets.map((packet) => Object.freeze({
    ...packet, labels: Object.freeze([...packet.labels])
  })));
  value.labels = Object.freeze([...value.labels]);
  value.consequentPaths = Object.freeze([...value.consequentPaths]);
  return Object.freeze(value);
}

const outgoingTagStrutsByDocument = new WeakMap();

function outgoingTagStrutIndex(graphDocument) {
  const cached = outgoingTagStrutsByDocument.get(graphDocument);
  if (cached) return cached;
  const index = new Map();
  for (const clause of graphDocument.strutClauses) {
    for (const graphPath of clause.antecedentPaths ?? []) {
      const atomPath = graphPathToAtomPath(graphDocument, graphPath);
      const clauses = index.get(atomPath) ?? [];
      clauses.push(clause);
      index.set(atomPath, clauses);
    }
  }
  outgoingTagStrutsByDocument.set(graphDocument, index);
  return index;
}

/**
 * Resolve one scene-local wave of explicit provider packets to the Programs
 * carried by their actual Graph struts. This is deliberately independent of
 * Slot containment: parent/child proximity is not a causal channel.
 */
export function routeSlotTagPackets(graphDocument, packets, { scene, revision }) {
  if (!graphDocument || typeof graphDocument !== 'object'
    || !Array.isArray(graphDocument.strutClauses)
    || !Array.isArray(packets)
    || typeof scene !== 'string' || !scene
    || typeof revision !== 'string' || !revision) {
    throw slotTagError('INVALID_SLOT_TAG_ROUTING_INPUT', 'Slot tag routing requires Graph, packets, scene, and revision');
  }
  const packetsBySource = new Map();
  for (const packet of packets) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)
      || typeof packet.sourceNodePath !== 'string' || !packet.sourceNodePath
      || !Array.isArray(packet.labels) || packet.labels.length === 0) {
      throw slotTagError('INVALID_SLOT_TAG_PACKET', 'Slot tag packet requires one exact source node and labels');
    }
    const entries = packetsBySource.get(packet.sourceNodePath) ?? [];
    entries.push(packet);
    packetsBySource.set(packet.sourceNodePath, entries);
  }
  const invocations = [];
  const outgoingIndex = outgoingTagStrutIndex(graphDocument);
  const selectedIds = new Set([...packetsBySource.keys()].flatMap((sourcePath) => (
    (outgoingIndex.get(sourcePath) ?? []).map(({ id }) => id)
  )));
  for (const clause of graphDocument.strutClauses) {
    if (!selectedIds.has(clause.id)) continue;
    const orderedPackets = [];
    for (const graphPath of clause.antecedentPaths ?? []) {
      const atomPath = graphPathToAtomPath(graphDocument, graphPath);
      for (const packet of packetsBySource.get(atomPath) ?? []) {
        orderedPackets.push({ sourceNodePath: atomPath, labels: [...packet.labels] });
      }
    }
    if (orderedPackets.length === 0) continue;
    const programs = collectLinePrograms(clause.root);
    if (programs.length === 0) continue;
    if (programs.length !== 1) {
      throw slotTagError(
        'MULTIPLE_SLOT_TAG_STRUT_PROGRAMS',
        'One Graph strut requires exactly one explicit tag-routing Program',
        { clauseId: clause.id, count: programs.length }
      );
    }
    const labels = [];
    const seen = new Set();
    for (const packet of orderedPackets) {
      for (const label of packet.labels) {
        if (seen.has(label)) continue;
        seen.add(label);
        labels.push(label);
      }
    }
    invocations.push(freezeTagInvocation({
      mode: 'slot-tag-strut',
      scene,
      revision,
      clauseId: clause.id,
      lineProgram: {
        predicateId: programs[0].predicateId,
        source: programs[0].source
      },
      sourcePackets: orderedPackets,
      labels,
      consequentPaths: (clause.then ?? []).map(({ targetPath }) => (
        graphPathToAtomPath(graphDocument, targetPath)
      ))
    }));
  }
  return Object.freeze(invocations);
}

export function resolveSlotSignalDeliveries(atoms, effects, { revision, createId }) {
  const matches = walkAtoms(atoms);
  const deliveries = [];
  for (const effect of effects) {
    const source = sourceProgram(matches, effect.sourceProgramPath);
    if (!source) throw sourceNotFound(effect.sourceProgramPath);
    const parentPath = source.path.slice(0, -1);
    const recipients = effect.to === 'up'
      ? matches.filter((candidate) => pathKey(candidate.path) === pathKey(parentPath))
      : matches.filter((candidate) => (
        candidate.path.length === source.path.length + 1
        && hasPathPrefix(candidate.path, source.path)
      ));
    const from = effect.to === 'up' ? 'down' : 'up';
    for (const recipient of recipients) {
      deliveries.push({
        mode: 'slot',
        id: createId(),
        revision,
        sourcePath: effect.sourceProgramPath,
        recipientPath: pathKey(recipient.path),
        from,
        labels: Object.freeze([...effect.labels])
      });
    }
  }
  return deliveries;
}
