import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  migrateAtomRuntimeData,
  resolveAtomRuntime
} from '../work-engine/atom-language/runtime-config.mjs';

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

test('runtime paths keep source code separate from one primary Atom world', () => {
  const runtime = resolveAtomRuntime({ localAppData: 'C:/Users/test/AppData/Local' });
  assert.equal(runtime.root, path.resolve('C:/Users/test/AppData/Local/AtomGraph'));
  assert.equal(runtime.contextFile, path.join(runtime.root, 'worlds', 'primary', 'atom.json'));
  assert.equal(runtime.graphFile, path.join(runtime.root, 'worlds', 'primary', 'graph.json'));
  assert.equal(runtime.storeFile, path.join(runtime.root, 'worlds', 'primary', 'knowledge.json'));
  assert.equal(runtime.sessionsDirectory, path.join(runtime.root, 'worlds', 'primary', 'sessions'));
  assert.equal(runtime.configFile, path.join(runtime.root, 'config.json'));
});

test('migration backs up, copies, verifies, and writes one shared runtime config without deleting source', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceDirectory = path.join(directory, 'repo', 'live');
  const localAppData = path.join(directory, 'LocalAppData');
  await fs.mkdir(sourceDirectory, { recursive: true });
  const files = {
    'atom.json': '[{"name":"A"}]\n',
    'graph.json': '{"graph":"projection"}\n',
    'knowledge.json': '{"view":"state"}\n'
  };
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(sourceDirectory, name), text);
  }

  const result = await migrateAtomRuntimeData({
    sourceDirectory,
    localAppData,
    timestamp: '20260809-120000'
  });

  for (const [name, text] of Object.entries(files)) {
    assert.equal(hash(await fs.readFile(path.join(result.runtime.worldDirectory, name), 'utf8')), hash(text));
    assert.equal(hash(await fs.readFile(path.join(result.backupDirectory, name), 'utf8')), hash(text));
    assert.equal(hash(await fs.readFile(path.join(sourceDirectory, name), 'utf8')), hash(text));
  }
  const config = JSON.parse(await fs.readFile(result.runtime.configFile, 'utf8'));
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.world, 'primary');
  assert.equal(config.contextFile, result.runtime.contextFile);
});
