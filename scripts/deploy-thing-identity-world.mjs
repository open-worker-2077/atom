import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { planThingIdentityMigration } from '../work-engine/atom-language/thing-identity-migration.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function hash(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function redactedTransaction(receipt) {
  const keys = ['contract', 'version', 'commandId', 'correlationId', 'beforeRevision',
    'afterRevision', 'status', 'committedAt'];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(receipt ?? {}, key))
    .map((key) => [key, receipt[key]]));
}

function parseMode(argv) {
  if (argv.length === 3 && ['--dry-run', '--apply'].includes(argv[0])
    && argv[1] === '--attempt' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(argv[2])) {
    return { action: argv[0].slice(2), attemptId: argv[2] };
  }
  if (argv.length === 2 && argv[0] === '--rollback' && argv[1]) {
    return { action: 'rollback', receiptFile: path.resolve(argv[1]) };
  }
  throw problem('INVALID_THING_IDENTITY_MIGRATION_MODE',
    'Use --dry-run --attempt <id>, --apply --attempt <id>, or --rollback <receipt>');
}

async function readWorld(file) {
  const bytes = await fs.readFile(file);
  const facts = JSON.parse(bytes.toString('utf8'));
  return { bytes, facts, revision: revisionOfWorldFacts(facts) };
}

async function copyVerified(source, target) {
  try {
    const bytes = await fs.readFile(source);
    await fs.writeFile(target, bytes, { flag: 'wx' });
    const copied = await fs.readFile(target);
    if (hash(bytes) !== hash(copied)) {
      throw problem('THING_IDENTITY_BACKUP_HASH_MISMATCH', `Backup verification failed: ${source}`);
    }
    return { name: path.basename(source), hash: hash(bytes), bytes: bytes.length };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertPlan(plan) {
  const valid = plan.summary.thingCount === plan.summary.uniqueIdentityCount
    && plan.summary.topologyPreserved
    && plan.summary.activeUnboundStrutEndpointCount === 0;
  if (!valid) {
    throw problem('THING_IDENTITY_MIGRATION_PREFLIGHT_FAILED',
      'Thing identity migration did not preserve identity, topology, or Strut bindings', plan.summary);
  }
}

async function createBackup(runtime, plan, attemptId, sourceBytes) {
  const directory = path.join(runtime.worldDirectory, 'migration-backups',
    'thing-identity', attemptId);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await fs.mkdir(directory, { recursive: false });
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const files = (await Promise.all([
    copyVerified(runtime.contextFile, path.join(directory, 'atom.json')),
    copyVerified(runtime.graphFile, path.join(directory, 'graph.json')),
    copyVerified(runtime.storeFile, path.join(directory, 'knowledge.json')),
    copyVerified(journalFile, path.join(directory, 'atom.transactions.json'))
  ])).filter(Boolean);
  const atom = files.find((file) => file.name === 'atom.json');
  if (!atom || atom.hash !== hash(sourceBytes)) {
    throw problem('THING_IDENTITY_BACKUP_HASH_MISMATCH', 'Authoritative Atom backup is incomplete');
  }
  const receipt = {
    contract: 'atom.thing-identity-private-backup', version: 1,
    migrationId: plan.migrationId, attemptId, directory,
    sourceRevision: plan.sourceRevision, targetRevision: plan.nextRevision, files
  };
  const receiptFile = path.join(directory, 'backup-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return { ...receipt, receiptFile };
}

function persistenceFor(runtime) {
  return createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: path.join(runtime.worldDirectory, 'atom.transactions.json')
  });
}

async function apply(mode, runtime) {
  const source = await readWorld(runtime.contextFile);
  const plan = planThingIdentityMigration(source.facts);
  assertPlan(plan);
  const preflight = {
    contract: 'atom.thing-identity-migration-preflight', version: 1,
    action: mode.action, attemptId: mode.attemptId, migrationId: plan.migrationId,
    revisions: { source: plan.sourceRevision, target: plan.nextRevision },
    changed: plan.changed, summary: plan.summary
  };
  if (mode.action === 'dry-run') {
    process.stdout.write(`${JSON.stringify(preflight)}\n`);
    return;
  }
  if (!plan.changed || source.revision !== plan.sourceRevision) {
    throw problem('THING_IDENTITY_MIGRATION_NOT_REQUIRED', 'World already has complete Thing identities');
  }
  const backup = await createBackup(runtime, plan, mode.attemptId, source.bytes);
  const persistence = persistenceFor(runtime);
  const correlationId = `${plan.migrationId}:attempt:${mode.attemptId}`;
  let committed;
  try {
    committed = await persistence.commit({
      correlationId, expectedRevision: plan.sourceRevision, nextRevision: plan.nextRevision,
      facts: plan.facts, source: 'thing-identity-migration', changedPaths: plan.changedPaths
    });
    const deployed = await persistence.readCommittedSnapshot();
    const verified = planThingIdentityMigration(deployed.facts);
    assertPlan(verified);
    if (deployed.revision !== plan.nextRevision || verified.changed) {
      throw problem('THING_IDENTITY_MIGRATION_POSTCHECK_FAILED',
        'Committed world did not pass identity migration readback');
    }
  } catch (error) {
    const receipt = committed ?? error.details?.receipt;
    if (receipt?.status === 'committed') {
      await persistence.rollback({
        targetCommandId: receipt.commandId,
        correlationId: `${correlationId}:automatic-rollback`,
        expectedRevision: receipt.afterRevision
      });
    }
    throw error;
  }
  const deployment = {
    ...preflight, action: 'apply',
    paths: { contextFile: runtime.contextFile, graphFile: runtime.graphFile,
      backupDirectory: backup.directory },
    backup: { receiptFile: backup.receiptFile, sourceHash: hash(source.bytes) },
    transaction: redactedTransaction(committed),
    rollback: { targetCommandId: committed.commandId, expectedRevision: committed.afterRevision }
  };
  const receiptFile = path.join(backup.directory, 'deployment-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ...deployment, receiptFile })}\n`);
}

async function rollback(mode, runtime) {
  const deployment = JSON.parse(await fs.readFile(mode.receiptFile, 'utf8'));
  if (deployment?.contract !== 'atom.thing-identity-migration-preflight'
    || deployment.action !== 'apply'
    || deployment.paths?.contextFile !== runtime.contextFile
    || deployment.rollback?.targetCommandId !== deployment.transaction?.commandId
    || deployment.rollback?.expectedRevision !== deployment.revisions?.target) {
    throw problem('INVALID_THING_IDENTITY_MIGRATION_RECEIPT',
      'Deployment receipt does not match this Atom world');
  }
  const persistence = persistenceFor(runtime);
  const receipt = await persistence.rollback({
    targetCommandId: deployment.rollback.targetCommandId,
    correlationId: `${deployment.migrationId}:attempt:${deployment.attemptId}:operator-rollback`,
    expectedRevision: deployment.rollback.expectedRevision
  });
  const restored = await persistence.readCommittedSnapshot();
  const ok = restored.revision === deployment.revisions.source;
  process.stdout.write(`${JSON.stringify({ ok, action: 'rollback', revision: restored.revision,
    transaction: redactedTransaction(receipt) })}\n`);
  if (!ok) process.exitCode = 1;
}

const mode = parseMode(process.argv.slice(2));
const runtime = resolveAtomRuntime();
try {
  if (mode.action === 'rollback') await rollback(mode, runtime);
  else await apply(mode, runtime);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code ?? error.name,
    message: error.message, details: error.details ?? null })}\n`);
  process.exitCode = 1;
}
