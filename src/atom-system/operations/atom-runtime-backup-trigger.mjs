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
  const delayMs = Math.max(250, Number(options.delayMs) || 2_000);
  let watcher = null;
  let timer = null;
  let running = false;
  let pending = false;
  let closed = false;

  function schedule() {
    if (closed) return;
    if (running) {
      pending = true;
      return;
    }
    if (timer) clearTimer(timer);
    timer = setTimer(flush, delayMs);
  }

  async function flush() {
    timer = null;
    if (closed) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    await runBackup({ worldDirectory, backupRepository, branch, script: options.script || defaultScript });
    running = false;
    if (pending && !closed) {
      pending = false;
      schedule();
    }
  }

  function start() {
    if (watcher || closed) return;
    watcher = watch(worldDirectory, { persistent: false }, (_event, filename) => {
      const name = typeof filename === 'string' ? filename.toLowerCase() : '';
      if (name === 'atom.json' || name === 'submissions.jsonl') schedule();
    });
    schedule();
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
