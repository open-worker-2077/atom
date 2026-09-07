import { projectAtomContext } from './context-store.mjs';
import { bindShortcutTargetIdentities } from './shortcut-runtime.mjs';
import {
  childrenOf,
  ensureThingIdentities,
  storedField,
  walkAtoms
} from './slot-graph-semantics.mjs';
import { bindStrutEndpointIdentities } from './transform-executor.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

function endpointStats(atoms) {
  let total = 0;
  let bound = 0;
  const unbound = [];
  function visit(value, ownerPath, inactiveBackup) {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, ownerPath, inactiveBackup));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const field = Object.keys(value).map((rawKey) => ({
      rawKey,
      parsed: storedField({ [rawKey]: value[rawKey] }, 'thing')?.parsed
    })).find(({ parsed }) => parsed);
    if (field) {
      total += 1;
      if (field.parsed.identity) bound += 1;
      else unbound.push({ ownerPath, selector: value[field.rawKey], inactiveBackup });
    }
    Object.values(value).forEach((item) => visit(item, ownerPath, inactiveBackup));
  }
  for (const match of walkAtoms(atoms)) {
    let current = match;
    let inactiveBackup = false;
    while (current) {
      const types = new Set((storedField(current.atom, 'thing')?.parsed.types ?? [])
        .map(({ raw }) => raw));
      if (types.has('backup') && types.has('default')) inactiveBackup = true;
      current = current.parent;
    }
    visit(storedField(match.atom, 'strut')?.value ?? [], match.path.join('/'), inactiveBackup);
  }
  return { total, bound, unbound };
}

function topology(atoms) {
  return walkAtoms(atoms).map((match) => ({
    path: match.path.join('/'),
    childCount: childrenOf(match.atom)?.length ?? 0
  }));
}

export function planThingIdentityMigration(sourceFacts) {
  if (!Array.isArray(sourceFacts)) {
    throw Object.assign(new Error('Thing identity migration requires one Atom array'), {
      code: 'INVALID_THING_IDENTITY_MIGRATION_SOURCE'
    });
  }
  const sourceRevision = revisionOfWorldFacts(sourceFacts);
  const sourceTopology = topology(sourceFacts);
  const facts = structuredClone(sourceFacts);
  ensureThingIdentities(facts);
  const strutPaths = bindStrutEndpointIdentities(facts);
  const shortcutPaths = bindShortcutTargetIdentities(facts);
  projectAtomContext(facts);
  const records = walkAtoms(facts);
  const identities = records.map(({ atom }) => storedField(atom, 'thing')?.parsed.identity);
  const endpoints = endpointStats(facts);
  const nextRevision = revisionOfWorldFacts(facts);
  return Object.freeze({
    migrationId: `thing-identity:${sourceRevision}:${nextRevision}`,
    sourceRevision,
    nextRevision,
    changed: sourceRevision !== nextRevision,
    facts,
    changedPaths: Object.freeze(records.map((match) => match.path.join('/'))),
    summary: Object.freeze({
      thingCount: records.length,
      uniqueIdentityCount: new Set(identities).size,
      topologyPreserved: JSON.stringify(sourceTopology) === JSON.stringify(topology(facts)),
      strutEndpointCount: endpoints.total,
      boundStrutEndpointCount: endpoints.bound,
      activeUnboundStrutEndpointCount: endpoints.unbound.filter(
        ({ inactiveBackup }) => !inactiveBackup
      ).length,
      unboundStrutEndpoints: Object.freeze(endpoints.unbound.map(Object.freeze)),
      boundStrutPaths: Object.freeze([...strutPaths]),
      boundShortcutPaths: Object.freeze([...shortcutPaths])
    })
  });
}
