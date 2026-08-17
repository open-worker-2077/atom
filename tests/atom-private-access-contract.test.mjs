import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  for (const file of ['install-atom-private-access.ps1', 'disable-atom-private-access.ps1']) {
    const source = await fs.readFile(path.join(root, 'scripts', file), 'utf8');
    assert.doesNotMatch(source, /[^\u0000-\u007f]/u, `${file} must remain ASCII-compatible`);
  }
});
