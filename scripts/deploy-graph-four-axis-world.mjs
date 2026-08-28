import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';
import {
  applyGraphFourAxisWorldMigration,
  planGraphFourAxisWorldMigration,
  planRequestDrivenLockFourAxisMigration,
  rollbackGraphFourAxisWorldMigration
} from '../src/atom-system/operations/graph-four-axis-migration.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { planGraphFourAxisMigration } from '../work-engine/atom-language/graph-migration-planner.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function argumentsOf(name) {
  return process.argv.flatMap((value, index) => (
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  ));
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

async function copyIfPresent(source, destination) {
  try {
    await fs.copyFile(source, destination);
    return { source, destination, hash: hashBytes(await fs.readFile(destination)) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readIfPresent(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function replaceFileBytes(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function createRequestDrivenLockMigrationPersistence(file) {
  const repository = createJsonRequestDrivenLockRepository({ file });
  return Object.freeze({
    async commit({ plan }) {
      const currentBytes = await fs.readFile(file);
      const current = JSON.parse(currentBytes.toString('utf8'));
      const currentPlan = planRequestDrivenLockFourAxisMigration(current);
      if (currentPlan.sourceHash !== plan.sourceHash) {
        throw Object.assign(new Error('Request-driven lock snapshot changed after preflight'), {
          code: 'REQUEST_DRIVEN_LOCK_MIGRATION_REVISION_MISMATCH'
        });
      }
      if (plan.summary.changed) {
        await replaceFileBytes(file, Buffer.from(`${JSON.stringify(plan.snapshot, null, 2)}\n`, 'utf8'));
      }
      const stored = await repository.load();
      const storedHash = planRequestDrivenLockFourAxisMigration(stored).sourceHash;
      if (storedHash !== plan.nextHash) {
        throw Object.assign(new Error('Request-driven lock postcheck hash mismatch'), {
          code: 'REQUEST_DRIVEN_LOCK_MIGRATION_POSTCHECK_FAILED'
        });
      }
      return { file, sourceHash: plan.sourceHash, nextHash: storedHash, changed: plan.summary.changed };
    },
    async rollback({ backup }) {
      const entry = (backup?.files ?? []).find((candidate) => (
        path.resolve(candidate.source) === path.resolve(file)
      ));
      if (!entry) {
        throw Object.assign(new Error('Request-driven lock backup is missing'), {
          code: 'REQUEST_DRIVEN_LOCK_MIGRATION_BACKUP_MISSING'
        });
      }
      const bytes = await fs.readFile(entry.destination);
      if (hashBytes(bytes) !== entry.hash) {
        throw Object.assign(new Error('Request-driven lock backup hash mismatch'), {
          code: 'REQUEST_DRIVEN_LOCK_MIGRATION_BACKUP_INVALID'
        });
      }
      await replaceFileBytes(file, bytes);
      const restored = JSON.parse(bytes.toString('utf8'));
      return {
        file,
        restoredFileHash: entry.hash,
        restoredSnapshotHash: planRequestDrivenLockFourAxisMigration(restored).sourceHash
      };
    }
  });
}

function requireAttemptId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw Object.assign(new Error('Deployment attempt id must be a path-safe stable token'), {
      code: 'INVALID_GRAPH_MIGRATION_ATTEMPT_ID'
    });
  }
  return value;
}

async function currentRevision(contextFile) {
  const facts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  return revisionOfWorldFacts(facts);
}

async function restoreProjectionBackup({ deployment, graphFile }) {
  const backup = deployment.migration?.backup;
  const projection = backup?.projection;
  if (!backup?.directory || projection?.path !== graphFile) {
    throw Object.assign(new Error('Deployment receipt has no matching projection backup'), {
      code: 'GRAPH_MIGRATION_PROJECTION_BACKUP_REQUIRED'
    });
  }
  if (projection.present === false) {
    await fs.rm(graphFile, { force: true });
    return { restored: true, present: false };
  }
  const stored = path.join(backup.directory, 'graph.json');
  const bytes = await fs.readFile(stored);
  if (hashBytes(bytes) !== projection.hash) {
    throw Object.assign(new Error('Projection backup hash does not match its receipt'), {
      code: 'GRAPH_MIGRATION_PROJECTION_BACKUP_INVALID'
    });
  }
  await fs.copyFile(stored, graphFile);
  return { restored: true, present: true, hash: projection.hash };
}

async function rollbackWithProjectionTolerance(request) {
  try {
    return { receipt: await rollbackGraphFourAxisWorldMigration(request), projectionPending: false };
  } catch (error) {
    if (error.code !== 'WORLD_COMMITTED_PROJECTION_PENDING'
      || error.details?.receipt?.status !== 'committed') throw error;
    return { receipt: error.details.receipt, projectionPending: true };
  }
}

async function main() {
  const contextFile = path.resolve(argument('--context') ?? 'atom.json');
  const worldDirectory = path.dirname(contextFile);
  const graphFile = path.resolve(argument('--graph') ?? path.join(worldDirectory, 'graph.json'));
  const journalFile = path.resolve(argument('--journal') ?? path.join(worldDirectory, 'atom.transactions.json'));
  const requestDrivenLockFile = path.resolve(
    argument('--request-driven-locks') ?? path.join(worldDirectory, 'request-driven-locks.json')
  );
  const backupRoot = path.resolve(argument('--backup-root') ?? path.join(worldDirectory, 'migration-backups'));
  const testRoots = argumentsOf('--isolated-root');
  const rollbackReceipt = argument('--rollback');
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile: graphFile, journalFile });
  const requestDrivenLockPersistence = createRequestDrivenLockMigrationPersistence(requestDrivenLockFile);

  if (rollbackReceipt) {
    const deployment = JSON.parse(await fs.readFile(path.resolve(rollbackReceipt), 'utf8'));
    const beforeRevision = await currentRevision(contextFile);
    let alreadyAtSource = beforeRevision === deployment.sourceRevision;
    const atDeploymentTarget = beforeRevision === deployment.migration?.rollback?.expectedRevision;
    if (!alreadyAtSource && !atDeploymentTarget) {
      throw Object.assign(new Error('World advanced beyond this deployment attempt'), {
        code: 'ROLLBACK_WORLD_DIVERGED',
        details: {
          actualRevision: beforeRevision,
          sourceRevision: deployment.sourceRevision,
          targetRevision: deployment.migration?.rollback?.expectedRevision
        }
      });
    }
    let rolledBack = { receipt: null, projectionPending: false };
    let rollbackError = null;
    let restoredRequestDrivenLocks = null;
    if (!alreadyAtSource) {
      try {
        rolledBack = await rollbackWithProjectionTolerance({
          migration: deployment.migration,
          persistence,
          requestDrivenLockPersistence,
          correlationId: `${deployment.migration.migrationId}:attempt:${deployment.attemptId}:operator-rollback`
        });
        restoredRequestDrivenLocks = rolledBack.receipt?.requestDrivenLocks ?? null;
      } catch (error) {
        rollbackError = error;
      }
    }
    if (rollbackError?.code === 'ROLLBACK_WORLD_DIVERGED'
      && await currentRevision(contextFile) === deployment.sourceRevision) {
      rollbackError = null;
      alreadyAtSource = true;
    }
    if (alreadyAtSource && deployment.migration.requestDrivenLocks) {
      restoredRequestDrivenLocks = await requestDrivenLockPersistence.rollback({
        backup: deployment.migration.backup
      });
    }
    const projection = await restoreProjectionBackup({ deployment, graphFile });
    if (rollbackError) throw rollbackError;
    const revision = await currentRevision(contextFile);
    const sidecarOk = !deployment.migration.requestDrivenLocks
      || restoredRequestDrivenLocks?.restoredSnapshotHash
        === deployment.migration.requestDrivenLocks.sourceHash;
    const ok = revision === deployment.sourceRevision
      && (alreadyAtSource || rolledBack.receipt?.afterRevision === deployment.sourceRevision)
      && sidecarOk;
    process.stdout.write(`${JSON.stringify({
      ok, action: 'rollback', revision,
      alreadyAtSource,
      projection,
      requestDrivenLocks: restoredRequestDrivenLocks,
      projectionPending: rolledBack.projectionPending,
      receipt: rolledBack.receipt
    })}\n`);
    if (!ok) process.exitCode = 1;
    return;
  }

  const sourceBytes = await fs.readFile(contextFile);
  const sourceFacts = JSON.parse(sourceBytes.toString('utf8'));
  const sourceRevision = revisionOfWorldFacts(sourceFacts);
  const requestDrivenLockSourceBytes = await readIfPresent(requestDrivenLockFile);
  let requestDrivenLockSnapshot = null;
  if (requestDrivenLockSourceBytes) {
    try {
      requestDrivenLockSnapshot = JSON.parse(requestDrivenLockSourceBytes.toString('utf8'));
    } catch (error) {
      throw Object.assign(new Error('Request-driven lock migration snapshot is not valid JSON'), {
        code: 'INVALID_REQUEST_DRIVEN_LOCK_MIGRATION_SNAPSHOT',
        cause: error
      });
    }
  }
  const plan = planGraphFourAxisWorldMigration({
    snapshot: { revision: sourceRevision, facts: sourceFacts },
    planner: planGraphFourAxisMigration,
    testRoots,
    requestDrivenLockSnapshot
  });
  const preflight = {
    ok: plan.summary.readyToCommit === true,
    action: process.argv.includes('--apply') ? 'apply' : 'preflight',
    contextFile,
    sourceRevision,
    sourceFileHash: hashBytes(sourceBytes),
    nextRevision: plan.nextRevision,
    counts: plan.summary.counts,
    testRoots,
    requestDrivenLocks: plan.requestDrivenLocks ? {
      file: requestDrivenLockFile,
      sourceHash: plan.requestDrivenLocks.sourceHash,
      nextHash: plan.requestDrivenLocks.nextHash,
      ...plan.requestDrivenLocks.summary
    } : { file: requestDrivenLockFile, present: false }
  };
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`${JSON.stringify(preflight)}\n`);
    return;
  }

  const attemptId = requireAttemptId(argument('--attempt-id') ?? crypto.randomUUID());
  preflight.attemptId = attemptId;

  let backupDirectory;
  const backup = {
    async create(request) {
      backupDirectory = path.join(backupRoot, request.migrationId, request.attemptId);
      await fs.mkdir(backupRoot, { recursive: true });
      await fs.mkdir(path.dirname(backupDirectory), { recursive: true });
      try {
        await fs.mkdir(backupDirectory, { recursive: false });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = JSON.parse(await fs.readFile(
          path.join(backupDirectory, 'backup-receipt.json'), 'utf8'
        ));
        if (existing.migrationId !== request.migrationId
          || existing.attemptId !== request.attemptId
          || existing.revision !== request.revision
          || existing.factsHash !== request.factsHash
          || existing.sourceFileHash !== hashBytes(sourceBytes)
          || existing.directory !== backupDirectory
          || existing.projection?.path !== graphFile) {
          throw Object.assign(new Error('Existing deployment attempt backup does not match this plan'), {
            code: 'GRAPH_MIGRATION_ATTEMPT_BACKUP_CONFLICT'
          });
        }
        return existing;
      }
      const files = (await Promise.all([
        copyIfPresent(contextFile, path.join(backupDirectory, 'atom.json')),
        copyIfPresent(graphFile, path.join(backupDirectory, 'graph.json')),
        copyIfPresent(journalFile, path.join(backupDirectory, 'atom.transactions.json')),
        copyIfPresent(path.join(worldDirectory, 'knowledge.json'), path.join(backupDirectory, 'knowledge.json')),
        copyIfPresent(path.join(worldDirectory, 'program-projection.json'), path.join(backupDirectory, 'program-projection.json')),
        copyIfPresent(requestDrivenLockFile, path.join(backupDirectory, 'request-driven-locks.json'))
      ])).filter(Boolean);
      const receipt = {
        contract: 'atom.graph-four-axis-private-backup', version: 1,
        migrationId: request.migrationId,
        attemptId: request.attemptId,
        revision: request.revision,
        factsHash: request.factsHash,
        sourceFileHash: hashBytes(sourceBytes),
        directory: backupDirectory,
        projection: {
          path: graphFile,
          present: files.some((file) => file.source === graphFile),
          ...(files.find((file) => file.source === graphFile)?.hash
            ? { hash: files.find((file) => file.source === graphFile).hash }
            : {})
        },
        files
      };
      await fs.writeFile(
        path.join(backupDirectory, 'backup-receipt.json'),
        `${JSON.stringify(receipt, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' }
      );
      return receipt;
    },
    async verify({ receipt, revision, factsHash }) {
      const copied = await fs.readFile(path.join(receipt.directory, 'atom.json'));
      const facts = JSON.parse(copied.toString('utf8'));
      const sidecar = receipt.files.find((entry) => path.resolve(entry.source) === requestDrivenLockFile);
      const sidecarVerified = requestDrivenLockSourceBytes === null
        ? sidecar === undefined
        : sidecar?.hash === hashBytes(requestDrivenLockSourceBytes)
          && sidecar.hash === hashBytes(await fs.readFile(sidecar.destination));
      return receipt.revision === revision
        && receipt.factsHash === factsHash
        && revisionOfWorldFacts(facts) === revision
        && receipt.sourceFileHash === hashBytes(copied)
        && sidecarVerified;
    }
  };

  let migration;
  try {
    migration = await applyGraphFourAxisWorldMigration({
      plan,
      confirmation: true,
      backup,
      persistence,
      requestDrivenLockPersistence,
      attemptId
    });
    const deployedFacts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
    const deployedRevision = revisionOfWorldFacts(deployedFacts);
    const manifest = await persistence.compatibilityManifest();
    const result = {
      ...preflight,
      ok: deployedRevision === plan.nextRevision
        && manifest?.currentWorldRevision === plan.nextRevision,
      deployedRevision,
      backupDirectory,
      migration,
      manifest
    };
    const receiptFile = path.join(backupDirectory, 'deployment-receipt.json');
    await fs.writeFile(receiptFile, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx'
    });
    process.stdout.write(`${JSON.stringify({ ...result, receiptFile })}\n`);
    if (!result.ok) throw Object.assign(new Error('Post-migration verification failed'), { code: 'GRAPH_MIGRATION_POSTCHECK_FAILED' });
  } catch (error) {
    if (migration) {
      let rolledBack = { receipt: null, projectionPending: false };
      let rollbackError = null;
      let restoredRequestDrivenLocks = null;
      const beforeRevision = await currentRevision(contextFile);
      let alreadyAtSource = beforeRevision === sourceRevision;
      const atDeploymentTarget = beforeRevision === migration.rollback.expectedRevision;
      if (atDeploymentTarget) {
        try {
          rolledBack = await rollbackWithProjectionTolerance({
            migration,
            persistence,
            requestDrivenLockPersistence,
            correlationId: `${migration.migrationId}:attempt:${attemptId}:failure-compensation`
          });
          restoredRequestDrivenLocks = rolledBack.receipt?.requestDrivenLocks ?? null;
        } catch (failure) {
          rollbackError = failure;
        }
      }
      if (rollbackError?.code === 'ROLLBACK_WORLD_DIVERGED'
        && await currentRevision(contextFile) === sourceRevision) {
        rollbackError = null;
        alreadyAtSource = true;
      }
      if (alreadyAtSource && migration.requestDrivenLocks) {
        try {
          restoredRequestDrivenLocks = await requestDrivenLockPersistence.rollback({
            backup: migration.backup
          });
        } catch (failure) {
          error.requestDrivenLockRestoreError = failure;
        }
      }
      let projection = null;
      if (alreadyAtSource || atDeploymentTarget) {
        try {
          projection = await restoreProjectionBackup({ deployment: {
            migration, sourceRevision, attemptId
          }, graphFile });
        } catch (failure) {
          error.projectionRestoreError = failure;
        }
      }
      const sidecarOk = !migration.requestDrivenLocks
        || restoredRequestDrivenLocks?.restoredSnapshotHash
          === migration.requestDrivenLocks.sourceHash;
      error.rollback = {
        ok: await currentRevision(contextFile) === sourceRevision
          && !rollbackError
          && sidecarOk
          && projection?.restored === true,
        alreadyAtSource,
        projection,
        requestDrivenLocks: restoredRequestDrivenLocks,
        projectionPending: rolledBack.projectionPending,
        receipt: rolledBack.receipt,
        ...(rollbackError ? { error: rollbackError } : {})
      };
    }
    throw error;
  }
}

await main();
