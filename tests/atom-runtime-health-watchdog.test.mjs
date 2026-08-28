import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function psQuote(value) {
  return String(value).replaceAll("'", "''");
}

async function runWatchdog(t, options = {}) {
  const stateRoot = options.stateRoot
    ?? await fs.mkdtemp(path.join(os.tmpdir(), 'atom-runtime-watchdog-'));
  if (!options.stateRoot) t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const statePath = path.join(stateRoot, 'watchdog.json');
  if (options.state) await fs.writeFile(statePath, JSON.stringify(options.state), 'utf8');
  const script = path.join(root, 'scripts', 'watch-atom-runtime-health.ps1');
  const health = options.health ?? [true];
  const command = [
    `$global:now = [datetime]'${options.now ?? '2026-08-28T00:00:00Z'}'`,
    `$global:taskState = '${options.taskState ?? 'Running'}'`,
    '$global:calls = [System.Collections.ArrayList]::new()',
    `$global:health = [System.Collections.Queue]::new([object[]]@(${health.map((value) => value ? '$true' : '$false').join(',')}))`,
    'function global:Get-Date { $global:now }',
    'function global:Get-ScheduledTask { param([string]$TaskName, [Parameter(ValueFromRemainingArguments = $true)]$Rest) [pscustomobject]@{ TaskName = $TaskName; State = $global:taskState } }',
    'function global:Start-ScheduledTask { param([string]$TaskName, [Parameter(ValueFromRemainingArguments = $true)]$Rest) [void]$global:calls.Add("start:$TaskName"); $global:taskState = "Running" }',
    'function global:Stop-ScheduledTask { param([string]$TaskName, [Parameter(ValueFromRemainingArguments = $true)]$Rest) [void]$global:calls.Add("stop:$TaskName"); $global:taskState = "Ready" }',
    `function global:Invoke-RestMethod { param([string]$Uri, [Parameter(ValueFromRemainingArguments = $true)]$Rest) [void]$global:calls.Add("health:$Uri"); ${options.healthEnteredPath ? `Set-Content -LiteralPath '${psQuote(options.healthEnteredPath)}' -Value entered` : ''}; ${options.healthDelayMilliseconds ? `Microsoft.PowerShell.Utility\\Start-Sleep -Milliseconds ${options.healthDelayMilliseconds}` : ''}; if ($global:health.Count -eq 0 -or -not [bool]$global:health.Dequeue()) { throw "UNHEALTHY" }; [pscustomobject]@{ ok = $true } }`,
    'function global:Start-Sleep { param([int]$Milliseconds, [int]$Seconds) if ($Milliseconds) { $global:now = $global:now.AddMilliseconds($Milliseconds) } elseif ($Seconds) { $global:now = $global:now.AddSeconds($Seconds) } }',
    `$result = & '${psQuote(script)}' -TaskName 'Atom Graph Runtime' -HealthUrl 'http://127.0.0.1:4784/health' -StatePath '${psQuote(statePath)}' -MutexName '${psQuote(options.mutexName ?? `Local\\AtomGraphWatchdog-${path.basename(stateRoot)}`)}' -StartupGraceSeconds 30 -CooldownSeconds 120 -WaitTimeoutSeconds 2 -PollMilliseconds 100`,
    '$payload = [pscustomobject]@{ result = $result; calls = @($global:calls); taskState = $global:taskState } | ConvertTo-Json -Compress -Depth 8',
    'Write-Output ("@@RESULT64@@" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)))'
  ].join('\n');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
  ], { windowsHide: true });
  const line = stdout.trim().split(/\r?\n/u).find((value) => value.startsWith('@@RESULT64@@'));
  assert.ok(line, stdout);
  return JSON.parse(Buffer.from(line.slice('@@RESULT64@@'.length), 'base64').toString('utf8'));
}

async function waitForFile(file, timeoutMilliseconds = 3000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await fs.access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.fail(`timed out waiting for ${file}`);
}

