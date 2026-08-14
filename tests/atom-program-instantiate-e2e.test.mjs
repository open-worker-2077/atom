import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

test('instantiate creates one complete advancement flow below the calling Program', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-instantiate-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('新任务', '项目目标', [
      atom('推进流', [
        "instantiate({",
        "    'template': 'advancement-flow',",
        "    'version': 'latest',",
        "    'mode': 'ensure',",
        "    'parameters': {'title': '新任务'}",
        "})"
      ].join('\n'), [], 'program')
    ])
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const first = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);

  const afterFirst = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const program = afterFirst[0].children[0];
  assert.deepEqual(program.children.map((entry) => entry.name ?? entry['name@program']), [
    '编标版本', '任务标题', '导航坐标', '设标', '建标', '推进', '收尾', '内部路由'
  ]);
  assert.equal(program.children.find((entry) => entry.name === '任务标题').detail, '新任务');
  assert.equal(program.children.find((entry) => entry['name@program'] === '内部路由')['name@program'], '内部路由');
  assert.deepEqual(
    program.children.find((entry) => entry.name === '设标').children.map((entry) => entry.name),
    ['定向', '调研', '策评']
  );

  const second = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(second.ok, true);
  assert.equal(second.lockState.filter((entry) => entry.reasons.some((reason) => reason.code === 'FRAMEWORK_SCHEMA')).length, 5);
  const afterSecond = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(afterSecond, afterFirst);
});

test('documented two-step commands create an Agent with one attached complete advancement flow', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-help-new-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const scheduler = createProgramRuntimeScheduler();

  const created = await executeAtomLanguage({
    source: 'transform new {"name@agent":"任务名","detail":"","children":[],"partners":[]}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });
  assert.equal(created.ok, true);

  const result = await executeAtomLanguage({
    source: `transform {"name":"任务名","children":[{"name@program":"推进流","detail":"instantiate({'template': 'advancement-flow', 'version': 'latest', 'mode': 'ensure', 'parameters': {'title': '任务标题'}})","children":[],"partners":[]}]}`,
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true);
  const [agent] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(agent['name@agent'], '任务名');
  assert.equal(agent.children.length, 1);
  assert.equal(agent.children[0]['name@program'], '推进流');
  assert.deepEqual(agent.children[0].children.map((child) => child.name ?? child['name@program']), [
    '编标版本', '任务标题', '导航坐标', '设标', '建标', '推进', '收尾', '内部路由'
  ]);
});

test('documented repair command attaches and instantiates a flow below an existing empty Agent', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-help-repair-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('已有任务名', '', [], 'agent')], null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();

  const result = await executeAtomLanguage({
    source: `transform {"name":"已有任务名","children":[{"name@program":"推进流","detail":"instantiate({'template': 'advancement-flow', 'version': 'latest', 'mode': 'ensure', 'parameters': {'title': '任务标题'}})","children":[],"partners":[]}]}`,
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true);
  const [agent] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(agent['name@agent'], '已有任务名');
  assert.equal(agent.children.length, 1);
  assert.equal(agent.children[0]['name@program'], '推进流');
  assert.equal(agent.children[0].children.find((child) => child.name === '导航坐标').detail, '定向');
});

test('advancement-flow data children can be edited without legacy uses partners', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-flow-field-edit-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Editable Flow', '', [
      atom('推进流', "instantiate({'template': 'advancement-flow', 'version': 'latest', 'mode': 'ensure', 'parameters': {'title': 'Editable Flow'}})", [], 'program')
    ], 'agent')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();
  const instantiated = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(instantiated.ok, true);

  const edited = await executeAtomLanguage({
    source: 'transform {"name":"Editable Flow/推进流/设标/定向/需求","detail.rep.真实需求"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler
  });

  assert.equal(edited.ok, true, JSON.stringify(edited.errors));
  const [agent] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const requirement = agent.children[0].children
    .find((child) => child.name === '设标').children
    .find((child) => child.name === '定向').children
    .find((child) => child.name === '需求');
  assert.equal(requirement.detail, '真实需求');
});

test('instantiate rejects an unknown template and unsupported mode', async () => {
  for (const source of [
    "instantiate({'template': 'missing', 'version': 'latest', 'mode': 'ensure', 'parameters': {}})",
    "instantiate({'template': 'advancement-flow', 'version': 'latest', 'mode': 'overwrite', 'parameters': {}})",
  ]) {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.refresh([atom('生成器', source, [], 'program')]),
      (error) => error?.code === 'ATOM_PROGRAM_FAILED' && error?.details?.type === 'ValueError'
    );
  }
});

test('template_catalog returns menu metadata and a JSON parameter schema', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([atom('模板菜单', [
    "items = template_catalog({})",
    "first = items[0]",
    "message({'level': 'info', 'text': first['id'] + '|' + first['label'] + '|' + first['parameters']['properties']['title']['type']})"
  ].join('\n'), [], 'program')]);
  assert.equal(cycle.messages[0].text, 'advancement-flow|推进流|string');
});
