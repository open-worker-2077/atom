import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { planInlineStrutMigration } from '../work-engine/atom-language/inline-strut-migration.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function hash(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function parseMode(argv) {
  if (argv.length === 3 && ['--dry-run', '--apply'].includes(argv[0])
    && argv[1] === '--attempt' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(argv[2])) {
    return { action: argv[0].slice(2), attemptId: argv[2] };
  }
  throw problem('INVALID_INLINE_STRUT_MIGRATION_MODE',
    'Use --dry-run --attempt <id> or --apply --attempt <id>');
}

async function readWorld(file) {
  const bytes = await fs.readFile(file);
  const facts = JSON.parse(bytes.toString('utf8'));
  return { bytes, facts, revision: revisionOfWorldFacts(facts) };
}

async function copyIfPresent(source, target) {
  try {
    const bytes = await fs.readFile(source);
    await fs.writeFile(target, bytes, { flag: 'wx' });
    const copied = await fs.readFile(target);
    if (hash(bytes) !== hash(copied)) {
      throw problem('INLINE_STRUT_BACKUP_HASH_MISMATCH', `Backup verification failed: ${source}`);
    }
    return { source, target, hash: hash(bytes), bytes: bytes.length };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function createBackup(runtime, plan, attemptId, sourceBytes) {
  const directory = path.join(runtime.worldDirectory, 'migration-backups',
    'inline-strut', plan.migrationId, attemptId);
  await fs.mkdir(directory, { recursive: false });
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const files = (await Promise.all([
    copyIfPresent(runtime.contextFile, path.join(directory, 'atom.json')),
    copyIfPresent(runtime.graphFile, path.join(directory, 'graph.json')),
    copyIfPresent(journalFile, path.join(directory, 'atom.transactions.json')),
    copyIfPresent(runtime.storeFile, path.join(directory, 'knowledge.json'))
  ])).filter(Boolean);
  const atomBackup = files.find((entry) => entry.source === runtime.contextFile);
  if (!atomBackup || atomBackup.hash !== hash(sourceBytes)) {
    throw problem('INLINE_STRUT_BACKUP_HASH_MISMATCH', 'Authoritative Atom backup is incomplete');
  }
  const receipt = {
    contract: 'atom.inline-strut-private-backup', version: 1,
    migrationId: plan.migrationId, attemptId,
    sourceRevision: plan.expectedRevision, targetRevision: plan.nextRevision,
    directory, files
  };
  const receiptFile = path.join(directory, 'backup-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return { ...receipt, receiptFile };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const runtime = resolveAtomRuntime();
  const source = await readWorld(runtime.contextFile);
  const plan = planInlineStrutMigration(source.facts);
  const preflight = {
    contract: 'atom.inline-strut-migration-preflight', version: 1,
    action: mode.action, attemptId: mode.attemptId,
    migrationId: plan.migrationId,
    revisions: { source: plan.expectedRevision, target: plan.nextRevision },
    summary: plan.summary,
    migrated: plan.migrated
  };
  if (mode.action === 'dry-run') {
    process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }
  if (source.revision !== plan.expectedRevision || plan.summary.migratedPredicates < 1) {
    throw problem('INLINE_STRUT_MIGRATION_SOURCE_DIVERGED',
      'Inline Strut migration source changed or no migration is required');
  }
  const backup = await createBackup(runtime, plan, mode.attemptId, source.bytes);
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const persistence = createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile
  });
  const correlationId = `${plan.migrationId}:attempt:${mode.attemptId}`;
  let committed;
  try {
    committed = await persistence.commit({
      correlationId,
      expectedRevision: plan.expectedRevision,
      nextRevision: plan.nextRevision,
      facts: plan.facts,
      source: 'inline-strut-program-migration',
      changedPaths: plan.migrated.map(({ ownerPath }) => ownerPath)
    });
  } catch (error) {
    const receipt = error.details?.receipt;
    if (receipt?.status === 'committed') {
      await persistence.rollback({
        targetCommandId: receipt.commandId,
        correlationId: `${correlationId}:automatic-rollback`,
        expectedRevision: receipt.afterRevision
      });
    }
    throw error;
  }
  const deployed = await readWorld(runtime.contextFile);
  if (deployed.revision !== plan.nextRevision) {
    await persistence.rollback({
      targetCommandId: committed.commandId,
      correlationId: `${correlationId}:postcheck-rollback`,
      expectedRevision: committed.afterRevision
    });
    throw problem('INLINE_STRUT_MIGRATION_POSTCHECK_FAILED', 'Committed world revision failed postcheck');
  }
  const deployment = {
    ...preflight,
    action: 'apply',
    backup: { directory: backup.directory, receiptFile: backup.receiptFile },
    transaction: {
      commandId: committed.commandId,
      correlationId: committed.correlationId,
      beforeRevision: committed.beforeRevision,
      afterRevision: committed.afterRevision,
      status: committed.status
    }
  };
  const receiptFile = path.join(backup.directory, 'deployment-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ...deployment, receiptFile }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false, code: error.code ?? error.name, message: error.message, details: error.details ?? null
  }, null, 2)}\n`);
  process.exitCode = 1;
});
