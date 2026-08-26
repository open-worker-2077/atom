import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import {
  applyGraphFourAxisWorldMigration,
  planGraphFourAxisWorldMigration,
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
  const backupRoot = path.resolve(argument('--backup-root') ?? path.join(worldDirectory, 'migration-backups'));
  const isolatedRoots = argumentsOf('--isolated-root');
  const rollbackReceipt = argument('--rollback');
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile: graphFile, journalFile });

  if (rollbackReceipt) {
    const deployment = JSON.parse(await fs.readFile(path.resolve(rollbackReceipt), 'utf8'));
    const rolledBack = await rollbackWithProjectionTolerance({
      migration: deployment.migration,
      persistence,
      correlationId: `${deployment.migration.migrationId}:operator-rollback`
    });
    const facts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
    const revision = revisionOfWorldFacts(facts);
    const ok = revision === deployment.sourceRevision
      && rolledBack.receipt.afterRevision === deployment.sourceRevision;
    process.stdout.write(`${JSON.stringify({
      ok, action: 'rollback', revision,
      projectionPending: rolledBack.projectionPending,
      receipt: rolledBack.receipt
    })}\n`);
    if (!ok) process.exitCode = 1;
    return;
  }

  const sourceBytes = await fs.readFile(contextFile);
  const sourceFacts = JSON.parse(sourceBytes.toString('utf8'));
  const sourceRevision = revisionOfWorldFacts(sourceFacts);
  const plan = planGraphFourAxisWorldMigration({
    snapshot: { revision: sourceRevision, facts: sourceFacts },
    planner: planGraphFourAxisMigration,
    isolatedRoots
  });
  const preflight = {
    ok: plan.summary.readyToCommit === true,
    action: process.argv.includes('--apply') ? 'apply' : 'preflight',
    contextFile,
    sourceRevision,
    sourceFileHash: hashBytes(sourceBytes),
    nextRevision: plan.nextRevision,
    counts: plan.summary.counts,
    isolatedRoots
  };
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`${JSON.stringify(preflight)}\n`);
    return;
  }

  let backupDirectory;
  const backup = {
    async create(request) {
      backupDirectory = path.join(backupRoot, request.migrationId);
      await fs.mkdir(backupRoot, { recursive: true });
      await fs.mkdir(backupDirectory, { recursive: false });
      const files = (await Promise.all([
        copyIfPresent(contextFile, path.join(backupDirectory, 'atom.json')),
        copyIfPresent(graphFile, path.join(backupDirectory, 'graph.json')),
        copyIfPresent(journalFile, path.join(backupDirectory, 'atom.transactions.json')),
        copyIfPresent(path.join(worldDirectory, 'knowledge.json'), path.join(backupDirectory, 'knowledge.json')),
        copyIfPresent(path.join(worldDirectory, 'program-projection.json'), path.join(backupDirectory, 'program-projection.json'))
      ])).filter(Boolean);
      const receipt = {
        contract: 'atom.graph-four-axis-private-backup', version: 1,
        migrationId: request.migrationId,
        revision: request.revision,
        factsHash: request.factsHash,
        sourceFileHash: hashBytes(sourceBytes),
        directory: backupDirectory,
        files
      };
      await fs.writeFile(
        path.join(backupDirectory, 'backup-receipt.json'),
        `${JSON.stringify(receipt, null, 2)}\n`,
        'utf8'
      );
      return receipt;
    },
    async verify({ receipt, revision, factsHash }) {
      const copied = await fs.readFile(path.join(receipt.directory, 'atom.json'));
      const facts = JSON.parse(copied.toString('utf8'));
      return receipt.revision === revision
        && receipt.factsHash === factsHash
        && revisionOfWorldFacts(facts) === revision
        && receipt.sourceFileHash === hashBytes(copied);
    }
  };

  let migration;
  try {
    migration = await applyGraphFourAxisWorldMigration({
      plan,
      confirmation: true,
      backup,
      persistence,
      correlationId: `${plan.migrationId}:deploy`
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
    await fs.writeFile(receiptFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ ...result, receiptFile })}\n`);
    if (!result.ok) throw Object.assign(new Error('Post-migration verification failed'), { code: 'GRAPH_MIGRATION_POSTCHECK_FAILED' });
  } catch (error) {
    if (migration) {
      const rolledBack = await rollbackWithProjectionTolerance({ migration, persistence });
      const restored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
      error.rollback = {
        ok: revisionOfWorldFacts(restored) === sourceRevision,
        projectionPending: rolledBack.projectionPending,
        receipt: rolledBack.receipt
      };
    }
    throw error;
  }
}

await main();
