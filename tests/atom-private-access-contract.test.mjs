import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

function psQuote(value) {
  return String(value).replaceAll("'", "''");
}

async function runPrivateAccessRepairHarness(t, options = {}) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-private-access-repair-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const markerDirectory = path.join(stateRoot, 'AtomGraph');
  await fs.mkdir(markerDirectory, { recursive: true });
  await fs.writeFile(path.join(markerDirectory, 'private-access.json'), JSON.stringify({
    contract: 'atom.private-access',
    version: 1,
    allowedLogin: 'worker@example.com',
    gatewayUrl: 'http://127.0.0.1:4785',
    gatewayPort: 4785,
    taskName: 'Atom Private Mobile Gateway',
    directTaskName: 'Atom Private Mobile Direct Gateway',
    directGatewayUrl: 'http://127.0.0.1:4786',
    directAllowedSource: '100.64.0.2'
  }), 'utf8');

  const repair = path.join(root, 'scripts', 'repair-atom-private-access.ps1');
  const harness = path.join(stateRoot, 'repair-harness.ps1');
  const taskApi = new Map([
    ['Get-ScheduledTask', 'Test-Get-ScheduledTask'],
    ['Register-ScheduledTask', 'Test-Register-ScheduledTask'],
    ['Unregister-ScheduledTask', 'Test-Unregister-ScheduledTask'],
    ['Start-ScheduledTask', 'Test-Start-ScheduledTask'],
    ['Stop-ScheduledTask', 'Test-Stop-ScheduledTask'],
    ['New-ScheduledTaskAction', 'Test-New-ScheduledTaskAction'],
    ['New-ScheduledTaskTrigger', 'Test-New-ScheduledTaskTrigger'],
    ['New-ScheduledTaskPrincipal', 'Test-New-ScheduledTaskPrincipal'],
    ['New-ScheduledTaskSettings', 'Test-New-ScheduledTaskSettings']
  ]);
  let repairSource = await fs.readFile(repair, 'utf8');
  for (const [actual, fake] of taskApi) {
    repairSource = repairSource.replaceAll(actual, fake);
  }
  repairSource = repairSource.replaceAll('$PSScriptRoot', '$env:REPAIR_SCRIPT_ROOT');
  await fs.writeFile(harness, repairSource, 'utf8');
  const initialTask = options.unownedTaskName
    ? `$taskStore['${psQuote(options.unownedTaskName)}'] = [pscustomobject]@{ TaskName = '${psQuote(options.unownedTaskName)}'; Description = 'foreign task'; State = 'Ready'; Action = $null }`
    : '';
  const failOnTask = options.failOnTaskName
    ? `'${psQuote(options.failOnTaskName)}'`
    : "''";
  const command = [
    `$env:LOCALAPPDATA = '${psQuote(stateRoot)}'`,
    '$global:taskStore = @{}',
    '$global:taskCalls = @()',
    initialTask.replaceAll('$taskStore', '$global:taskStore'),
    `function global:Test-Get-ScheduledTask { param([string]$TaskName) $global:taskCalls += ('get:' + $TaskName); if ($global:taskStore.ContainsKey($TaskName)) { return $global:taskStore[$TaskName] } }`,
    `function global:Test-New-ScheduledTaskAction { param([string]$Execute, [string]$Argument, [string]$WorkingDirectory) [pscustomobject]@{ Execute = $Execute; Argument = $Argument; WorkingDirectory = $WorkingDirectory } }`,
    `function global:Test-New-ScheduledTaskTrigger { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{} }`,
    `function global:Test-New-ScheduledTaskPrincipal { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{} }`,
    `function global:Test-New-ScheduledTaskSettings { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{} }`,
    `function global:Test-Register-ScheduledTask { param([string]$TaskName, $Action, $Trigger, $Principal, $Settings, [string]$Description, [switch]$Force) $global:taskCalls += ('register:' + $TaskName); if ($TaskName -eq ${failOnTask}) { throw 'SIMULATED_TASK_REGISTRATION_FAILURE' }; $global:taskStore[$TaskName] = [pscustomobject]@{ TaskName = $TaskName; Description = $Description; State = 'Ready'; Action = $Action } }`,
    `function global:Test-Unregister-ScheduledTask { param([string]$TaskName, [switch]$Confirm) $global:taskCalls += ('unregister:' + $TaskName); $global:taskStore.Remove($TaskName) | Out-Null }`,
    `function global:Test-Start-ScheduledTask { param([string]$TaskName) $global:taskCalls += ('start:' + $TaskName); if ($global:taskStore.ContainsKey($TaskName)) { $global:taskStore[$TaskName].State = 'Running' } }`,
    `function global:Test-Stop-ScheduledTask { param([string]$TaskName) $global:taskCalls += ('stop:' + $TaskName); if ($global:taskStore.ContainsKey($TaskName)) { $global:taskStore[$TaskName].State = 'Ready' } }`,
    `function global:Invoke-RestMethod { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{ ok = $true } }`,
    `function global:Invoke-WebRequest { param([Parameter(ValueFromRemainingArguments = $true)]$Arguments) [pscustomobject]@{ StatusCode = 200 } }`,
    `try { & '${psQuote(harness)}'; $errorCode = $null } catch { $errorCode = $_.Exception.Message }`,
    `$tasks = @($global:taskStore.Values | Sort-Object TaskName | ForEach-Object { [pscustomobject]@{ name = $_.TaskName; description = $_.Description; state = $_.State; execute = if ($null -eq $_.Action) { $null } else { $_.Action.Execute }; argument = if ($null -eq $_.Action) { $null } else { $_.Action.Argument } } })`,
    `$resultJson = [pscustomobject]@{ error = $errorCode; tasks = $tasks; calls = $global:taskCalls } | ConvertTo-Json -Compress -Depth 6`,
    `Write-Output ('@@RESULT64@@' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($resultJson)))`
  ].filter(Boolean).join('\n');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
  ], {
    windowsHide: true,
    env: { ...process.env, REPAIR_SCRIPT_ROOT: path.dirname(repair) }
  });
  const resultLine = stdout.trim().split(/\r?\n/u).find((line) => line.startsWith('@@RESULT64@@'));
  assert.ok(resultLine, `repair harness did not emit result: ${stdout}`);
  let result;
  try {
    result = JSON.parse(Buffer.from(resultLine.slice('@@RESULT64@@'.length), 'base64').toString('utf8'));
  } catch (error) {
    throw new Error(`invalid repair harness result: ${stdout}`, { cause: error });
  }
  return { ...result, raw: stdout };
}

