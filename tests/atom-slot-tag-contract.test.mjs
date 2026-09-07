import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function program(thing, situation) {
  return atom(thing, situation, [], 'program');
}

test('slot_receive declares labels and match without a channel', async () => {
  const world = [atom('目标', '', [program('接收程序', [
    'def receive(packet):',
    '    message({"level":"info","text":"收到"})',
    'slot_receive({"labels":["钻木取火","人工介入"],"match":"all"}, receive)'
  ].join('\n'))])];
  const scheduler = createProgramRuntimeScheduler();

  await scheduler.refresh(world);

  assert.deepEqual(scheduler.triggerContracts.get('目标/接收程序').contract, {
    mode: 'slot-tag',
    parameters: { labels: ['钻木取火', '人工介入'], match: 'all' },
    entrypoint: 'receive'
  });
});

test('slot_receive rejects caller supplied paths or channels', async () => {
  for (const specification of [
    '{"labels":["A"],"match":"all","from":"up"}',
    '{"labels":["A"],"match":"all","path":"目标"}'
  ]) {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.validateProgramSources([program('接收程序', [
        'def receive(packet):',
        '    pass',
        `slot_receive(${specification}, receive)`
      ].join('\n'))]),
      (error) => error?.code === 'ATOM_PROGRAM_FAILED'
        && /slot_receive/u.test(error.message)
    );
  }
});

test('slot_provide emits one canonical packet from an explicitly run Program', async () => {
  const world = [atom('木头', '', [program('取火判断', [
    'slot_provide(["钻木取火","人工介入"])'
  ].join('\n'))])];
  const scheduler = createProgramRuntimeScheduler();

  const cycle = await scheduler.refresh(world, {
    programSelector: '木头/取火判断',
    force: true
  });

  assert.deepEqual(cycle.slotProvides, [{
    sourceProgramPath: '木头/取火判断',
    sourceNodePath: '木头',
    labels: ['钻木取火', '人工介入']
  }]);
});

test('slot_provide is inert during ordinary world refresh', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('木头', '', [program('取火判断', 'slot_provide(["钻木取火"])')])
  ], { isolateFailures: true });

  assert.deepEqual(cycle.slotProvides, []);
});

test('slot_provide rejects a second packet and invalid labels', async () => {
  for (const source of [
    'slot_provide(["A"]); slot_provide(["B"])',
    'slot_provide([])',
    'slot_provide(["A","A"])',
    'slot_provide(["A-B"])'
  ]) {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.refresh([atom('节点', '', [program('提供程序', source)])], {
        programSelector: '节点/提供程序',
        force: true
      }),
      (error) => [
        'INVALID_SLOT_PROVIDE_LABELS',
        'MULTIPLE_SLOT_PROVIDE_PACKETS'
      ].includes(error?.code) && /slot_provide/u.test(error.message)
    );
  }
});
