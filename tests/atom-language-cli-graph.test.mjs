import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSpatialServer } from '../cli/lib/server.mjs';
import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';

async function runCli(args, execute = executeAtomLanguage) {
  let stdout = '';
  let stderr = '';
  let result = null;
  const code = await runAtomCli(['--json', ...args], {
    execute: async (options) => {
      result = await execute(options);
      return result;
    },
    stdin: { isTTY: false },
    stdout: {
      isTTY: false,
      write(value) {
        stdout += value;
      }
    },
    stderr: {
      write(value) {
        stderr += value;
      }
    }
  });
  return {
    code,
    stdout,
    stderr,
    result,
    output: stdout
      ? materializeGraphJson(parseGraphJson(stdout))
      : null
  };
}

function findGraphNode(document, thing) {
  const queue = [document.graph];
  while (queue.length) {
    const node = queue.shift();
    if (node.thing === thing) return node;
    queue.push(...node.contain);
  }
  return null;
}

test('the atom CLI drives a graph served from a fully isolated 4784-style store', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-cli-graph-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');

  const created = await runCli([
    '--context',
    contextFile,
    '--projection',
    projectionFile,
    'transform',
    'new',
    '{"thing":"石器工坊","situation#工坊简介":"第一版正文","contain":[],"support":[]}'
  ]);
  assert.equal(created.code, 0, created.stderr);
  assert.deepEqual(created.output, { 'thing~created': '石器工坊' });

  const instance = await createSpatialServer({
    storeFile,
    graphFile: projectionFile
  });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => instance.server.close(resolve)));
  const address = instance.server.address();
  assert.notEqual(address.port, 4783);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/__spatial/api/health`).then((response) => response.json());
  assert.equal(health.store, path.resolve(storeFile));
  assert.equal(health.graphFile, path.resolve(projectionFile));

  const firstGraph = await fetch(`${baseUrl}/__spatial/api/graph`).then((response) => response.json());
  assert.equal(findGraphNode(firstGraph, '石器工坊')['situation#工坊简介'], '第一版正文');

  const transformed = await runCli([
    '--context',
    contextFile,
    '--projection',
    projectionFile,
    'transform',
    '{"thing":"石器工坊","situation.rep.第二版正文"}'
  ]);
  assert.equal(transformed.code, 0, transformed.stderr);
  assert.deepEqual(transformed.output, { 'thing~updated': '石器工坊' });

  const secondGraph = await fetch(`${baseUrl}/__spatial/api/graph`).then((response) => response.json());
  assert.equal(findGraphNode(secondGraph, '石器工坊')['situation#工坊简介'], '第二版正文');

  const explored = await runCli([
    '--context',
    contextFile,
    '--projection',
    projectionFile,
    'explore',
    '{"thing":"石器工坊","situation$full"}'
  ]);
  assert.equal(explored.code, 0, explored.stderr);
  assert.match(explored.stdout, /第二版正文/u);
});

test('exact CLI Explore exposes an explicit read-only compiled-lock status without mutating the target', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-cli-lock-status-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const root = 'Lock Status Contract';
  const target = `${root}/Target`;
  const created = await runCli([
    '--context', contextFile, '--projection', projectionFile,
    'transform', 'new', JSON.stringify({
      thing: root, situation: 'synthetic lock status contract', contain: [
        { thing: 'Target', situation: 'unchanged', contain: [], support: [] }
      ], support: []
    })
  ]);
  assert.equal(created.code, 0, created.stderr);

  const explored = await runCli([
    '--context', contextFile, '--projection', projectionFile,
    'explore', JSON.stringify({ thing: target, 'situation$lock': true })
  ]);
  assert.equal(explored.code, 0, explored.stderr);
  assert.deepEqual(explored.output['lock~status'], {
    active: false,
    compiled: null
  }, explored.stdout);
});

test('exact CLI Explore renders lock~active for a compiled literal path lock', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-cli-active-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const root = 'Lock Active Contract';
  const target = `${root}/Target`;
  const guard = `${root}/Guard`;
  await fs.writeFile(contextFile, JSON.stringify([{
    thing: root, situation: 'synthetic active lock contract', contain: [
      { thing: 'Target', situation: 'unchanged', contain: [], support: [] },
      { 'thing@program': 'Guard', situation: `lock({"targets":{"paths":["${target}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`, contain: [], support: [] }
    ], support: []
  }]), 'utf8');
  const compiledLock = { kind: 'node', path: target, actions: ['transform'], labels: ['^'], sourceProgramPath: guard };
  const executeWithCompiledLock = (options) => executeAtomLanguage({
    ...options,
    programScheduler: {
      async activeRequestDrivenLocks() { return [compiledLock]; },
      async current() { return { locks: [compiledLock], records: [], messages: [], failures: [], runtimeWarnings: [] }; },
      async refresh() { return { locks: [], records: [], messages: [], failures: [], runtimeWarnings: [] }; }
    }
  });

  const explored = await runCli([
    '--context', contextFile, '--projection', projectionFile,
    'explore', JSON.stringify({ thing: target, 'situation$full': true })
  ], executeWithCompiledLock);
  assert.equal(explored.code, 0, explored.stderr);
  assert.deepEqual(explored.output['lock~active'], {
    kind: 'node', path: target, actions: ['transform'], labels: ['^'], sourceProgramPath: guard
  }, `${explored.stdout}\n${JSON.stringify(explored.result)}`);
});
