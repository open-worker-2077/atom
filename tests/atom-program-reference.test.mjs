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

test('use_program accepts an exact explore ThingCoordinate and reauthorizes it', async () => {
  const world = [
    atom('库', "def main(arguments):\n    return {'value': arguments['value']}", [], 'program'),
    atom('调用方', [
      "target = explore({'thing': '库'})[0]",
      "result = use_program({'name': target, 'arguments': {'value': '坐标调用成功'}})",
      "message({'level': 'info', 'text': result['value']})"
    ].join('\n'), [], 'program')
  ];
  const requests = [];
  const result = await createProgramRuntimeScheduler().refresh(world, {
    programSelector: '调用方',
    force: true,
    executeExplore: async (request) => {
      requests.push(structuredClone(request));
      return request.thing === '库' ? [{ path: '库' }] : [];
    }
  });

  assert.equal(result.messages[0].text, '坐标调用成功');
  assert.deepEqual(requests, [{ thing: '库' }, { thing: '库' }]);
});

test('use_program keeps exact string selectors compatible', async () => {
  const world = [
    atom('库', "def main(arguments):\n    return {'value': arguments['value']}", [], 'program'),
    atom('调用方', [
      "result = use_program({'name': '库', 'arguments': {'value': '字符串兼容'}})",
      "message({'level': 'info', 'text': result['value']})"
    ].join('\n'), [], 'program')
  ];

  const result = await createProgramRuntimeScheduler().refresh(world, {
    programSelector: '调用方', force: true
  });

  assert.equal(result.messages[0].text, '字符串兼容');
});

test('use_program rejects a missing reauthorized coordinate precisely', async () => {
  const world = [
    atom('库', 'def main(arguments):\n    return arguments', [], 'program'),
    atom('调用方', [
      "target = explore({'thing': '库'})[0]",
      "use_program({'name': target, 'arguments': {}})"
    ].join('\n'), [], 'program')
  ];
  let calls = 0;

  await assert.rejects(
    createProgramRuntimeScheduler().refresh(world, {
      programSelector: '调用方',
      force: true,
      executeExplore: async () => (++calls === 1 ? [{ path: '库' }] : [])
    }),
    (error) => error.code === 'USE_PROGRAM_COORDINATE_NOT_FOUND'
  );
});

test('use_program rejects a non-Program coordinate precisely', async () => {
  const world = [
    atom('普通节点'),
    atom('调用方', [
      "target = explore({'thing': '普通节点'})[0]",
      "use_program({'name': target, 'arguments': {}})"
    ].join('\n'), [], 'program')
  ];

  await assert.rejects(
    createProgramRuntimeScheduler().refresh(world, {
      programSelector: '调用方', force: true
    }),
    (error) => error.code === 'USE_PROGRAM_TARGET_NOT_PROGRAM'
  );
});

test('use_program preserves a coordinate reauthorization denial', async () => {
  const world = [
    atom('库', 'def main(arguments):\n    return arguments', [], 'program'),
    atom('调用方', [
      "target = explore({'thing': '库'})[0]",
      "use_program({'name': target, 'arguments': {}})"
    ].join('\n'), [], 'program')
  ];
  let calls = 0;

  await assert.rejects(
    createProgramRuntimeScheduler().refresh(world, {
      programSelector: '调用方',
      force: true,
      executeExplore: async () => {
        calls += 1;
        if (calls === 1) return [{ path: '库' }];
        throw Object.assign(new Error('当前窗口无权访问目标 Program'), {
          code: 'WINDOW_ACCESS_DENIED'
        });
      }
    }),
    (error) => error.code === 'WINDOW_ACCESS_DENIED'
  );
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