test('long-running Atom task settings survive battery changes and restart crashed services', {
  skip: process.platform !== 'win32'
}, async () => {
  const helper = path.join(root, 'scripts', 'atom-long-running-task.ps1').replaceAll("'", "''");
  const command = [
    `. '${helper}'`,
    '$settings = New-AtomLongRunningTaskSettings',
    '[pscustomobject]@{',
    '  allowBattery = -not $settings.DisallowStartIfOnBatteries',
    '  keepRunningOnBattery = -not $settings.StopIfGoingOnBatteries',
    '  startWhenAvailable = $settings.StartWhenAvailable',
    '  executionTimeLimit = [string]$settings.ExecutionTimeLimit',
    '  restartCount = $settings.RestartCount',
    '  restartInterval = [string]$settings.RestartInterval',
    '  unifiedScheduling = $settings.UseUnifiedSchedulingEngine',
    '} | ConvertTo-Json -Compress'
  ].join('\n');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
  ]);
  assert.deepEqual(JSON.parse(stdout.trim()), {
    allowBattery: true,
    keepRunningOnBattery: true,
    startWhenAvailable: true,
    executionTimeLimit: 'PT0S',
    restartCount: 999,
    restartInterval: 'PT1M',
    unifiedScheduling: false
  });
});

test('private access installer is deny-first and never configures a public Funnel', async () => {
  const source = await fs.readFile(path.join(root, 'scripts', 'install-atom-private-access.ps1'), 'utf8');
  assert.match(source, /127\.0\.0\.1:4784/u);
  assert.match(source, /GatewayPort\s*=\s*4785/u);
  assert.match(source, /gatewayUrl\s*=\s*"http:\/\/127\.0\.0\.1:\$GatewayPort"/u);
  assert.match(source, /serve\s+status\s+--json/u);
  assert.match(source, /--bg/u);
  assert.match(source, /AllowedLogin/u);
  assert.match(source, /existing[^\r\n]*Serve|SERVE_CONFIG_NOT_EMPTY/iu);
  assert.match(source, /PRIVATE_GATEWAY_TASK_EXISTS/u);
  assert.doesNotMatch(source, /tailscale(?:\.exe)?["']?\s+funnel/iu);
  assert.doesNotMatch(source, /serve\s+reset/iu);
});

test('private access scheduled services directly own their Node gateway listeners', async () => {
  const repair = await fs.readFile(path.join(root, 'scripts', 'repair-atom-private-access.ps1'), 'utf8');
  assert.doesNotMatch(repair, /run-atom-private-mobile-gateway-service\.ps1/u);
  assert.doesNotMatch(repair, /powershell\.exe/u);
  const install = await fs.readFile(path.join(root, 'scripts', 'install-atom-private-access.ps1'), 'utf8');
  assert.match(install, /repair-atom-private-access\.ps1/u);
});

test('repair recreates every missing Atom-owned private access task from a valid marker', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const result = await runPrivateAccessRepairHarness(t);

  assert.equal(result.error, null, result.raw);
  assert.deepEqual(result.tasks.map((task) => task.name), [
    'Atom Graph Runtime',
    'Atom Private Mobile Direct Gateway',
    'Atom Private Mobile Gateway'
  ], result.raw);
  const runtime = result.tasks.find((task) => task.name === 'Atom Graph Runtime');
  assert.equal(runtime.execute.toLowerCase().endsWith('node.exe'), true);
  assert.match(runtime.argument, /graph-server\.mjs/u);
  for (const task of result.tasks.filter((task) => task.name !== 'Atom Graph Runtime')) {
    assert.match(task.description, /Atom mobile access|Tailnet-IP-only/u);
    assert.equal(task.execute.toLowerCase().endsWith('node.exe'), true);
    assert.match(task.argument, /private-mobile-gateway\.mjs/u);
  }
});

test('repair rejects a same-named non-Atom gateway task before replacing it', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const result = await runPrivateAccessRepairHarness(t, {
    unownedTaskName: 'Atom Private Mobile Gateway'
  });

  assert.match(result.error, /^PRIVATE_GATEWAY_TASK_EXISTS:/u, result.raw);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].description, 'foreign task');
});

