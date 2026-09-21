import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { writeAtomGraphProjection } from '../work-engine/atom-language/context-store.mjs';
import { planShortThingIdentityMigration } from '../work-engine/atom-language/thing-identity-migration.mjs';
import { rebuildProgramRefBindings } from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { rebuildThingIdWatermark } from '../work-engine/atom-language/thing-id-allocator.mjs';
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

async function copyVerified(source, target, relativeName = path.basename(source)) {
  try {
    const bytes = await fs.readFile(source);
    await fs.writeFile(target, bytes, { flag: 'wx' });
    const copied = await fs.readFile(target);
    if (hash(bytes) !== hash(copied)) {
      throw problem('THING_IDENTITY_BACKUP_HASH_MISMATCH', `Backup verification failed: ${source}`);
    }
    return { name: relativeName, hash: hash(bytes), bytes: bytes.length };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function copyTreeVerified(source, target, prefix = path.basename(source)) {
  let stat;
  try { stat = await fs.stat(source); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (stat.isFile()) return [await copyVerified(source, target, prefix)];
  if (!stat.isDirectory()) return [];
  await fs.mkdir(target, { recursive: false });
  const records = [];
  for (const entry of (await fs.readdir(source, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    records.push(...await copyTreeVerified(
      path.join(source, entry.name), path.join(target, entry.name), path.join(prefix, entry.name)
    ));
  }
  return records;
}

function assertPlan(plan) {
  const valid = plan.summary.thingCount === plan.summary.uniqueShortIdentityCount
    && plan.summary.topologyPreserved
    && plan.summary.activeLegacyIdentityCount === 0;
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
    copyVerified(journalFile, path.join(directory, 'atom.transactions.json')),
    copyTreeVerified(`${journalFile}.d`, path.join(directory, 'atom.transactions.json.d'))
  ])).flat().filter(Boolean);
  const atom = files.find((file) => file.name === 'atom.json');
  if (!atom || atom.hash !== hash(sourceBytes)) {
    throw problem('THING_IDENTITY_BACKUP_HASH_MISMATCH', 'Authoritative Atom backup is incomplete');
  }
  const identityMapFile = path.join(directory, 'identity-map.json');
  const identityMapBytes = Buffer.from(`${JSON.stringify(Object.fromEntries(plan.identityMap), null, 2)}\n`);
  await fs.writeFile(identityMapFile, identityMapBytes, { flag: 'wx' });
  files.push({ name: 'identity-map.json', hash: hash(identityMapBytes), bytes: identityMapBytes.length });
  const receipt = {
    contract: 'atom.thing-identity-private-backup', version: 1,
    migrationId: plan.migrationId, attemptId, directory,
    sourceRevision: plan.sourceRevision, targetRevision: plan.nextRevision, files,
    identityMapFile,
    bindingGeneration: plan.nextRevision,
    allocatorWatermark: plan.summary.allocatorWatermark
  };
  const receiptFile = path.join(directory, 'backup-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  return { ...receipt, receiptFile };
}

function persistenceFor(runtime) {
  return createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: path.join(runtime.worldDirectory, 'atom.transactions.json'),
    publishLegacyProjection: false
  });
}

async function migrationInput(persistence) {
  const metadata = await persistence.readInternalMetadataState();
  return {
    metadata,
    programRefBindings: rebuildProgramRefBindings(metadata.receipts),
    sourceWatermark: rebuildThingIdWatermark(metadata.receipts)
  };
}

async function assertPostflight(persistence, expected) {
  const deployed = await persistence.readCommittedSnapshot();
  const input = await migrationInput(persistence);
  const verified = planShortThingIdentityMigration({
    facts: deployed.facts,
    programRefBindings: input.programRefBindings,
    sourceWatermark: input.sourceWatermark,
    expectedThingCount: expected.summary.thingCount
  });
  assertPlan(verified);
  if (verified.changed || deployed.revision !== expected.nextRevision
    || input.sourceWatermark !== expected.summary.allocatorWatermark
    || JSON.stringify(input.programRefBindings.entries().map(([, value]) => value))
      !== JSON.stringify(expected.nextBindings.replacements)) {
    throw problem('THING_IDENTITY_MIGRATION_POSTCHECK_FAILED',
      'Committed world did not pass short identity generation readback');
  }
  return deployed;
}

async function apply(mode, runtime) {
  const persistence = persistenceFor(runtime);
  const sourceFile = await readWorld(runtime.contextFile);
  const source = await persistence.readCommittedSnapshot();
  const input = await migrationInput(persistence);
  const plan = planShortThingIdentityMigration({
    facts: source.facts,
    programRefBindings: input.programRefBindings,
    sourceWatermark: input.sourceWatermark
  });
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
  const backup = await createBackup(runtime, plan, mode.attemptId, sourceFile.bytes);
  const correlationId = `${plan.migrationId}:attempt:${mode.attemptId}`;
  let committed;
  try {
    committed = await persistence.commit({
      correlationId, expectedRevision: plan.sourceRevision, nextRevision: plan.nextRevision,
      facts: plan.facts, source: 'thing-identity-migration',
      programRefBindings: plan.nextBindings,
      thingIdentityAllocator: plan.receipt.thingIdentityAllocator,
      thingIdentityMigration: plan.receipt.thingIdentityMigration
    });
    await writeAtomGraphProjection(runtime.graphFile, plan.facts, {
      rootName: path.basename(runtime.contextFile)
    });
    await assertPostflight(persistence, plan);
  } catch (error) {
    const receipt = committed ?? error.details?.receipt;
    if (receipt?.status === 'committed') {
      await persistence.rollback({
        targetCommandId: receipt.commandId,
        correlationId: `${correlationId}:automatic-rollback`,
        expectedRevision: receipt.afterRevision
      });
      const backedUpGraph = path.join(backup.directory, 'graph.json');
      try { await fs.copyFile(backedUpGraph, runtime.graphFile); }
      catch (restoreError) { if (restoreError.code !== 'ENOENT') throw restoreError; }
    }
    throw error;
  }
  const deployment = {
    ...preflight, contract: 'atom.short-thing-id-deployment', version: 1, action: 'apply',
    paths: { contextFile: runtime.contextFile, graphFile: runtime.graphFile,
      backupDirectory: backup.directory },
    backup: { receiptFile: backup.receiptFile, identityMapFile: backup.identityMapFile,
      sourceHash: hash(sourceFile.bytes) },
    transaction: redactedTransaction(committed),
    bindingGeneration: { revision: plan.nextRevision,
      programCount: plan.nextBindings.replacements.length },
    rollback: { targetCommandId: committed.commandId, expectedRevision: committed.afterRevision }
  };
  const receiptFile = path.join(backup.directory, 'deployment-receipt.json');
  await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ...deployment, receiptFile })}\n`);
}

async function rollback(mode, runtime) {
  const deployment = JSON.parse(await fs.readFile(mode.receiptFile, 'utf8'));
  if (deployment?.contract !== 'atom.short-thing-id-deployment'
    || deployment.action !== 'apply'
    || deployment.paths?.contextFile !== runtime.contextFile
    || deployment.rollback?.targetCommandId !== deployment.transaction?.commandId
    || deployment.rollback?.expectedRevision !== deployment.revisions?.target) {
    throw problem('INVALID_THING_IDENTITY_MIGRATION_RECEIPT',
      'Deployment receipt does not match this Atom world');
  }
  const persistence = persistenceFor(runtime);
  const backup = JSON.parse(await fs.readFile(deployment.backup.receiptFile, 'utf8'));
  if (backup?.contract !== 'atom.thing-identity-private-backup'
    || backup.directory !== deployment.paths.backupDirectory
    || backup.sourceRevision !== deployment.revisions.source
    || backup.targetRevision !== deployment.revisions.target
    || !Array.isArray(backup.files)) {
    throw problem('INVALID_THING_IDENTITY_BACKUP_RECEIPT',
      'Private backup receipt does not match this deployment');
  }
  for (const file of backup.files) {
    const bytes = await fs.readFile(path.join(backup.directory, file.name));
    if (hash(bytes) !== file.hash) {
      throw problem('THING_IDENTITY_BACKUP_HASH_MISMATCH', `Backup verification failed: ${file.name}`);
    }
  }
  const receipt = await persistence.rollback({
    targetCommandId: deployment.rollback.targetCommandId,
    correlationId: `${deployment.migrationId}:attempt:${deployment.attemptId}:operator-rollback`,
    expectedRevision: deployment.rollback.expectedRevision
  });
  try { await fs.copyFile(path.join(backup.directory, 'graph.json'), runtime.graphFile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const restored = await persistence.readCommittedSnapshot();
  const metadata = await migrationInput(persistence);
  const ok = restored.revision === deployment.revisions.source
    && metadata.sourceWatermark === '000';
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
