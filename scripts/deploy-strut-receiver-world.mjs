import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import {
  projectAtomContext,
  writeAtomGraphProjection
} from '../work-engine/atom-language/context-store.mjs';
import { planStrutReceiverMigration } from '../work-engine/atom-language/strut-receiver-migration.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function hash(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

async function assertNoLinkedAncestor(candidate) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw problem('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH',
        'Strut receiver migration refuses linked world or backup paths', { path: current });
    }
  }
}

async function trustedRuntime(configured) {
  await assertNoLinkedAncestor(configured.worldDirectory);
  const worldDirectory = await fs.realpath(configured.worldDirectory);
  if (!samePath(worldDirectory, configured.worldDirectory)) {
    throw problem('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH',
      'Configured Atom world directory is not canonical');
  }
  return Object.freeze({
    ...configured,
    worldDirectory,
    contextFile: path.join(worldDirectory, path.basename(configured.contextFile)),
    graphFile: path.join(worldDirectory, path.basename(configured.graphFile)),
    storeFile: path.join(worldDirectory, path.basename(configured.storeFile)),
    backupRoot: path.join(worldDirectory, 'migration-backups', 'strut-receiver')
  });
}

function parseMode(argv) {
  if (argv.length === 3 && ['--dry-run', '--apply'].includes(argv[0])
    && argv[1] === '--attempt' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(argv[2])) {
    return { action: argv[0].slice(2), attemptId: argv[2] };
  }
  if (argv.length === 2 && argv[0] === '--rollback' && argv[1]) {
    return { action: 'rollback', receiptFile: path.resolve(argv[1]) };
  }
  throw problem('INVALID_STRUT_RECEIVER_MIGRATION_MODE',
    'Use --dry-run --attempt <id>, --apply --attempt <id>, or --rollback <receipt>');
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
      throw problem('STRUT_RECEIVER_BACKUP_HASH_MISMATCH', `Backup verification failed: ${source}`);
    }
    return { source, target, hash: hash(bytes), bytes: bytes.length };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function createBackup(runtime, plan, attemptId, sourceBytes) {
  const directory = path.join(runtime.backupRoot, plan.migrationId, attemptId);
  await assertNoLinkedAncestor(directory);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  const realParent = await fs.realpath(path.dirname(directory));
  if (!isContained(runtime.worldDirectory, realParent)) {
    throw problem('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH',
      'Strut receiver migration backup escaped the configured world');
  }
  await fs.mkdir(directory, { recursive: false });
  const realDirectory = await fs.realpath(directory);
  if (!isContained(runtime.worldDirectory, realDirectory)) {
    throw problem('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH',
      'Strut receiver migration backup escaped the configured world');
  }
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const files = (await Promise.all([
    copyIfPresent(runtime.contextFile, path.join(directory, 'atom.json')),
    copyIfPresent(runtime.graphFile, path.join(directory, 'graph.json')),
    copyIfPresent(journalFile, path.join(directory, 'atom.transactions.json')),
    copyIfPresent(runtime.storeFile, path.join(directory, 'knowledge.json'))
  ])).filter(Boolean);
  const atomBackup = files.find((entry) => entry.source === runtime.contextFile);
  if (!atomBackup || atomBackup.hash !== hash(sourceBytes)) {
    throw problem('STRUT_RECEIVER_BACKUP_HASH_MISMATCH', 'Authoritative Atom backup is incomplete');
  }
  const receipt = {
    contract: 'atom.strut-receiver-private-backup', version: 1,
    migrationId: plan.migrationId, attemptId,
    sourceRevision: plan.expectedRevision, targetRevision: plan.nextRevision,
    directory, files
  };
  const receiptFile = path.join(directory, 'backup-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return { ...receipt, receiptFile };
}

async function findAttemptBackup(runtime, attemptId) {
  await assertNoLinkedAncestor(runtime.backupRoot);
  let migrations;
  try {
    migrations = await fs.readdir(runtime.backupRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const matches = [];
  for (const migration of migrations) {
    if (migration.isSymbolicLink()) {
      throw problem('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH',
        'Strut receiver migration refuses a linked backup directory');
    }
    if (!migration.isDirectory()) continue;
    const candidate = path.join(runtime.backupRoot, migration.name, attemptId);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw problem('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH',
          'Strut receiver migration attempt backup is not a trusted directory');
      }
      matches.push(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (matches.length > 1) {
    throw problem('STRUT_RECEIVER_MIGRATION_ATTEMPT_CONFLICT',
      'Attempt id belongs to more than one Strut receiver migration');
  }
  return matches[0] ?? null;
}

function deploymentReceipt({ runtime, plan, attemptId, backup, committed, deployedRevision }) {
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  return {
    contract: 'atom.strut-receiver-deployment-receipt', version: 1,
    action: 'apply', attemptId,
    migrationId: plan.migrationId,
    summary: plan.summary,
    migrated: plan.migrated,
    paths: { contextFile: runtime.contextFile, graphFile: runtime.graphFile, journalFile },
    revisions: {
      source: plan.expectedRevision,
      target: plan.nextRevision,
      deployed: deployedRevision
    },
    backup: { directory: backup.directory, receiptFile: backup.receiptFile },
    transaction: {
      commandId: committed.commandId,
      correlationId: committed.correlationId,
      beforeRevision: committed.beforeRevision,
      afterRevision: committed.afterRevision,
      status: committed.status
    }
  };
}

async function recoverAppliedAttempt(runtime, attemptId, current) {
  const directory = await findAttemptBackup(runtime, attemptId);
  if (!directory) return null;
  await assertNoLinkedAncestor(directory);
  const [sourceBytes, backup] = await Promise.all([
    fs.readFile(path.join(directory, 'atom.json')),
    fs.readFile(path.join(directory, 'backup-receipt.json'), 'utf8').then(JSON.parse)
  ]);
  const sourceFacts = JSON.parse(sourceBytes.toString('utf8'));
  const plan = planStrutReceiverMigration(sourceFacts);
  const receiptFile = path.join(directory, 'deployment-receipt.json');
  if (backup?.contract !== 'atom.strut-receiver-private-backup'
    || backup.version !== 1
    || backup.attemptId !== attemptId
    || backup.migrationId !== plan.migrationId
    || backup.sourceRevision !== plan.expectedRevision
    || backup.targetRevision !== plan.nextRevision
    || !samePath(backup.directory, directory)
    || hash(sourceBytes) !== backup.files?.find(({ target }) => (
      samePath(target, path.join(directory, 'atom.json'))
    ))?.hash) {
    throw problem('STRUT_RECEIVER_MIGRATION_ATTEMPT_CONFLICT',
      'Existing Strut receiver migration backup failed verification');
  }
  if (current.revision !== plan.nextRevision) {
    throw problem('STRUT_RECEIVER_MIGRATION_ATTEMPT_CONFLICT',
      'Existing attempt is not a recoverable committed migration');
  }
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const correlationId = `${plan.migrationId}:attempt:${attemptId}`;
  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const record = journal.receipts.find((entry) => (
    entry.correlationId === correlationId
    && entry.receipt?.beforeRevision === plan.expectedRevision
    && entry.receipt?.afterRevision === plan.nextRevision
  ));
  if (!record) {
    throw problem('STRUT_RECEIVER_MIGRATION_ATTEMPT_CONFLICT',
      'Committed world has no matching durable migration command');
  }
  try {
    await writeAtomGraphProjection(runtime.graphFile, current.facts, {
      rootName: path.basename(runtime.contextFile)
    });
    const actualProjection = JSON.parse(await fs.readFile(runtime.graphFile, 'utf8'));
    const { config, graph } = projectAtomContext(current.facts, {
      rootName: path.basename(runtime.contextFile)
    });
    if (JSON.stringify(actualProjection) !== JSON.stringify({ config, graph })) {
      throw problem('STRUT_RECEIVER_MIGRATION_PROJECTION_RECOVERY_FAILED',
        'Recovered Graph projection does not match the authoritative world');
    }
  } catch (error) {
    await persistenceFor(runtime).rollback({
      targetCommandId: record.commandId,
      correlationId: `${correlationId}:recovery-rollback`,
      expectedRevision: record.receipt.afterRevision
    });
    throw error;
  }
  const expectedDeployment = deploymentReceipt({
    runtime, plan, attemptId, backup,
    committed: record.receipt,
    deployedRevision: current.revision
  });
  let deployment;
  try {
    deployment = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    if (JSON.stringify(deployment) !== JSON.stringify(expectedDeployment)) {
      throw problem('INVALID_STRUT_RECEIVER_MIGRATION_RECEIPT',
        'Existing deployment receipt does not match the durable migration');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    deployment = expectedDeployment;
    await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, { flag: 'wx' });
  }
  return { ...deployment, receiptFile, recovered: true };
}

function persistenceFor(runtime) {
  return createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: path.join(runtime.worldDirectory, 'atom.transactions.json')
  });
}

async function rollbackFromReceipt(runtime, receiptFile) {
  await assertNoLinkedAncestor(receiptFile);
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  if (receipt?.contract !== 'atom.strut-receiver-deployment-receipt'
    || receipt.version !== 1
    || !samePath(receipt.paths?.contextFile, runtime.contextFile)
    || !samePath(receipt.paths?.graphFile, runtime.graphFile)
    || !samePath(receipt.paths?.journalFile, journalFile)
    || !isContained(runtime.backupRoot, receiptFile)
    || typeof receipt.transaction?.commandId !== 'string') {
    throw problem('INVALID_STRUT_RECEIVER_MIGRATION_RECEIPT',
      'Rollback receipt is not bound to this Atom world');
  }
  const current = await readWorld(runtime.contextFile);
  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const durable = journal.receipts.find(({ commandId }) => (
    commandId === receipt.transaction.commandId
  ));
  const durableReceipt = durable?.receipt;
  if (!durable
    || durable.correlationId !== receipt.transaction.correlationId
    || durableReceipt?.beforeRevision !== receipt.revisions.source
    || durableReceipt?.afterRevision !== receipt.revisions.target
    || current.revision !== receipt.revisions.target) {
    throw problem('INVALID_STRUT_RECEIVER_MIGRATION_RECEIPT',
      'Rollback receipt does not match the durable migration command');
  }
  const restored = await persistenceFor(runtime).rollback({
    targetCommandId: durable.commandId,
    correlationId: `${durable.correlationId}:operator-rollback`,
    expectedRevision: durableReceipt.afterRevision
  });
  const world = await readWorld(runtime.contextFile);
  if (world.revision !== receipt.revisions.source) {
    throw problem('STRUT_RECEIVER_MIGRATION_ROLLBACK_FAILED',
      'Rollback did not restore the exact source revision');
  }
  return { action: 'rollback', revision: world.revision, transaction: restored };
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const runtime = await trustedRuntime(resolveAtomRuntime());
  if (mode.action === 'rollback') {
    process.stdout.write(`${JSON.stringify(await rollbackFromReceipt(runtime, mode.receiptFile), null, 2)}\n`);
    return;
  }
  const source = await readWorld(runtime.contextFile);
  if (mode.action === 'apply') {
    const recovered = await recoverAppliedAttempt(runtime, mode.attemptId, source);
    if (recovered) {
      process.stdout.write(`${JSON.stringify(recovered, null, 2)}\n`);
      return;
    }
  }
  const plan = planStrutReceiverMigration(source.facts);
  const preflight = {
    contract: 'atom.strut-receiver-migration-preflight', version: 1,
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
  if (source.revision !== plan.expectedRevision || plan.summary.migratedPrograms < 1) {
    throw problem('STRUT_RECEIVER_MIGRATION_SOURCE_DIVERGED',
      'Strut receiver migration source changed or no migration is required');
  }
  const backup = await createBackup(runtime, plan, mode.attemptId, source.bytes);
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const persistence = persistenceFor(runtime);
  const correlationId = `${plan.migrationId}:attempt:${mode.attemptId}`;
  let committed;
  try {
    committed = await persistence.commit({
      correlationId,
      expectedRevision: plan.expectedRevision,
      nextRevision: plan.nextRevision,
      facts: plan.facts,
      source: 'strut-receiver-migration',
      changedPaths: plan.changedPaths
    });
    const deployed = await readWorld(runtime.contextFile);
    if (deployed.revision !== plan.nextRevision) {
      throw problem('STRUT_RECEIVER_MIGRATION_POSTCHECK_FAILED',
        'Committed world revision failed postcheck');
    }
    const deployment = deploymentReceipt({
      runtime, plan, attemptId: mode.attemptId, backup, committed,
      deployedRevision: deployed.revision
    });
    const receiptFile = path.join(backup.directory, 'deployment-receipt.json');
    await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ ...deployment, receiptFile }, null, 2)}\n`);
  } catch (error) {
    const receipt = error.details?.receipt;
    const rollbackTarget = committed ?? (receipt?.status === 'committed' ? receipt : null);
    if (rollbackTarget) {
      await persistence.rollback({
        targetCommandId: rollbackTarget.commandId,
        correlationId: `${correlationId}:automatic-rollback`,
        expectedRevision: rollbackTarget.afterRevision
      });
    }
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false, code: error.code ?? error.name, message: error.message, details: error.details ?? null
  }, null, 2)}\n`);
  process.exitCode = 1;
});
