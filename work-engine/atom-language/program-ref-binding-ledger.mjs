function immutable(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) immutable(child);
  return Object.freeze(value);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`Program reference binding requires ${field}`), {
      code: 'INVALID_PROGRAM_REF_BINDING',
      details: { field }
    });
  }
  return value;
}

function normalizeSite(site) {
  return {
    fingerprint: requiredString(site?.fingerprint, 'fingerprint'),
    role: requiredString(site?.role, 'role'),
    targetThingId: requiredString(site?.targetThingId, 'targetThingId')
  };
}

function normalizeReplacement(replacement) {
  const sourceHash = requiredString(replacement?.sourceHash, 'sourceHash');
  if (!/^sha256:[0-9a-f]{64}$/u.test(sourceHash)) {
    throw Object.assign(new Error('Program reference binding sourceHash must be sha256'), {
      code: 'INVALID_PROGRAM_REF_BINDING',
      details: { field: 'sourceHash' }
    });
  }
  const sites = (replacement?.sites ?? []).map(normalizeSite);
  if (new Set(sites.map(({ fingerprint }) => fingerprint)).size !== sites.length) {
    throw Object.assign(new Error('Program reference binding fingerprints must be unique'), {
      code: 'INVALID_PROGRAM_REF_BINDING',
      details: { field: 'fingerprint' }
    });
  }
  return {
    programThingId: requiredString(replacement?.programThingId, 'programThingId'),
    sourceHash,
    sites
  };
}

export function createProgramRefBindingUpdate({ replacements = [], removals = [] } = {}) {
  const normalizedReplacements = replacements.map(normalizeReplacement);
  const normalizedRemovals = removals.map((id) => requiredString(id, 'programThingId'));
  const replacementIds = normalizedReplacements.map(({ programThingId }) => programThingId);
  if (new Set(replacementIds).size !== replacementIds.length
    || new Set(normalizedRemovals).size !== normalizedRemovals.length
    || normalizedRemovals.some((id) => replacementIds.includes(id))) {
    throw Object.assign(new Error('Program reference binding update contains duplicate owners'), {
      code: 'INVALID_PROGRAM_REF_BINDING',
      details: { field: 'programThingId' }
    });
  }
  return immutable({
    version: 1,
    replacements: normalizedReplacements,
    removals: normalizedRemovals
  });
}

function receiptOf(entry) {
  return entry?.receipt ?? entry;
}

function updateOf(entry) {
  const update = receiptOf(entry)?.result?.programRefBindings;
  if (update == null) return null;
  if (update.version !== 1 || !Array.isArray(update.replacements) || !Array.isArray(update.removals)) {
    throw Object.assign(new Error('Program reference binding receipt metadata is invalid'), {
      code: 'INVALID_PROGRAM_REF_BINDING'
    });
  }
  return createProgramRefBindingUpdate(update);
}

function hasIdentityMigrationBarrier(entry) {
  const barrier = receiptOf(entry)?.result?.thingIdentityMigration;
  if (barrier == null) return false;
  if (barrier.version !== 1
    || barrier.sourceContract !== 'base64url-22'
    || barrier.targetContract !== 'base62-short'
    || !Number.isSafeInteger(barrier.thingCount)
    || barrier.thingCount < 0
    || typeof barrier.sourceRevision !== 'string'
    || typeof barrier.targetRevision !== 'string'
    || typeof barrier.allocatorWatermark !== 'string'
    || updateOf(entry) == null) {
    throw Object.assign(new Error('Program reference binding migration barrier is invalid'), {
      code: 'INVALID_PROGRAM_REF_BINDING_MIGRATION'
    });
  }
  return true;
}

function replay(receipts) {
  const values = new Map();
  const migrationSnapshots = new Map();
  for (const entry of receipts ?? []) {
    const commandId = entry?.commandId ?? receiptOf(entry)?.commandId;
    if (hasIdentityMigrationBarrier(entry)) {
      migrationSnapshots.set(commandId, new Map(values));
      values.clear();
    }
    const rollback = receiptOf(entry)?.result?.thingIdentityMigrationRollback;
    if (rollback != null) {
      if (rollback.version !== 1 || typeof rollback.targetCommandId !== 'string'
        || !migrationSnapshots.has(rollback.targetCommandId)) {
        throw Object.assign(new Error('Program reference binding migration rollback is invalid'), {
          code: 'INVALID_PROGRAM_REF_BINDING_MIGRATION_ROLLBACK'
        });
      }
      values.clear();
      for (const [id, binding] of migrationSnapshots.get(rollback.targetCommandId)) {
        values.set(id, binding);
      }
    }
    const update = updateOf(entry);
    if (!update) continue;
    for (const id of update.removals) values.delete(id);
    for (const replacement of update.replacements) values.set(replacement.programThingId, replacement);
  }
  return values;
}

function currentProgramIds(currentPrograms) {
  if (currentPrograms == null) return null;
  const ids = new Set();
  for (const program of currentPrograms) {
    const id = typeof program === 'string' ? program : program?.programThingId;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

function bindingSnapshot(values) {
  const frozen = new Map([...values].map(([id, binding]) => [id, immutable(structuredClone(binding))]));
  const programIds = Object.freeze([...frozen.keys()]);
  return Object.freeze({
    programIds,
    forProgram(programThingId) {
      return frozen.get(programThingId) ?? null;
    },
    entries() {
      return Object.freeze(programIds.map((id) => Object.freeze([id, frozen.get(id)])));
    }
  });
}

export function rebuildProgramRefBindings(receipts, currentPrograms = null) {
  const values = replay(receipts);
  const currentIds = currentProgramIds(currentPrograms);
  if (currentIds) for (const id of values.keys()) if (!currentIds.has(id)) values.delete(id);
  return bindingSnapshot(values);
}

export function programRefBindingsForRollback(receipts, targetCommandId) {
  const entries = [...(receipts ?? [])];
  const targetIndex = entries.findIndex((entry) => (
    (entry?.commandId ?? receiptOf(entry)?.commandId) === targetCommandId
  ));
  if (targetIndex < 0) return null;
  if (hasIdentityMigrationBarrier(entries[targetIndex])) return null;
  const targetUpdate = updateOf(entries[targetIndex]);
  if (!targetUpdate) return null;
  const before = replay(entries.slice(0, targetIndex));
  const affected = [...new Set([
    ...targetUpdate.replacements.map(({ programThingId }) => programThingId),
    ...targetUpdate.removals
  ])];
  return createProgramRefBindingUpdate({
    replacements: affected.flatMap((id) => before.has(id) ? [before.get(id)] : []),
    removals: affected.filter((id) => !before.has(id))
  });
}

export function redactProgramRefBindings(value) {
  if (value == null) return value;
  const copy = structuredClone(value);
  const redactReceipt = (receipt) => {
    if (!receipt?.result || typeof receipt.result !== 'object') return;
    delete receipt.result.programRefBindings;
  };
  redactReceipt(copy);
  redactReceipt(copy.receipt);
  redactReceipt(copy.sourceReceipt);
  redactReceipt(copy.childReceipt);
  if (Array.isArray(copy)) for (const entry of copy) {
    redactReceipt(entry);
    redactReceipt(entry?.receipt);
    redactReceipt(entry?.sourceReceipt);
    redactReceipt(entry?.childReceipt);
  }
  return copy;
}
