import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSpatialCli } from '../cli/lib/cli-app.mjs';

function output() {
  let text = '';
  return {
    write(value) { text += value; },
    value() { return text; }
  };
}

async function run(args) {
  const stdout = output();
  const stderr = output();
  const code = await runSpatialCli(args, {
    stdout,
    stderr,
    stdin: { isTTY: false },
    interactive: false,
    env: {}
  });
  return { code, stdout: stdout.value(), stderr: stderr.value() };
}

test('CLI creates and writes isolated Boss JSON files with leader routing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-4d-boss-cli-'));
  assert.equal((await run(['boss', 'create', 'manageboard', '--name', '个人主库', '--boss-dir', directory, '--json'])).code, 0);
  assert.equal((await run(['boss', 'create', 'test', '--name', '测试库', '--boss-dir', directory, '--json'])).code, 0);

  const created = await run([
    'node', 'create',
    '--boss', 'manageboard',
    '--leader', 'manageboard',
    '--id', 'task-1',
    '--name', '第一项',
    '--path', 'root/manageboard',
    '--boss-dir', directory,
    '--json'
  ]);
  assert.equal(created.code, 0, created.stderr);

  const manageboard = JSON.parse(await fs.readFile(path.join(directory, 'bosses', 'manageboard.json'), 'utf8'));
  const testKnowledge = JSON.parse(await fs.readFile(path.join(directory, 'bosses', 'test.json'), 'utf8'));
  assert.equal(manageboard.nodes.length, 2);
  assert.equal(manageboard.nodes[1].bossId, 'manageboard');
  assert.equal(manageboard.nodes[1].leaderId, 'manageboard');
  assert.equal(testKnowledge.nodes.length, 1);
});

test('CLI undo and redo operate only on the selected Boss', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-4d-boss-cli-history-'));
  await run(['boss', 'create', 'individual-management', '--boss-dir', directory, '--json']);
  await run(['boss', 'create', 'test', '--boss-dir', directory, '--json']);
  await run([
    'node', 'create',
    '--boss', 'individual-management',
    '--leader', 'individual-management',
    '--id', 'task',
    '--name', '合成任务',
    '--boss-dir', directory,
    '--json'
  ]);

  assert.equal((await run(['boss', 'undo', 'individual-management', '--boss-dir', directory, '--json'])).code, 0);
  let individual = JSON.parse(await fs.readFile(path.join(directory, 'bosses', 'individual-management.json'), 'utf8'));
  let testKnowledge = JSON.parse(await fs.readFile(path.join(directory, 'bosses', 'test.json'), 'utf8'));
  assert.equal(individual.nodes.length, 1);
  assert.equal(testKnowledge.nodes.length, 1);

  assert.equal((await run(['boss', 'redo', 'individual-management', '--boss-dir', directory, '--json'])).code, 0);
  individual = JSON.parse(await fs.readFile(path.join(directory, 'bosses', 'individual-management.json'), 'utf8'));
  testKnowledge = JSON.parse(await fs.readFile(path.join(directory, 'bosses', 'test.json'), 'utf8'));
  assert.equal(individual.nodes.length, 2);
  assert.equal(testKnowledge.nodes.length, 1);
});
