import { createHash } from 'node:crypto';
import { collectDefaultBackupBoundary } from './default-backup-boundary.mjs';
import { storedField } from './slot-graph-semantics.mjs';
import { parseThingSelector } from './thing-selector.mjs';

const hash = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;
const empty = Object.freeze([]);

function immutable(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) immutable(child);
  return Object.freeze(value);
}

function bindProgram({ programThingId, programPath, sourceHash }, binding, pathByThingId) {
  try {
    if (!binding) {
      throw Object.assign(new Error('Program reference binding metadata is missing'), {
        code: 'PROGRAM_REF_BINDING_MISSING'
      });
    }
    if (binding.sourceHash !== sourceHash) {
      throw Object.assign(new Error('Program reference binding source does not match its Situation'), {
        code: 'PROGRAM_REF_SOURCE_MISMATCH'
      });
    }
    const sites = binding.sites.map((site) => {
      const exactPath = pathByThingId.get(site.targetThingId);
      if (!exactPath) {
        throw Object.assign(new Error('Program reference target is missing'), {
          code: 'PROGRAM_REF_TARGET_MISSING',
          details: { fingerprint: site.fingerprint, role: site.role }
        });
      }
      return immutable({ ...structuredClone(site), programThingId, programPath, sourceHash, exactPath });
    });
    return { sites: Object.freeze(sites), failure: null };
  } catch (error) {
    return { sites: empty, failure: immutable({ programThingId, programPath, sourceHash,
      code: error.code ?? 'INVALID_PROGRAM_REFERENCE_SITE', message: error.message,
      details: structuredClone(error.details ?? {}) }) };
  }
}

// A Program that predates kernel bindings (or was created outside a bound
// write) derives its reference sites once, from the current world, so it stays
// usable; the next write persists the same binding as kernel metadata.
async function deriveBinding({ programThingId, programPath, source, sourceHash }, inspectProgram, pathByThingId) {
  if (typeof inspectProgram !== 'function') return null;
  const inspected = await inspectProgram({ source, programPath });
  if (!inspected || inspected.sourceHash !== sourceHash) return null;
  const byPath = [...pathByThingId.entries()].map(([id, path]) => ({ id, path }));
  const sites = inspected.sites.map((site) => {
    const identitySelector = site.selector?.startsWith('@')
      ? parseThingSelector(site.selector)
      : null;
    if (identitySelector?.kind === 'invalid-identity') return null;
    const rooted = site.selector?.startsWith('世界之外/');
    const selector = rooted ? site.selector.slice('世界之外/'.length) : site.selector;
    const matches = identitySelector?.kind === 'identity'
      ? byPath.filter(({ id }) => id === identitySelector.identity)
      : byPath.filter(({ path }) => (rooted
        ? path === selector
        : path === selector || path.endsWith(`/${selector}`)));
    if (matches.length !== 1) return null;
    return { fingerprint: site.fingerprint, role: site.role, targetThingId: matches[0].id };
  });
  if (sites.some((site) => site === null)) return null;
  return { programThingId, sourceHash, sites };
}

function snapshot(pathByThingId, owners, failuresByOwner) {
  const reverse = new Map();
  for (const sites of owners.values()) for (const site of sites) {
    if (!reverse.has(site.targetThingId)) reverse.set(site.targetThingId, []);
    reverse.get(site.targetThingId).push(site);
  }
  for (const sites of reverse.values()) Object.freeze(sites);
  return Object.freeze({
    failures: Object.freeze([...failuresByOwner.values()]),
    sitesForProgram: (id) => owners.get(id) ?? empty,
    sitesForTargets: (ids) => Object.freeze([...new Set(ids)].flatMap(id => reverse.get(id) ?? empty)),
    withoutProgram(programThingId) {
      const nextOwners = new Map(owners);
      const nextFailures = new Map(failuresByOwner);
      nextOwners.delete(programThingId);
      nextFailures.delete(programThingId);
      return snapshot(pathByThingId, nextOwners, nextFailures);
    },
    transition({ relocations = [] } = {}) {
      const byId = new Map(relocations.map(change => [change.thingId, change.resultPath]));
      const nextPaths = new Map(pathByThingId);
      for (const [id, resultPath] of byId) nextPaths.set(id, resultPath);
      const nextOwners = new Map([...owners].map(([id, sites]) => [id, Object.freeze(sites.map(site => {
        const nextPath = byId.get(site.targetThingId);
        const programPath = byId.get(id) ?? site.programPath;
        return nextPath || programPath !== site.programPath
          ? immutable({ ...site, programPath, exactPath: nextPath ?? site.exactPath })
          : site;
      }))]));
      return snapshot(nextPaths, nextOwners, new Map(failuresByOwner));
    }
  });
}

// Disposable cache: persisted kernel bindings establish identity; paths only project readability.
export async function createProgramReferenceIndex(atoms, {
  bindings = null, pathByThingId = null, inspectProgram = null
} = {}) {
  const boundary = collectDefaultBackupBoundary(atoms);
  const currentPaths = pathByThingId instanceof Map
    ? new Map(pathByThingId)
    : new Map([...boundary.entriesByPath].flatMap(([path, entry]) => entry.identity ? [[entry.identity, path]] : []));
  const owners = new Map();
  const failures = new Map();
  for (const entry of boundary.entriesByPath.values()) {
    if (entry.inactive || !storedField(entry.atom, 'thing')?.parsed.types.some(type => type.raw === 'program')) continue;
      const source = storedField(entry.atom, 'situation')?.value ?? '';
      if (!source.trim()) continue;
      const sourceHash = hash(source);
      try {
        if (!entry.identity) {
          // Authors never maintain ids: a Program the world still carries
          // without one stays usable with literal selectors until a write
          // adopts its permanent identity; it is simply not indexed yet.
          continue;
        }
      const persisted = bindings?.forProgram?.(entry.identity) ?? null;
      const effective = persisted ?? await deriveBinding({
        programThingId: entry.identity, programPath: entry.path, source, sourceHash
      }, inspectProgram, currentPaths);
      const bound = bindProgram({ programThingId: entry.identity, programPath: entry.path, sourceHash },
        effective, currentPaths);
      owners.set(entry.identity, bound.sites);
      if (bound.failure) failures.set(entry.identity, bound.failure);
    } catch (error) {
      failures.set(entry.identity ?? entry.path, immutable({ programThingId: entry.identity, programPath: entry.path, sourceHash,
        code: error.code ?? 'PROGRAM_REFERENCE_INSPECTION_FAILED', message: error.message,
        details: structuredClone(error.details ?? {}) }));
    }
  }
  return snapshot(currentPaths, owners, failures);
}
