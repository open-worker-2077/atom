import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileProgramTransform
} from '../work-engine/atom-language/engine.mjs';
import { executeProgramExplore } from '../work-engine/atom-language/query-capability.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';

function atom(name, detail = '', children = []) {
  return { name, detail, children, partners: [] };
}

test('Program explore uses the same coordinate execution as CLI explore', async () => {
  const atoms = [atom('推进流', '', [atom('任务A', '', [atom('状态', '已人工冻结')])])];
  const receiver = createAtomLanguageReceiver();
  const cli = receiver.receive('explore {"name":"推进流","children$latitude-2","detail$full"}');
  assert.equal(cli.ok, true);

  const program = await executeProgramExplore({
    atoms,
    request: { name: '推进流', 'children$latitude-2': null, 'detail$full': null },
    receiver
  });

  assert.deepEqual(program.map(({ path, detail }) => ({ path, detail })), [
    { path: '推进流', detail: '' },
    { path: '推流/任务A'.replace('推流', '推进流'), detail: '' },
    { path: '推进流/任务A/状态', detail: '已人工冻结' }
  ]);
});

test('Program transform compiles to the same normalized item as CLI transform', () => {
  const receiver = createAtomLanguageReceiver();
  const cli = receiver.receive('transform {"name":"任务A","detail.rep.":"新值"}');
  const program = compileProgramTransform({
    request: { name: '任务A', 'detail.rep.': '新值' },
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
      name: 'test/创建结果',
      detail: '{"probe":true}',
      children: [],
      partners: []
    },
    receiver
  });
  const partial = compileProgramTransform({
    request: { name: '已有目标', children: [] },
    receiver
  });
  const fourAxesWithCommand = compileProgramTransform({
    request: {
      name: '已有目标',
      detail: '保留值',
      children: [],
      'partners.rep.': []
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
