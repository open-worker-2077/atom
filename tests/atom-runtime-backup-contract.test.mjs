import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createAtomRuntimeBackupTrigger } from '../src/atom-system/operations/atom-runtime-backup-trigger.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
process.env.ATOM_RUNTIME_BACKUP_REPO = '';

test('private Atom runtime backup copies only recovery data and never deletes prior copies', async () => {
  const source = await fs.readFile(path.join(root, 'scripts', 'backup-atom-runtime.ps1'), 'utf8');
  assert.match(source, /atom\.json/);
  assert.match(source, /submissions\.jsonl/);
  assert.match(source, /Copy-Item/);
  assert.match(source, /git -C \$repositoryRoot push origin \$Branch/);
  assert.doesNotMatch(source, /graph\.json|knowledge\.json|Remove-Item|\/MIR/);
});

test('each authoritative Atom write schedules one serialized private backup', async () => {
  const callbacks = [];
  const runs = [];
  const watcher = { close() {} };
  const trigger = createAtomRuntimeBackupTrigger({
    worldDirectory: 'C:/AtomGraph/worlds/primary',
    backupRepository: 'C:/private/atom_backup',
    watch: (_directory, _options, callback) => { callbacks.push(callback); return watcher; },
    runBackup: async (request) => { runs.push(request); return true; },
    setTimer: (handler) => { handler(); return 1; },
    clearTimer: () => {}
  });
  trigger.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1, 'startup captures the current recoverable state');
  callbacks[0]('change', 'graph.json');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1, 'derived projections never create private backup churn');
  callbacks[0]('change', 'atom.json');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 2);
  assert.equal(runs[1].worldDirectory.endsWith('primary'), true);
  trigger.close();
});

test('runtime changes share one fixed five-minute backup window', async () => {
  const callbacks = [];
  const runs = [];
  const timers = [];
  const trigger = createAtomRuntimeBackupTrigger({
    worldDirectory: 'C:/AtomGraph/worlds/primary',
    backupRepository: 'C:/private/atom_backup',
    watch: (_directory, _options, callback) => {
      callbacks.push(callback);
      return { close() {} };
    },
    runBackup: async (request) => {
      runs.push(request);
      return true;
    },
    setTimer: (handler, delayMs) => {
      const timer = { handler, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {}
  });

  trigger.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.length, 1, 'startup still captures the current recoverable state immediately');

  callbacks[0]('change', 'atom.json');
  callbacks[0]('change', 'submissions.jsonl');
  trigger.schedule();
  assert.equal(timers.length, 1, 'later changes join the active backup window instead of postponing it');
  assert.equal(timers[0].delayMs, 5 * 60 * 1_000);

  await timers[0].handler();
  assert.equal(runs.length, 2, 'the merged changes produce one private backup version');
  trigger.close();
});

test('explicit backup flush waits for an older run and captures the pending latest save before close', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const snapshots = [];
  let current = 'older-saved';
  const trigger = createAtomRuntimeBackupTrigger({ worldDirectory: path.join(os.tmpdir(), 'injected-backup-world'),
    backupRepository: path.join(os.tmpdir(), 'injected-backup-target'),
    setTimer: () => ({}), clearTimer() {},
    runBackup: async () => { snapshots.push(current); if (snapshots.length === 1) await hold; return true; } });
  const older = trigger.flush();
  await new Promise(resolve => setImmediate(resolve));
  current = 'latest-saved'; trigger.schedule();
  let completed = false;
  const final = trigger.flush().then(() => { completed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false, 'flush must not let close discard the pending latest backup');
  } finally { release(); await Promise.all([older, final]); trigger.close(); }
  assert.deepEqual(snapshots, ['older-saved', 'latest-saved']);
});

test('explicit backup failure rejects and a later flush retries instead of retaining a stuck running flag', async () => {
  let failure = true;
  let runs = 0;
  const trigger = createAtomRuntimeBackupTrigger({ worldDirectory: path.join(os.tmpdir(), 'injected-backup-world-failed'),
    backupRepository: path.join(os.tmpdir(), 'injected-backup-target-failed'),
    runBackup: async () => { runs += 1; return !failure; } });
  try {
    await assert.rejects(trigger.flush(), { code: 'ATOM_RUNTIME_BACKUP_FAILED' });
    failure = false;
    await trigger.flush();
    assert.equal(runs, 2);
  } finally { trigger.close(); }
});

test('startup and timer backup failures are observed while explicit flush still reports failure and can retry', async () => {
  let fail = true;
  const timers = [];
  let runs = 0;
  const trigger = createAtomRuntimeBackupTrigger({ worldDirectory: path.join(os.tmpdir(), 'injected-backup-errors'),
    backupRepository: path.join(os.tmpdir(), 'injected-backup-errors-target'), watch: () => ({ close() {} }),
    setTimer: handler => { timers.push(handler); return {}; }, clearTimer() {}, runBackup: async () => {
      runs += 1; if (fail) throw Object.assign(new Error('injected backup I/O'), { code: 'EIO' }); return true;
    } });
  try {
    trigger.start();
    await new Promise(resolve => setImmediate(resolve));
    trigger.schedule();
    await timers[0]();
    await assert.rejects(trigger.flush(), { code: 'EIO' });
    fail = false;
    await trigger.flush();
    assert.equal(runs, 4);
  } finally { trigger.close(); }
});
