import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { runGeneratedSlotPrintMaintenance } from '../scripts/deploy-generated-slot-print-world.mjs';
import { planGeneratedSlotPrintMigration } from '../work-engine/atom-language/generated-slot-print-migration.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';
import { applyPlanSlotBodyEffect, readVisibleSlotPlans } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import {
  atomName,
  childrenOf,
  fieldValue,
  replaceStoredField
} from '../work-engine/atom-language/slot-graph-semantics.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const operator = path.join(projectRoot, 'scripts', 'deploy-generated-slot-print-world.mjs');

function atom(thing, situation = '', slot = [], strut = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    slot,
    strut
  };
}

function find(atoms, selector) {
  let records = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = records.find((candidate) => atomName(candidate) === segment);
    if (!current) return null;
    records = childrenOf(current) ?? [];
  }
  return current;
}

function unsealedBody(name) {
  return atom(name, 'slot_body({"action":"seal"})', [
    atom('模型', '模型正文\r\n保持原字节', [
      atom('字段', '字段正文\n含有 body 与 print 字样')
    ])
  ], [], ['program']);
}

async function seal(facts, bodyPath) {
  const result = await applyPlanSlotBodyEffect({
    atoms: facts,
    effect: { action: 'seal', body: bodyPath }
  });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.atoms;
}

function visiblePrint(facts, bodyPath) {
  const visible = readVisibleSlotPlans(facts)
    .find(({ layout }) => layout.bodyPath === bodyPath);
  assert.ok(visible, `missing visible print plan for ${bodyPath}`);
  return visible;
}

function legacyGeneratedSource(source, planBody) {
  const lines = source.split('\n');
  assert.equal(lines.length, 3);
  lines[2] = `    return slot_body({"action":"print","body":${JSON.stringify(planBody)},"name":arguments["name"]})`;
  return lines.join('\n');
}

function withoutSituationAt(facts, path) {
  const copy = structuredClone(facts);
  replaceStoredField(find(copy, path), 'situation', '<selected-situation>');
  return copy;
}

async function migratableWorld() {
  const facts = await seal([
    atom('Root', 'source situation stays private', [unsealedBody('订单槽体')])
  ], 'Root/订单槽体');
  const generated = visiblePrint(facts, 'Root/订单槽体');
  replaceStoredField(generated.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(generated.layout.print, 'situation'),
    generated.plan.body
  ));
  return facts;
}

async function isolatedRuntime(t, prefix) {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const graphFile = path.join(worldDirectory, 'graph.json');
  const journalFile = path.join(worldDirectory, 'atom.transactions.json');
  await fs.mkdir(worldDirectory, { recursive: true });
  return {
    localAppData,
    worldDirectory,
    contextFile,
    graphFile,
    journalFile,
    env: { ...process.env, LOCALAPPDATA: localAppData }
  };
}

async function runOperator(args, runtime, nodeArgs = []) {
  return JSON.parse((await execFileAsync(process.execPath, [...nodeArgs, operator, ...args], {
    cwd: projectRoot,
    env: runtime.env
  })).stdout);
}

function migrationIdForPlan(plan) {
  const digest = crypto.createHash('sha256')
    .update(`${plan.expectedRevision}\0${plan.nextRevision}`)
    .digest('hex');
  return `generated-slot-print-${digest}`;
}

