import assert from 'node:assert/strict';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { programFunctionRegistry } from '../work-engine/atom-language/program-function-registry.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

function output() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, value: () => value };
}

test('jump accepts exact Program Things and orders recycle before when and where', async () => {
  const world = [
    atom('槽例A', '', [atom('窗口', '', [], 'agent')]),
    atom('槽例B'),
    atom('回收判定', 'def main(arguments):\n    return False', [], 'program'),
    atom('跳转判定', 'def main(arguments):\n    message({"level":"info","text":"when"})\n    return True', [], 'program'),
    atom('目标计算', [
      'def main(arguments):',
      '    message({"level":"info","text":"where"})',
      '    return explore({"thing":"槽例B"})[0]'
    ].join('\n'), [], 'program'),
    atom('窗口注册', [
      'recycle_program = explore({"thing":"回收判定"})[0]',
      'when_program = explore({"thing":"跳转判定"})[0]',
      'where_program = explore({"thing":"目标计算"})[0]',
      'jump({"recycle":recycle_program,"when":when_program,"where":where_program})'
    ].join('\n'), [], 'program')
  ];

  const cycle = await createProgramRuntimeScheduler().refresh(world, {
    agentOrigin: { path: '槽例A/窗口' }
  });

  assert.deepEqual(cycle.jumps, [{
    action: 'move', destinationPath: '槽例B', sourceProgramPath: '窗口注册'
  }]);
  assert.deepEqual(cycle.messages.map((entry) => entry.text), ['when', 'where']);
});

test('jump guards without when, skips where when false, and recycle true wins', async () => {
  const cases = [
    {
      name: '守窗', source: 'jump({"where":explore({"thing":"目标计算"})[0]})',
      expected: { action: 'guard' }, messages: []
    },
    {
      name: '不命中',
      source: 'jump({"when":explore({"thing":"否"})[0],"where":explore({"thing":"目标计算"})[0]})',
      expected: { action: 'guard' }, messages: []
    },
    {
      name: '回收',
      source: 'jump({"recycle":explore({"thing":"是"})[0],"when":explore({"thing":"否"})[0],"where":explore({"thing":"目标计算"})[0]})',
      expected: { action: 'recycle' }, messages: []
    }
  ];
  for (const scenario of cases) {
    const world = [
      atom('目标'),
      atom('是', 'def main(arguments):\n    return True', [], 'program'),
      atom('否', 'def main(arguments):\n    return False', [], 'program'),
      atom('目标计算', 'def main(arguments):\n    message({"level":"info","text":"where"})\n    return explore({"thing":"目标"})[0]', [], 'program'),
      atom(scenario.name, scenario.source, [], 'program')
    ];
    const cycle = await createProgramRuntimeScheduler().refresh(world, {
      programSelector: scenario.name, force: true, agentOrigin: { path: '窗口' }
    });
    assert.deepEqual(cycle.jumps, [{ ...scenario.expected, sourceProgramPath: scenario.name }]);
    assert.deepEqual(cycle.messages.map((entry) => entry.text), scenario.messages);
  }
});

test('jump rejects every exact-path string selector and accepts ThingCoordinate objects', async () => {
  for (const [key, selector] of [
    ['when', 'Root/判定'],
    ['where', 'Root/定位'],
    ['recycle', 'Root/判定']
  ]) {
    const invalid = [atom('Root', '', [
      atom('判定', 'def main(arguments):\n    return True', [], 'program'),
      atom('目标'),
      atom('定位', 'def main(arguments):\n    return explore({"thing":"Root/目标"})[0]', [], 'program'),
      atom('错误注册', `jump({"${key}":"${selector}"})`, [], 'program')
    ])];
    await assert.rejects(createProgramRuntimeScheduler().refresh(invalid, {
      programSelector: 'Root/错误注册',
      force: true,
      agentOrigin: { path: '窗口' }
    }), { code: 'INVALID_JUMP_CONTRACT' });
  }

  const adapted = [
    atom('判定', 'def main(arguments):\n    return True', [], 'program'),
    atom('目标'),
    atom('定位', 'def main(arguments):\n    return explore({"thing":"目标"})[0]', [], 'program'),
    atom('注册', 'jump({"when":{"thing":"判定"},"where":{"thing":"定位"}})', [], 'program')
  ];
  const cycle = await createProgramRuntimeScheduler().refresh(adapted, {
    programSelector: '注册', force: true, agentOrigin: { path: '窗口' }
  });
  assert.equal(cycle.jumps[0].destinationPath, '目标');
});

