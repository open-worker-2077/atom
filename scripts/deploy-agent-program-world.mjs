import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import {
  applyAgentProgramMigration,
  planAgentProgramMigration,
  rollbackAgentProgramMigration
} from '../src/atom-system/operations/agent-program-migration.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function hashBytes(bytes) {
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

async function assertNoReparseAncestors(candidate) {
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
        'AGENT_MIGRATION_UNSAFE_BACKUP_PATH',
        'Agent Program migration refuses a symlink, junction, or reparse-point path',
        { path: current }
      );
    }
  }
}

async function assertRealDirectoryContained(root, directory) {
  await assertNoReparseAncestors(directory);
  const [realRoot, realDirectory] = await Promise.all([fs.realpath(root), fs.realpath(directory)]);
  if (!isContained(realRoot, realDirectory)) {
    throw problem(
      'AGENT_MIGRATION_UNSAFE_BACKUP_PATH',
      'Agent Program migration backup escaped the configured world',
      { directory }
    );
  }
  return realDirectory;
}

async function trustedRuntime(runtime) {
  await assertNoReparseAncestors(runtime.worldDirectory);
  const worldDirectory = await fs.realpath(runtime.worldDirectory);
  if (!samePath(worldDirectory, runtime.worldDirectory)
    || !isContained(worldDirectory, runtime.contextFile)
    || !isContained(worldDirectory, runtime.graphFile)) {
    throw problem(
      'AGENT_MIGRATION_UNSAFE_BACKUP_PATH',
      'Configured Atom world paths are not canonical and contained'
    );
  }
  return Object.freeze({
    ...runtime,
    worldDirectory,
    contextFile: path.join(worldDirectory, path.basename(runtime.contextFile)),
    graphFile: path.join(worldDirectory, path.basename(runtime.graphFile)),
    backupRoot: path.join(worldDirectory, 'migration-backups', 'agent-program')
  });
}

function requireAttemptId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw problem(
      'INVALID_AGENT_MIGRATION_ATTEMPT_ID',
      'Agent Program migration attempt id must be a path-safe stable token'
    );
  }
  return value;
}

function parseMode(argv) {
  if (argv.length === 3
    && (argv[0] === '--dry-run' || argv[0] === '--apply')
    && argv[1] === '--attempt') {
    return Object.freeze({
      action: argv[0] === '--apply' ? 'apply' : 'dry-run',
      attemptId: requireAttemptId(argv[2])
    });
  }
  if (argv.length === 2 && argv[0] === '--rollback' && argv[1]) {
    return Object.freeze({ action: 'rollback', receiptFile: path.resolve(argv[1]) });
  }
  throw problem(
    'INVALID_AGENT_MIGRATION_OPERATOR_MODE',
    'Use exactly --dry-run --attempt <id>, --apply --attempt <id>, or --rollback <receipt>'
  );
}

function redactedTransactionReceipt(receipt) {
  const allowed = [
    'contract', 'version', 'commandId', 'correlationId', 'beforeRevision',
    'afterRevision', 'status', 'committedAt'
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(receipt ?? {}, key))
    .map((key) => [key, structuredClone(receipt[key])]));
}

async function readWorld(contextFile) {
  const bytes = await fs.readFile(contextFile);
  const facts = JSON.parse(bytes.toString('utf8'));
  return { bytes, facts, revision: revisionOfWorldFacts(facts) };
}