test('migrates one exact historical generated print after an ancestor rename without changing source facts', async () => {
  let facts = await seal([
    atom('Root', '根正文\r\n逐字保留', [
      atom('邻居', '普通 Situation 保留\n第二行'),
      unsealedBody('订单槽体')
    ])
  ], 'Root/订单槽体');
  const original = visiblePrint(facts, 'Root/订单槽体');
  const historicalPlanBody = original.plan.body;
  replaceStoredField(original.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(original.layout.print, 'situation'),
    historicalPlanBody
  ));
  replaceStoredField(find(facts, 'Root'), 'thing', 'RenamedRoot');
  const current = visiblePrint(facts, 'RenamedRoot/订单槽体');
  assert.equal(current.plan.body, 'Root/订单槽体');
  const before = structuredClone(facts);

  const plan = planGeneratedSlotPrintMigration(facts);

  assert.deepEqual(facts, before);
  assert.equal(plan.expectedRevision, revisionOfWorldFacts(before));
  assert.equal(plan.nextRevision, revisionOfWorldFacts(plan.facts));
  assert.notEqual(plan.nextRevision, plan.expectedRevision);
  assert.equal(plan.summary.migratedPrograms, 1);
  assert.deepEqual(plan.changedPaths, ['RenamedRoot/订单槽体/print']);
  assert.deepEqual(plan.migrated, [{
    bodyPath: 'RenamedRoot/订单槽体',
    programPath: 'RenamedRoot/订单槽体/print',
    planRevision: current.plan.revision
  }]);
  const beforeSource = fieldValue(find(before, 'RenamedRoot/订单槽体/print'), 'situation');
  const afterSource = fieldValue(find(plan.facts, 'RenamedRoot/订单槽体/print'), 'situation');
  assert.equal(afterSource.split('\n')[0], beforeSource.split('\n')[0]);
  assert.equal(afterSource, [
    beforeSource.split('\n')[0],
    'def main(arguments):',
    '    return slot_body({"action":"print","name":arguments["name"]})'
  ].join('\n'));
  assert.deepEqual(
    withoutSituationAt(plan.facts, 'RenamedRoot/订单槽体/print'),
    withoutSituationAt(before, 'RenamedRoot/订单槽体/print')
  );
});

test('migrates a generated print whose main body alone was maintained to the renamed layout path', async () => {
  let facts = await seal([
    atom('Root', '根正文保持', [unsealedBody('订单槽体')])
  ], 'Root/订单槽体');
  const original = visiblePrint(facts, 'Root/订单槽体');
  const originalHeader = fieldValue(original.layout.print, 'situation').split('\n')[0];
  replaceStoredField(find(facts, 'Root'), 'thing', 'RenamedRoot');
  const renamed = visiblePrint(facts, 'RenamedRoot/订单槽体');
  assert.equal(renamed.plan.body, 'Root/订单槽体');
  replaceStoredField(renamed.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(renamed.layout.print, 'situation'),
    renamed.layout.bodyPath
  ));
  const before = structuredClone(facts);

  const plan = planGeneratedSlotPrintMigration(facts);

  assert.deepEqual(facts, before);
  assert.equal(plan.summary.migratedPrograms, 1);
  assert.deepEqual(plan.changedPaths, ['RenamedRoot/订单槽体/print']);
  const migratedSource = fieldValue(find(plan.facts, 'RenamedRoot/订单槽体/print'), 'situation');
  assert.equal(migratedSource.split('\n')[0], originalHeader);
  assert.equal(migratedSource.split('\n').at(-1),
    '    return slot_body({"action":"print","name":arguments["name"]})');
  assert.deepEqual(
    withoutSituationAt(plan.facts, 'RenamedRoot/订单槽体/print'),
    withoutSituationAt(before, 'RenamedRoot/订单槽体/print')
  );
});

test('leaves the current generated ABI and handwritten print Programs unchanged', async () => {
  const currentFacts = await seal([atom('Root', '', [unsealedBody('当前槽体')])], 'Root/当前槽体');
  const currentBefore = structuredClone(currentFacts);

  const currentPlan = planGeneratedSlotPrintMigration(currentFacts);

  assert.deepEqual(currentFacts, currentBefore);
  assert.deepEqual(currentPlan.facts, currentBefore);
  assert.deepEqual(currentPlan.changedPaths, []);
  assert.deepEqual(currentPlan.migrated, []);
  assert.deepEqual(currentPlan.summary, { migratedPrograms: 0 });
  assert.equal(currentPlan.nextRevision, currentPlan.expectedRevision);

  const handwrittenFacts = structuredClone(currentFacts);
  replaceStoredField(
    visiblePrint(handwrittenFacts, 'Root/当前槽体').layout.print,
    'situation',
    'def main(arguments):\n    return {"handwritten": arguments["name"]}'
  );
  const handwrittenBefore = structuredClone(handwrittenFacts);

  const handwrittenPlan = planGeneratedSlotPrintMigration(handwrittenFacts);

  assert.deepEqual(handwrittenFacts, handwrittenBefore);
  assert.deepEqual(handwrittenPlan.facts, handwrittenBefore);
  assert.deepEqual(handwrittenPlan.changedPaths, []);
  assert.equal(handwrittenPlan.nextRevision, handwrittenPlan.expectedRevision);
});

