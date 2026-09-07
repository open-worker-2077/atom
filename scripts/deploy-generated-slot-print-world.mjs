import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { applyLocalWorldPatch } from '../src/atom-system/world-runtime/local-world-patch.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { planGeneratedSlotPrintMigration } from '../work-engine/atom-language/generated-slot-print-migration.mjs';
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

function relativeFile(value) {
  return value.split(path.sep).join('/');
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
      throw problem(
        'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
        'Generated slot print migration refuses linked world, journal, or backup paths',
        { path: current }
      );
    }
  }
}

async function assertRealDirectoryContained(root, directory) {
  await assertNoLinkedAncestor(directory);
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(directory)]);
  if (!isContained(realRoot, realDirectory)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
      'Generated slot print migration path escaped the configured world',
      { directory }
    );
  }
  return realDirectory;
}

async function trustedRuntime(configured) {
  const expected = resolveAtomRuntime({ root: configured.root });
  const exactKeys = [
    'root', 'worldDirectory', 'contextFile', 'graphFile', 'storeFile', 'sessionsDirectory'
  ];
  if (exactKeys.some((key) => !samePath(configured[key] ?? '', expected[key]))) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
      'Configured Atom runtime paths do not match the canonical primary world layout'
    );
  }
  const journalFile = path.join(expected.worldDirectory, 'atom.transactions.json');
  const backupRoot = path.join(
    expected.worldDirectory,
    'migration-backups',
    'generated-slot-print'
  );
  for (const candidate of [
    expected.worldDirectory,
    expected.contextFile,
    expected.graphFile,
    expected.storeFile,
    journalFile,
    `${journalFile}.d`,
    backupRoot
  ]) await assertNoLinkedAncestor(candidate);
  const worldDirectory = await fs.realpath(expected.worldDirectory);
  if (!samePath(worldDirectory, expected.worldDirectory)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
      'Configured Atom world directory is not canonical'
    );
  }
  return Object.freeze({
    ...expected,
    worldDirectory,
    journalFile,
    backupRoot
  });
}

function requireAttemptId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw problem(
      'INVALID_GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_ID',
      'Generated slot print migration attempt id must be a path-safe stable token'
    );
  }
  return value;
}

function parseMode(argv) {
  if (argv.length === 3 && ['--dry-run', '--apply'].includes(argv[0]) && argv[1] === '--attempt') {
    return Object.freeze({ action: argv[0].slice(2), attemptId: requireAttemptId(argv[2]) });
  }
  if (argv.length === 2 && argv[0] === '--rollback' && argv[1]) {
    return Object.freeze({ action: 'rollback', receiptFile: path.resolve(argv[1]) });
  }
  throw problem(
    'INVALID_GENERATED_SLOT_PRINT_MIGRATION_MODE',
    'Use exactly --dry-run --attempt <id>, --apply --attempt <id>, or --rollback <receipt>'
  );
}

async function readWorld(contextFile) {
  const bytes = await fs.readFile(contextFile);
  let facts = JSON.parse(bytes.toString('utf8'));
  let revision = revisionOfWorldFacts(facts);
  const journal = createJsonTransactionJournal({
    file: path.join(path.dirname(contextFile), 'atom.transactions.json')
  });
  const state = await journal.readState();
  const chain = [];
  let chainRevision = revision;
  for (const entry of state.receipts) {
    if (entry.receipt?.beforeRevision !== chainRevision) continue;
    chain.push(entry);
    chainRevision = entry.receipt.afterRevision;
  }
  const latestRevision = state.receipts.at(-1)?.receipt?.afterRevision;
  if (latestRevision && chainRevision !== latestRevision) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_JOURNAL_UNSETTLED',
      'Authoritative Atom facts do not reach the latest committed transaction'
    );
  }
  const lastWholeWorld = chain.findLastIndex((entry) => entry.historyMode !== 'local-patch');
  let start = 0;
  if (lastWholeWorld >= 0) {
    let record = chain[lastWholeWorld];
    if (!Array.isArray(record.after?.facts)) record = await journal.findCommitted(record.commandId);
    facts = structuredClone(record.after.facts);
    revision = revisionOfWorldFacts(facts);
    if (revision !== chain[lastWholeWorld].receipt.afterRevision) {
      throw problem(
        'INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT',
        'Committed transaction history does not reproduce its declared Atom revision'
      );
    }
    start = lastWholeWorld + 1;
  }
  for (const record of chain.slice(start)) {
    if (record.historyMode === 'local-patch') {
      facts = applyLocalWorldPatch(facts, record.patch);
    } else {
      throw problem(
        'INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT',
        'Whole-world transaction ordering changed during reconstruction'
      );
    }
    revision = revisionOfWorldFacts(facts);
    if (revision !== record.receipt.afterRevision) {
      throw problem(
        'INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT',
        'Committed transaction history does not reproduce its declared Atom revision'
      );
    }
  }
  return Object.freeze({
    bytes,
    facts,
    revision
  });
}

