import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(projectRoot, 'scripts', 'deploy-graph-four-axis-world.mjs');

function legacyNode(name, detail = '', children = [], suffix = '') {
  return { [`name${suffix}`]: name, detail, children, partners: [] };
}

test('deployment preflight passes exact test roots through the world migration operation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-four-axis-deploy-script-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const world = [legacyNode('World', '', [
    legacyNode('test', '', [legacyNode(
      'Fixture Program', "explore({'name':'Fixture'})", [], '@program'
    )]),
    legacyNode('Active Program', "explore({'name':'Active'})", [], '@program')
  ])];
  await fs.writeFile(contextFile, `${JSON.stringify(world, null, 2)}\n`, 'utf8');

  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--isolated-root', 'World/test'
  ], { cwd: projectRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.deepEqual(result.testRoots, ['World/test']);
  assert.equal(Object.hasOwn(result, 'isolatedRoots'), false);
  assert.equal(result.counts.testLegacyPrograms, 1);
  assert.equal(result.counts.activeLegacyPrograms, 1);
  assert.equal(result.counts.upgradedPrograms, 2);
});
