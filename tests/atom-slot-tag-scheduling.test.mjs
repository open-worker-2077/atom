import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

const atom = (thing, situation = '', slot = [], type = '') => ({
  [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: []
});
const program = (thing, situation) => atom(thing, situation, [], 'program');

function invocation(source) {
  return {
    mode: 'slot-tag-strut',
    scene: 'scene-1',
    revision: 'sha256:r1',
    clauseId: 'strut:atom.json/木头:0',
    lineProgram: { predicateId: 'line-1', source },
    sourcePackets: [{ sourceNodePath: '木头', labels: ['钻木取火', '人工介入'] }],
    labels: ['钻木取火', '人工介入'],
    consequentPaths: ['火']
  };
}

function packet(id, targetPath, labels) {
  return {
    mode: 'slot-tag', id, scene: 'scene-1', revision: 'sha256:r1',
    source: 'strut:atom.json/木头:0', targetPath, labels
  };
}

function event(packets) {
  return {
    mode: 'slot-tag',
    nodes: [...new Set(packets.map(({ targetPath }) => targetPath))],
    packets
  };
}

test('line Program emits zero or one label packet and strict bool has no causal meaning', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('木头'), atom('火')];

  assert.deepEqual(await scheduler.evaluateSlotTagStrutProgram(world, invocation([
    'def main(packet):',
    '    slot_provide(["点燃","人工介入"])'
  ].join('\n'))), ['点燃', '人工介入']);
  assert.equal(await scheduler.evaluateSlotTagStrutProgram(world, invocation([
    'def main(packet):',
    '    pass'
  ].join('\n'))), null);
  assert.equal(await scheduler.evaluateSlotTagStrutProgram(world, invocation([
    'def main(packet):',
    '    return True'
  ].join('\n'))), null);
});

test('line Program may read facts from the same world revision before emitting', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('木头', '干燥'), atom('火')];
  const labels = await scheduler.evaluateSlotTagStrutProgram(world, invocation([
    'def main(packet):',
    '    wood = explore({"thing":"木头"})',
    '    if wood and wood[0].situation == "干燥":',
    '        slot_provide(["可点燃"])'
  ].join('\n')));
  assert.deepEqual(labels, ['可点燃']);
});

test('receiver index belongs to the containing node and all/exact match independently', async () => {
  const world = [
    atom('火', '', [
      program('全含接收', [
        'def receive(packet):',
        '    message({"level":"info","text":"all:" + ",".join(packet["labels"])})',
        'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
      ].join('\n')),
      program('精确接收', [
        'def receive(packet):',
        '    message({"level":"info","text":"exact"})',
        'slot_receive({"labels":["点燃"],"match":"exact"}, receive)'
      ].join('\n'))
    ]),
    atom('无关', '', [program('无关接收', [
      'def receive(packet):',
      '    message({"level":"info","text":"wrong"})',
      'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
    ].join('\n'))])
  ];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);

  const cycle = await scheduler.refresh(world, {
    triggerEvent: event([packet('p1', '火', ['点燃', '人工介入'])])
  });

  assert.deepEqual(cycle.messages.map(({ text }) => text), ['all:点燃,人工介入']);
  assert.deepEqual(cycle.executedProgramPaths, ['火/全含接收']);
});

test('receiver may explicitly provide the next packet from its containing node', async () => {
  const world = [atom('火', '', [program('继续燃烧', [
    'def receive(packet):',
    '    slot_provide(["燃烧"] )',
    'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
  ].join('\n'))])];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);

  const cycle = await scheduler.refresh(world, {
    triggerEvent: event([packet('p1', '火', ['点燃'])])
  });

  assert.deepEqual(cycle.slotProvides, [{
    sourceProgramPath: '火/继续燃烧', sourceNodePath: '火', labels: ['燃烧']
  }]);
});

test('plain nodes and Programs without slot_receive stay still', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('火', '', [program('普通程序', 'message({"level":"info","text":"wrong"})')])];
  await scheduler.refresh(world);

  const cycle = await scheduler.refresh(world, {
    triggerEvent: event([packet('p1', '火', ['点燃'])])
  });
  assert.deepEqual(cycle.messages, []);
  assert.deepEqual(cycle.executedProgramPaths, []);
});

test('one receiver handles one packet once after its claim is committed', async () => {
  const world = [atom('火', '', [program('计数', [
    'def receive(packet):',
    '    message({"level":"info","text":packet["scene"]})',
    'slot_receive({"labels":["点燃"],"match":"all"}, receive)'
  ].join('\n'))])];
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(world);
  const triggerEvent = event([packet('same-packet', '火', ['点燃'])]);

  const first = await scheduler.refresh(world, { triggerEvent });
  scheduler.confirmSlotTags(first.slotTagClaims);
  const second = await scheduler.refresh(world, { triggerEvent });

  assert.deepEqual(first.messages.map(({ text }) => text), ['scene-1']);
  assert.equal(first.slotTagClaims.length, 1);
  assert.deepEqual(second.messages, []);
  assert.deepEqual(second.executedProgramPaths, []);
});

test('one strut runs at most once in one ephemeral scene', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [
    {
      thing: '木头', situation: '', slot: [], strut: [{
        'if@current': true,
        if: [{ program: 'def main(packet):\n    slot_provide(["点燃"])' }],
        then: [{ thing: '火' }]
      }]
    },
    atom('火')
  ];
  const visitedClauseIds = new Set();
  const input = [{ sourceNodePath: '木头', labels: ['钻木取火'] }];

  const first = await scheduler.evaluateSlotTagWave(world, input, {
    scene: 'scene-once', visitedClauseIds
  });
  const second = await scheduler.evaluateSlotTagWave(world, input, {
    scene: 'scene-once', visitedClauseIds
  });

  assert.equal(first.deliveries.length, 1);
  assert.deepEqual(first.deliveries[0].labels, ['点燃']);
  assert.deepEqual(second.deliveries, []);
  assert.deepEqual([...visitedClauseIds], ['strut:atom.json/木头:0']);
});