function migrationIdFor(plan) {
  const digest = crypto.createHash('sha256')
    .update(`${plan.expectedRevision}\0${plan.nextRevision}`)
    .digest('hex');
  return `generated-slot-print-${digest}`;
}

function artifactsFor(plan) {
  return {
    changedPaths: [...plan.changedPaths],
    migrated: structuredClone(plan.migrated)
  };
}

function preflightFor({ plan, source, attemptId, action }) {
  return Object.freeze({
    contract: 'atom.generated-slot-print-migration-preflight',
    version: 1,
    action,
    attemptId,
    migrationId: migrationIdFor(plan),
    revisions: { source: plan.expectedRevision, target: plan.nextRevision },
    hashes: { sourceFile: hash(source.bytes), targetFacts: plan.nextRevision },
    changedPaths: [...plan.changedPaths],
    artifacts: artifactsFor(plan),
    summary: structuredClone(plan.summary)
  });
}

async function verifyJournal(journalFile, incrementalDirectory = `${journalFile}.d`, match = null) {
  const journal = createJsonTransactionJournal({ file: journalFile, incrementalDirectory });
  const state = await journal.readState();
  const matches = [];
  for (const record of state.receipts) {
    if (!match?.(record)) continue;
    matches.push(await journal.findCommitted(record.commandId));
  }
  return { preparedCount: state.prepared.length, receiptCount: state.receipts.length, matches };
}

async function verifyStableJournalSources(runtime) {
  const before = await collectBackupSources(runtime);
  const journalEvidence = await verifyJournal(runtime.journalFile);
  const after = await collectBackupSources(runtime);
  if (!sameInventory(before, after)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_DIVERGED',
      'Atom world or transaction journal changed during semantic journal verification'
    );
  }
  return { journalEvidence, sources: after };
}

async function fileMetadata(source, relative) {
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(source)) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  return { source, path: relativeFile(relative), hash: `sha256:${digest.digest('hex')}`, bytes };
}

async function copyVerified(source, target, expected) {
  await pipeline(createReadStream(source), createWriteStream(target, { flags: 'wx' }));
  const copied = await fileMetadata(target, expected.path);
  if (copied.hash !== expected.hash || copied.bytes !== expected.bytes) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_BACKUP_VERIFICATION_FAILED',
      'Private backup file failed byte verification',
      { path: expected.path }
    );
  }
}

async function collectTree(directory, prefix) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const source = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) {
      throw problem(
        'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
        'Generated slot print migration refuses linked journal entries',
        { path: source }
      );
    }
    if (stat.isDirectory()) {
      files.push(...await collectTree(source, relative));
    } else if (stat.isFile()) {
      files.push(await fileMetadata(source, relative));
    } else {
      throw problem(
        'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
        'Generated slot print migration refuses special journal entries',
        { path: source }
      );
    }
  }
  return files;
}

async function optionalFile(source, relative) {
  let stat;
  try {
    stat = await fs.lstat(source);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
      'Generated slot print migration backup source is not a regular file',
      { path: source }
    );
  }
  return [await fileMetadata(source, relative)];
}

