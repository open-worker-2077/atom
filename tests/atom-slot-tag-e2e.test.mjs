import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeAtomCommandEndpoint,
  runAtomCli
} from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

const atom = (thing, situation = '', slot = [], strut = [], type = '') => ({
  [`thing${type ? `@${type}` : ''}`]: thing,
  situation,
  slot,
  strut
});

const program = (thing, source) => atom(thing, source, [], [], 'program');

async function fixture(t, world) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-tag-e2e-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(world, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

async function execute(files, source, scheduler = createProgramRuntimeScheduler()) {
  const result = await executeAtomLanguage({
    ...files,
    source,
    programScheduler: scheduler,
    interaction: { id: `slot-tag-${crypto.randomUUID()}` }
  });
  const world = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  return { result, world, scheduler };
}

function situationAt(world, thing) {
  return world.find((entry) => entry.thing === thing)?.situation ?? null;
}

function causalWorld(receiverSource, sourceSlot = []) {
  return [
    atom('木头', '现成', sourceSlot, [{
      'if@current': true,
      if: [{ program: [
        'def main(packet):',
        '    slot_provide(["点燃","人工介入"])'
      ].join('\n') }],
      then: [{ thing: '火' }]
    }]),
    atom('火', '未点燃', [program('接收点燃', receiverSource)])
  ];
}

async function runPublicCli(endpoint, agent, source) {
  let stdout = '';
  let stderr = '';
  let result = null;
  const code = await runAtomCli([
    '--endpoint', endpoint, '--agent', agent, ...source
  ], {
    execute: async (options, actualEndpoint) => {
      result = await executeAtomCommandEndpoint(options, actualEndpoint);
      return result;
    },
    requireAgent: true,
    remoteAgentResolution: true,
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });
  return { code, stdout, stderr, result };
}

test('$act starts one Graph-strut tag scene and persists the matching receiver effect', async (t) => {
  const files = await fixture(t, causalWorld([
    'def receive(packet):',
    '    transform({"thing":"火","situation.rep.已点燃":None})',
    'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
  ].join('\n')));

  const { result, world } = await execute(
    files, 'transform {"thing$act=钻木取火|人工介入":"木头"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'completed', JSON.stringify(result));
  assert.equal(situationAt(world, '木头'), '现成');
  assert.equal(situationAt(world, '火'), '已点燃');
});

test('public CLI completes a tag strut scene and cold-starts from the persisted result', async (t) => {
  const files = await fixture(t, [atom('操作Agent', [
    'agent({"labels":[],"functions":{"groups":[],"names":["explore","slot_provide","slot_receive","transform"]}})'
  ].join('\n'), [
    atom('木头', '现成', [], [{
      'if@current': true,
      if: [{ program: [
        'def main(packet):',
        '    slot_provide(["点燃","人工介入"])'
      ].join('\n') }],
      then: [{ thing: '操作Agent/火' }]
    }]),
    atom('火', '未点燃', [program('接收点燃', [
      'def receive(packet):',
      '    transform({"thing":"操作Agent/火","situation.rep.已点燃":None})',
      'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
    ].join('\n'))])
  ], [], 'program')]);
  const storeFile = path.join(path.dirname(files.contextFile), 'knowledge.json');
  let running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0,
    contextFile: files.contextFile, graphFile: files.projectionFile, storeFile
  });
  t.after(async () => running?.close());

  const acted = await runPublicCli(
    `${running.url}/__atom/api/command`,
    '操作Agent',
    ['transform', '{"thing$act=钻木取火|人工介入":"操作Agent/木头"}']
  );
  assert.equal(acted.code, 0, acted.stderr);
  assert.match(acted.stdout, /"thing~updated"\s*:\s*"木头"/u);
  assert.equal(acted.result.subsequentExecution.status, 'completed', JSON.stringify(acted.result));

  await running.close();
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0,
    contextFile: files.contextFile, graphFile: files.projectionFile, storeFile
  });
  const readBack = await runPublicCli(
    `${running.url}/__atom/api/command`,
    '操作Agent',
    ['explore', '{"thing":"操作Agent/火","situation$full":true}']
  );
  assert.equal(readBack.code, 0, readBack.stderr);
  assert.match(readBack.stdout, /已点燃/u);
});

test('an ordinary fact Transform does not manufacture a canonical tag packet', async (t) => {
  const files = await fixture(t, causalWorld([
    'def receive(packet):',
    '    transform({"thing":"火","situation.rep.误触发":None})',
    'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
  ].join('\n')));

  const { result, world } = await execute(
    files, 'transform {"thing":"木头","situation.rep.已搬动"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(situationAt(world, '火'), '未点燃');
});

test('a receiver failure leaves an already committed source fact intact', async (t) => {
  const files = await fixture(t, causalWorld([
    'def receive(packet):',
    '    transform({"thing":"不存在","situation.rep.失败":None})',
    'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
  ].join('\n'), [program('提供点燃', [
    'def send():',
    '    slot_provide(["钻木取火"])',
    'trigger("transform", {"nodes":["木头"]}, send)'
  ].join('\n'))]));

  const acted = await execute(files, 'transform {"thing":"木头","situation.rep.已准备"}');

  assert.equal(acted.result.ok, true, JSON.stringify(acted.result));
  assert.equal(acted.result.subsequentExecution.status, 'failed', JSON.stringify(acted.result));
  assert.equal(acted.result.changed, true, JSON.stringify(acted.result));
  assert.notEqual(acted.result.revisionAfter, acted.result.revisionBefore);
  assert.equal(situationAt(acted.world, '火'), '未点燃');
});

test('causal labels do not grant a receiver authority to change a locked target', async (t) => {
  const world = causalWorld([
    'def receive(packet):',
    '    transform({"thing":"火","situation.rep.越权":None})',
    'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
  ].join('\n'));
  world.push(program('保护火', [
    'lock({"targets":{"paths":["火"],"scope":"exact"},',
    '      "actions":["transform"],"labels":["总控"]})'
  ].join('\n')));
  const files = await fixture(t, world);

  const { result, world: stored } = await execute(
    files, 'transform {"thing$act=钻木取火|人工介入":"木头"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed', JSON.stringify(result));
  assert.equal(situationAt(stored, '火'), '未点燃');
});
