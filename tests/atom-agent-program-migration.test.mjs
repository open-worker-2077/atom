import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  applyAgentProgramMigration,
  planAgentProgramMigration,
  rollbackAgentProgramMigration
} from '../src/atom-system/operations/agent-program-migration.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const operator = path.join(projectRoot, 'scripts', 'deploy-agent-program-world.mjs');
const programScheduler = createProgramRuntimeScheduler({ timeoutMs: 2_000 });

function atom(key, name, situation = '', contain = []) {
  return { [key]: name, situation, contain, support: [] };
}

function fieldByBase(record, base) {
  return Object.entries(record).find(([key]) => key.split(/[@#$~]/u, 1)[0] === base);
}

async function validPlan() {
  const facts = [atom('thing@agent', 'LegacyWindow', 'original human context')];
  return planAgentProgramMigration({
    snapshot: { facts, revision: revisionOfWorldFacts(facts) },
    programScheduler
  });
}

function backupPort(verified, calls = []) {
  return {
    async create(request) {
      calls.push({ operation: 'backup.create', request: structuredClone(request) });
      return { id: 'backup-1', hash: 'sha256:verified-source' };
    },
    async verify(request) {
      calls.push({ operation: 'backup.verify', request: structuredClone(request) });
      return verified;
    }
  };
}

function persistencePort(plan, calls = []) {
  return {
    async commit(request) {
      calls.push({ operation: 'commit', request: structuredClone(request) });
      return {
        contract: 'atom.world-receipt',
        version: 1,
        commandId: 'agent-migration-command-1',
        beforeRevision: request.expectedRevision,
        afterRevision: request.nextRevision,
        status: 'committed'
      };
    },
    async rollback(request) {
      calls.push({ operation: 'rollback', request: structuredClone(request) });
      return {
        contract: 'atom.world-receipt',
        version: 1,
        commandId: 'agent-migration-rollback-1',
        beforeRevision: request.expectedRevision,
        afterRevision: plan.expectedRevision,
        status: 'committed'
      };
    }
  };
}

test('migration upgrades active legacy Agents and demotes archived ones without losing metadata', async () => {
  const legacyProgramSource = 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore"]}})';
  const world = [
    atom('thing@note@agent#legacy', 'LegacyWindow', 'original human context'),
    atom('thing@program@agent#declared', 'LegacyProgram', legacyProgramSource),
    atom('thing@backup@default', 'Backup', '', [
      atom('thing@marker@program@agent#archived', 'ArchivedProgram', 'archived bytes')
    ])
  ];
  const snapshot = { facts: world, revision: revisionOfWorldFacts(world) };

  const plan = await planAgentProgramMigration({ snapshot, programScheduler });

  assert.equal(JSON.stringify(plan.facts).includes('@agent'), false);
  assert.deepEqual(fieldByBase(plan.facts[0], 'thing'), ['thing@note@program#legacy', 'LegacyWindow']);
  assert.equal(plan.facts[0].situation, [
    'LEGACY_AGENT_SITUATION = "original human context"',
    'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})'
  ].join('\n'));
  assert.deepEqual(fieldByBase(plan.facts[1], 'thing'), ['thing@program#declared', 'LegacyProgram']);
  assert.equal(plan.facts[1].situation, legacyProgramSource);
  assert.deepEqual(
    fieldByBase(plan.facts[2].contain[0], 'thing'),
    ['thing@marker#archived', 'ArchivedProgram']
  );
  assert.equal(plan.facts[2].contain[0].situation, 'archived bytes');
  assert.deepEqual(plan.summary, {
    activePureAgentsUpgraded: 1,
    activeProgramAgentsUpgraded: 1,
    archivedAgentsDemoted: 1,
    ambiguousSources: 0
  });
});

test('migration rejects zero, dynamic, and multiple active Program Agent declarations as one ambiguous batch', async () => {
  const sources = [
    'message({"level":"info","text":"no declaration"})',
    'spec = {"functions":{"groups":[],"names":["explore"]}}\nagent(spec)',
    [
      'agent({"functions":{"groups":[],"names":["explore"]}})',
      'agent({"functions":{"groups":[],"names":["explore"]}})'
    ].join('\n')
  ];
  for (const [index, source] of sources.entries()) {
    const world = [atom('thing@program@agent', `Broken ${index}`, source)];
    const before = structuredClone(world);
    await assert.rejects(
      planAgentProgramMigration({
        snapshot: { facts: world, revision: revisionOfWorldFacts(world) },
        programScheduler
      }),
      (error) => error.code === 'AGENT_MIGRATION_SOURCE_AMBIGUOUS'
    );
    assert.deepEqual(world, before);
  }
});

test('migration rejects reconstructed-key collisions without mutating the source snapshot', async () => {
  const world = [{
    'thing@agent': 'Legacy',
    'thing@program': 'Collision',
    situation: 'original',
    contain: [],
    support: []
  }];
  const before = structuredClone(world);

  await assert.rejects(
    planAgentProgramMigration({
      snapshot: { facts: world, revision: revisionOfWorldFacts(world) },
      programScheduler
    }),
    { code: 'AGENT_MIGRATION_KEY_COLLISION' }
  );
  assert.deepEqual(world, before);
});

test('migration preserves support payload objects without interpreting them as Atom fields', async () => {
  const world = [atom('thing@agent', 'Legacy', 'source')];
  world[0].support = [
    { verb: '历史关联', object: 'Target/对象' },
    { 'if@current': true, then: [{ thing: 'Target' }] }
  ];

  const plan = await planAgentProgramMigration({
    snapshot: { facts: world, revision: revisionOfWorldFacts(world) },
    programScheduler
  });

  assert.deepEqual(plan.facts[0].support, world[0].support);
});

test('migration plan is revision-bound, independently cloned, and target-authorized by the scheduler', async () => {
  const world = [atom('thing@agent', 'Legacy', 'private source bytes')];
  const sourceRevision = revisionOfWorldFacts(world);
  let inspectedTarget = null;
  const scheduler = {
    async deriveAgentSecurity(facts) {
      inspectedTarget = structuredClone(facts);
      return new Map([['Legacy', { labels: [], functions: ['explore'] }]]);
    }
  };

  const plan = await planAgentProgramMigration({
    snapshot: { facts: world, revision: sourceRevision },
    programScheduler: scheduler
  });

  assert.equal(plan.contract, 'atom.agent-program-migration-plan');
  assert.equal(plan.version, 1);
  assert.equal(plan.expectedRevision, sourceRevision);
  assert.equal(plan.nextRevision, revisionOfWorldFacts(plan.facts));
  assert.match(plan.sourceFactsHash, /^sha256:/u);
  assert.match(plan.nextFactsHash, /^sha256:/u);
  assert.equal(JSON.stringify(inspectedTarget).includes('@agent'), false);
  world[0].situation = 'caller mutation';
  assert.equal(plan.sourceFacts[0].situation, 'private source bytes');
  assert.notEqual(plan.facts, inspectedTarget);
});

test('migration fails closed when target derivation does not prove every upgraded path', async () => {
  const world = [atom('thing@agent', 'Legacy', '')];
  await assert.rejects(
    planAgentProgramMigration({
      snapshot: { facts: world, revision: revisionOfWorldFacts(world) },
      programScheduler: { deriveAgentSecurity: async () => new Map() }
    }),
    (error) => error.code === 'AGENT_MIGRATION_SOURCE_AMBIGUOUS'
      && error.details.paths[0] === 'Legacy'
  );
});

test('apply validates confirmation and immutable plan hashes before any side effect', async () => {
  const plan = await validPlan();
  const calls = [];
  const backup = backupPort(true, calls);
  const persistence = persistencePort(plan, calls);

  await assert.rejects(
    applyAgentProgramMigration({
      plan, confirmation: false, backup, persistence, attemptId: 'confirm-rejected'
    }),
    { code: 'AGENT_MIGRATION_CONFIRMATION_REQUIRED' }
  );
  const corrupted = structuredClone(plan);
  corrupted.facts[0].situation = 'unbound mutation';
  await assert.rejects(
    applyAgentProgramMigration({
      plan: corrupted, confirmation: true, backup, persistence, attemptId: 'plan-rejected'
    }),
    { code: 'INVALID_AGENT_MIGRATION_PLAN' }
  );
  assert.deepEqual(calls, []);
});

test('apply verifies backup before one atomic commit and emits a redacted rollback receipt', async () => {
  const plan = await validPlan();
  const calls = [];
  const applied = await applyAgentProgramMigration({
    plan,
    confirmation: true,
    backup: backupPort(true, calls),
    persistence: persistencePort(plan, calls),
    attemptId: 'agent-program-test-applied'
  });

  assert.deepEqual(calls.map(({ operation }) => operation), [
    'backup.create', 'backup.verify', 'commit'
  ]);
  assert.equal(calls[2].request.expectedRevision, plan.expectedRevision);
  assert.equal(calls[2].request.nextRevision, plan.nextRevision);
  assert.equal(calls[2].request.source, `agent-program-migration:${plan.migrationId}`);
  assert.deepEqual(calls[2].request.facts, plan.facts);
  assert.deepEqual(applied.rollback, {
    targetCommandId: 'agent-migration-command-1',
    expectedRevision: plan.nextRevision
  });
  assert.equal(Object.hasOwn(applied, 'facts'), false);
  assert.equal(Object.hasOwn(applied, 'sourceFacts'), false);
  assert.equal(JSON.stringify(applied).includes('original human context'), false);
});

test('failed backup verification performs no world write', async () => {
  const plan = await validPlan();
  const calls = [];
  await assert.rejects(
    applyAgentProgramMigration({
      plan,
      confirmation: true,
      backup: backupPort(false, calls),
      persistence: persistencePort(plan, calls),
      attemptId: 'agent-program-test-rejected'
    }),
    { code: 'AGENT_MIGRATION_BACKUP_VERIFICATION_FAILED' }
  );
  assert.deepEqual(calls.map(({ operation }) => operation), ['backup.create', 'backup.verify']);
});

test('apply and rollback reject missing recovery ports and malformed receipts with stable codes', async () => {
  const plan = await validPlan();
  await assert.rejects(applyAgentProgramMigration({
    plan,
    confirmation: true,
    backup: null,
    persistence: persistencePort(plan),
    attemptId: 'missing-backup'
  }), { code: 'AGENT_MIGRATION_BACKUP_REQUIRED' });
  await assert.rejects(applyAgentProgramMigration({
    plan,
    confirmation: true,
    backup: backupPort(true),
    persistence: null,
    attemptId: 'missing-transaction'
  }), { code: 'AGENT_MIGRATION_TRANSACTION_REQUIRED' });
  await assert.rejects(rollbackAgentProgramMigration({
    migration: { contract: 'wrong', version: 1 },
    persistence: { rollback: async () => assert.fail('invalid receipt must not reach persistence') }
  }), { code: 'INVALID_AGENT_MIGRATION_RECEIPT' });
  await assert.rejects(rollbackAgentProgramMigration({
    migration: {
      contract: 'atom.agent-program-migration-receipt',
      version: 1,
      migrationId: 'migration',
      rollback: { targetCommandId: 'command', expectedRevision: 'sha256:target' }
    },
    persistence: null
  }), { code: 'AGENT_MIGRATION_TRANSACTION_REQUIRED' });
});

test('rollback consumes only the durable command and revision receipt', async () => {
  const plan = await validPlan();
  const calls = [];
  const persistence = persistencePort(plan, calls);
  const migration = {
    contract: 'atom.agent-program-migration-receipt',
    version: 1,
    migrationId: plan.migrationId,
    rollback: { targetCommandId: 'durable-command', expectedRevision: plan.nextRevision },
    sourceFacts: [{ forbidden: 'must not be consumed' }]
  };

  const restored = await rollbackAgentProgramMigration({
    migration,
    persistence,
    correlationId: 'agent-program-test-rollback'
  });

  assert.deepEqual(calls[0], {
    operation: 'rollback',
    request: {
      targetCommandId: 'durable-command',
      expectedRevision: plan.nextRevision,
      correlationId: 'agent-program-test-rollback'
    }
  });
  assert.equal(restored.afterRevision, plan.expectedRevision);
});

test('operator rejects mixed or malformed modes before creating runtime files', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-migration-args-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--dry-run', '--apply', '--attempt', 'mixed'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } }));
  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--dry-run', '--attempt', '../unsafe'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } }));
  await assert.rejects(fs.access(path.join(localAppData, 'AtomGraph')), { code: 'ENOENT' });
});

test('operator dry-run reads a disposable configured world without writing backup, receipt, or world files', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-migration-dry-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const world = [atom('thing@agent', 'Legacy', 'dry-run sensitive situation')];
  await fs.mkdir(worldDirectory, { recursive: true });
  const sourceBytes = `${JSON.stringify(world, null, 2)}\n`;
  await fs.writeFile(contextFile, sourceBytes, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    operator, '--dry-run', '--attempt', 'dry-run-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } });
  const result = JSON.parse(stdout);

  assert.equal(result.action, 'dry-run');
  assert.equal(result.summary.activePureAgentsUpgraded, 1);
  assert.equal(stdout.includes('dry-run sensitive situation'), false);
  assert.equal(await fs.readFile(contextFile, 'utf8'), sourceBytes);
  assert.deepEqual((await fs.readdir(worldDirectory)).sort(), ['atom.json']);
});

test('operator apply writes a redacted receipt and receipt-only rollback restores the exact source revision', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-migration-apply-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const source = [atom('thing@agent', 'Legacy', 'receipt must not disclose this situation')];
  const sourceRevision = revisionOfWorldFacts(source);
  await fs.mkdir(worldDirectory, { recursive: true });
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');

  const applied = JSON.parse((await execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'apply-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } })).stdout);
  const deployment = JSON.parse(await fs.readFile(applied.receiptFile, 'utf8'));
  const serializedReceipt = JSON.stringify(deployment);

  assert.equal(applied.action, 'apply');
  assert.equal(deployment.contract, 'atom.agent-program-deployment-receipt');
  assert.equal(serializedReceipt.includes('receipt must not disclose this situation'), false);
  assert.equal(Object.hasOwn(deployment, 'facts'), false);
  assert.equal(Object.hasOwn(deployment, 'sourceFacts'), false);
  assert.equal(deployment.revisions.source, sourceRevision);
  assert.equal(deployment.backup.sourceFileHash, deployment.hashes.sourceFile);
  assert.equal(deployment.backup.copiedFileHash, deployment.hashes.sourceFile);

  const rolledBack = JSON.parse((await execFileAsync(process.execPath, [
    operator, '--rollback', applied.receiptFile
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } })).stdout);

  assert.equal(rolledBack.action, 'rollback');
  assert.equal(rolledBack.revision, sourceRevision);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), source);
});

test('operator rejects a deployment receipt whose persistence paths do not match the configured world', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-migration-tamper-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const source = [atom('thing@agent', 'Legacy', 'tamper source')];
  await fs.mkdir(worldDirectory, { recursive: true });
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const applied = JSON.parse((await execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'tamper-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } })).stdout);
  const deployment = JSON.parse(await fs.readFile(applied.receiptFile, 'utf8'));
  deployment.paths.journalFile = path.join(localAppData, 'untrusted-journal.json');
  const tamperedReceipt = path.join(localAppData, 'tampered-receipt.json');
  await fs.writeFile(tamperedReceipt, JSON.stringify(deployment), 'utf8');

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--rollback', tamperedReceipt
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } }), (error) => (
    error.stderr.includes('INVALID_AGENT_MIGRATION_RECEIPT')
  ));
  assert.equal(revisionOfWorldFacts(JSON.parse(await fs.readFile(contextFile, 'utf8'))), deployment.revisions.target);
});