async function collectBackupSources(runtime) {
  const context = await optionalFile(runtime.contextFile, 'atom.json');
  if (context.length !== 1) {
    throw problem('GENERATED_SLOT_PRINT_MIGRATION_WORLD_REQUIRED', 'Configured Atom world is missing');
  }
  return [
    ...context,
    ...await optionalFile(runtime.journalFile, 'atom.transactions.json'),
    ...await collectTree(`${runtime.journalFile}.d`, 'atom.transactions.json.d')
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function inventory(files) {
  return files.map(({ path: file, hash: digest, bytes }) => ({
    path: file,
    hash: digest,
    bytes
  }));
}

function sameInventory(left, right) {
  return JSON.stringify(inventory(left)) === JSON.stringify(inventory(right));
}

async function createBackup({ runtime, plan, attemptId, source, journalEvidence, sources }) {
  const directory = path.join(runtime.backupRoot, migrationIdFor(plan), attemptId);
  await assertNoLinkedAncestor(directory);
  await fs.mkdir(path.dirname(directory), { recursive: true });
  await assertRealDirectoryContained(runtime.worldDirectory, path.dirname(directory));
  try {
    await fs.mkdir(directory, { recursive: false });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT',
      'This generated slot print migration attempt already has private artifacts'
    );
  }
  await assertRealDirectoryContained(runtime.worldDirectory, directory);
  for (const entry of sources) {
    const target = path.join(directory, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await assertRealDirectoryContained(runtime.worldDirectory, path.dirname(target));
    await copyVerified(entry.source, target, entry);
  }
  const after = await collectBackupSources(runtime);
  const sourceEntry = sources.find(({ path: file }) => file === 'atom.json');
  if (!sameInventory(sources, after) || hash(source.bytes) !== sourceEntry?.hash) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_DIVERGED',
      'Atom world or transaction journal changed while the private backup was created'
    );
  }
  const manifestFile = path.join(directory, 'backup-manifest.json');
  const manifest = Object.freeze({
    contract: 'atom.generated-slot-print-private-backup',
    version: 1,
    migrationId: migrationIdFor(plan),
    attemptId,
    directory,
    worldDirectory: runtime.worldDirectory,
    contextFile: runtime.contextFile,
    journalFile: runtime.journalFile,
    revisions: { source: plan.expectedRevision, target: plan.nextRevision },
    hashes: { sourceFile: hash(source.bytes), targetFacts: plan.nextRevision },
    changedPaths: [...plan.changedPaths],
    artifacts: artifactsFor(plan),
    summary: structuredClone(plan.summary),
    journal: {
      receiptsVerified: journalEvidence.receiptCount,
      preparedTransactions: journalEvidence.preparedCount
    },
    files: inventory(sources),
    manifestFile
  });
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  return verifyBackup({ runtime, directory, attemptId });
}

async function listBackupPayload(directory) {
  return (await collectTree(directory, '')).filter(({ path: file }) => ![
    'backup-manifest.json',
    'deployment-receipt.json',
    'failure-receipt.json',
    'rollback-receipt.json'
  ].includes(file));
}

async function verifyBackup({ runtime, directory, attemptId }) {
  await assertRealDirectoryContained(runtime.worldDirectory, directory);
  const manifestFile = path.join(directory, 'backup-manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch (error) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT',
      'Existing generated slot print migration backup is incomplete',
      { cause: error.code ?? error.name }
    );
  }
  const files = await listBackupPayload(directory);
  const declared = manifest?.files;
  if (manifest?.contract !== 'atom.generated-slot-print-private-backup'
    || manifest.version !== 1
    || manifest.attemptId !== attemptId
    || !samePath(manifest.directory ?? '', directory)
    || !samePath(manifest.worldDirectory ?? '', runtime.worldDirectory)
    || !samePath(manifest.contextFile ?? '', runtime.contextFile)
    || !samePath(manifest.journalFile ?? '', runtime.journalFile)
    || !samePath(manifest.manifestFile ?? '', manifestFile)
    || !Array.isArray(declared)
    || JSON.stringify(inventory(files)) !== JSON.stringify(declared)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT',
      'Existing generated slot print migration backup failed manifest verification'
    );
  }
  const sourceEntry = files.find(({ path: file }) => file === 'atom.json');
  if (!sourceEntry || sourceEntry.hash !== manifest.hashes?.sourceFile) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_BACKUP_VERIFICATION_FAILED',
      'Authoritative Atom backup is missing or damaged'
    );
  }
  const sourceBytes = await fs.readFile(path.join(directory, 'atom.json'));
  const sourceFacts = (await readWorld(path.join(directory, 'atom.json'))).facts;
  const plan = planGeneratedSlotPrintMigration(sourceFacts);
  if (manifest.migrationId !== migrationIdFor(plan)
    || manifest.migrationId !== path.basename(path.dirname(directory))
    || manifest.revisions?.source !== plan.expectedRevision
    || manifest.revisions?.target !== plan.nextRevision
    || manifest.hashes?.targetFacts !== plan.nextRevision
    || JSON.stringify(manifest.changedPaths) !== JSON.stringify(plan.changedPaths)
    || JSON.stringify(manifest.artifacts) !== JSON.stringify(artifactsFor(plan))
    || JSON.stringify(manifest.summary) !== JSON.stringify(plan.summary)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT',
      'Existing generated slot print migration backup does not match its migration plan'
    );
  }
  return Object.freeze({ manifest, manifestFile, sourceFacts, sourceBytes, plan });
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
  await assertRealDirectoryContained(runtime.worldDirectory, runtime.backupRoot);
  const matches = [];
  for (const migration of migrations) {
    if (migration.isSymbolicLink()) {
      throw problem(
        'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
        'Generated slot print migration refuses linked backup directories'
      );
    }
    if (!migration.isDirectory()) continue;
    const candidate = path.join(runtime.backupRoot, migration.name, attemptId);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw problem(
          'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH',
          'Generated slot print migration attempt artifact is not a trusted directory'
        );
      }
      matches.push(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (matches.length > 1) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT',
      'Attempt id belongs to more than one generated slot print migration'
    );
  }
  return matches[0] ?? null;
}

