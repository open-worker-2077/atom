import crypto from 'node:crypto';

import { validateRequestDrivenLockSnapshot } from '../public/request-driven-lock-contract.mjs';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import { createCompatibilityManifest } from '../world-runtime/legacy-graph-compat.mjs';

const REQUEST_DRIVEN_LOCK_AXIS_MAP = Object.freeze({
  name: 'thing',
  detail: 'situation',
  children: 'contain',
  partners: 'support'
});
const LEGACY_REQUEST_DRIVEN_LOCK_AXES = new Set(Object.keys(REQUEST_DRIVEN_LOCK_AXIS_MAP));
const CURRENT_REQUEST_DRIVEN_LOCK_AXES = new Set(Object.values(REQUEST_DRIVEN_LOCK_AXIS_MAP));
const REQUEST_DRIVEN_LOCK_FIELDS = new Set([
  ...LEGACY_REQUEST_DRIVEN_LOCK_AXES,
  ...CURRENT_REQUEST_DRIVEN_LOCK_AXES,
  'messages'
]);

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function planRequestDrivenLockFourAxisMigration(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || snapshot.version !== 1 || !Array.isArray(snapshot.locks)) {
    throw problem(
      'INVALID_REQUEST_DRIVEN_LOCK_MIGRATION_SNAPSHOT',
      'Request-driven lock migration requires one version 1 snapshot'
    );
  }
  let fields = 0;
  let migratedFields = 0;
  const next = structuredClone(snapshot);
  for (const [lockIndex, lock] of next.locks.entries()) {
    if (!lock || typeof lock !== 'object' || Array.isArray(lock)
      || !Array.isArray(lock.fields) || lock.fields.length === 0
      || lock.fields.some((field) => typeof field !== 'string'
        || !REQUEST_DRIVEN_LOCK_FIELDS.has(field))) {
      throw problem(
        'INVALID_REQUEST_DRIVEN_LOCK_MIGRATION_SNAPSHOT',
        'Request-driven lock migration snapshot contains invalid fields',
        { lockIndex }
      );
    }
    const legacyAxes = lock.fields.filter((field) => LEGACY_REQUEST_DRIVEN_LOCK_AXES.has(field));
    const currentAxes = lock.fields.filter((field) => CURRENT_REQUEST_DRIVEN_LOCK_AXES.has(field));
    if (legacyAxes.length > 0 && currentAxes.length > 0) {
      throw problem(
        'AMBIGUOUS_REQUEST_DRIVEN_LOCK_GRAPH_AXIS',
        'Request-driven lock fields cannot mix retired and current Graph axes',
        { lockIndex, legacyAxes, currentAxes }
      );
    }
    const mappedLegacyAxes = legacyAxes.map((field) => REQUEST_DRIVEN_LOCK_AXIS_MAP[field]);
    if (new Set(mappedLegacyAxes).size !== mappedLegacyAxes.length) {
      throw problem(
        'AMBIGUOUS_REQUEST_DRIVEN_LOCK_GRAPH_AXIS',
        'Request-driven lock field migration cannot produce duplicate Graph axes',
        { lockIndex, legacyAxes }
      );
    }
    fields += lock.fields.length;
    lock.fields = lock.fields.map((field) => {
      if (!LEGACY_REQUEST_DRIVEN_LOCK_AXES.has(field)) return field;
      migratedFields += 1;
      return REQUEST_DRIVEN_LOCK_AXIS_MAP[field];
    });
  }
  try {
    validateRequestDrivenLockSnapshot(next);
  } catch (error) {
    throw problem(
      'INVALID_REQUEST_DRIVEN_LOCK_MIGRATION_SNAPSHOT',
      'Request-driven lock migration result is not valid for the four-axis repository',
      { cause: error.code ?? error.name }
    );
  }
  const sourceHash = digest(snapshot);
  const nextHash = digest(next);
  return Object.freeze({
    contract: 'atom.request-driven-lock-four-axis-migration-plan',
    version: 1,
    sourceHash,
    nextHash,
    snapshot: structuredClone(next),
    summary: Object.freeze({
      locks: next.locks.length,
      fields,
      migratedFields,
      changed: sourceHash !== nextHash
    })
  });
}