test('jump rejects an exact-path string returned by where as an invalid destination', async () => {
  const world = [
    atom('判定', 'def main(arguments):\n    return True', [], 'program'),
    atom('定位', 'def main(arguments):\n    return "目标"', [], 'program'),
    atom('目标'),
    atom('注册', [
      'when_program = explore({"thing":"判定"})[0]',
      'where_program = explore({"thing":"定位"})[0]',
      'jump({"when":when_program,"where":where_program})'
    ].join('\n'), [], 'program')
  ];
  const cycle = await createProgramRuntimeScheduler().refresh(world, {
    programSelector: '注册',
    force: true,
    isolateFailures: true,
    agentOrigin: { path: '窗口' }
  });

  assert.deepEqual(cycle.jumps, []);
  assert.equal(cycle.failures[0].code, 'WINDOW_JUMP_DESTINATION_INVALID');
});

test('changed returns only a bool, records exact dependencies, and caller explicitly short-circuits', async () => {
  const world = [
    atom('监测点'),
    atom('探针', [
      'def expensive():',
      '    message({"level":"info","text":"expensive"})',
      'point = explore({"thing":"监测点"})[0]',
      'if changed([point]):',
      '    expensive()'
    ].join('\n'), [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler();

  const miss = await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['其他点'] }
  });
  assert.deepEqual(miss.messages, []);

  const hit = await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['监测点'] }
  });
  assert.deepEqual(hit.messages.map((entry) => entry.text), ['expensive']);
  assert.equal(hit.executedProgramPaths.includes('探针'), true);
});

test('changed rejects empty, duplicate, string, and ref arrays', async () => {
  for (const expression of ['[]', '["\u76d1\u6d4b\u70b9"]', '[point.ref]', '[point, point]']) {
    const source = expression.includes('point')
      ? `point = explore({"thing":"\u76d1\u6d4b\u70b9"})[0]\nchanged(${expression})`
      : `changed(${expression})`;
    await assert.rejects(createProgramRuntimeScheduler().refresh([
      atom('\u76d1\u6d4b\u70b9'), atom('\u975e\u6cd5\u63a2\u9488', source, [], 'program')
    ], { agentOrigin: { path: '\u7a97\u53e3' } }), { code: 'ATOM_PROGRAM_FAILED' });
  }
});

test('registry and Help publish jump, changed, thing coordinates, and explicit short-circuiting', async () => {
  const registry = programFunctionRegistry();
  assert.deepEqual(registry.runtimeTypes.ThingCoordinate, {
    type: 'object', source: 'explore exact result', opaque: true, stringOrRef: 'forbidden'
  });
  const jump = registry.functions.find((entry) => entry.name === 'jump');
  const changed = registry.functions.find((entry) => entry.name === 'changed');
  assert.deepEqual(jump.contract.argument.properties, {
    when: { format: 'exact-thing@program' },
    where: { format: 'exact-thing@program' },
    recycle: { format: 'exact-thing@program' }
  });
  assert.deepEqual(jump.contract.coordinateInputs, {
    selectors: 'ThingCoordinate-only',
    whereResult: 'ThingCoordinate-only',
    exactPathString: 'forbidden',
    shortNameString: 'forbidden',
    ref: 'forbidden'
  });
  assert.equal(jump.contract.errors.includes('INVALID_JUMP_CONTRACT'), true);
  assert.equal(jump.contract.authorization, 'shared-cli-graph-chain');
  assert.equal(changed.contract.dispatch, 'shared-transform-reverse-index');
  assert.equal(changed.contract.result, 'boolean');
  assert.equal(changed.contract.controlFlow, 'caller-explicit-short-circuit');

  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /jump\(\{"when":.*"where":.*"recycle":/u);
  assert.match(stdout.value(), /explore\(\{"thing":"EXACT.*@program"\}\)\[0\]/u);
  assert.match(stdout.value(), /不使用 \.ref/u);
  assert.match(stdout.value(), /jump 的 when／where／recycle.*完整 EXACT_PATH 字符串.*拒绝/u);
  assert.match(stdout.value(), /精确字符串兼容仅保留于 use_program\.name 与 CLI thing\.run\./u);
  assert.match(stdout.value(), /if not changed\(\[.*\]\):[\s\S]*return/u);
  assert.match(stdout.value(), /jump 定位复用 Explore、移动复用 Transform/u);
  assert.match(stdout.value(), /固定窗口锁：agent\(\) 登记时/u);
});