function redactedTransactionReceipt(receipt) {
  const allowed = [
    'contract', 'version', 'commandId', 'correlationId', 'beforeRevision',
    'afterRevision', 'status', 'committedAt'
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(receipt ?? {}, key))
    .map((key) => [key, structuredClone(receipt[key])]));
}

function recordRevisions(record) {
  return record?.historyMode === 'local-patch'
    ? { before: record.patch?.beforeRevision, after: record.patch?.afterRevision }
    : { before: record?.before?.revision, after: record?.after?.revision };
}

function invalidReceipt(message = 'Migration receipt is not bound to the configured Atom world') {
  return problem('INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT', message);
}

function validateCommittedRecord({ record, deployment, currentRevision }) {
  const expectedCorrelationId = `${deployment.migrationId}:attempt:${deployment.attemptId}`;
  const expectedSource = `generated-slot-print-migration:${deployment.migrationId}`;
  const revisions = recordRevisions(record);
  const transaction = deployment.transaction;
  if (!record
    || record.commandId !== transaction.commandId
    || record.command?.commandId !== transaction.commandId
    || record.command?.contract !== 'atom.world-command'
    || record.command?.version !== 1
    || record.command?.name !== 'legacy-transition'
    || record.command?.correlationId !== expectedCorrelationId
    || record.correlationId !== expectedCorrelationId
    || transaction.correlationId !== expectedCorrelationId
    || record.command?.expectedRevision !== deployment.revisions.source
    || record.command?.payload?.source !== expectedSource
    || record.historyMode !== 'local-patch'
    || record.patch?.contract !== 'atom.world-patch'
    || record.patch?.version !== 1
    || JSON.stringify(record.patch?.changedPaths) !== JSON.stringify(deployment.artifacts.changedPaths)
    || revisions.before !== deployment.revisions.source
    || revisions.after !== deployment.revisions.target
    || record.receipt?.commandId !== transaction.commandId
    || record.receipt?.correlationId !== expectedCorrelationId
    || record.receipt?.beforeRevision !== deployment.revisions.source
    || record.receipt?.afterRevision !== deployment.revisions.target
    || record.receipt?.status !== 'committed'
    || record.receipt?.result?.source !== expectedSource
    || currentRevision !== deployment.revisions.target) {
    throw problem(
      'INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT',
      'Central transaction does not match the generated slot print migration receipt',
      {
        recordCommandId: record?.commandId,
        commandId: transaction?.commandId,
        commandExpectedRevision: record?.command?.expectedRevision,
        sourceRevision: deployment?.revisions?.source,
        historyMode: record?.historyMode,
        patchChangedPaths: record?.patch?.changedPaths,
        artifactChangedPaths: deployment?.artifacts?.changedPaths,
        recordBeforeRevision: revisions.before,
        recordAfterRevision: revisions.after,
        targetRevision: deployment?.revisions?.target,
        currentRevision
      }
    );
  }
  return record.receipt;
}

