import { spawn } from 'node:child_process';
import { watch as watchFileSystem } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'backup-boss-json.ps1'
);

function runPowerShellBackup({ bossDirectory, backupRepository, branch, script = defaultScript }) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-BossDirectory',
      bossDirectory,
      '-BackupRepository',
      backupRepository,
      '-Branch',
      branch
    ], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

export function createBossBackupTrigger(options = {}) {
  const bossDirectory = path.resolve(options.bossDirectory);
  const backupRepository = path.resolve(options.backupRepository);
  const branch = options.branch || 'main';
  const delayMs = Math.max(250, Number(options.delayMs) || 15_000);
  const watch = options.watch || watchFileSystem;
  const runBackup = options.runBackup || runPowerShellBackup;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let watcher = null;
  let timer = null;
  let running = false;
  let pending = false;
  let closed = false;

  async function flush() {
    timer = null;
    if (closed) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    await runBackup({ bossDirectory, backupRepository, branch });
    running = false;
    if (pending && !closed) {
      pending = false;
      schedule();
    }
  }

  function schedule() {
    if (closed) return;
    if (timer) clearTimer(timer);
    timer = setTimer(flush, delayMs);
  }

  function start() {
    if (watcher || closed) return;
    watcher = watch(bossDirectory, { recursive: true }, (_event, filename) => {
      if (typeof filename === 'string' && filename.toLowerCase().endsWith('.json')) {
        schedule();
      }
    });
    schedule();
  }

  function close() {
    closed = true;
    if (timer) clearTimer(timer);
    timer = null;
    if (watcher) watcher.close();
    watcher = null;
  }

  return {
    start,
    close,
    schedule,
    flush,
    get state() {
      return { running, pending, scheduled: Boolean(timer), closed };
    }
  };
}