function createPrivateBackupPort({ runtime, sourceBytes, sourceRevision, sourceFactsHash }) {
  const { backupRoot } = runtime;
  return Object.freeze({
    async create(request) {
      if (request.revision !== sourceRevision || request.factsHash !== sourceFactsHash) {
        throw problem(
          'AGENT_MIGRATION_BACKUP_VERIFICATION_FAILED',
          'Backup request no longer matches the operator source snapshot'
        );
      }
      const directory = path.join(backupRoot, request.migrationId, request.attemptId);
      await assertNoReparseAncestors(directory);
      await fs.mkdir(path.dirname(directory), { recursive: true });
      await assertRealDirectoryContained(runtime.worldDirectory, path.dirname(directory));
      try {
        await fs.mkdir(directory, { recursive: false });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        throw problem(
          'AGENT_MIGRATION_ATTEMPT_BACKUP_CONFLICT',
          'This Agent Program migration attempt already has a private backup',
          { migrationId: request.migrationId, attemptId: request.attemptId }
        );
      }
      await assertRealDirectoryContained(runtime.worldDirectory, directory);
      const copiedFile = path.join(directory, 'atom.json');
      await assertRealDirectoryContained(runtime.worldDirectory, directory);
      await fs.writeFile(copiedFile, sourceBytes, { flag: 'wx' });
      const copiedFileHash = hashBytes(await fs.readFile(copiedFile));
      const receiptFile = path.join(directory, 'backup-receipt.json');
      const receipt = Object.freeze({
        contract: 'atom.agent-program-private-backup',
        version: 1,
        migrationId: request.migrationId,
        attemptId: request.attemptId,
        directory,
        sourceFile: runtime.contextFile,
        copiedFile,
        sourceFileHash: hashBytes(sourceBytes),
        copiedFileHash,
        sourceRevision,
        sourceFactsHash,
        targetRevision: request.targetRevision,
        targetFactsHash: request.targetFactsHash,
        summary: structuredClone(request.summary),
        receiptFile
      });
      await assertRealDirectoryContained(runtime.worldDirectory, directory);
      await fs.writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx'
      });
      return receipt;
    },
    async verify({ receipt, revision, factsHash }) {
      if (receipt?.contract !== 'atom.agent-program-private-backup'
        || receipt.version !== 1
        || receipt.sourceFile !== runtime.contextFile
        || receipt.sourceRevision !== revision
        || receipt.sourceFactsHash !== factsHash
        || receipt.sourceFileHash !== hashBytes(sourceBytes)) return false;
      await assertRealDirectoryContained(runtime.worldDirectory, receipt.directory);
      const copiedBytes = await fs.readFile(receipt.copiedFile);
      if (receipt.copiedFileHash !== hashBytes(copiedBytes)
        || receipt.sourceFileHash !== receipt.copiedFileHash) return false;
      const copiedFacts = JSON.parse(copiedBytes.toString('utf8'));
      return revisionOfWorldFacts(copiedFacts) === revision;
    }
  });
}

function invalidReceipt(message = 'Deployment receipt is not bound to the durable Agent migration') {
  return problem('INVALID_AGENT_MIGRATION_RECEIPT', message);
}

function recordRevisions(record) {
  return record?.historyMode === 'local-patch'
    ? { before: record.patch?.beforeRevision, after: record.patch?.afterRevision }
    : { before: record?.before?.revision, after: record?.after?.revision };
}

function validateCommittedMigrationRecord({
  record,
  migrationId,
  attemptId,
  commandId,
  sourceRevision,
  targetRevision,
  currentRevision
}) {
  const correlationId = `${migrationId}:attempt:${attemptId}`;
  const source = `agent-program-migration:${migrationId}`;
  const revisions = recordRevisions(record);
  if (!record
    || record.commandId !== commandId
    || record.command?.commandId !== commandId
    || record.command?.contract !== 'atom.world-command'
    || record.command?.version !== 1
    || record.command?.name !== 'legacy-transition'
    || record.command?.correlationId !== correlationId
    || record.correlationId !== correlationId
    || record.command?.expectedRevision !== sourceRevision
    || record.command?.payload?.source !== source
    || revisions.before !== sourceRevision
    || revisions.after !== targetRevision
    || record.receipt?.commandId !== commandId
    || record.receipt?.correlationId !== correlationId
    || record.receipt?.beforeRevision !== sourceRevision
    || record.receipt?.afterRevision !== targetRevision
    || record.receipt?.status !== 'committed'
    || record.receipt?.source !== source
    || currentRevision !== targetRevision) {
    throw invalidReceipt();
  }
  return record.receipt;
}