export function planGraphFourAxisWorldMigration({
  snapshot, planner, testRoots = [], requestDrivenLockSnapshot = null
}) {
  if (!snapshot || !Array.isArray(snapshot.facts) || typeof snapshot.revision !== 'string') {
    throw problem('INVALID_GRAPH_MIGRATION_SNAPSHOT', 'Migration planning requires one revision-bound world snapshot');
  }
  const actualRevision = revisionOfWorldFacts(snapshot.facts);
  if (snapshot.revision !== actualRevision) {
    throw problem('GRAPH_MIGRATION_REVISION_MISMATCH', 'Migration snapshot revision does not match its facts', {
      expectedRevision: snapshot.revision, actualRevision
    });
  }
  if (typeof planner !== 'function') {
    throw problem('GRAPH_MIGRATION_PLANNER_REQUIRED', 'Migration planning requires an injected legacy Graph planner');
  }
  const { graph: facts, summary } = planner(snapshot.facts, { testRoots });
  const nextRevision = revisionOfWorldFacts(facts);
  const compatibilityManifest = createCompatibilityManifest({
    sourceRevision: snapshot.revision,
    targetFacts: facts
  });
  const requestDrivenLocks = requestDrivenLockSnapshot === null
    ? null
    : planRequestDrivenLockFourAxisMigration(requestDrivenLockSnapshot);
  const migrationId = `graph-four-axis-${digest({
    sourceRevision: snapshot.revision,
    nextRevision,
    summary,
    requestDrivenLocks: requestDrivenLocks
      ? { sourceHash: requestDrivenLocks.sourceHash, nextHash: requestDrivenLocks.nextHash }
      : null
  }).slice('sha256:'.length, 'sha256:'.length + 20)}`;
  return Object.freeze({
    contract: 'atom.graph-four-axis-migration-plan', version: 1, migrationId,
    expectedRevision: snapshot.revision, nextRevision,
    sourceFactsHash: digest(snapshot.facts), nextFactsHash: digest(facts),
    sourceFacts: structuredClone(snapshot.facts), facts: structuredClone(facts),
    summary: structuredClone(summary),
    compatibilityManifest: structuredClone(compatibilityManifest),
    ...(requestDrivenLocks ? { requestDrivenLocks: structuredClone(requestDrivenLocks) } : {})
  });
}

export async function applyGraphFourAxisWorldMigration({
  plan, confirmation = false, backup, persistence,
  requestDrivenLockPersistence = null, attemptId = null, correlationId = null
}) {
  if (confirmation !== true) {
    throw problem('GRAPH_MIGRATION_CONFIRMATION_REQUIRED', 'Graph migration requires explicit confirmation');
  }
  if (plan?.contract !== 'atom.graph-four-axis-migration-plan' || plan.version !== 1) {
    throw problem('INVALID_GRAPH_MIGRATION_PLAN', 'A valid Graph migration plan is required');
  }
  if (plan.summary?.readyToCommit !== true) {
    throw problem('GRAPH_PROGRAM_SOURCE_UPGRADE_BLOCKED', 'Graph migration contains Programs that cannot be upgraded uniquely', {
      programs: structuredClone(plan.summary?.blockedPrograms ?? [])
    });
  }
  if (typeof backup?.create !== 'function' || typeof backup?.verify !== 'function') {
    throw problem('GRAPH_MIGRATION_BACKUP_REQUIRED', 'Graph migration requires a verifiable private backup port');
  }
  if (typeof persistence?.commit !== 'function' || typeof persistence?.rollback !== 'function') {
    throw problem('GRAPH_MIGRATION_TRANSACTION_REQUIRED', 'Graph migration requires transactional commit and rollback ports');
  }
  if (plan.requestDrivenLocks && (
    typeof requestDrivenLockPersistence?.commit !== 'function'
    || typeof requestDrivenLockPersistence?.rollback !== 'function'
  )) {
    throw problem(
      'GRAPH_MIGRATION_SIDECAR_TRANSACTION_REQUIRED',
      'Graph migration requires request-driven lock commit and rollback ports'
    );
  }
  const attemptScope = attemptId ?? correlationId;
  if (typeof attemptScope !== 'string' || attemptScope.length === 0) {
    throw problem(
      'GRAPH_MIGRATION_ATTEMPT_ID_REQUIRED',
      'Graph migration requires one explicit deployment attempt identity'
    );
  }
  const transactionCorrelationId = correlationId
    ?? `${plan.migrationId}:attempt:${attemptScope}`;
  const backupReceipt = await backup.create({
    migrationId: plan.migrationId, attemptId: attemptScope, revision: plan.expectedRevision,
    facts: structuredClone(plan.sourceFacts), factsHash: plan.sourceFactsHash,
    ...(plan.requestDrivenLocks ? {
      requestDrivenLocks: {
        sourceHash: plan.requestDrivenLocks.sourceHash,
        nextHash: plan.requestDrivenLocks.nextHash
      }
    } : {})
  });
  const verified = await backup.verify({
    receipt: backupReceipt, revision: plan.expectedRevision, factsHash: plan.sourceFactsHash
  });
  if (verified !== true) {
    throw problem('GRAPH_MIGRATION_BACKUP_VERIFICATION_FAILED', 'Private migration backup could not be verified');
  }
  const receipt = await persistence.commit({
    correlationId: transactionCorrelationId,
    expectedRevision: plan.expectedRevision, nextRevision: plan.nextRevision,
    facts: structuredClone(plan.facts),
    source: `graph-four-axis-migration:${plan.migrationId}`,
    compatibilityManifest: structuredClone(plan.compatibilityManifest)
  });
  let requestDrivenLocks = null;
  if (plan.requestDrivenLocks) {
    try {
      const sidecarReceipt = await requestDrivenLockPersistence.commit({
        plan: structuredClone(plan.requestDrivenLocks),
        backup: structuredClone(backupReceipt)
      });
      requestDrivenLocks = Object.freeze({
        sourceHash: plan.requestDrivenLocks.sourceHash,
        nextHash: plan.requestDrivenLocks.nextHash,
        receipt: structuredClone(sidecarReceipt)
      });
    } catch (error) {
      const compensation = {};
      try {
        compensation.requestDrivenLocks = await requestDrivenLockPersistence.rollback({
          plan: structuredClone(plan.requestDrivenLocks),
          backup: structuredClone(backupReceipt)
        });
      } catch (rollbackError) {
        compensation.requestDrivenLockError = rollbackError.code ?? rollbackError.name;
      }
      try {
        compensation.world = await persistence.rollback({
          targetCommandId: receipt.commandId,
          expectedRevision: receipt.afterRevision,
          correlationId: `${transactionCorrelationId}:sidecar-compensation`
        });
      } catch (rollbackError) {
        compensation.worldError = rollbackError.code ?? rollbackError.name;
      }
      throw problem(
        'GRAPH_MIGRATION_SIDECAR_COMMIT_FAILED',
        'Request-driven lock sidecar migration failed and triggered compensation',
        { cause: error.code ?? error.name, compensation }
      );
    }
  }
  return Object.freeze({
    migrationId: plan.migrationId, attemptId: attemptScope,
    sourceRevision: plan.expectedRevision,
    backup: structuredClone(backupReceipt), receipt: structuredClone(receipt),
    ...(requestDrivenLocks ? { requestDrivenLocks } : {}),
    rollback: Object.freeze({
      targetCommandId: receipt.commandId, expectedRevision: receipt.afterRevision
    })
  });
}

