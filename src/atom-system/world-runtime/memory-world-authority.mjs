import { isSealedWorldFacts, revisionOfWorldFacts } from './world-revision.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function sealedSnapshot(input) {
  if (!isSealedWorldFacts(input?.facts)
    || typeof input.revision !== 'string' || !input.revision) {
    throw problem('INVALID_WORLD_SNAPSHOT', 'Memory authority requires sealed facts and a revision');
  }
  if (revisionOfWorldFacts(input.facts) !== input.revision) {
    throw problem('INVALID_WORLD_REVISION', 'Memory snapshot revision does not match its facts');
  }
  return Object.freeze({
    facts: input.facts,
    revision: input.revision,
    compatibilityManifest: freeze(structuredClone(input.compatibilityManifest ?? null))
  });
}

export function createMemoryWorldAuthority({ initialSnapshot }) {
  let current = Object.freeze({ ...sealedSnapshot(initialSnapshot), version: 0 });
  let acceptedVersion = 0;
  let savedVersion = 0;
  let savedRevision = current.revision;
  const unsavedRevisions = new Map();
  const status = () => Object.freeze({ acceptedVersion, acceptedRevision: current.revision,
    savedVersion, savedRevision, dirty: acceptedVersion !== savedVersion });

  return Object.freeze({
    snapshot: () => current,
    status,
    accept({ expectedVersion, expectedRevision, nextSnapshot, receipt }) {
      if (expectedVersion !== acceptedVersion || expectedRevision !== current.revision) {
        throw problem('WORLD_REVISION_CONFLICT', 'Memory world changed before acceptance', {
          expectedVersion, expectedRevision,
          actualVersion: acceptedVersion, actualRevision: current.revision
        });
      }
      if (typeof receipt?.commandId !== 'string' || !receipt.commandId) {
        throw problem('INVALID_WORLD_RECEIPT', 'Memory acceptance requires a command receipt');
      }
      const next = sealedSnapshot(nextSnapshot);
      if (next.revision === current.revision) {
        throw problem('WORLD_TRANSITION_NO_CHANGE', 'Memory acceptance must change the world');
      }
      acceptedVersion += 1;
      current = Object.freeze({ ...next, version: acceptedVersion });
      unsavedRevisions.set(acceptedVersion, next.revision);
      return status();
    },
    markSaved({ version, revision }) {
      if (!Number.isSafeInteger(version) || version < 0 || version > acceptedVersion
        || typeof revision !== 'string') {
        throw problem('UNKNOWN_SAVED_REVISION', 'Saved version was not accepted by memory authority');
      }
      if (version <= savedVersion) return status();
      if (unsavedRevisions.get(version) !== revision) {
        throw problem('UNKNOWN_SAVED_REVISION', 'Saved version and revision do not match accepted memory');
      }
      savedVersion = version;
      savedRevision = revision;
      for (const pendingVersion of unsavedRevisions.keys()) {
        if (pendingVersion <= savedVersion) unsavedRevisions.delete(pendingVersion);
      }
      return status();
    }
  });
}
