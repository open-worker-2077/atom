import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

test('a Program can call one exact reusable Program with JSON arguments', async () => {
  const reusable = [
    'def main(arguments):',
    "    rows = explore({'thing': arguments['root'], 'contain$latitude-1': None, 'situation$full': None})",
    "    refs = [row.ref for row in rows if row.situation.strip()]",
    "    lock({'targets': {'refs': refs}, 'mode': 'write', 'fields': ['thing', 'situation'], 'protect': {'atom': True, 'messages': False}, 'reason': {'code': 'PREDEFINED_CONTENT', 'message': '预定义内容已锁定'}})",
    "    return {'locked': len(refs)}",
  ].join('\n');
  const caller = [
    "result = use_program({'name': '预定义内容锁', 'arguments': {'root': '任务'}})",
    "message({'level': 'info', 'text': 'locked=' + str(result['locked'])})",
  ].join('\n');
  const world = [
    atom('任务', '框架说明', [atom('框架', '预填说明'), atom('填写项', '')]),
    atom('预定义内容锁', reusable, [], 'program'),
    atom('调用方', caller, [], 'program'),
  ];

  const result = await createProgramRuntimeScheduler().refresh(world);

  assert.equal(result.locks.length, 1);
  assert.equal(result.locks[0].targets.refs.length, 2);
  assert.deepEqual(result.locks[0].fields, ['thing', 'situation']);
  assert.equal(result.messages[0].text, 'locked=2');
});

test('Program references reject ambiguous names and recursive calls', async () => {
  const caller = atom('调用方', "use_program({'name': '库', 'arguments': {}})", [], 'program');
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(
    scheduler.refresh([atom('A', '', [atom('库', 'def main(arguments):\n    return {}', [], 'program')]), atom('B', '', [atom('库', 'def main(arguments):\n    return {}', [], 'program')]), caller]),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED' && /ambiguous/.test(error?.message)
  );

  await assert.rejects(
    scheduler.refresh([atom('循环', "def main(arguments):\n    return use_program({'name': '循环', 'arguments': {}})\nuse_program({'name': '循环', 'arguments': {}})", [], 'program')]),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED' && /recursive/i.test(error?.message)
  );
});

test('Programs resolve exact sibling, ancestor, descendant, and partner paths without flattening scope', async () => {
  const library = (label) => [
    'def main(arguments):',
    `    return {'label': '${label}', 'path': current_atom().path}`
  ].join('\n');
  const callerSource = [
    "paths = ['领域/同级库', '领域', '领域/调用方/下级库', '外部/伙伴库']",
    "resolved = [use_program({'name': path, 'arguments': {}})['path'] for path in paths]",
    "message({'level': 'info', 'text': '|'.join(resolved)})"
  ].join('\n');
  const caller = atom('调用方', callerSource, [atom('下级库', library('descendant'), [], 'program')], 'program');
  caller.support = [{ 'if@current': true, then: [{ thing: '外部/伙伴库' }] }];
  const world = [
    atom('领域', library('ancestor'), [atom('同级库', library('sibling'), [], 'program'), caller], 'program'),
    atom('外部', '', [atom('伙伴库', library('partner'), [], 'program')])
  ];

  const result = await createProgramRuntimeScheduler().refresh(world);
  assert.equal(result.messages[0].text, '领域/同级库|领域|领域/调用方/下级库|外部/伙伴库');
});