function deploymentReceipt({ runtime, backup, transaction, recovered = false, warnings = [] }) {
  const { manifest, plan } = backup;
  return Object.freeze({
    contract: 'atom.generated-slot-print-deployment-receipt',
    version: 1,
    action: 'apply',
    attemptId: manifest.attemptId,
    migrationId: manifest.migrationId,
    paths: {
      contextFile: runtime.contextFile,
      graphFile: runtime.graphFile,
      journalFile: runtime.journalFile,
      backupDirectory: manifest.directory,
      backupManifest: manifest.manifestFile
    },
    hashes: structuredClone(manifest.hashes),
    revisions: {
      source: plan.expectedRevision,
      target: plan.nextRevision,
      deployed: plan.nextRevision
    },
    changedPaths: [...plan.changedPaths],
    artifacts: structuredClone(manifest.artifacts),
    summary: structuredClone(plan.summary),
    transaction: redactedTransactionReceipt(transaction),
    rollback: {
      targetCommandId: transaction.commandId,
      expectedRevision: plan.nextRevision
    },
    warnings: structuredClone(warnings),
    ...(recovered ? { recovered: true } : {})
  });
}

function validateDeploymentShape({ deployment, runtime, backup }) {
  const expectedDirectory = path.join(
    runtime.backupRoot,
    String(deployment?.migrationId ?? ''),
    String(deployment?.attemptId ?? '')
  );
  if (deployment?.contract !== 'atom.generated-slot-print-deployment-receipt'
    || deployment.version !== 1
    || deployment.action !== 'apply'
    || !samePath(deployment.paths?.contextFile ?? '', runtime.contextFile)
    || !samePath(deployment.paths?.graphFile ?? '', runtime.graphFile)
    || !samePath(deployment.paths?.journalFile ?? '', runtime.journalFile)
    || !samePath(deployment.paths?.backupDirectory ?? '', expectedDirectory)
    || !samePath(deployment.paths?.backupManifest ?? '', backup.manifestFile)
    || deployment.migrationId !== backup.manifest.migrationId
    || deployment.attemptId !== backup.manifest.attemptId
    || deployment.revisions?.source !== backup.plan.expectedRevision
    || deployment.revisions?.target !== backup.plan.nextRevision
    || deployment.revisions?.deployed !== backup.plan.nextRevision
    || JSON.stringify(deployment.hashes) !== JSON.stringify(backup.manifest.hashes)
    || JSON.stringify(deployment.changedPaths) !== JSON.stringify(backup.plan.changedPaths)
    || JSON.stringify(deployment.artifacts) !== JSON.stringify(artifactsFor(backup.plan))
    || JSON.stringify(deployment.artifacts?.changedPaths) !== JSON.stringify(deployment.changedPaths)
    || JSON.stringify(deployment.summary) !== JSON.stringify(backup.plan.summary)
    || deployment.transaction?.contract !== 'atom.world-receipt'
    || deployment.transaction?.version !== 1
    || deployment.transaction?.beforeRevision !== deployment.revisions.source
    || deployment.transaction?.afterRevision !== deployment.revisions.target
    || deployment.transaction?.status !== 'committed'
    || deployment.rollback?.targetCommandId !== deployment.transaction.commandId
    || deployment.rollback?.expectedRevision !== deployment.revisions.target) {
    throw invalidReceipt();
  }
  return deployment;
}

async function writeNewJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function recoverApplyAttempt({ runtime, attemptId }) {
  const directory = await findAttemptBackup(runtime, attemptId);
  if (!directory) return null;
  const backup = await verifyBackup({ runtime, directory, attemptId });
  const correlationId = `${backup.manifest.migrationId}:attempt:${attemptId}`;
  const source = `generated-slot-print-migration:${backup.manifest.migrationId}`;
  const match = (record) => (
    record.command?.correlationId === correlationId && record.command?.payload?.source === source
  );
  let evidence = await verifyJournal(runtime.journalFile, `${runtime.journalFile}.d`, match);
  if (evidence.preparedCount) {
    await createTransactionalWorldPersistence({
      contextFile: runtime.contextFile,
      projectionFile: runtime.graphFile,
      journalFile: runtime.journalFile
    }).recover();
    evidence = await verifyJournal(runtime.journalFile, `${runtime.journalFile}.d`, match);
  }
  const current = await readWorld(runtime.contextFile);
  const { matches } = evidence;
  if (matches.length !== 1) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT',
      'Existing attempt has no unique committed central transaction; it will not be replayed'
    );
  }
  const candidate = deploymentReceipt({
    runtime,
    backup,
    transaction: matches[0].receipt,
    recovered: true,
    warnings: [{ code: 'GENERATED_SLOT_PRINT_MIGRATION_RECEIPT_RECOVERED' }]
  });
  validateCommittedRecord({ record: matches[0], deployment: candidate, currentRevision: current.revision });
  const receiptFile = path.join(directory, 'deployment-receipt.json');
  try {
    const existing = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    validateDeploymentShape({ deployment: existing, runtime, backup });
    if (existing.transaction.commandId !== candidate.transaction.commandId) throw invalidReceipt();
    return { ...existing, receiptFile, recovered: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeNewJson(receiptFile, candidate);
  }
  return { ...candidate, receiptFile };
}

