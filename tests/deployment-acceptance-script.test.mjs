import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import deploymentAcceptanceWorld from './fixtures/deployment-acceptance-world.fixture.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(projectRoot, 'scripts', 'accept-real-world-write-copy.mjs');
const temporaryPrefix = 'atom-real-write-acceptance-';

async function acceptanceDirectories() {
  return new Set((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(temporaryPrefix)));
}

async function createContext(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-deployment-source-'));
  const contextFile = path.join(directory, 'atom.json');
  const source = `${JSON.stringify(deploymentAcceptanceWorld, null, 2)}\n`;
  await fs.writeFile(contextFile, source, 'utf8');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { contextFile, source };
}

test('deployment acceptance proves an ephemeral isolated world and removes its successful copy', async (t) => {
  const { contextFile, source } = await createContext(t);
  const directoriesBefore = await acceptanceDirectories();
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--agent', '部署验收窗口',
    '--cleanup'
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.equal(result.ephemeralPort, true);
  assert.notEqual(result.port, 4784);
  assert.equal(result.sourceContextUnchanged, true);
  assert.equal(await fs.readFile(contextFile, 'utf8'), source);
  assert.deepEqual(await acceptanceDirectories(), directoriesBefore);
});

test('deployment acceptance removes its temporary copy when agent resolution fails', async (t) => {
  const { contextFile } = await createContext(t);
  const directoriesBefore = await acceptanceDirectories();
  await assert.rejects(execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--agent', '__missing_deployment_acceptance_agent__',
    '--cleanup'
  ], { cwd: projectRoot }));
  assert.deepEqual(await acceptanceDirectories(), directoriesBefore);
});
