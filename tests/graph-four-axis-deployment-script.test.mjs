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
    legacyNode('test', '', [legacyNode(
      'Fixture Program', "explore({'name':'Fixture'})", [], '@program'
    )]),
    legacyNode('Active Program', "explore({'name':'Active'})", [], '@program')
  ])];
  await fs.writeFile(contextFile, `${JSON.stringify(world, null, 2)}\n`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--isolated-root', 'World/test'
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.deepEqual(result.testRoots, ['World/test']);
  assert.equal(Object.hasOwn(result, 'isolatedRoots'), false);
  assert.equal(result.counts.testLegacyPrograms, 1);
  assert.equal(result.counts.activeLegacyPrograms, 1);
  assert.equal(result.counts.upgradedPrograms, 2);
});

test('deployment apply backs up, upgrades, strictly reloads, and rolls back request-driven locks', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-four-axis-lock-sidecar-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'transactions.json');
  const lockFile = path.join(directory, 'request-driven-locks.json');
  const backupRoot = path.join(directory, 'private-backups');
  const world = [legacyNode('World')];
  const lockSnapshot = {
    version: 1,
    locks: [{
      sourceProgramPath: 'World/Lock Program',
      targets: { paths: ['World/Target'] },
      mode: 'read_write',
      fields: ['name', 'detail', 'children', 'partners', 'messages'],
      protect: { atom: true, messages: false },
      refresh: { policy: 'on_request' },
      retained: { text: 'name/detail are ordinary values' }
    }]
  };
  const originalLockBytes = `${JSON.stringify(lockSnapshot, null, 2)}\n`;
  await fs.writeFile(contextFile, `${JSON.stringify(world, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockFile, originalLockBytes, 'utf8');

  const applied = JSON.parse((await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--graph', graphFile,
    '--journal', journalFile,
    '--request-driven-locks', lockFile,
    '--backup-root', backupRoot,
    '--apply'
  ], { cwd: projectRoot })).stdout);
  const migrated = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  assert.equal(applied.ok, true);
  assert.deepEqual(migrated.locks[0].fields, [
    'thing', 'situation', 'contain', 'support', 'messages'
  ]);
  assert.deepEqual(migrated.locks[0].retained, lockSnapshot.locks[0].retained);
  assert.equal(
    await fs.readFile(path.join(applied.backupDirectory, 'request-driven-locks.json'), 'utf8'),
    originalLockBytes
  );

  const rolledBack = JSON.parse((await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--graph', graphFile,
    '--journal', journalFile,
    '--request-driven-locks', lockFile,
    '--rollback', applied.receiptFile
  ], { cwd: projectRoot })).stdout);
  assert.equal(rolledBack.ok, true);
  assert.equal(await fs.readFile(lockFile, 'utf8'), originalLockBytes);
});