async function automaticRollback({ runtime, backup, committed, originalError }) {
  const persistence = createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: runtime.journalFile
  });
  let rollbackReceipt;
  let rollbackError;
  try {
    rollbackReceipt = await persistence.rollback({
      targetCommandId: committed.commandId,
      correlationId: `${backup.manifest.migrationId}:attempt:${backup.manifest.attemptId}:automatic-rollback`,
      expectedRevision: committed.afterRevision
    });
  } catch (error) {
    rollbackReceipt = error.details?.receipt?.status === 'committed' ? error.details.receipt : null;
    rollbackError = error;
  }
  const restored = await readWorld(runtime.contextFile);
  const restoredExactly = restored.revision === backup.plan.expectedRevision
    && JSON.stringify(restored.facts) === JSON.stringify(backup.sourceFacts);
  const failure = {
    contract: 'atom.generated-slot-print-failure-receipt',
    version: 1,
    migrationId: backup.manifest.migrationId,
    attemptId: backup.manifest.attemptId,
    error: { code: originalError.code ?? originalError.name, message: originalError.message },
    transaction: redactedTransactionReceipt(committed),
    rollback: rollbackReceipt ? redactedTransactionReceipt(rollbackReceipt) : null,
    rollbackError: rollbackError
      ? { code: rollbackError.code ?? rollbackError.name, message: rollbackError.message }
      : null,
    restoredExactly
  };
  await writeNewJson(path.join(backup.manifest.directory, 'failure-receipt.json'), failure);
  if (!rollbackReceipt || !restoredExactly) {
    originalError.details = {
      ...(originalError.details ?? {}),
      automaticRollback: { restoredExactly, error: rollbackError?.code ?? null }
    };
  }
}

async function applyMigration({ runtime, attemptId }) {
  const recovered = await recoverApplyAttempt({ runtime, attemptId });
  if (recovered) return recovered;
  let verified = await verifyStableJournalSources(runtime);
  let { journalEvidence } = verified;
  if (journalEvidence.preparedCount) {
    await createTransactionalWorldPersistence({
      contextFile: runtime.contextFile,
      projectionFile: runtime.graphFile,
      journalFile: runtime.journalFile
    }).recover();
    verified = await verifyStableJournalSources(runtime);
    ({ journalEvidence } = verified);
    if (journalEvidence.preparedCount) {
      throw problem(
        'GENERATED_SLOT_PRINT_MIGRATION_JOURNAL_UNSETTLED',
        'Transaction journal still has prepared records after central recovery'
      );
    }
  }
  const source = await readWorld(runtime.contextFile);
  verified = await verifyStableJournalSources(runtime);
  ({ journalEvidence } = verified);
  const plan = planGeneratedSlotPrintMigration(source.facts);
  if (plan.summary.migratedPrograms < 1 || plan.expectedRevision !== source.revision) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_NOT_REQUIRED',
      'Configured Atom world has no verified generated slot print migration candidates'
    );
  }
  const backup = await createBackup({
    runtime,
    plan,
    attemptId,
    source,
    journalEvidence,
    sources: verified.sources
  });
  const currentSources = await collectBackupSources(runtime);
  if (hash(await fs.readFile(runtime.contextFile)) !== backup.manifest.hashes.sourceFile
    || JSON.stringify(inventory(currentSources)) !== JSON.stringify(backup.manifest.files)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_DIVERGED',
      'Atom world or transaction journal changed after backup and before commit'
    );
  }
  let committed;
  try {
    const persistence = createTransactionalWorldPersistence({
      contextFile: runtime.contextFile,
      projectionFile: runtime.graphFile,
      journalFile: runtime.journalFile
    });
    committed = await persistence.commit({
      correlationId: `${backup.manifest.migrationId}:attempt:${attemptId}`,
      expectedRevision: plan.expectedRevision,
      nextRevision: plan.nextRevision,
      facts: plan.facts,
      source: `generated-slot-print-migration:${backup.manifest.migrationId}`,
      changedPaths: plan.changedPaths,
      affectedAtoms: plan.changedPaths.map((path) => ({ path, axes: ['situation'] })),
      affectedPathClosureComplete: true,
      relationEndpoints: [],
      lockPaths: [],
      shortcutPaths: [],
      referencePaths: plan.changedPaths
    });
    const deployed = await readWorld(runtime.contextFile);
    if (deployed.revision !== plan.nextRevision) {
      throw problem(
        'GENERATED_SLOT_PRINT_MIGRATION_POSTCHECK_FAILED',
        'Committed generated slot print migration failed its revision postcheck'
      );
    }
    const deployment = deploymentReceipt({ runtime, backup, transaction: committed });
    const receiptFile = path.join(backup.manifest.directory, 'deployment-receipt.json');
    await writeNewJson(receiptFile, deployment);
    return { ...deployment, receiptFile };
  } catch (error) {
    committed ??= error.details?.receipt?.status === 'committed' ? error.details.receipt : null;
    if (committed) await automaticRollback({ runtime, backup, committed, originalError: error });
    throw error;
  }
}

