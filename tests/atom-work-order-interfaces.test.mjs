import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeAtomWorkOrderRegistryEndpoint,
  runAtomCli
} from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { workOrderRegistry } from '../work-engine/atom-language/work-order-registry.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function output() {
  let value = '';
  return {
    stream: { write(chunk) { value += chunk; } },
    value: () => value
  };
}

test('work-order registry exposes one exact public contract for actions, errors, and receipts', () => {
  const registry = workOrderRegistry();
  const version = registry.templates[0].versions[0];

  assert.equal(registry.contract, 'atom-work-order-registry');
  assert.equal(registry.version, 1);
  assert.equal(registry.runtimeContract, 'atom-interaction/4');
  assert.equal(registry.templates[0].id, 'work-order');
  assert.equal(registry.templates[0].latest, '1');
  assert.deepEqual(version.groups, ['Output', 'Step', 'Criteria']);
  assert.deepEqual(version.actions.map((action) => action.id), [
    'create', 'fill', 'validate', 'submit', 'reject', 'revise', 'read-back'
  ]);
  const submit = version.actions.find((action) => action.id === 'submit');
  assert.deepEqual(submit.input, {
    required: ['path'],
    optional: ['submitted_at', 'decision', 'reviewer', 'reviewed_at']
  });
  assert.equal(version.actions.every((action) => (
    Array.isArray(action.input.required)
      && Array.isArray(action.result.required)
      && typeof action.mutates === 'boolean'
  )), true);
  assert.deepEqual(version.errors.map((error) => error.code), [
    'ATOM_PROGRAM_FAILED',
    'ATOM_PROGRAM_TIMEOUT',
    'PROGRAM_LOCK_DENIED',
    'WORLD_REVISION_CONFLICT'
  ]);
  assert.deepEqual(version.commitReceipt, {
    contract: 'atom.world-receipt',
    version: 1,
    required: [
      'commandId', 'correlationId', 'beforeRevision', 'afterRevision',
      'status', 'committedAt', 'source', 'affectedAtoms'
    ]
  });

  registry.templates[0].label = '篡改';
  assert.equal(workOrderRegistry().templates[0].label, '工单');
});

test('Program work_order_catalog reads the same seven action identifiers as public interfaces', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('工单注册表测试', [
      "catalog = work_order_catalog({})",
      "message({'level': 'info', 'text': '|'.join([action['id'] for action in catalog['actions']])})"
    ].join('\n'), [], 'program')
  ], { force: true });

  const publicActions = workOrderRegistry().templates[0].versions[0].actions
    .map((action) => action.id).join('|');
  assert.equal(cycle.messages[0].text, publicActions);
});

test('Web endpoint and CLI return byte-equivalent registry data without requiring an Agent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-work-order-interface-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom(
      '接口Agent',
      'LEGACY_AGENT_SITUATION = "接口测试"\nagent({"labels":[],"functions":{"groups":[],"names":["explore"]}})',
      [],
      'program'
    )
  ]), 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());
  const endpoint = `${running.url}/__atom/api/work-order-registry`;

  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  const webPayload = await response.json();
  const clientRegistry = await executeAtomWorkOrderRegistryEndpoint(endpoint);
  assert.deepEqual(webPayload, { ok: true, result: clientRegistry });

  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--work-order-registry'], {
    requireAgent: true,
    stdout: stdout.stream,
    stderr: stderr.stream,
    workOrderRegistry: () => executeAtomWorkOrderRegistryEndpoint(endpoint)
  });
  assert.equal(code, 0, stderr.value());
  assert.deepEqual(JSON.parse(stdout.value()), clientRegistry);
  assert.deepEqual(clientRegistry, workOrderRegistry());
});