async function findAttemptBackup(runtime, attemptId) {
  await assertNoReparseAncestors(runtime.backupRoot);
  let entries;
  try {
    entries = await fs.readdir(runtime.backupRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  await assertRealDirectoryContained(runtime.worldDirectory, runtime.backupRoot);
  const candidates = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw problem(
        'AGENT_MIGRATION_UNSAFE_BACKUP_PATH',
        'Agent Program migration refuses a linked private backup directory'
      );
    }
    if (!entry.isDirectory()) continue;
    const candidate = path.join(runtime.backupRoot, entry.name, attemptId);
    let stat;
    try {
      stat = await fs.lstat(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw problem(
        'AGENT_MIGRATION_UNSAFE_BACKUP_PATH',
        'Agent Program migration attempt backup is not a trusted directory'
      );
    }
    await assertRealDirectoryContained(runtime.worldDirectory, candidate);
    candidates.push(candidate);
  }
  if (candidates.length > 1) {
    throw problem(
      'AGENT_MIGRATION_ATTEMPT_BACKUP_CONFLICT',
      'This attempt id belongs to more than one Agent Program migration'
    );
  }
  return candidates[0] ?? null;
}

async function loadVerifiedBackup({ runtime, directory, attemptId, programScheduler }) {
  await assertRealDirectoryContained(runtime.worldDirectory, directory);
  const receiptFile = path.join(directory, 'backup-receipt.json');
  const copiedFile = path.join(directory, 'atom.json');
  let receipt;
  let bytes;
  try {
    [receipt, bytes] = await Promise.all([
      fs.readFile(receiptFile, 'utf8').then(JSON.parse),
      fs.readFile(copiedFile)
    ]);
  } catch (error) {
    throw problem(
      'AGENT_MIGRATION_ATTEMPT_BACKUP_CONFLICT',
      'Existing Agent Program migration backup is incomplete',
      { cause: error.code ?? error.name }
    );
  }
  const facts = JSON.parse(bytes.toString('utf8'));
  const revision = revisionOfWorldFacts(facts);
  const plan = await planAgentProgramMigration({
    snapshot: { facts, revision },
    programScheduler
  });
  if (receipt?.contract !== 'atom.agent-program-private-backup'
    || receipt.version !== 1
    || receipt.attemptId !== attemptId
    || receipt.migrationId !== plan.migrationId
    || !samePath(receipt.directory, directory)
    || !samePath(receipt.sourceFile, runtime.contextFile)
    || !samePath(receipt.copiedFile, copiedFile)
    || !samePath(receipt.receiptFile, receiptFile)
    || receipt.sourceFileHash !== hashBytes(bytes)
    || receipt.copiedFileHash !== hashBytes(bytes)
    || receipt.sourceRevision !== plan.expectedRevision
    || receipt.sourceFactsHash !== plan.sourceFactsHash
    || receipt.targetRevision !== plan.nextRevision
    || receipt.targetFactsHash !== plan.nextFactsHash
    || JSON.stringify(receipt.summary) !== JSON.stringify(plan.summary)) {
    throw problem(
      'AGENT_MIGRATION_ATTEMPT_BACKUP_CONFLICT',
      'Existing Agent Program migration backup failed verification'
    );
  }
  return { receipt, plan };
}

function deploymentReceipt({ runtime, journalFile, plan, migration, deployedRevision, warnings }) {
  return Object.freeze({
    contract: 'atom.agent-program-deployment-receipt',
    version: 1,
    action: 'apply',
    attemptId: migration.attemptId,
    migrationId: migration.migrationId,
    paths: {
      contextFile: runtime.contextFile,
      graphFile: runtime.graphFile,
      journalFile,
      backupDirectory: migration.backup.directory
    },
    hashes: {
      sourceFile: migration.backup.sourceFileHash,
      sourceFacts: migration.backup.sourceFactsHash,
      targetFacts: migration.backup.targetFactsHash
    },
    revisions: {
      source: plan.expectedRevision,
      target: plan.nextRevision,
      deployed: deployedRevision
    },
    counts: structuredClone(plan.summary),
    backup: structuredClone(migration.backup),
    transaction: structuredClone(migration.receipt),
    rollback: structuredClone(migration.rollback),
    warnings: structuredClone(warnings ?? [])
  });
}

async function writeDeploymentReceipt({ runtime, deployment }) {
  const receiptFile = path.join(deployment.paths.backupDirectory, 'deployment-receipt.json');
  await assertRealDirectoryContained(runtime.worldDirectory, deployment.paths.backupDirectory);
  await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  return receiptFile;
}

function existingDeploymentMatches({ existing, reconstructed }) {
  const transaction = reconstructed.transaction;
  return existing?.contract === reconstructed.contract
    && existing.version === reconstructed.version
    && existing.action === reconstructed.action
    && existing.attemptId === reconstructed.attemptId
    && existing.migrationId === reconstructed.migrationId
    && JSON.stringify(existing.paths) === JSON.stringify(reconstructed.paths)
    && JSON.stringify(existing.hashes) === JSON.stringify(reconstructed.hashes)
    && JSON.stringify(existing.revisions) === JSON.stringify(reconstructed.revisions)
    && JSON.stringify(existing.counts) === JSON.stringify(reconstructed.counts)
    && existing.backup?.migrationId === reconstructed.backup.migrationId
    && existing.backup?.attemptId === reconstructed.backup.attemptId
    && existing.backup?.sourceRevision === reconstructed.backup.sourceRevision
    && existing.backup?.targetRevision === reconstructed.backup.targetRevision
    && existing.transaction?.commandId === transaction.commandId
    && existing.transaction?.correlationId === transaction.correlationId
    && existing.transaction?.beforeRevision === transaction.beforeRevision
    && existing.transaction?.afterRevision === transaction.afterRevision
    && existing.transaction?.status === 'committed'
    && existing.rollback?.targetCommandId === reconstructed.rollback.targetCommandId
    && existing.rollback?.expectedRevision === reconstructed.rollback.expectedRevision
    && Array.isArray(existing.warnings);
}

async function recoverApplyAttempt({ runtime, attemptId, programScheduler }) {
  const directory = await findAttemptBackup(runtime, attemptId);
  if (!directory) return null;
  const { receipt: backup, plan } = await loadVerifiedBackup({
    runtime,
    directory,
    attemptId,
    programScheduler
  });
  const current = await readWorld(runtime.contextFile);
  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const state = await createJsonTransactionJournal({ file: journalFile }).readState();
  const correlationId = `${plan.migrationId}:attempt:${attemptId}`;
  const matches = state.receipts.filter((record) => (
    record.command?.correlationId === correlationId
      && record.command?.payload?.source === `agent-program-migration:${plan.migrationId}`
  ));
  if (matches.length !== 1) throw invalidReceipt('Durable Agent migration commit cannot be reconstructed');
  const record = matches[0];
  const committed = validateCommittedMigrationRecord({
    record,
    migrationId: plan.migrationId,
    attemptId,
    commandId: record.commandId,
    sourceRevision: plan.expectedRevision,
    targetRevision: plan.nextRevision,
    currentRevision: current.revision
  });
  const migration = {
    contract: 'atom.agent-program-migration-receipt',
    version: 1,
    migrationId: plan.migrationId,
    attemptId,
    sourceRevision: plan.expectedRevision,
    targetRevision: plan.nextRevision,
    summary: structuredClone(plan.summary),
    backup: structuredClone(backup),
    receipt: redactedTransactionReceipt(committed),
    rollback: {
      targetCommandId: committed.commandId,
      expectedRevision: plan.nextRevision
    }
  };
  const warnings = [{ code: 'AGENT_MIGRATION_DEPLOYMENT_RECEIPT_RECOVERED' }];
  const deployment = deploymentReceipt({
    runtime,
    journalFile,
    plan,
    migration,
    deployedRevision: current.revision,
    warnings
  });
  const receiptFile = path.join(directory, 'deployment-receipt.json');
  try {
    const existing = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    if (!existingDeploymentMatches({ existing, reconstructed: deployment })) {
      throw invalidReceipt('Existing deployment receipt conflicts with durable migration evidence');
    }
    return { ...existing, receiptFile, recovered: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeDeploymentReceipt({ runtime, deployment });
  }
  return { ...deployment, receiptFile, recovered: true };
}

async function apply(mode, runtime) {
  const programScheduler = createProgramRuntimeScheduler({ timeoutMs: 10_000 });
  if (mode.action === 'apply') {
    const recovered = await recoverApplyAttempt({
      runtime,
      attemptId: mode.attemptId,
      programScheduler
    });
    if (recovered) {
      process.stdout.write(`${JSON.stringify(recovered)}\n`);
      return;
    }
  }
  const source = await readWorld(runtime.contextFile);
  const plan = await planAgentProgramMigration({
    snapshot: { facts: source.facts, revision: source.revision },
    programScheduler
  });
  const preflight = {
    contract: 'atom.agent-program-migration-preflight',
    version: 1,
    action: mode.action,
    attemptId: mode.attemptId,
    migrationId: plan.migrationId,
    revisions: { source: plan.expectedRevision, target: plan.nextRevision },
    hashes: {
      sourceFile: hashBytes(source.bytes),
      sourceFacts: plan.sourceFactsHash,
      targetFacts: plan.nextFactsHash
    },
    summary: structuredClone(plan.summary)
  };
  if (mode.action === 'dry-run') {
    process.stdout.write(`${JSON.stringify(preflight)}\n`);
    return;
  }

  const journalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const persistence = createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile
  });
  const backup = createPrivateBackupPort({
    runtime,
    sourceBytes: source.bytes,
    sourceRevision: source.revision,
    sourceFactsHash: plan.sourceFactsHash
  });
  const migration = await applyAgentProgramMigration({
    plan,
    confirmation: true,
    backup,
    persistence,
    attemptId: mode.attemptId
  });
  const deployed = await readWorld(runtime.contextFile);
  if (deployed.revision !== plan.nextRevision) {
    throw problem(
      'AGENT_MIGRATION_POSTCHECK_FAILED',
      'Committed Agent Program migration revision failed postcheck',
      { expectedRevision: plan.nextRevision, actualRevision: deployed.revision }
    );
  }
  const deployment = deploymentReceipt({
    runtime,
    journalFile,
    plan,
    migration,
    deployedRevision: deployed.revision,
    warnings: migration.warnings
  });
  const receiptFile = await writeDeploymentReceipt({ runtime, deployment });
  process.stdout.write(`${JSON.stringify({
    ...deployment,
    receiptFile
  })}\n`);
}

