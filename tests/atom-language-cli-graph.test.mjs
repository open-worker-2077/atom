import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

import { createSpatialServer } from '../cli/lib/server.mjs';
import {
  executeAtomCommandEndpoint,
  runAtomCli
} from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';
import { createNightWatchCliFixture } from '../scripts/night-watch-isolated-cli-fixture.mjs';
import { atomCmdSpawnOptions } from '../scripts/night-watch-isolated-cli-live.mjs';

function runExternalAtom(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('atom.cmd', args, atomCmdSpawnOptions());
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function runIsolatedCliJourney(evidenceDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/night-watch-isolated-cli-live.mjs', '--evidence-dir', evidenceDir
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

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

test('public CLI targets an explicitly isolated command endpoint', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-public-cli-endpoint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    { 'thing@agent': '🧊', situation: 'isolated synthetic Agent', contain: [], support: [] },
    { thing: 'test', situation: 'isolated synthetic domain', contain: [], support: [] }
  ], null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());

  let stdout = '';
  let stderr = '';
  const code = await runAtomCli([
    '--endpoint', `${running.url}/__atom/api/command`, '--agent', '🧊', 'atom'
  ], {
    execute: executeAtomCommandEndpoint,
    requireAgent: true,
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });

  assert.equal(code, 0, stderr);
  assert.match(stdout, /"agent~current"\s*:\s*"🧊"/u);
});

test('the isolated live runner launches public atom.cmd through the Windows shell only for fixed generated arguments', () => {
  assert.equal(atomCmdSpawnOptions().shell, process.platform === 'win32' ? true : undefined);
});

test('the Windows atom.cmd wrapper preserves --agent for an isolated endpoint', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-external-cli-agent-'));
  const fixture = createNightWatchCliFixture(directory);
  await fs.writeFile(fixture.contextFile, JSON.stringify(fixture.world, null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0,
    contextFile: fixture.contextFile, graphFile: fixture.graphFile, storeFile: fixture.storeFile
  });
  t.after(async () => {
    running.server.closeAllConnections?.();
    await running.close();
  });
  const result = await runExternalAtom([
    '--endpoint', `${running.url}/__atom/api/command`, '--agent', 'Bootstrap', '--stdin'
  ], 'atom');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /"agent~current"\s*:\s*"test\/Bootstrap"/u);
});

test('an explicitly registered ^ synthetic Agent proves path-lock fail-closed and rejects ^^ delegation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-night-watch-cli-labels-'));
  const fixture = createNightWatchCliFixture(directory);
  assert.match(fixture.syntheticAgentSource, /"json_parse"/u);
  await fs.writeFile(fixture.contextFile, JSON.stringify(fixture.world, null, 2));
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0,
    contextFile: fixture.contextFile, graphFile: fixture.graphFile, storeFile: fixture.storeFile
  });
  t.after(async () => {
    running.server.closeAllConnections?.();
    await running.close();
  });
  const endpoint = `${running.url}/__atom/api/command`;
  const command = async (agent, source) => {
    let stdout = '';
    let stderr = '';
    const code = await runAtomCli(['--endpoint', endpoint, '--agent', agent, ...source], {
      execute: executeAtomCommandEndpoint,
      requireAgent: true,
      stdout: { isTTY: false, write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } }
    });
    return { code, stdout, stderr };
  };

  const registered = await command(fixture.bootstrapPath, [
    'transform', 'new', JSON.stringify({
      'thing@program': fixture.syntheticPath,
      situation: fixture.syntheticAgentSource,
      contain: [], support: []
    })
  ]);
  assert.equal(registered.code, 0, registered.stderr);
  const activated = await command(fixture.bootstrapPath, [
    'transform', JSON.stringify({ 'thing.run.': fixture.syntheticPath })
  ]);
  assert.equal(activated.code, 0, activated.stderr);
  const readBack = await command(fixture.bootstrapPath, [
    'explore', JSON.stringify({ thing: fixture.syntheticPath, 'situation$full': true })
  ]);
  assert.equal(readBack.code, 0, readBack.stderr);
  assert.match(readBack.stdout, /"thing@program@agent"\s*:\s*"🧊"/u);
  assert.match(JSON.parse(readBack.stdout).situation, /"labels"\s*:\s*\["\^"\]/u);

  const targetCreated = await command(fixture.syntheticPath, [
    'transform', 'new', JSON.stringify(fixture.createSyntheticTarget())
  ]);
  assert.equal(targetCreated.code, 0, targetCreated.stderr);
  const lockCreated = await command(fixture.syntheticPath, [
    'transform', 'new', JSON.stringify(fixture.createSyntheticLock())
  ]);
  assert.equal(lockCreated.code, 0, lockCreated.stderr);
  const lockActivated = await command(fixture.syntheticPath, [
    'transform', JSON.stringify({ 'thing.run.': fixture.syntheticLockPath })
  ]);
  assert.equal(lockActivated.code, 0, lockActivated.stderr);

  const noLabel = await command(fixture.noLabelPath, [
    'transform', `{"thing":${JSON.stringify(fixture.noLabelTargetPath)},"situation.rep.must-not-write"}`
  ]);
  assert.notEqual(noLabel.code, 0, noLabel.stdout);
  assert.match(`${noLabel.stdout}\n${noLabel.stderr}`, /GRAPH_LOCK_DENIED/u);

  const allowed = await command(fixture.syntheticPath, [
    'transform', `{"thing":${JSON.stringify(fixture.syntheticTargetPath)},"situation.rep.caret-authorized"}`
  ]);
  assert.equal(allowed.code, 0, allowed.stderr);
  const targetReadBack = await command(fixture.syntheticPath, [
    'explore', JSON.stringify({ thing: fixture.syntheticTargetPath, 'situation$full': true })
  ]);
  assert.equal(targetReadBack.code, 0, targetReadBack.stderr);
  assert.match(targetReadBack.stdout, /caret-authorized/u);

  const overreachCreated = await command(fixture.syntheticPath, [
    'transform', 'new', JSON.stringify({
      'thing@program': fixture.overreachPath,
      situation: fixture.overreachAgentSource,
      contain: [], support: []
    })
  ]);
  assert.equal(overreachCreated.code, 0, overreachCreated.stderr);
  const overreach = await command(fixture.syntheticPath, [
    'transform', JSON.stringify({ 'thing.run.': fixture.overreachPath })
  ]);
  assert.notEqual(overreach.code, 0, overreach.stdout);
  assert.match(`${overreach.stdout}\n${overreach.stderr}`, /AGENT_JURISDICTION_ESCALATION/u);
});

test('the full isolated public-CLI journey keeps shortcut execution in the moved Agent domain', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-night-watch-cli-journey-'));
  t.after(() => fs.rm(evidenceDir, { recursive: true, force: true }));
  const result = await runIsolatedCliJourney(evidenceDir);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(await fs.readFile(path.join(evidenceDir, 'isolated-cli-live-report.json'), 'utf8'));
  assert.equal(report.steps.find((step) => step.step === 'shortcut.read-back')?.outcome, 'passed');
  assert.equal(report.steps.find((step) => step.step === 'jump.read-back')?.outcome, 'passed');
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
