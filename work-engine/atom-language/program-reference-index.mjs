import { createHash } from 'node:crypto';
import { collectDefaultBackupBoundary } from './default-backup-boundary.mjs';
import { storedField } from './slot-graph-semantics.mjs';
import { inspectProgramReferenceSites } from './program-reference-runtime.mjs';

const hash = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;
const unroot = (path) => path.startsWith('世界之外/') ? path.slice('世界之外/'.length) : path;
const empty = Object.freeze([]);

function immutable(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) immutable(child);
  return Object.freeze(value);
}

function bindInspection(programThingId, inspection, targets) {
  const programPath = inspection.programPath ?? inspection.path ?? null;
  const { sourceHash } = inspection;
  try {
    const sites = (inspection.referenceSites ?? inspection.sites ?? []).map((site) => {
      const exactPath = site.exactPath ?? site.selector;
      const target = targets.get(unroot(exactPath));
      if (!target?.id || (site.targetThingId && site.targetThingId !== target.id)) {
        throw Object.assign(new Error(`Program reference target is missing: ${exactPath}`), {
          code: 'PROGRAM_REFERENCE_TARGET_MISSING', details: { selector: exactPath, role: site.role }
        });
      }
      return immutable({ ...structuredClone(site), programThingId, programPath, sourceHash,
        targetThingId: target.id, exactPath,
        positionFingerprint: `${site.role}:${JSON.stringify(site.astPath)}` });
    });
    return { sites: Object.freeze(sites), failure: null };
  } catch (error) {
    return { sites: empty, failure: immutable({ programThingId, programPath, sourceHash,
      code: error.code ?? 'INVALID_PROGRAM_REFERENCE_SITE', message: error.message,
      details: structuredClone(error.details ?? {}) }) };
  }
}

function snapshot(targets, owners, failuresByOwner) {
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
    withProgram(programThingId, inspection) {
      const bound = bindInspection(programThingId, inspection, targets);
      const nextOwners = new Map(owners);
      const nextFailures = new Map(failuresByOwner);
      nextOwners.set(programThingId, bound.sites);
      nextFailures.delete(programThingId);
      if (bound.failure) nextFailures.set(programThingId, bound.failure);
      return snapshot(targets, nextOwners, nextFailures);
    },
    withoutProgram(programThingId) {
      const nextOwners = new Map(owners);
      const nextFailures = new Map(failuresByOwner);
      nextOwners.delete(programThingId);
      nextFailures.delete(programThingId);
      return snapshot(targets, nextOwners, nextFailures);
    },
    transition({ relocations = [], changedPrograms = [] } = {}) {
      const byId = new Map(relocations.map(change => [change.thingId, change.resultPath]));
      const nextTargets = new Map();
      for (const [path, target] of targets) nextTargets.set(byId.get(target.id) ?? path, target);
      const nextOwners = new Map([...owners].map(([id, sites]) => [id, Object.freeze(sites.map(site => {
        const nextPath = byId.get(site.targetThingId);
        const programPath = byId.get(id) ?? site.programPath;
        return nextPath || programPath !== site.programPath
          ? immutable({ ...site, programPath, exactPath: nextPath
            ? `${site.exactPath.startsWith('世界之外/') ? '世界之外/' : ''}${nextPath}` : site.exactPath })
          : site;
      }))]));
      let result = snapshot(nextTargets, nextOwners, new Map(failuresByOwner));
      for (const { programThingId, inspection } of changedPrograms) {
        result = inspection == null ? result.withoutProgram(programThingId) : result.withProgram(programThingId, inspection);
      }
      return result;
    }
  });
}

// Rebuild-local cache: Situation and permanent Thing keys are the only inputs.
export async function createProgramReferenceIndex(atoms, { inspectProgram = inspectProgramReferenceSites } = {}) {
  const boundary = collectDefaultBackupBoundary(atoms);
  const targets = new Map([...boundary.entriesByPath].map(([path, entry]) => [path, { id: entry.identity }]));
  const owners = new Map();
  const failures = new Map();
  const inspections = new Map();
  for (const entry of boundary.entriesByPath.values()) {
    if (entry.inactive || !storedField(entry.atom, 'thing')?.parsed.types.some(type => type.raw === 'program')) continue;
    const source = storedField(entry.atom, 'situation')?.value ?? '';
    if (!source.trim()) continue;
    const sourceHash = hash(source);
    try {
      if (!entry.identity) throw Object.assign(new Error('Program reference indexing requires a permanent Thing identity'), {
        code: 'PROGRAM_REFERENCE_IDENTITY_REQUIRED'
      });
      if (!inspections.has(sourceHash)) {
        inspections.set(sourceHash, Promise.resolve().then(() => inspectProgram({ source, programPath: entry.path })));
      }
      const inspection = await inspections.get(sourceHash);
      if (inspection.sourceHash !== sourceHash) throw Object.assign(new Error('Program reference AST does not match its source'), {
        code: 'PROGRAM_REFERENCE_SOURCE_MISMATCH'
      });
      const bound = bindInspection(entry.identity, { ...inspection, programPath: entry.path }, targets);
      owners.set(entry.identity, bound.sites);
      if (bound.failure) failures.set(entry.identity, bound.failure);
    } catch (error) {
      failures.set(entry.identity ?? entry.path, immutable({ programThingId: entry.identity, programPath: entry.path, sourceHash,
        code: error.code ?? 'PROGRAM_REFERENCE_INSPECTION_FAILED', message: error.message,
        details: structuredClone(error.details ?? {}) }));
    }
  }
  return snapshot(targets, owners, failures);
}
