import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Windows Boss backup is scheduled, Git-backed, and never mirrors source deletion', async () => {
  const backup = await fs.readFile(path.join(root, 'scripts', 'backup-boss-json.ps1'), 'utf8');
  const installer = await fs.readFile(path.join(root, 'scripts', 'install-boss-backup-task.ps1'), 'utf8');
  const server = await fs.readFile(path.join(root, 'cli', 'lib', 'server.mjs'), 'utf8');
  const cli = await fs.readFile(path.join(root, 'cli', 'lib', 'cli-app.mjs'), 'utf8');
  const ignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');

  assert.match(backup, /Get-ChildItem[\s\S]+-Filter "\*\.json"/);
  assert.match(backup, /Copy-Item/);
  assert.match(backup, /git -C \$repositoryRoot commit/);
  assert.match(backup, /git -C \$repositoryRoot push origin \$Branch/);
  assert.match(backup, /origin\/\$Branch\.\.HEAD/);
  assert.match(backup, /pending local commit/);
  assert.doesNotMatch(backup, /Remove-Item|robocopy[\s\S]+\/MIR/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(installer, /\[int\]\$Minutes = 15/);
  assert.match(installer, /-WindowStyle Hidden/);
  assert.match(installer, /New-ScheduledTaskSettingsSet[\s\S]+-Hidden/);
  assert.match(installer, /LogonType Interactive/);
  assert.match(installer, /RunLevel Limited/);
  assert.match(installer, /RepetitionInterval/);
  assert.match(server, /createBossBackupTrigger/);
  assert.match(cli, /WORLD_MODELING_BOSS_BACKUP_REPO/);
  assert.match(ignore, /^data\/boss-data\/$/m);
});