export async function rollbackGraphFourAxisWorldMigration({
  migration, persistence, requestDrivenLockPersistence = null, correlationId
}) {
  if (!migration?.rollback?.targetCommandId || !migration.rollback.expectedRevision) {
    throw problem('INVALID_GRAPH_MIGRATION_RECEIPT', 'Migration receipt is required for rollback');
  }
  if (typeof persistence?.rollback !== 'function') {
    throw problem('GRAPH_MIGRATION_TRANSACTION_REQUIRED', 'Graph migration rollback requires the transactional rollback port');
  }
  if (migration.requestDrivenLocks && typeof requestDrivenLockPersistence?.rollback !== 'function') {
    throw problem(
      'GRAPH_MIGRATION_SIDECAR_TRANSACTION_REQUIRED',
      'Graph migration rollback requires the request-driven lock rollback port'
    );
  }
  let receipt;
  let projectionError = null;
  try {
    receipt = await persistence.rollback({
      targetCommandId: migration.rollback.targetCommandId,
      expectedRevision: migration.rollback.expectedRevision,
      correlationId: correlationId ?? `${migration.migrationId}:rollback`
    });
  } catch (error) {
    if (error.code !== 'WORLD_COMMITTED_PROJECTION_PENDING'
      || error.details?.receipt?.status !== 'committed') throw error;
    receipt = error.details.receipt;
    projectionError = error;
  }
  if (!migration.requestDrivenLocks) {
    if (projectionError) throw projectionError;
    return receipt;
  }
  try {
    const requestDrivenLocks = await requestDrivenLockPersistence.rollback({
      migration: structuredClone(migration.requestDrivenLocks),
      backup: structuredClone(migration.backup)
    });
    const combinedReceipt = Object.freeze({
      ...receipt,
      requestDrivenLocks: structuredClone(requestDrivenLocks)
    });
    if (projectionError) {
      projectionError.details = Object.freeze({
        ...projectionError.details,
        receipt: combinedReceipt
      });
      throw projectionError;
    }
    return combinedReceipt;
  } catch (error) {
    if (error === projectionError) throw error;
    throw problem(
      'GRAPH_MIGRATION_SIDECAR_ROLLBACK_FAILED',
      'World rollback committed but request-driven lock sidecar restore failed',
      { cause: error.code ?? error.name, worldReceipt: structuredClone(receipt) }
    );
  }
}
