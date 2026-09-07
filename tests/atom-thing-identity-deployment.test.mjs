import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { planThingIdentityMigration } from '../work-engine/atom-language/thing-identity-migration.mjs';

const run = promisify(execFile);
const operator = path.resolve('scripts/deploy-thing-identity-world.mjs');

function atom(thing, situation = '', slot = [], strut = []) {
  return { thing, situation, slot, strut };
}

test('Thing identity operator backs up, commits, reads back, and rolls back one cold world', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-thing-id-deploy-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  await fs.mkdir(worldDirectory, { recursive: true });
  const source = [atom('域', '', [
    atom('目标'),
    atom('来源', '', [], [{ 'if@current': true, then: [{ thing: '目标' }] }])
  ])];
  const sourceRevision = revisionOfWorldFacts(source);
  await fs.writeFile(path.join(worldDirectory, 'atom.json'), `${JSON.stringify(source, null, 2)}\n`);
  await fs.writeFile(path.join(worldDirectory, 'graph.json'), `${JSON.stringify(source, null, 2)}\n`);

  const environment = { ...process.env, LOCALAPPDATA: localAppData };
  const dry = JSON.parse((await run(process.execPath, [operator, '--dry-run', '--attempt', 'cold'], {
    env: environment
  })).stdout);
  assert.equal(dry.changed, true);
  assert.equal(dry.summary.thingCount, 3);

  const applied = JSON.parse((await run(process.execPath, [operator, '--apply', '--attempt', 'cold'], {
    env: environment
  })).stdout);
  const deployed = JSON.parse(await fs.readFile(path.join(worldDirectory, 'atom.json'), 'utf8'));
  const verified = planThingIdentityMigration(deployed);
  assert.equal(verified.changed, false);
  assert.equal(verified.summary.uniqueIdentityCount, 3);
  assert.equal(verified.summary.boundStrutEndpointCount, 1);
  assert.equal((await fs.stat(applied.backup.receiptFile)).isFile(), true);

  const rolledBack = JSON.parse((await run(process.execPath, [operator, '--rollback', applied.receiptFile], {
    env: environment
  })).stdout);
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.revision, sourceRevision);
  const persistence = createTransactionalWorldPersistence({
    contextFile: path.join(worldDirectory, 'atom.json'),
    projectionFile: path.join(worldDirectory, 'graph.json'),
    journalFile: path.join(worldDirectory, 'atom.transactions.json')
  });
  assert.deepEqual((await persistence.readCommittedSnapshot()).facts, source);
  assert.deepEqual(JSON.parse(await fs.readFile(
    path.join(applied.paths.backupDirectory, 'atom.json'), 'utf8'
  )), source);
});
