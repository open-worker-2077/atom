import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const execFileAsync = promisify(execFile);
const launcherPath = path.join(root, 'scripts', 'start-atom-graph.ps1');

async function runLauncherScenario({ taskState, taskQueryError = null, healthyAfter, timeoutSeconds = 300 }) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-launcher-'));
  const wrapper = path.join(fixture, 'run.ps1');
  const psQuote = (value) => value.replaceAll("'", "''");
  await fs.writeFile(wrapper, '\uFEFF' + [
    '$global:healthChecks = 0',
    '$global:startCalls = 0',
    '$global:browserCalls = 0',
    '$global:rawProcessCalls = 0',
    `function Invoke-RestMethod { $global:healthChecks += 1; if ($global:healthChecks -ge ${healthyAfter}) { return [pscustomobject]@{ ok = $true } }; throw 'offline' }`,
    taskQueryError
      ? `function Get-ScheduledTask { param($TaskName, $ErrorAction); if ([string]$ErrorAction -eq 'SilentlyContinue') { return @() }; throw '${taskQueryError}' }`
      : taskState
        ? `function Get-ScheduledTask { return [pscustomobject]@{ TaskName = 'Atom Graph Runtime'; State = '${taskState}' } }`
        : 'function Get-ScheduledTask { return @() }',
    'function Start-ScheduledTask { $global:startCalls += 1 }',
    'function Start-Sleep {}',
    "function Start-Process { param($FilePath); if ([string]$FilePath -eq 'http://127.0.0.1:4784/') { $global:browserCalls += 1; return }; $global:rawProcessCalls += 1; return [pscustomobject]@{ HasExited = $false } }",
    '$caught = $null',
    `try { & '${psQuote(launcherPath)}' -StartupTimeoutSeconds ${timeoutSeconds} -PollMilliseconds 1 -NoFailureDialog | Out-Null } catch { $caught = $_.Exception.Message }`,
    '[pscustomobject]@{ healthChecks = $global:healthChecks; startCalls = $global:startCalls; browserCalls = $global:browserCalls; rawProcessCalls = $global:rawProcessCalls; error = $caught } | ConvertTo-Json -Compress'
  ].join('\r\n'), 'utf8');
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper
    ]);
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

test('Atom Graph launcher starts 4784, waits for health, and opens the browser', async () => {
  const source = await fs.readFile(
    path.join(root, 'scripts', 'start-atom-graph.ps1'),
    'utf8'
  );

  assert.match(source, /127\.0\.0\.1:4784/);
  assert.match(source, /__spatial\/api\/health/);
  assert.match(source, /Invoke-RestMethod/);
  assert.match(source, /\[string\]\$RuntimeTaskName\s*=\s*['"]Atom Graph Runtime['"]/);
  assert.match(source, /Get-ScheduledTask/);
  assert.match(source, /Start-ScheduledTask/);
  assert.match(source, /\[int\]\$StartupTimeoutSeconds\s*=\s*300/);
  assert.match(source, /\[int\]\$PollMilliseconds\s*=\s*1000/);
  assert.match(source, /AddSeconds\(\$StartupTimeoutSeconds\)/);
  assert.match(source, /Write-Progress/);
  assert.match(source, /WScript\.Shell/);
  assert.match(source, /ATOM_GRAPH_STARTUP_TIMEOUT/);
  assert.match(source, /Start-Process\s+\$WebUrl/);
  assert.match(source, /\$PSScriptRoot/);
  assert.doesNotMatch(source, /4783/);
});

test('Atom Graph launcher waits for an already-running supervised cold start without spawning another server', { skip: process.platform !== 'win32' }, async () => {
  const observed = await runLauncherScenario({ taskState: 'Running', healthyAfter: 3 });
  assert.equal(observed.error, null);
  assert.equal(observed.startCalls, 0);
  assert.equal(observed.rawProcessCalls, 0);
  assert.equal(observed.browserCalls, 1);
  assert.equal(observed.healthChecks, 4);
});

test('Atom Graph launcher starts a stopped supervised task once and opens only after health', { skip: process.platform !== 'win32' }, async () => {
  const observed = await runLauncherScenario({ taskState: 'Ready', healthyAfter: 2 });
  assert.equal(observed.error, null);
  assert.equal(observed.startCalls, 1);
  assert.equal(observed.rawProcessCalls, 0);
  assert.equal(observed.browserCalls, 1);
});

test('Atom Graph launcher reports an explicit timeout instead of disappearing', { skip: process.platform !== 'win32' }, async () => {
  const observed = await runLauncherScenario({ taskState: 'Running', healthyAfter: 999, timeoutSeconds: 0 });
  assert.match(observed.error, /ATOM_GRAPH_STARTUP_TIMEOUT/);
  assert.equal(observed.browserCalls, 0);
});

test('Atom Graph launcher uses the local fallback only after a successful query proves the task is absent', { skip: process.platform !== 'win32' }, async () => {
  const observed = await runLauncherScenario({ taskState: null, healthyAfter: 2 });
  assert.equal(observed.error, null);
  assert.equal(observed.startCalls, 0);
  assert.equal(observed.rawProcessCalls, 1);
  assert.equal(observed.browserCalls, 1);
});

test('Atom Graph launcher never starts a duplicate server when scheduled-task discovery fails', { skip: process.platform !== 'win32' }, async () => {
  const observed = await runLauncherScenario({ taskQueryError: 'task service unavailable', healthyAfter: 999 });
  assert.match(observed.error, /task service unavailable/);
  assert.equal(observed.startCalls, 0);
  assert.equal(observed.rawProcessCalls, 0);
  assert.equal(observed.browserCalls, 0);
});
