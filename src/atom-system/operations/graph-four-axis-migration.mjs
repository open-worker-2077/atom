import crypto from 'node:crypto';

import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import { createCompatibilityManifest } from '../world-runtime/legacy-graph-compat.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function planGraphFourAxisWorldMigration({ snapshot, planner, testRoots = [] }) {
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
  const migrationId = `graph-four-axis-${digest({
    sourceRevision: snapshot.revision, nextRevision, summary
  }).slice('sha256:'.length, 'sha256:'.length + 20)}`;
  return Object.freeze({
    contract: 'atom.graph-four-axis-migration-plan', version: 1, migrationId,
    expectedRevision: snapshot.revision, nextRevision,
    sourceFactsHash: digest(snapshot.facts), nextFactsHash: digest(facts),
    sourceFacts: structuredClone(snapshot.facts), facts: structuredClone(facts),
    summary: structuredClone(summary),
    compatibilityManifest: structuredClone(compatibilityManifest)
  });
}

export async function applyGraphFourAxisWorldMigration({
  plan, confirmation = false, backup, persistence, correlationId
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
  const backupReceipt = await backup.create({
    migrationId: plan.migrationId, revision: plan.expectedRevision,
    facts: structuredClone(plan.sourceFacts), factsHash: plan.sourceFactsHash
  });
  const verified = await backup.verify({
    receipt: backupReceipt, revision: plan.expectedRevision, factsHash: plan.sourceFactsHash
  });
  if (verified !== true) {
    throw problem('GRAPH_MIGRATION_BACKUP_VERIFICATION_FAILED', 'Private migration backup could not be verified');
  }
  const receipt = await persistence.commit({
    correlationId: correlationId ?? plan.migrationId,
    expectedRevision: plan.expectedRevision, nextRevision: plan.nextRevision,
    facts: structuredClone(plan.facts),
    source: `graph-four-axis-migration:${plan.migrationId}`,
    compatibilityManifest: structuredClone(plan.compatibilityManifest)
  });
  return Object.freeze({
    migrationId: plan.migrationId,
    backup: structuredClone(backupReceipt), receipt: structuredClone(receipt),
    rollback: Object.freeze({
      targetCommandId: receipt.commandId, expectedRevision: receipt.afterRevision
    })
  });
}

export function rollbackGraphFourAxisWorldMigration({ migration, persistence, correlationId }) {
  if (!migration?.rollback?.targetCommandId || !migration.rollback.expectedRevision) {
    throw problem('INVALID_GRAPH_MIGRATION_RECEIPT', 'Migration receipt is required for rollback');
  }
  if (typeof persistence?.rollback !== 'function') {
    throw problem('GRAPH_MIGRATION_TRANSACTION_REQUIRED', 'Graph migration rollback requires the transactional rollback port');
  }
  return persistence.rollback({
    targetCommandId: migration.rollback.targetCommandId,
    expectedRevision: migration.rollback.expectedRevision,
    correlationId: correlationId ?? `${migration.migrationId}:rollback`
  });
}