async function rollbackMigration({ runtime, receiptFile }) {
  const deployment = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  requireAttemptId(deployment?.attemptId);
  const expectedDirectory = path.join(
    runtime.backupRoot,
    String(deployment?.migrationId ?? ''),
    deployment.attemptId
  );
  if (!samePath(receiptFile, path.join(expectedDirectory, 'deployment-receipt.json'))) {
    throw invalidReceipt('Rollback receipt must be the private deployment receipt for this world');
  }
  const backup = await verifyBackup({
    runtime,
    directory: expectedDirectory,
    attemptId: deployment.attemptId
  });
  validateDeploymentShape({ deployment, runtime, backup });
  const current = await readWorld(runtime.contextFile);
  const record = await createJsonTransactionJournal({
    file: runtime.journalFile
  }).findCommitted(deployment.transaction.commandId);
  validateCommittedRecord({ record, deployment, currentRevision: current.revision });
  const persistence = createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: runtime.journalFile
  });
  let receipt;
  let warning;
  try {
    receipt = await persistence.rollback({
      targetCommandId: deployment.transaction.commandId,
      correlationId: `${deployment.migrationId}:attempt:${deployment.attemptId}:operator-rollback`,
      expectedRevision: deployment.revisions.target
    });
  } catch (error) {
    if (error.details?.receipt?.status !== 'committed') throw error;
    receipt = error.details.receipt;
    warning = { code: error.code ?? error.name, cause: error.details?.cause ?? null };
  }
  const restored = await readWorld(runtime.contextFile);
  if (receipt.afterRevision !== deployment.revisions.source
    || restored.revision !== deployment.revisions.source
    || JSON.stringify(restored.facts) !== JSON.stringify(backup.sourceFacts)) {
    throw problem(
      'GENERATED_SLOT_PRINT_MIGRATION_ROLLBACK_POSTCHECK_FAILED',
      'Central rollback did not restore the private source snapshot'
    );
  }
  const result = {
    contract: 'atom.generated-slot-print-rollback-receipt',
    version: 1,
    action: 'rollback',
    migrationId: deployment.migrationId,
    attemptId: deployment.attemptId,
    revision: restored.revision,
    transaction: redactedTransactionReceipt(receipt),
    ...(warning ? { warnings: [warning] } : { warnings: [] })
  };
  await writeNewJson(path.join(expectedDirectory, 'rollback-receipt.json'), result);
  return result;
}

export async function runGeneratedSlotPrintMaintenance(argv, configuredRuntime = resolveAtomRuntime()) {
  const mode = parseMode(argv);
  const runtime = await trustedRuntime(configuredRuntime);
  if (mode.action === 'rollback') return rollbackMigration({ runtime, receiptFile: mode.receiptFile });
  if (mode.action === 'apply') return applyMigration({ runtime, attemptId: mode.attemptId });
  const source = await readWorld(runtime.contextFile);
  const plan = planGeneratedSlotPrintMigration(source.facts);
  return preflightFor({ plan, source, attemptId: mode.attemptId, action: mode.action });
}

async function main() {
  const result = await runGeneratedSlotPrintMaintenance(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code ?? error.name,
      message: error.message,
      details: error.details ?? null
    })}\n`);
    process.exitCode = 1;
  });
}