test('rejects an entire candidate when a generated-looking print has extra behavior', async () => {
  let facts = [atom('Root', '', [unsealedBody('合法槽体'), unsealedBody('畸形槽体')])];
  facts = await seal(facts, 'Root/合法槽体');
  facts = await seal(facts, 'Root/畸形槽体');
  for (const bodyPath of ['Root/合法槽体', 'Root/畸形槽体']) {
    const entry = visiblePrint(facts, bodyPath);
    replaceStoredField(entry.layout.print, 'situation', legacyGeneratedSource(
      fieldValue(entry.layout.print, 'situation'),
      entry.plan.body
    ));
  }
  const malformed = visiblePrint(facts, 'Root/畸形槽体');
  replaceStoredField(malformed.layout.print, 'situation', `${fieldValue(malformed.layout.print, 'situation')}\nprint("extra")`);
  const before = structuredClone(facts);

  assert.throws(
    () => planGeneratedSlotPrintMigration(facts),
    (error) => error?.code === 'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_AMBIGUOUS'
      && error.details?.path === 'Root/畸形槽体/print'
  );
  assert.deepEqual(facts, before);
});

test('rejects a generated print whose main body names a third-party path', async () => {
  let facts = await seal([atom('Root', '', [unsealedBody('订单槽体')])], 'Root/订单槽体');
  const entry = visiblePrint(facts, 'Root/订单槽体');
  replaceStoredField(entry.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(entry.layout.print, 'situation'),
    'External/Other'
  ));
  const before = structuredClone(facts);

  assert.throws(
    () => planGeneratedSlotPrintMigration(facts),
    (error) => error?.code === 'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_AMBIGUOUS'
      && error.details?.path === 'Root/订单槽体/print'
  );
  assert.deepEqual(facts, before);
});

test('skips sealed print Programs inside an explicitly typed default backup domain', async () => {
  let facts = [atom('Root', '', [
    unsealedBody('活跃槽体'),
    atom('旧版本', '普通名称不提供停用语义', [unsealedBody('仍活跃槽体')]),
    atom('Archive', '名字不是停用依据', [unsealedBody('归档槽体')], [], ['backup', 'default'])
  ])];
  facts = await seal(facts, 'Root/活跃槽体');
  facts = await seal(facts, 'Root/旧版本/仍活跃槽体');
  facts = await seal(facts, 'Root/Archive/归档槽体');
  for (const bodyPath of [
    'Root/活跃槽体',
    'Root/旧版本/仍活跃槽体',
    'Root/Archive/归档槽体'
  ]) {
    const entry = visiblePrint(facts, bodyPath);
    replaceStoredField(entry.layout.print, 'situation', legacyGeneratedSource(
      fieldValue(entry.layout.print, 'situation'),
      entry.plan.body
    ));
  }
  const archivedBefore = fieldValue(find(facts, 'Root/Archive/归档槽体/print'), 'situation');

  const plan = planGeneratedSlotPrintMigration(facts);

  assert.equal(plan.summary.migratedPrograms, 2);
  assert.deepEqual(plan.changedPaths, [
    'Root/旧版本/仍活跃槽体/print',
    'Root/活跃槽体/print'
  ]);
  assert.equal(
    fieldValue(find(plan.facts, 'Root/Archive/归档槽体/print'), 'situation'),
    archivedBefore
  );
});

test('maintenance dry-run reports the migration without writing world or backup files', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-dry-');
  const source = await migratableWorld();
  const sourceBytes = `${JSON.stringify(source, null, 2)}\n`;
  await fs.writeFile(runtime.contextFile, sourceBytes, 'utf8');

  const result = await runOperator(['--dry-run', '--attempt', 'dry-run-1'], runtime);

  assert.equal(result.action, 'dry-run');
  assert.equal(result.summary.migratedPrograms, 1);
  assert.deepEqual(result.changedPaths, ['Root/订单槽体/print']);
  assert.deepEqual(result.artifacts.migrated, planGeneratedSlotPrintMigration(source).migrated);
  assert.equal(JSON.stringify(result).includes('source situation stays private'), false);
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), sourceBytes);
  assert.deepEqual((await fs.readdir(runtime.worldDirectory)).sort(), ['atom.json']);
});