async function rollback(mode, runtime) {
  const deployment = JSON.parse(await fs.readFile(mode.receiptFile, 'utf8'));
  const configuredJournalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  const expectedCorrelationId = `${deployment?.migrationId}:attempt:${deployment?.attemptId}`;
  const expectedBackupDirectory = path.join(
    runtime.backupRoot,
    String(deployment?.migrationId ?? ''),
    String(deployment?.attemptId ?? '')
  );
  if (deployment?.contract !== 'atom.agent-program-deployment-receipt'
    || deployment.version !== 1
    || deployment.action !== 'apply'
    || deployment.paths?.contextFile !== runtime.contextFile
    || deployment.paths?.graphFile !== runtime.graphFile
    || deployment.paths?.journalFile !== configuredJournalFile
    || typeof deployment.migrationId !== 'string'
    || typeof deployment.attemptId !== 'string'
    || typeof deployment.revisions?.source !== 'string'
    || typeof deployment.revisions?.target !== 'string'
    || deployment.revisions.deployed !== deployment.revisions.target
    || !samePath(deployment.paths?.backupDirectory ?? '', expectedBackupDirectory)
    || deployment.transaction?.contract !== 'atom.world-receipt'
    || deployment.transaction?.version !== 1
    || deployment.transaction?.commandId !== deployment.rollback?.targetCommandId
    || deployment.transaction?.correlationId !== expectedCorrelationId
    || deployment.transaction?.beforeRevision !== deployment.revisions.source
    || deployment.transaction?.afterRevision !== deployment.revisions.target
    || deployment.transaction?.status !== 'committed'
    || deployment.rollback?.expectedRevision !== deployment.revisions.target
    || deployment.backup?.migrationId !== deployment.migrationId
    || deployment.backup?.attemptId !== deployment.attemptId
    || deployment.backup?.sourceRevision !== deployment.revisions.source
    || deployment.backup?.targetRevision !== deployment.revisions.target) {
    throw invalidReceipt('Deployment receipt does not match the configured Atom world');
  }
  await assertRealDirectoryContained(runtime.worldDirectory, deployment.paths.backupDirectory);
  const current = await readWorld(runtime.contextFile);
  const journal = createJsonTransactionJournal({ file: configuredJournalFile });
  const record = await journal.findCommitted(deployment.transaction.commandId);
  validateCommittedMigrationRecord({
    record,
    migrationId: deployment.migrationId,
    attemptId: deployment.attemptId,
    commandId: deployment.transaction.commandId,
    sourceRevision: deployment.revisions.source,
    targetRevision: deployment.revisions.target,
    currentRevision: current.revision
  });
  const persistence = createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: configuredJournalFile
  });
  const receipt = await rollbackAgentProgramMigration({
    migration: {
      contract: 'atom.agent-program-migration-receipt',
      version: 1,
      migrationId: deployment.migrationId,
      sourceRevision: deployment.revisions.source,
      rollback: structuredClone(deployment.rollback)
    },
    persistence,
    correlationId: `${deployment.migrationId}:attempt:${deployment.attemptId}:operator-rollback`
  });
  const restored = await readWorld(runtime.contextFile);
  const ok = restored.revision === deployment.revisions.source
    && receipt.afterRevision === deployment.revisions.source;
  process.stdout.write(`${JSON.stringify({
    ok,
    action: 'rollback',
    migrationId: deployment.migrationId,
    revision: restored.revision,
    receipt: redactedTransactionReceipt(receipt),
    warnings: structuredClone(receipt.warnings ?? [])
  })}\n`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const runtime = await trustedRuntime(resolveAtomRuntime());
  if (mode.action === 'rollback') {
    await rollback(mode, runtime);
    return;
  }
  await apply(mode, runtime);
}

await main();