test('repair compensates every task it created when a later gateway registration fails', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const result = await runPrivateAccessRepairHarness(t, {
    failOnTaskName: 'Atom Private Mobile Direct Gateway'
  });

  assert.match(result.error, /SIMULATED_TASK_REGISTRATION_FAILURE/u, result.raw);
  assert.deepEqual(result.tasks, []);
});

test('the runtime scheduled task directly owns graph-server so stopping it cannot orphan Node', async () => {
  const repair = await fs.readFile(path.join(root, 'scripts', 'repair-atom-private-access.ps1'), 'utf8');
  assert.match(repair, /serverScript\s*=.*graph-server\.mjs/u);
  assert.match(repair, /runtimeAction\s*=\s*New-ScheduledTaskAction[\s\S]*-Execute\s+\$nodeCommand\.Source/u);
  assert.match(repair, /runtimeAction\s*=\s*New-ScheduledTaskAction[\s\S]*-Argument\s+\$runtimeArguments/u);
  assert.doesNotMatch(repair, /runtimeScript\s*=.*run-atom-graph-service\.ps1/u);
});

test('private access disable script removes only owned entry and task', async () => {
  const source = await fs.readFile(path.join(root, 'scripts', 'disable-atom-private-access.ps1'), 'utf8');
  assert.match(source, /private-access\.json/u);
  assert.match(source, /Unregister-ScheduledTask/u);
  assert.match(source, /directTaskName/u);
  assert.match(source, /serve[^\r\n]*--https=443[^\r\n]*off/u);
  assert.doesNotMatch(source, /serve\s+reset/iu);
  assert.doesNotMatch(source, /tailscale(?:\.exe)?["']?\s+funnel/iu);
});

test('Windows PowerShell 5 can decode the private access scripts without a UTF-8 BOM', async () => {
  for (const file of [
    'atom-long-running-task.ps1',
    'install-atom-private-access.ps1',
    'disable-atom-private-access.ps1',
    'repair-atom-private-access.ps1',
    'run-atom-graph-service.ps1',
    'run-atom-private-mobile-gateway-service.ps1'
  ]) {
    const source = await fs.readFile(path.join(root, 'scripts', file), 'utf8');
    assert.doesNotMatch(source, /[^\u0000-\u007f]/u, `${file} must remain ASCII-compatible`);
  }
});