test('maintenance apply backs up the complete incremental journal, is idempotent, and rolls back exactly', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-apply-');
  const initial = [atom('Initial', 'journal history')];
  const source = await migratableWorld();
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
  await createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: runtime.journalFile
  }).commit({
    correlationId: 'fixture-history',
    expectedRevision: revisionOfWorldFacts(initial),
    nextRevision: revisionOfWorldFacts(source),
    facts: source,
    source: 'fixture-history'
  });
  await assert.rejects(fs.access(runtime.journalFile), { code: 'ENOENT' });

  const first = await runOperator(['--apply', '--attempt', 'apply-1'], runtime);
  const second = await runOperator(['--apply', '--attempt', 'apply-1'], runtime);
  const manifest = JSON.parse(await fs.readFile(first.paths.backupManifest, 'utf8'));
  const backedUpPaths = manifest.files.map(({ path: file }) => file).sort();
  const sourceAfterApply = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));

  assert.equal(first.action, 'apply');
  assert.equal(second.recovered, true);
  assert.equal(second.transaction.commandId, first.transaction.commandId);
  assert.deepEqual(first.changedPaths, ['Root/订单槽体/print']);
  assert.deepEqual(first.artifacts.migrated, planGeneratedSlotPrintMigration(source).migrated);
  assert.deepEqual(manifest.artifacts, first.artifacts);
  assert.ok(backedUpPaths.includes('atom.json'));
  assert.ok(backedUpPaths.includes('atom.transactions.json.d/events.jsonl'));
  assert.ok(backedUpPaths.some((file) => file.startsWith('atom.transactions.json.d/objects/')));
  assert.equal(backedUpPaths.includes('atom.transactions.json'), false);
  assert.equal(manifest.hashes.sourceFile, first.hashes.sourceFile);
  assert.equal((await createJsonTransactionJournal({ file: runtime.journalFile }).readState()).receipts.length, 2);
  assert.equal(revisionOfWorldFacts(sourceAfterApply), first.revisions.target);

  const rolledBack = await runOperator(['--rollback', first.receiptFile], runtime);
  const worldAfterRollback = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(rolledBack.action, 'rollback');
  assert.equal(rolledBack.revision, first.revisions.source);
  assert.deepEqual(worldAfterRollback, source);
});

test('maintenance refuses an incomplete existing attempt without committing', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-incomplete-');
  const source = await migratableWorld();
  const plan = planGeneratedSlotPrintMigration(source);
  const migrationId = migrationIdForPlan(plan);
  const attemptDirectory = path.join(
    runtime.worldDirectory,
    'migration-backups',
    'generated-slot-print',
    migrationId,
    'incomplete-1'
  );
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  await fs.mkdir(attemptDirectory, { recursive: true });
  await fs.writeFile(path.join(attemptDirectory, 'atom.json'), 'incomplete', 'utf8');

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'incomplete-1'
  ], { cwd: projectRoot, env: runtime.env }), (error) => (
    error.stderr.includes('GENERATED_SLOT_PRINT_MIGRATION_ATTEMPT_CONFLICT')
  ));
  assert.deepEqual(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), source);
  assert.equal((await createJsonTransactionJournal({ file: runtime.journalFile }).readState()).receipts.length, 0);
});

test('maintenance refuses a hash-invalid private backup without committing', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-invalid-backup-');
  const source = await migratableWorld();
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const plan = planGeneratedSlotPrintMigration(source);
  const migrationId = migrationIdForPlan(plan);
  const attemptId = 'invalid-backup-1';
  const directory = path.join(
    runtime.worldDirectory,
    'migration-backups',
    'generated-slot-print',
    migrationId,
    attemptId
  );
  const manifestFile = path.join(directory, 'backup-manifest.json');
  const sourceHash = `sha256:${crypto.createHash('sha256').update(sourceBytes).digest('hex')}`;
  await fs.writeFile(runtime.contextFile, sourceBytes);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'atom.json'), sourceBytes);
  await fs.writeFile(manifestFile, `${JSON.stringify({
    contract: 'atom.generated-slot-print-private-backup',
    version: 1,
    migrationId,
    attemptId,
    directory,
    worldDirectory: runtime.worldDirectory,
    contextFile: runtime.contextFile,
    journalFile: runtime.journalFile,
    revisions: { source: plan.expectedRevision, target: plan.nextRevision },
    hashes: { sourceFile: 'sha256:invalid', targetFacts: plan.nextRevision },
    changedPaths: plan.changedPaths,
    artifacts: { changedPaths: plan.changedPaths, migrated: plan.migrated },
    summary: plan.summary,
    journal: { receiptsVerified: 0, preparedTransactions: 0 },
    files: [{ path: 'atom.json', hash: sourceHash, bytes: sourceBytes.length }],
    manifestFile
  }, null, 2)}\n`, 'utf8');

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', attemptId
  ], { cwd: projectRoot, env: runtime.env }), (error) => (
    error.stderr.includes('GENERATED_SLOT_PRINT_MIGRATION_BACKUP_VERIFICATION_FAILED')
  ));
  assert.deepEqual(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), source);
  assert.equal((await createJsonTransactionJournal({ file: runtime.journalFile }).readState()).receipts.length, 0);
});

