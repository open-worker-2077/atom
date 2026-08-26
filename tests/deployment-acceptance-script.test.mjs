import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(projectRoot, 'scripts', 'accept-real-world-write-copy.mjs');
const fixture = path.join(projectRoot, 'tests', 'fixtures', 'deployment-acceptance-world.json');
const temporaryPrefix = 'atom-real-write-acceptance-';

async function acceptanceDirectories() {
  return new Set((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(temporaryPrefix)));
}

test('deployment acceptance proves an ephemeral isolated world and removes its successful copy', async () => {
  const sourceBefore = await fs.readFile(fixture, 'utf8');
  const directoriesBefore = await acceptanceDirectories();
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--context', fixture,
    '--agent', '部署验收窗口',
    '--cleanup'
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.equal(result.ephemeralPort, true);
  assert.notEqual(result.port, 4784);
  assert.equal(result.sourceContextUnchanged, true);
  assert.equal(await fs.readFile(fixture, 'utf8'), sourceBefore);
  assert.deepEqual(await acceptanceDirectories(), directoriesBefore);
});

test('deployment acceptance removes its temporary copy when agent resolution fails', async () => {
  const directoriesBefore = await acceptanceDirectories();
  await assert.rejects(execFileAsync(process.execPath, [
    script,
    '--context', fixture,
    '--agent', '__missing_deployment_acceptance_agent__',
    '--cleanup'
  ], { cwd: projectRoot }));
  assert.deepEqual(await acceptanceDirectories(), directoriesBefore);
});
