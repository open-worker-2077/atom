import { createHash } from 'node:crypto';

import { projectAtomContext } from './context-store.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { createProgramRefBindingUpdate } from './program-ref-binding-ledger.mjs';
import { planThingIdAllocation, thingIdentityAllocatorUpdate } from './thing-id-allocator.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const LEGACY_ID = /^[A-Za-z0-9_-]{22}$/u;

function migrationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function axisField(atom, baseKey, identityContract = 'short') {
  const matches = Object.entries(atom ?? {}).map(([rawKey, value]) => ({
    rawKey,
    value,
    parsed: parseAtomKey(rawKey, { descriptionSymbolWarnings: false, identityContract })
  })).filter(({ parsed }) => parsed.baseKey === baseKey);
  if (matches.length !== 1 || matches[0].parsed.errors.length) {
    throw migrationError('INVALID_THING_IDENTITY_MIGRATION_SOURCE', `Migration requires one valid ${baseKey} axis`);
  }
  return matches[0];
}

function classifyThing(atom) {
  const rawKey = Object.keys(atom ?? {}).find((key) => (
    parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === 'thing'
  ));
  if (!rawKey) throw migrationError('MISSING_LEGACY_THING_IDENTITY', 'Every migrated Thing requires one identity');
  const rawIdentity = rawKey.match(/&id=([^#]+)/u)?.[1] ?? null;
  if (!rawIdentity) throw migrationError('MISSING_LEGACY_THING_IDENTITY', 'Every migrated Thing requires one identity');
  if (LEGACY_ID.test(rawIdentity)) {
    const field = axisField(atom, 'thing', 'legacy-22-migration');
    return { contract: 'legacy-22', field, identity: field.parsed.identity };
  }
  const field = axisField(atom, 'thing', 'short');
  return { contract: 'base62-short', field, identity: field.parsed.identity };
}

function scanFacts(facts) {
  if (!Array.isArray(facts)) {
    throw migrationError('INVALID_THING_IDENTITY_MIGRATION_SOURCE', 'Thing identity migration requires one Atom array');
  }
  const records = [];
  function visit(atom, parentPath) {
    if (!atom || typeof atom !== 'object' || Array.isArray(atom)) {
      throw migrationError('INVALID_THING_IDENTITY_MIGRATION_SOURCE', 'Migration encountered a non-Thing slot item');
    }
    const identity = classifyThing(atom);
    const name = identity.field.value;
    if (typeof name !== 'string' || !name) {
      throw migrationError('INVALID_THING_IDENTITY_MIGRATION_SOURCE', 'Migrated Thing names must be non-empty strings');
    }
    const path = [...parentPath, name];
    records.push({ atom, path, ...identity });
    const contract = identity.contract === 'legacy-22' ? 'legacy-22-migration' : 'short';
    const slot = axisField(atom, 'slot', contract).value;
    if (!Array.isArray(slot)) {
      throw migrationError('INVALID_THING_IDENTITY_MIGRATION_SOURCE', 'Migrated slot axes must be arrays');
    }
    for (const child of slot) visit(child, path);
  }
  for (const atom of facts) visit(atom, []);
  const contracts = new Set(records.map(({ contract }) => contract));
  if (contracts.size > 1) {
    throw migrationError('MIXED_THING_IDENTITY_GENERATION', 'Legacy and short Thing identities cannot coexist');
  }
  const identities = records.map(({ identity }) => identity);
  if (new Set(identities).size !== identities.length) {
    throw migrationError('DUPLICATE_THING_IDENTITY', 'Migration requires unique source identities');
  }
  return { records, contract: records[0]?.contract ?? 'base62-short' };
}

function persistentThingKey(parsed, identity) {
  return `thing${parsed.types.map(type => `@${type.raw}`).join('')}&id=${identity}${
    parsed.descriptionPresent ? `#${parsed.description}` : ''
  }`;
}

function rewriteStrutValue(value, identityMap) {
  if (Array.isArray(value)) return value.map(item => rewriteStrutValue(item, identityMap));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([rawKey, child]) => {
    const parsed = parseAtomKey(rawKey, {
      descriptionSymbolWarnings: false,
      identityContract: 'legacy-22-migration'
    });
    if (parsed.baseKey !== 'thing') return [rawKey, rewriteStrutValue(child, identityMap)];
    if (parsed.errors.length || !parsed.identity) {
      throw migrationError('UNBOUND_STRUT_ENDPOINT', 'Every migrated Strut endpoint requires one legacy target identity');
    }
    const nextIdentity = identityMap.get(parsed.identity);
    if (!nextIdentity) throw migrationError('DANGLING_STRUT_ENDPOINT', 'A Strut endpoint targets a missing Thing');
    return [persistentThingKey(parsed, nextIdentity), rewriteStrutValue(child, identityMap)];
  }));
}

function rewriteShortcutSituation(rawSituation, identityMap) {
  let metadata;
  try { metadata = JSON.parse(rawSituation); }
  catch { throw migrationError('INVALID_SHORTCUT_RECORD', 'A migrated Shortcut has invalid metadata'); }
  const targetIdentity = metadata?.target?.identity;
  if (typeof targetIdentity !== 'string' || !targetIdentity) {
    throw migrationError('UNBOUND_SHORTCUT_TARGET', 'Every migrated Shortcut target requires one legacy identity');
  }
  const nextIdentity = identityMap.get(targetIdentity);
  if (!nextIdentity) throw migrationError('DANGLING_SHORTCUT_TARGET', 'A Shortcut targets a missing Thing');
  return JSON.stringify({ ...metadata, target: { ...metadata.target, identity: nextIdentity } });
}

function rewriteFacts(facts, identityMap) {
  function rewriteAtom(atom) {
    const thing = axisField(atom, 'thing', 'legacy-22-migration');
    const nextIdentity = identityMap.get(thing.parsed.identity);
    const types = new Set(thing.parsed.types.map(type => type.raw));
    return Object.fromEntries(Object.entries(atom).map(([rawKey, value]) => {
      const parsed = parseAtomKey(rawKey, {
        descriptionSymbolWarnings: false,
        identityContract: 'legacy-22-migration'
      });
      if (parsed.baseKey === 'thing') return [persistentThingKey(parsed, nextIdentity), value];
      if (parsed.baseKey === 'slot') return [rawKey, value.map(rewriteAtom)];
      if (parsed.baseKey === 'strut') return [rawKey, rewriteStrutValue(value, identityMap)];
      if (parsed.baseKey === 'situation' && types.has('shortcut')) {
        return [rawKey, rewriteShortcutSituation(value, identityMap)];
      }
      return [rawKey, structuredClone(value)];
    }));
  }
  return facts.map(rewriteAtom);
}

function bindingReplacements(programRefBindings) {
  if (programRefBindings == null) return [];
  if (Array.isArray(programRefBindings.replacements)) return programRefBindings.replacements;
  if (typeof programRefBindings.entries === 'function') {
    return programRefBindings.entries().map(([, binding]) => binding);
  }
  if (Array.isArray(programRefBindings)) return programRefBindings;
  throw migrationError('INVALID_PROGRAM_REF_BINDING', 'Migration requires one Program binding snapshot');
}

function rewriteBindings(bindings, records, identityMap) {
  const byIdentity = new Map(records.map(record => [record.identity, record]));
  const programRecords = records.filter(({ field }) => field.parsed.types.some(type => type.raw === 'program'));
  const byOwner = new Map();
  for (const binding of bindingReplacements(bindings)) {
    if (byOwner.has(binding.programThingId)) {
      throw migrationError('INVALID_PROGRAM_REF_BINDING', 'Program binding owners must be unique');
    }
    const owner = byIdentity.get(binding.programThingId);
    if (!owner || !owner.field.parsed.types.some(type => type.raw === 'program')) {
      throw migrationError('PROGRAM_REF_OWNER_MISSING', 'Program binding owner is missing');
    }
    const situation = axisField(owner.atom, 'situation', 'legacy-22-migration').value;
    const sourceHash = `sha256:${createHash('sha256').update(situation).digest('hex')}`;
    if (binding.sourceHash !== sourceHash) {
      throw migrationError('PROGRAM_REF_SOURCE_MISMATCH', 'Program binding source hash does not match');
    }
    const sites = binding.sites.map(site => {
      const targetThingId = identityMap.get(site.targetThingId);
      if (!targetThingId) throw migrationError('PROGRAM_REF_TARGET_MISSING', 'Program binding target is missing');
      return { ...site, targetThingId };
    });
    byOwner.set(binding.programThingId, {
      ...binding,
      programThingId: identityMap.get(binding.programThingId),
      sites
    });
  }
  if (programRecords.some(({ identity }) => !byOwner.has(identity))) {
    throw migrationError('PROGRAM_REF_BINDING_MISSING', 'Every migrated Program requires one binding entry');
  }
  return createProgramRefBindingUpdate({ replacements: [...byOwner.values()] });
}

function topology(records) {
  return records.map(({ atom, path, contract }) => ({
    path: path.join('/'),
    childCount: axisField(atom, 'slot', contract === 'legacy-22' ? 'legacy-22-migration' : 'short').value.length
  }));
}

export function planShortThingIdentityMigration({
  facts,
  programRefBindings = null,
  sourceWatermark = '000',
  expectedThingCount = null
}) {
  const sourceRevision = revisionOfWorldFacts(facts);
  const scanned = scanFacts(facts);
  if (expectedThingCount != null && scanned.records.length !== expectedThingCount) {
    throw migrationError('THING_IDENTITY_MIGRATION_COUNT_MISMATCH', 'Migrated Thing count does not match the deployment expectation', {
      expectedThingCount,
      actualThingCount: scanned.records.length
    });
  }
  if (scanned.contract === 'base62-short') {
    const clonedFacts = structuredClone(facts);
    projectAtomContext(clonedFacts);
    return Object.freeze({
      changed: false,
      sourceRevision,
      nextRevision: sourceRevision,
      facts: clonedFacts,
      identityMap: new Map(),
      nextBindings: createProgramRefBindingUpdate({ replacements: bindingReplacements(programRefBindings) }),
      receipt: null,
      summary: Object.freeze({
        thingCount: scanned.records.length,
        uniqueShortIdentityCount: scanned.records.length,
        topologyPreserved: true,
        activeLegacyIdentityCount: 0,
        allocatorWatermark: sourceWatermark
      })
    });
  }
  if (sourceWatermark !== '000') {
    throw migrationError('INVALID_THING_ID_MIGRATION_WATERMARK', 'Legacy cutover must start from watermark 000');
  }
  const sourceTopology = topology(scanned.records);
  const allocation = planThingIdAllocation({ watermark: '000', count: scanned.records.length });
  const identityMap = new Map(scanned.records.map((record, index) => [record.identity, allocation.ids[index]]));
  const nextBindings = rewriteBindings(programRefBindings, scanned.records, identityMap);
  const nextFacts = rewriteFacts(facts, identityMap);
  projectAtomContext(nextFacts);
  const nextScan = scanFacts(nextFacts);
  const nextRevision = revisionOfWorldFacts(nextFacts);
  const thingIdentityAllocator = thingIdentityAllocatorUpdate({ previousWatermark: '000', ids: allocation.ids });
  const thingIdentityMigration = Object.freeze({
    version: 1,
    sourceContract: 'base64url-22',
    targetContract: 'base62-short',
    thingCount: scanned.records.length,
    sourceRevision,
    targetRevision: nextRevision,
    allocatorWatermark: allocation.nextWatermark
  });
  return Object.freeze({
    changed: true,
    sourceRevision,
    nextRevision,
    facts: nextFacts,
    identityMap,
    nextBindings,
    receipt: Object.freeze({ thingIdentityMigration, thingIdentityAllocator, programRefBindings: nextBindings }),
    summary: Object.freeze({
      thingCount: scanned.records.length,
      uniqueShortIdentityCount: new Set(allocation.ids).size,
      topologyPreserved: JSON.stringify(sourceTopology) === JSON.stringify(topology(nextScan.records)),
      activeLegacyIdentityCount: nextScan.records.filter(record => record.contract === 'legacy-22').length,
      allocatorWatermark: allocation.nextWatermark
    })
  });
}