async function runInstaller() {
  const script = path.join(root, 'scripts', 'install-atom-runtime-health-watchdog.ps1');
  const command = [
    '$global:calls = [System.Collections.ArrayList]::new()',
    '$global:tasks = @{ "Atom Graph Runtime" = [pscustomobject]@{ TaskName = "Atom Graph Runtime"; Description = "Atom Graph runtime supervisor [atom.graph-runtime/1]"; Actions = @([pscustomobject]@{ Execute = "C:\\Program Files\\nodejs\\node.exe"; Arguments = "graph-server.mjs" }) } }',
    'function global:Get-ScheduledTask { param([string]$TaskName, [Parameter(ValueFromRemainingArguments = $true)]$Rest) if ($global:tasks.ContainsKey($TaskName)) { $global:tasks[$TaskName] } }',
    'function global:New-ScheduledTaskAction { param([string]$Execute, [string]$Argument, [string]$WorkingDirectory) [pscustomobject]@{ Execute = $Execute; Argument = $Argument; WorkingDirectory = $WorkingDirectory } }',
    'function global:New-ScheduledTaskTrigger { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{ kind = "periodic" } }',
    'function global:New-ScheduledTaskPrincipal { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{ kind = "current-user" } }',
    'function global:New-ScheduledTaskSettingsSet { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{ kind = "bounded-single-instance" } }',
    'function global:Register-ScheduledTask { param([string]$TaskName, $Action, $Trigger, $Principal, $Settings, [string]$Description, [switch]$Force) [void]$global:calls.Add("register:$TaskName"); $global:tasks[$TaskName] = [pscustomobject]@{ TaskName = $TaskName; Description = $Description; Action = $Action; Trigger = $Trigger; Settings = $Settings } }',
    'function global:Start-ScheduledTask { param([string]$TaskName) [void]$global:calls.Add("start:$TaskName") }',
    'function global:Stop-ScheduledTask { param([string]$TaskName) [void]$global:calls.Add("stop:$TaskName") }',
    `try { $result = & '${psQuote(script)}'; $errorMessage = $null } catch { $result = $null; $errorMessage = $_.Exception.Message }`,
    '$runtime = $global:tasks["Atom Graph Runtime"]',
    '$watchdog = $global:tasks["Atom Graph Runtime Health Watchdog"]',
    '$payload = [pscustomobject]@{ result = $result; error = $errorMessage; calls = @($global:calls); runtimeExecute = $runtime.Actions[0].Execute; runtimeArguments = $runtime.Actions[0].Arguments; watchdog = $watchdog } | ConvertTo-Json -Compress -Depth 8',
    'Write-Output ("@@RESULT64@@" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)))'
  ].join('\n');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
  ], { windowsHide: true });
  const line = stdout.trim().split(/\r?\n/u).find((value) => value.startsWith('@@RESULT64@@'));
  assert.ok(line, stdout);
  return JSON.parse(Buffer.from(line.slice('@@RESULT64@@'.length), 'base64').toString('utf8'));
}

test('a deliberately stopped runtime task is started once and awaited to health', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const observed = await runWatchdog(t, {
    taskState: 'Ready',
    health: [false, true]
  });

  assert.equal(observed.result.action, 'started');
  assert.equal(observed.result.healthy, true);
  assert.deepEqual(observed.calls.filter((call) => call.startsWith('start:')), [
    'start:Atom Graph Runtime'
  ]);
  assert.equal(observed.calls.some((call) => call.startsWith('stop:')), false);
  assert.equal(observed.taskState, 'Running');
});

test('a running task receives its full startup grace before any restart', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const observed = await runWatchdog(t, {
    taskState: 'Running',
    health: [false]
  });

  assert.equal(observed.result.action, 'grace');
  assert.equal(observed.calls.some((call) => /^(?:stop|start):/u.test(call)), false);
  const state = JSON.parse(await fs.readFile(observed.result.statePath, 'utf8'));
  assert.equal(state.unhealthySince, '2026-08-28T00:00:00.0000000Z');
});

