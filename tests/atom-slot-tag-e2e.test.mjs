import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
