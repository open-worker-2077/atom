import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeProgramExplore } from '../work-engine/atom-language/query-capability.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', contain = [], support = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    contain,
    support
  };
}

function find(atoms, selector) {
  let children = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = children.find((candidate) => (
      Object.entries(candidate).find(([key]) => key.split(/[@#]/u)[0] === 'thing')?.[1] === segment
    ));
    if (!current) return null;
    children = current.contain;
  }
  return current;
}

test('relative Program Explore resolves only unique direct contain segments below the bound scope root', async () => {
  const atoms = [
    atom('Root', '', [
      atom('候选', '', [atom('客户', '当前客户', [atom('地址', '', [atom('城市', '上海')])])]),
      atom('其他', '', [atom('客户', '无关客户')])
    ])
  ];

  const root = await executeProgramExplore({ atoms, request: { thing: '.', 'situation$full': true }, scopeRoot: 'Root/候选' });
  const nested = await executeProgramExplore({
    atoms,
    request: { thing: './客户/地址/城市', 'situation$full': true },
    scopeRoot: 'Root/候选'
  });

  assert.deepEqual(root.map(({ path: value }) => value), ['Root/候选']);
  assert.deepEqual(nested.map(({ path: value, situation }) => ({ path: value, situation })), [
    { path: 'Root/候选/客户/地址/城市', situation: '上海' }
  ]);
});

test('relative Program Explore fails closed for unbound, absolute, missing and ambiguous selectors', async () => {
  const atoms = [atom('Root', '', [
    atom('候选', '', [atom('客户', '一'), atom('客户', '二')]),
    atom('其他')
  ])];

  await assert.rejects(
    executeProgramExplore({ atoms, request: { thing: './客户' } }),
    (error) => error.code === 'SLOT_SCOPE_ROOT_UNBOUND'
  );
  await assert.rejects(
    executeProgramExplore({ atoms, request: { thing: 'Root/其他' }, scopeRoot: 'Root/候选' }),
    (error) => error.code === 'SLOT_RELATIVE_SELECTOR_REQUIRED'
  );
  await assert.rejects(
    executeProgramExplore({ atoms, request: { thing: './缺项' }, scopeRoot: 'Root/候选' }),
    (error) => error.code === 'SLOT_RELATIVE_TARGET_NOT_FOUND'
  );
  await assert.rejects(
    executeProgramExplore({ atoms, request: { thing: './客户' }, scopeRoot: 'Root/候选' }),
    (error) => error.code === 'SLOT_RELATIVE_TARGET_AMBIGUOUS'
  );
});

test('relative Program Explore may return a nested slot instance root but cannot cross its domain boundary', async () => {
  const atoms = [atom('Root', '', [
    atom('外层实例', '', [
      atom('嵌套实例', '', [atom('秘密', '不可穿透')], [], ['slot-revision-sha256-abc'])
    ]),
    atom('嵌套槽体', '', [
      atom('槽模'),
      atom('print', '', [atom('修订', '', [atom('sha256:abc', '{}')])], [], ['program']),
      atom('槽例')
    ])
  ])];

  const boundary = await executeProgramExplore({
    atoms, request: { thing: './嵌套实例' }, scopeRoot: 'Root/外层实例'
  });
  assert.deepEqual(boundary.map(({ path: value }) => value), ['Root/外层实例/嵌套实例']);
  await assert.rejects(
    executeProgramExplore({
      atoms, request: { thing: './嵌套实例/秘密' }, scopeRoot: 'Root/外层实例'
    }),
    (error) => error.code === 'SLOT_SCOPE_BOUNDARY_CROSSING'
  );
});

test('explicit development run binds one candidate scope and inherited use_program keeps that scope', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-scope-development-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const reader = [
    'def main(arguments):',
    '    rows = explore({"thing":"./客户","situation$full":True})',
    '    return rows[0].situation'
  ].join('\n');
  const orchestrator = [
    'value = use_program({"name":"Root/候选/读取客户","arguments":{}})',
    'transform({"thing":"./结果","situation.rep." + value:None})'
  ].join('\n');
  const world = [atom('Root', '', [
    atom('研发窗口', '', [], [], ['agent']),
    atom('候选', '', [
      atom('客户', '张三'),
      atom('结果', '未运行'),
      atom('读取客户', reader, [], [], ['program']),
      atom('编排', orchestrator, [], [], ['program'])
    ]),
    atom('无关域', '', [atom('结果', '保持不变')])
  ])];
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2), 'utf8');

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.Root/候选":"Root/候选/编排"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const committed = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/候选/结果').situation, '张三', JSON.stringify(result));
  assert.equal(find(committed, 'Root/无关域/结果').situation, '保持不变');
});

test('scope-bound use_program rejects a Program outside the current model with an exact boundary code', async () => {
  const world = [atom('Root', '', [
    atom('候选', '', [
      atom('编排', 'use_program({"name":"Root/外部程序","arguments":{}})', [], [], ['program'])
    ]),
    atom('外部程序', 'def main(arguments):\n    return arguments', [], [], ['program'])
  ])];

  await assert.rejects(
    createProgramRuntimeScheduler().refresh(world, {
      programSelector: 'Root/候选/编排',
      force: true,
      slotScopeRoot: 'Root/候选'
    }),
    (error) => error.code === 'SLOT_SCOPE_BOUNDARY_CROSSING'
  );
});

test('scope-bound calculation rejects recursive slot-body registration with an exact error code', async () => {
  const world = [atom('Root', '', [
    atom('候选', '', [
      atom('计算', 'slot_body({"action":"seal","body":"Root/其他槽体"})', [], [], ['program'])
    ]),
    atom('其他槽体', '', [atom('候选流')])
  ])];

  await assert.rejects(
    createProgramRuntimeScheduler().refresh(world, {
      programSelector: 'Root/候选/计算',
      force: true,
      slotScopeRoot: 'Root/候选'
    }),
    (error) => error.code === 'SLOT_BODY_NESTED_EFFECT_FORBIDDEN'
  );
});