test('maintenance rejects a source change after backup starts before central commit', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-cas-');
  const source = await migratableWorld();
  const changed = [...source, atom('Concurrent', 'outside writer')];
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const objectDirectory = path.join(`${runtime.journalFile}.d`, 'objects');
  await fs.mkdir(objectDirectory, { recursive: true });
  const padding = Buffer.alloc(64 * 1024, 7);
  await Promise.all(Array.from({ length: 128 }, (_, index) => fs.writeFile(
    path.join(objectDirectory, `${String(index).padStart(3, '0')}.padding`),
    padding
  )));

  let watcher;
  let timeout;
  const mutated = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('backup copy was not observed')), 5000);
    watcher = watch(runtime.worldDirectory, { recursive: true }, (_event, filename) => {
      const observed = String(filename ?? '').split(path.sep).join('/');
      if (!observed.endsWith('/cas-1/atom.json')) return;
      watcher.close();
      clearTimeout(timeout);
      fs.writeFile(runtime.contextFile, `${JSON.stringify(changed, null, 2)}\n`, 'utf8')
        .then(resolve, reject);
    });
  });
  t.after(() => {
    watcher?.close();
    clearTimeout(timeout);
  });
  const operation = execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'cas-1'
  ], { cwd: projectRoot, env: runtime.env });

  await mutated;
  await assert.rejects(operation, (error) => (
    error.stderr.includes('GENERATED_SLOT_PRINT_MIGRATION_SOURCE_DIVERGED')
      || error.stderr.includes('WORLD_REVISION_CONFLICT')
  ));
  assert.deepEqual(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), changed);
  assert.equal((await createJsonTransactionJournal({ file: runtime.journalFile }).readState()).receipts.length, 0);
});

test('maintenance automatically rolls back a committed migration when projection postcheck fails', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-postcheck-');
  const source = await migratableWorld();
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  await fs.mkdir(runtime.graphFile);

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'postcheck-1'
  ], { cwd: projectRoot, env: runtime.env }), (error) => (
    error.stderr.includes('WORLD_COMMITTED_PROJECTION_PENDING')
  ));

  assert.deepEqual(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), source);
  const state = await createJsonTransactionJournal({ file: runtime.journalFile }).readState();
  assert.equal(state.receipts.length, 2);
  const backupRoot = path.join(runtime.worldDirectory, 'migration-backups', 'generated-slot-print');
  const [migration] = await fs.readdir(backupRoot);
  const failureFile = path.join(backupRoot, migration, 'postcheck-1', 'failure-receipt.json');
  const failure = JSON.parse(await fs.readFile(failureFile, 'utf8'));
  assert.equal(failure.error.code, 'WORLD_COMMITTED_PROJECTION_PENDING');
  assert.equal(failure.rollback.status, 'committed');
});

test('maintenance rejects rollback after a later world revision', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-later-');
  const source = await migratableWorld();
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const applied = await runOperator(['--apply', '--attempt', 'later-1'], runtime);
  const migrated = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  const later = [...migrated, atom('Later', 'business revision')];
  await createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: runtime.journalFile
  }).commit({
    correlationId: 'later-business-change',
    expectedRevision: revisionOfWorldFacts(migrated),
    nextRevision: revisionOfWorldFacts(later),
    facts: later,
    source: 'ordinary-test'
  });

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--rollback', applied.receiptFile
  ], { cwd: projectRoot, env: runtime.env }), (error) => (
    error.stderr.includes('INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT')
  ));
  assert.deepEqual(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), later);
});

