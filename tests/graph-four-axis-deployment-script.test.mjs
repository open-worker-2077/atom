import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(projectRoot, 'scripts', 'deploy-graph-four-axis-world.mjs');

function legacyNode(name, detail = '', children = [], suffix = '') {
  return { [`name${suffix}`]: name, detail, children, partners: [] };
}

test('deployment preflight passes exact test roots through the world migration operation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-four-axis-deploy-script-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const world = [legacyNode('World', '', [
    legacyNode('test', '', [legacyNode('Fixture Program', "explore({'name':'Fixture'})", [], '@program')]),
    legacyNode('Active Program', "explore({'name':'Active'})", [], '@program')
  ])];
  await fs.writeFile(contextFile, `${JSON.stringify(world, null, 2)}\n`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--isolated-root', 'World/test'
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.deepEqual(result.testRoots, ['World/test']);
  assert.equal(Object.hasOwn(result, 'isolatedRoots'), false);
  assert.equal(result.counts.testLegacyPrograms, 1);
  assert.equal(result.counts.activeLegacyPrograms, 1);
  assert.equal(result.counts.upgradedPrograms, 2);
});

test('deployment preserves and backs up the retired request-driven security tombstone', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-four-axis-lock-sidecar-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'transactions.json');
  const lockFile = path.join(directory, 'request-driven-locks.json');
  const backupRoot = path.join(directory, 'private-backups');
  const lockSnapshot = { contract: 'atom.request-driven-security-retired', version: 1 };
  const originalLockBytes = `${JSON.stringify(lockSnapshot, null, 2)}\n`;
  await fs.writeFile(contextFile, `${JSON.stringify([legacyNode('World')], null, 2)}\n`, 'utf8');
  await fs.writeFile(lockFile, originalLockBytes, 'utf8');

  const applied = JSON.parse((await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--request-driven-locks', lockFile, '--backup-root', backupRoot,
    '--attempt-id', 'sidecar-attempt', '--apply'
  ], { cwd: projectRoot })).stdout);
  const migrated = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  assert.equal(applied.ok, true);
  assert.deepEqual(migrated, lockSnapshot);
  assert.deepEqual(applied.requestDrivenLocks, { file: lockFile, present: false });
  assert.equal(await fs.readFile(path.join(applied.backupDirectory, 'request-driven-locks.json'), 'utf8'), originalLockBytes);

  const rolledBack = JSON.parse((await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--request-driven-locks', lockFile, '--rollback', applied.receiptFile
  ], { cwd: projectRoot })).stdout);
  assert.equal(rolledBack.ok, true);
  assert.equal(await fs.readFile(lockFile, 'utf8'), originalLockBytes);
});

test('deployment attempts isolate immutable backups and rollback restores projection bytes idempotently', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-four-axis-deploy-attempt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const backupRoot = path.join(directory, 'backups');
  const originalProjection = Buffer.from('{"original":"projection-bytes"}\n', 'utf8');
  await fs.writeFile(contextFile, `${JSON.stringify([legacyNode('World')], null, 2)}\n`, 'utf8');
  await fs.writeFile(graphFile, originalProjection);

  const applied = JSON.parse((await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--backup-root', backupRoot, '--attempt-id', 'attempt-a', '--apply'
  ], { cwd: projectRoot })).stdout);
  assert.equal(applied.ok, true);
  assert.equal(applied.attemptId, 'attempt-a');
  assert.match(applied.backupDirectory.replaceAll('\\', '/'), /\/attempt-a$/u);

  const rolledBack = JSON.parse((await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--rollback', applied.receiptFile
  ], { cwd: projectRoot })).stdout);
  assert.equal(rolledBack.ok, true);
  assert.deepEqual(await fs.readFile(graphFile), originalProjection);

  await fs.writeFile(graphFile, '{"stale":"target-projection"}\n', 'utf8');
  const repeated = JSON.parse((await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--rollback', applied.receiptFile
  ], { cwd: projectRoot })).stdout);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.alreadyAtSource, true);
  assert.deepEqual(await fs.readFile(graphFile), originalProjection);

  const backupReceiptFile = path.join(applied.backupDirectory, 'backup-receipt.json');
  const immutableBackupReceipt = await fs.readFile(backupReceiptFile);
  const immutableDeploymentReceipt = await fs.readFile(applied.receiptFile);
  await assert.rejects(execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--backup-root', backupRoot, '--attempt-id', 'attempt-a', '--apply'
  ], { cwd: projectRoot }));
  assert.deepEqual(await fs.readFile(graphFile), originalProjection);
  assert.deepEqual(await fs.readFile(backupReceiptFile), immutableBackupReceipt);
  assert.deepEqual(await fs.readFile(applied.receiptFile), immutableDeploymentReceipt);

  const second = JSON.parse((await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--graph', graphFile, '--journal', journalFile,
    '--backup-root', backupRoot, '--attempt-id', 'attempt-b', '--apply'
  ], { cwd: projectRoot })).stdout);
  assert.equal(second.ok, true);
  assert.notEqual(second.migration.receipt.commandId, applied.migration.receipt.commandId);
  assert.notEqual(second.backupDirectory, applied.backupDirectory);
});