test('a healthy running task performs no lifecycle action and clears an old failure observation', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const observed = await runWatchdog(t, {
    taskState: 'Running',
    health: [true],
    state: {
      unhealthySince: '2026-08-27T23:58:00.0000000Z',
      lastRecoveryAt: '2026-08-27T23:59:30.0000000Z'
    }
  });

  assert.equal(observed.result.action, 'none');
  assert.equal(observed.calls.some((call) => /^(?:stop|start):/u.test(call)), false);
  const state = JSON.parse(await fs.readFile(observed.result.statePath, 'utf8'));
  assert.equal(state.unhealthySince, null);
  assert.equal(state.lastRecoveryAt, null);
});

test('sustained unhealthy state causes exactly one controlled stop and start', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const observed = await runWatchdog(t, {
    taskState: 'Running',
    health: [false, false, true],
    state: { unhealthySince: '2026-08-27T23:59:00.0000000Z', lastRecoveryAt: null }
  });

  assert.equal(observed.result.action, 'restarted');
  assert.equal(observed.result.healthy, true);
  assert.deepEqual(observed.calls.filter((call) => /^(?:stop|start):/u.test(call)), [
    'stop:Atom Graph Runtime',
    'start:Atom Graph Runtime'
  ]);
});

test('a recent recovery cools down without another lifecycle attempt', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const observed = await runWatchdog(t, {
    taskState: 'Running',
    health: [false],
    state: {
      unhealthySince: '2026-08-27T23:55:00.0000000Z',
      lastRecoveryAt: '2026-08-27T23:59:30.0000000Z'
    }
  });

  assert.equal(observed.result.action, 'cooldown');
  assert.equal(observed.calls.some((call) => /^(?:stop|start):/u.test(call)), false);
});

test('one unhealthy invocation has one recovery attempt and a bounded health wait', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const observed = await runWatchdog(t, {
    taskState: 'Running',
    health: [false],
    state: { unhealthySince: '2026-08-27T23:59:00.0000000Z', lastRecoveryAt: null }
  });

  assert.equal(observed.result.action, 'restarted');
  assert.equal(observed.result.healthy, false);
  assert.deepEqual(observed.calls.filter((call) => /^(?:stop|start):/u.test(call)), [
    'stop:Atom Graph Runtime',
    'start:Atom Graph Runtime'
  ]);
  assert.equal(observed.calls.filter((call) => call.startsWith('health:')).length <= 25, true);
});

test('concurrent watchdog invocations share one mutex and only one probes the runtime', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-runtime-watchdog-concurrent-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const entered = path.join(stateRoot, 'health-entered');
  const mutexName = `Local\\AtomGraphWatchdog-concurrent-${path.basename(stateRoot)}`;
  const first = runWatchdog(t, {
    stateRoot, mutexName, taskState: 'Running', health: [true],
    healthEnteredPath: entered, healthDelayMilliseconds: 600
  });
  await waitForFile(entered);
  const second = runWatchdog(t, {
    stateRoot, mutexName, taskState: 'Running', health: [true]
  });
  const observed = await Promise.all([first, second]);

  assert.deepEqual(observed.map((entry) => entry.result.action).sort(), ['none', 'skipped']);
  assert.equal(observed.flatMap((entry) => entry.calls)
    .filter((call) => call.startsWith('health:')).length, 1);
});

test('installer adds only a periodic watchdog while the runtime task keeps direct Node ownership', {
  skip: process.platform !== 'win32'
}, async () => {
  const observed = await runInstaller();

  assert.equal(observed.error, null);
  assert.equal(observed.runtimeExecute.toLowerCase().endsWith('node.exe'), true);
  assert.match(observed.runtimeArguments, /graph-server\.mjs/u);
  assert.deepEqual(observed.calls, ['register:Atom Graph Runtime Health Watchdog']);
  assert.match(observed.watchdog.Action.Execute, /powershell\.exe$/iu);
  assert.match(observed.watchdog.Action.Argument, /watch-atom-runtime-health\.ps1/u);
});