test('maintenance rejects a deployment receipt with a changed migrated-program mapping', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-mapping-');
  const source = await migratableWorld();
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const applied = await runOperator(['--apply', '--attempt', 'mapping-1'], runtime);
  const tampered = JSON.parse(await fs.readFile(applied.receiptFile, 'utf8'));
  tampered.artifacts = {
    ...(tampered.artifacts ?? {}),
    migrated: [{
      ...planGeneratedSlotPrintMigration(source).migrated[0],
      programPath: 'Root/其他槽体/print'
    }]
  };
  await fs.writeFile(applied.receiptFile, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--rollback', applied.receiptFile
  ], { cwd: projectRoot, env: runtime.env }), (error) => (
    error.stderr.includes('INVALID_GENERATED_SLOT_PRINT_MIGRATION_RECEIPT')
  ));
  assert.equal(
    revisionOfWorldFacts(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'))),
    applied.revisions.target
  );
});

test('maintenance rejects a linked backup ancestor before writing through it', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-link-');
  const source = await migratableWorld();
  const outside = path.join(runtime.localAppData, 'outside');
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  await fs.mkdir(outside);
  try {
    await fs.symlink(outside, path.join(runtime.worldDirectory, 'migration-backups'),
      process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`reparse-point creation unsupported: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'link-1'
  ], { cwd: projectRoot, env: runtime.env }), (error) => (
    error.stderr.includes('GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH')
  ));
  assert.deepEqual(await fs.readdir(outside), []);
  assert.deepEqual(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), source);
});

test('maintenance rejects noncanonical configured file paths before reading them', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-canonical-');
  const configured = resolveAtomRuntime({ localAppData: runtime.localAppData });
  const noncanonical = {
    ...configured,
    contextFile: path.join(runtime.worldDirectory, 'nested', 'atom.json')
  };

  await assert.rejects(
    runGeneratedSlotPrintMaintenance(['--dry-run', '--attempt', 'canonical-1'], noncanonical),
    { code: 'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH' }
  );
  await assert.rejects(fs.access(noncanonical.contextFile), { code: 'ENOENT' });
});

test('maintenance rejects a linked canonical context leaf before dry-run reads it', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-leaf-link-');
  const configured = resolveAtomRuntime({ localAppData: runtime.localAppData });
  const outside = path.join(runtime.localAppData, 'outside-atom.json');
  await fs.writeFile(outside, `${JSON.stringify(await migratableWorld())}\n`, 'utf8');
  try {
    await fs.symlink(outside, runtime.contextFile, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`file symlink creation unsupported: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    runGeneratedSlotPrintMaintenance(['--dry-run', '--attempt', 'leaf-link-1'], configured),
    { code: 'GENERATED_SLOT_PRINT_MIGRATION_UNSAFE_PATH' }
  );
});

test('maintenance applies within a constrained heap with real historical snapshot objects', async (t) => {
  const runtime = await isolatedRuntime(t, 'atom-generated-print-memory-');
  let source = [...await migratableWorld(), atom('History', 'seed')];
  await fs.writeFile(runtime.contextFile, `${JSON.stringify(source)}\n`, 'utf8');
  const persistence = createTransactionalWorldPersistence({
    contextFile: runtime.contextFile,
    projectionFile: runtime.graphFile,
    journalFile: runtime.journalFile,
    publishLegacyProjection: false
  });
  for (let index = 0; index < 36; index += 1) {
    const next = [...source.slice(0, -1), atom(
      'History',
      `${index}:${crypto.randomBytes(768 * 1024).toString('base64')}`
    )];
    await persistence.commit({
      correlationId: `memory-history-${index}`,
      expectedRevision: revisionOfWorldFacts(source),
      nextRevision: revisionOfWorldFacts(next),
      facts: next,
      source: 'memory-history-fixture'
    });
    source = next;
  }

  const applied = await runOperator(
    ['--apply', '--attempt', 'memory-1'],
    runtime,
    ['--max-old-space-size=64']
  );
  const manifest = JSON.parse(await fs.readFile(applied.paths.backupManifest, 'utf8'));

  assert.equal(applied.summary.migratedPrograms, 1);
  assert.equal(applied.revisions.source, revisionOfWorldFacts(source));
  assert.ok(manifest.files.filter(({ path: file }) => (
    file.startsWith('atom.transactions.json.d/objects/')
  )).length >= 36);
});
