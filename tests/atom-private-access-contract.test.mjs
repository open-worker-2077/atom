import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

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
    restartInterval: 'PT1M'
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
