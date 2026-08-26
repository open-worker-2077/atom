import crypto from 'node:crypto';

import { revisionOfWorldFacts } from './world-revision.mjs';

const MANIFEST_CONTRACT = 'atom.graph-four-axis-compatibility-manifest';
const MANIFEST_VERSION = 2;

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(
    typeof value === 'string' ? value : JSON.stringify(value)
  ).digest('hex')}`;
}

function baseKey(rawKey) {
  return String(rawKey).match(/^[^@#$~]+/u)?.[0] ?? '';
}

function entryAt(atom, axis) {
  return Object.entries(atom ?? {}).find(([rawKey]) => baseKey(rawKey) === axis);
}

export function isLegacySupportEntry(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, 'verb') && typeof value.verb === 'string'
    && Object.hasOwn(value, 'object') && typeof value.object === 'string' && value.object.trim());
}

export function legacySupportFingerprint(entries) {
  return digest(entries);
}

export function scanCompatibilityFacts(facts) {
  const supportGroups = [];
  function visit(atom, parentPath = []) {
    const thingEntry = entryAt(atom, 'thing') ?? entryAt(atom, 'name');
    const containEntry = entryAt(atom, 'contain') ?? entryAt(atom, 'children');
    const supportEntry = entryAt(atom, 'support') ?? entryAt(atom, 'partners');
    const thing = thingEntry?.[1];
    const pathParts = [...parentPath, thing];
    const path = pathParts.join('/');
    const legacyEntries = Array.isArray(supportEntry?.[1])
      ? supportEntry[1].filter(isLegacySupportEntry)
      : [];
    if (legacyEntries.length) {
      supportGroups.push({
        path,
        fingerprint: legacySupportFingerprint(legacyEntries),
        entries: structuredClone(legacyEntries)
      });
    }
    for (const child of Array.isArray(containEntry?.[1]) ? containEntry[1] : []) visit(child, pathParts);
  }
  for (const atom of Array.isArray(facts) ? facts : [facts]) visit(atom);
  return { supportGroups };
}

function countedFingerprints(groups) {
  const counts = new Map();
  for (const group of groups) counts.set(group.fingerprint, (counts.get(group.fingerprint) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, occurrences]) => ({ fingerprint, occurrences }));
}

export function createCompatibilityManifest({
  sourceRevision,
  targetFacts
}) {
  const currentWorldRevision = revisionOfWorldFacts(targetFacts);
  const scanned = scanCompatibilityFacts(targetFacts);
  return Object.freeze({
    contract: MANIFEST_CONTRACT,
    version: MANIFEST_VERSION,
    sourceRevision,
    currentWorldRevision,
    legacySupport: countedFingerprints(scanned.supportGroups)
  });
}

export function validateCompatibilityManifest(manifest, facts) {
  if (manifest?.contract !== MANIFEST_CONTRACT || manifest.version !== MANIFEST_VERSION
      || Object.hasOwn(manifest, 'programs') || Object.hasOwn(manifest, 'isolatedRoots')) {
    throw problem('INVALID_GRAPH_COMPATIBILITY_MANIFEST', 'Graph compatibility manifest is invalid');
  }
  const actualRevision = revisionOfWorldFacts(facts);
  if (manifest.currentWorldRevision !== actualRevision) {
    throw problem('GRAPH_COMPATIBILITY_MANIFEST_REVISION_MISMATCH', 'Graph compatibility manifest does not match current world revision', {
      manifestRevision: manifest.currentWorldRevision,
      actualRevision
    });
  }
  const scanned = scanCompatibilityFacts(facts);
  const actualCounts = new Map(countedFingerprints(scanned.supportGroups)
    .map(({ fingerprint, occurrences }) => [fingerprint, occurrences]));
  for (const entry of manifest.legacySupport ?? []) {
    if ((actualCounts.get(entry.fingerprint) ?? 0) < entry.occurrences) {
      throw problem('GRAPH_COMPATIBILITY_PROVENANCE_MISMATCH', 'Trusted legacy-support provenance is missing from current facts', {
        fingerprint: entry.fingerprint,
        expectedOccurrences: entry.occurrences,
        actualOccurrences: actualCounts.get(entry.fingerprint) ?? 0
      });
    }
  }
  return true;
}

export function advanceCompatibilityManifest(manifest, currentFacts, nextFacts) {
  validateCompatibilityManifest(manifest, currentFacts);
  const scanned = scanCompatibilityFacts(nextFacts);
  const authorized = new Map((manifest.legacySupport ?? [])
    .map(({ fingerprint, occurrences }) => [fingerprint, occurrences]));
  const nextCounts = countedFingerprints(scanned.supportGroups).flatMap((entry) => {
    const occurrences = Math.min(entry.occurrences, authorized.get(entry.fingerprint) ?? 0);
    return occurrences ? [{ fingerprint: entry.fingerprint, occurrences }] : [];
  });
  return Object.freeze({
    ...structuredClone(manifest),
    currentWorldRevision: revisionOfWorldFacts(nextFacts),
    legacySupport: nextCounts
  });
}

export function compatibilityMetadata(manifest, facts) {
  validateCompatibilityManifest(manifest, facts);
  const remaining = new Map((manifest.legacySupport ?? [])
    .map(({ fingerprint, occurrences }) => [fingerprint, occurrences]));
  const trustedGroups = [];
  for (const group of scanCompatibilityFacts(facts).supportGroups) {
    const count = remaining.get(group.fingerprint) ?? 0;
    if (!count) continue;
    trustedGroups.push(group);
    remaining.set(group.fingerprint, count - 1);
  }
  return Object.freeze({
    contract: MANIFEST_CONTRACT,
    version: MANIFEST_VERSION,
    mode: 'versioned-compatibility',
    currentWorldRevision: manifest.currentWorldRevision,
    legacySupportPaths: Object.freeze(trustedGroups.map(({ path }) => path)),
    relations: Object.freeze(trustedGroups.flatMap((group) => group.entries.map((entry, ordinal) => Object.freeze({
      source: group.path, ordinal, verb: entry.verb, object: entry.object
    }))))
  });
}
