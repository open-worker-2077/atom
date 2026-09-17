import { spawn } from 'node:child_process';
import { watch as watchFileSystem } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'scripts', 'backup-atom-runtime.ps1'
);

function runPowerShellBackup({ worldDirectory, backupRepository, branch, script = defaultScript }) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-WorldDirectory', worldDirectory,
      '-BackupRepository', backupRepository,
      '-Branch', branch
    ], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

export function createAtomRuntimeBackupTrigger(options = {}) {
  const worldDirectory = path.resolve(options.worldDirectory);
  const backupRepository = path.resolve(options.backupRepository);
  const branch = options.branch || 'runtime-data';
  const watch = options.watch || watchFileSystem;
  const runBackup = options.runBackup || runPowerShellBackup;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const delayMs = Math.max(250, Number(options.delayMs) || 5 * 60 * 1_000);
  let watcher = null;
  let timer = null;
  let running = null;
  let pending = false;
  let closed = false;

  function schedule() {
    if (closed) return;
    if (running) {
      pending = true;
      return;
    }
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      return runOnce().catch(() => {});
    }, delayMs);
  }

  function clearScheduled() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function runOnce() {
    if (closed) return Promise.resolve();
    if (running) return running;
    pending = false;
    running = Promise.resolve().then(() => runBackup({ worldDirectory, backupRepository,
      branch, script: options.script || defaultScript })).then(result => {
      if (result === false) throw Object.assign(new Error('Runtime backup did not complete successfully'), {
        code: 'ATOM_RUNTIME_BACKUP_FAILED'
      });
    }).finally(() => {
      running = null;
      if (pending && !closed) schedule();
    });
    return running;
  }

  async function flush() {
    clearScheduled();
    if (closed) return;
    // An existing run may have captured an older recovery point. Explicit
    // flush joins it and drains a fresh run, not just a future timer request.
    if (running) pending = true;
    do {
      try { await runOnce(); }
      finally { clearScheduled(); }
    } while ((pending || running) && !closed);
  }

  function start({ initialBackup = true } = {}) {
    if (watcher || closed) return;
    watcher = watch(worldDirectory, { persistent: false }, (_event, filename) => {
      const name = typeof filename === 'string' ? filename.toLowerCase() : '';
      if (name === 'atom.json' || name === 'submissions.jsonl') schedule();
    });
    if (initialBackup) void flush().catch(() => {});
  }

  function close() {
    closed = true;
    if (timer) clearTimer(timer);
    timer = null;
    watcher?.close();
    watcher = null;
  }

  return Object.freeze({ start, close, schedule, flush });
}
