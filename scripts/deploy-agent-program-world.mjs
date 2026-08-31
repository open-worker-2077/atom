import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
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
  const backupRoot = path.join(runtime.worldDirectory, 'migration-backups', 'agent-program');
  return Object.freeze({
    async create(request) {
      if (request.revision !== sourceRevision || request.factsHash !== sourceFactsHash) {
        throw problem(
          'AGENT_MIGRATION_BACKUP_VERIFICATION_FAILED',
          'Backup request no longer matches the operator source snapshot'
        );
      }
      const directory = path.join(backupRoot, request.migrationId, request.attemptId);
      await fs.mkdir(path.dirname(directory), { recursive: true });
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
      const copiedFile = path.join(directory, 'atom.json');
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
        receiptFile
      });
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
      const copiedBytes = await fs.readFile(receipt.copiedFile);
      if (receipt.copiedFileHash !== hashBytes(copiedBytes)
        || receipt.sourceFileHash !== receipt.copiedFileHash) return false;
      const copiedFacts = JSON.parse(copiedBytes.toString('utf8'));
      return revisionOfWorldFacts(copiedFacts) === revision;
    }
  });
}

async function apply(mode, runtime) {
  const source = await readWorld(runtime.contextFile);
  const programScheduler = createProgramRuntimeScheduler({ timeoutMs: 10_000 });
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
  const receiptFile = path.join(migration.backup.directory, 'deployment-receipt.json');
  const deployment = Object.freeze({
    contract: 'atom.agent-program-deployment-receipt',
    version: 1,
    action: 'apply',
    attemptId: mode.attemptId,
    migrationId: migration.migrationId,
    paths: {
      contextFile: runtime.contextFile,
      graphFile: runtime.graphFile,
      journalFile,
      backupDirectory: migration.backup.directory
    },
    hashes: structuredClone(preflight.hashes),
    revisions: {
      source: plan.expectedRevision,
      target: plan.nextRevision,
      deployed: deployed.revision
    },
    counts: structuredClone(plan.summary),
    backup: structuredClone(migration.backup),
    transaction: structuredClone(migration.receipt),
    rollback: structuredClone(migration.rollback)
  });
  await fs.writeFile(receiptFile, `${JSON.stringify(deployment, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  if (deployed.revision !== plan.nextRevision) {
    throw problem(
      'AGENT_MIGRATION_POSTCHECK_FAILED',
      'Committed Agent Program migration revision failed postcheck',
      { receiptFile, expectedRevision: plan.nextRevision, actualRevision: deployed.revision }
    );
  }
  process.stdout.write(`${JSON.stringify({
    ...deployment,
    receiptFile
  })}\n`);
}

async function rollback(mode, runtime) {
  const deployment = JSON.parse(await fs.readFile(mode.receiptFile, 'utf8'));
  const configuredJournalFile = path.join(runtime.worldDirectory, 'atom.transactions.json');
  if (deployment?.contract !== 'atom.agent-program-deployment-receipt'
    || deployment.version !== 1
    || deployment.paths?.contextFile !== runtime.contextFile
    || deployment.paths?.graphFile !== runtime.graphFile
    || deployment.paths?.journalFile !== configuredJournalFile
    || typeof deployment.migrationId !== 'string'
    || deployment.transaction?.commandId !== deployment.rollback?.targetCommandId
    || deployment.rollback?.expectedRevision !== deployment.revisions?.target) {
    throw problem(
      'INVALID_AGENT_MIGRATION_RECEIPT',
      'Deployment receipt does not match the configured Atom world'
    );
  }
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
    receipt: redactedTransactionReceipt(receipt)
  })}\n`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const runtime = resolveAtomRuntime();
  if (mode.action === 'rollback') {
    await rollback(mode, runtime);
    return;
  }
  await apply(mode, runtime);
}

await main();
