import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const quote = value => value.replaceAll("'", "''");
test('desktop shortcut installation is usable, idempotent, and preserves conflicting files', { skip: process.platform !== 'win32' }, async t => {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-shortcut-'));
 t.diagnostic(`Retained synthetic desktop: ${directory}`);
 const script = path.join(directory, 'verify.ps1');
 const installer = quote(path.join(root, 'scripts/install-atom-desktop-shortcut.ps1'));
 await fs.writeFile(script, '\uFEFF' + `
 & '${installer}' -DesktopDirectory '${quote(directory)}' | Out-Null
 $file = Join-Path '${quote(directory)}' 'Atom.lnk'
 $stamp = (Get-Item $file).LastWriteTimeUtc
 & '${installer}' -DesktopDirectory '${quote(directory)}' | Out-Null
 $same = $stamp -eq (Get-Item $file).LastWriteTimeUtc
 $shell = New-Object -ComObject WScript.Shell
 $link = $shell.CreateShortcut($file)
 $argsBefore = $link.Arguments
 $link.TargetPath = (Get-Command cmd.exe).Source
 $link.Save()
 $bytesBefore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))
 $errorText = $null
 try { & '${installer}' -DesktopDirectory '${quote(directory)}' | Out-Null } catch { $errorText = $_.Exception.Message }
 [pscustomobject]@{ same=$same; arguments=$argsBefore; conflict=$errorText; preserved=($bytesBefore -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($file))) } | ConvertTo-Json -Compress
 `);
 const { stdout } = await exec('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',script]);
 const result = JSON.parse(stdout.trim());
 assert.equal(result.same, true);
 assert.match(result.arguments, /start-atom-graph\.ps1/);
 assert.match(result.conflict, /ATOM_SHORTCUT_EXISTS/);
 assert.equal(result.preserved, true);
});
test('default supervised server failure survives in a local startup log', async t => {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-startup-log-'));
 t.diagnostic(`Retained synthetic runtime: ${directory}`);
 await fs.mkdir(path.join(directory, 'AtomGraph'));
 await fs.writeFile(path.join(directory, 'AtomGraph/runtime-authority.json'), '{}');
 await assert.rejects(exec(process.execPath, [path.join(root, 'work-engine/atom-language/graph-server.mjs')], { env: {...process.env, LOCALAPPDATA:directory} }), error => {
  assert.match(error.stderr, /INVALID_RUNTIME_AUTHORITY_MARKER/); return true;
 });
 const logs = await fs.readdir(path.join(directory, 'AtomGraph/startup-logs'));
 const event = JSON.parse((await fs.readFile(path.join(directory, 'AtomGraph/startup-logs', logs[0]), 'utf8')).trim());
 assert.equal(event.status, 'failed');
 assert.equal(event.code, 'INVALID_RUNTIME_AUTHORITY_MARKER');
});
