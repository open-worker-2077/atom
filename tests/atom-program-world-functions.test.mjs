import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileProgramTransform
} from '../work-engine/atom-language/engine.mjs';
import { executeProgramExplore } from '../work-engine/atom-language/query-capability.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';

function atom(thing, situation = '', contain = []) {
  return { thing, situation, contain, support: [] };
}

test('Program explore uses the same coordinate execution as CLI explore', async () => {
  const atoms = [atom('推进流', '', [atom('任务A', '', [atom('状态', '已人工冻结')])])];
  const receiver = createAtomLanguageReceiver();
  const cli = receiver.receive('explore {"thing":"推进流","contain$latitude-2","situation$full"}');
  assert.equal(cli.ok, true);

  const program = await executeProgramExplore({
    atoms,
    request: { thing: '推进流', 'contain$latitude-2': null, 'situation$full': null },
    receiver
  });

  assert.deepEqual(program.map(({ path, situation }) => ({ path, situation })), [
    { path: '推进流', situation: '' },
    { path: '推流/任务A'.replace('推流', '推进流'), situation: '' },
    { path: '推进流/任务A/状态', situation: '已人工冻结' }
  ]);
});

test('Program transform compiles to the same normalized item as CLI transform', () => {
  const receiver = createAtomLanguageReceiver();
  const cli = receiver.receive('transform {"thing":"任务A","situation.rep.":"新值"}');
  const program = compileProgramTransform({
    request: { thing: '任务A', 'situation.rep.': '新值' },
    receiver
  });

  assert.equal(program.ok, true);
  assert.deepEqual(program.item, cli.items[0]);
  assert.equal(program.createNew, false);
});

test('Program transform classifies only a complete command-free four-axis Atom as creation', () => {
  const receiver = createAtomLanguageReceiver();
  const create = compileProgramTransform({
    request: {
      thing: 'test/创建结果',
      situation: '{"probe":true}',
      contain: [],
      support: []
    },
    receiver
  });
  const partial = compileProgramTransform({
    request: { thing: '已有目标', contain: [] },
    receiver
  });
  const fourAxesWithCommand = compileProgramTransform({
    request: {
      thing: '已有目标',
      situation: '保留值',
      contain: [],
      'support.rep.': []
    },
    receiver
  });

  assert.equal(create.ok, true);
  assert.equal(create.createNew, true);
  assert.equal(partial.ok, true);
  assert.equal(partial.createNew, false);
  assert.equal(fourAxesWithCommand.ok, true);
  assert.equal(fourAxesWithCommand.createNew, false);
});
