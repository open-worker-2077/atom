import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';
import { programFunctionRegistry } from '../work-engine/atom-language/program-function-registry.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { evaluateSupportClausesWithPrograms } from '../work-engine/atom-language/support-runtime.mjs';

const fixtureAgentSpecification = programFunctionRegistry().functions
  .find((entry) => entry.name === 'agent').contract.argument.example;

function atom(thing, situation = '', contain = [], type = '') {
  const agentProgram = type === 'agent';
  const storedType = agentProgram ? 'program' : type;
  const storedSituation = agentProgram
    ? `LEGACY_AGENT_SITUATION = ${JSON.stringify(situation)}\nagent(${JSON.stringify(fixtureAgentSpecification)})`
    : situation;
  return { [`thing${storedType ? `@${storedType}` : ''}`]: thing, situation: storedSituation, contain, support: [] };
}

function output() {
  let value = '';
  return {
    stream: { write(chunk) { value += chunk; } },
    value: () => value
  };
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
  const program = afterFirst[0].contain[0];
  assert.deepEqual(program.contain.map((entry) => entry.thing ?? entry['thing@program']), [
    '编标版本', '任务标题', '导航坐标', '设标', '建标', '推进', '收尾', '内部路由'
  ]);
  assert.equal(program.contain.find((entry) => entry.thing === '任务标题').situation, '新任务');
  assert.equal(program.contain.find((entry) => entry['thing@program'] === '内部路由')['thing@program'], '内部路由');
  assert.deepEqual(
    program.contain.find((entry) => entry.thing === '设标').contain.map((entry) => entry.thing),
    ['定向', '调研', '策评']
  );

  const second = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(second.ok, true);
  assert.equal(
    second.lockState.filter((entry) => entry.reasons.some((reason) => reason.code === 'FRAMEWORK_SCHEMA')).length,
    5,
    JSON.stringify(second)
  );
  const afterSecond = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(afterSecond, afterFirst);
});

test('advancement-flow transitions consume independent strict-bool Programs without writing the next form', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-instantiate-support-gate-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Synthetic Flow', '', [
      atom('Generator', "instantiate({'template':'advancement-flow','version':'latest','mode':'ensure','parameters':{'title':'Synthetic'}})", [], 'program')
    ])
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();
  const instantiated = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(instantiated.ok, true, JSON.stringify(instantiated.errors));

  const initialWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const initialGraph = projectAtomContext(initialWorld);
  const transition = initialGraph.supportClauses.find((clause) => clause.sourcePath.endsWith('/定向'));
  assert.ok(transition, '定向 ordinary Thing 应持有前往调研的推支关系');
  assert.equal(transition.root.kind, 'and');
  assert.deepEqual(
    transition.root.children.map(({ kind, targetPath, implicit }) => ({
      kind,
      target: targetPath.split('/').at(-1),
      implicit: implicit === true
    })),
    [
      { kind: 'thing', target: '定向', implicit: true },
      { kind: 'program', target: '定向完成门', implicit: false }
    ]
  );
  assert.deepEqual(
    transition.then.map(({ kind, targetPath }) => ({ kind, target: targetPath.split('/').at(-1) })),
    [{ kind: 'thing', target: '调研' }]
  );
  assert.deepEqual(transition.antecedentPaths.map((entry) => entry.split('/').at(-1)), ['定向']);
  assert.deepEqual(
    transition.dependencyPaths.map((entry) => entry.split('/').at(-1)),
    ['定向', '定向完成门']
  );
  assert.equal(initialGraph.supportClauses.some((clause) => clause.sourcePath.endsWith('/定向完成门')), false);

  const evaluate = (world, graph) => evaluateSupportClausesWithPrograms(graph, {
    evaluateProgram: (graphPath) => scheduler.evaluateSupportProgram(
      world,
      graph.atomPathByGraphPath.get(graphPath)
    )
  });
  const beforeFalseEvaluation = structuredClone(initialWorld);
  const falseDecisions = await evaluate(initialWorld, initialGraph);
  assert.equal(falseDecisions.get(transition.id).decision, false);
  assert.deepEqual(initialWorld, beforeFalseEvaluation);

  const completedWorld = structuredClone(initialWorld);
  const generator = completedWorld[0].contain[0];
  const direction = generator.contain
    .find((child) => child.thing === '设标').contain
    .find((child) => child.thing === '定向');
  direction.contain.find((child) => child.thing === '状态').situation = '已通过';
  const completedGraph = projectAtomContext(completedWorld);
  const completedTransition = completedGraph.supportClauses
    .find((clause) => clause.sourcePath.endsWith('/定向'));
  const beforeTrueEvaluation = structuredClone(completedWorld);
  const trueDecisions = await evaluate(completedWorld, completedGraph);
  assert.equal(trueDecisions.get(completedTransition.id).decision, true);
  assert.deepEqual(completedWorld, beforeTrueEvaluation);
});

test('documented two-step commands create an Agent with one attached complete advancement flow', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-help-new-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const scheduler = createProgramRuntimeScheduler();

  const agentExample = programFunctionRegistry().functions
    .find((entry) => entry.name === 'agent').contract.argument.example;
  const initialWorld = [
    atom('当前Agent', `agent(${JSON.stringify(agentExample)})`, [atom('任务区')], 'program')
  ];
  await fs.writeFile(contextFile, JSON.stringify(initialWorld, null, 2), 'utf8');
  await scheduler.rebuildAgentSecurity(initialWorld);
  const registrationSource = [
    `agent(${JSON.stringify(agentExample)})`,
    'instantiate({"template":"advancement-flow","version":"latest","mode":"ensure","parameters":{"title":"任务标题"}})'
  ].join('\n');
  const createCommand = `transform new ${JSON.stringify({
    'thing@program': '当前Agent/任务区/任务名', situation: registrationSource, contain: [], support: []
  })}`;
  const runCommand = 'transform {"thing.run.":"当前Agent/任务区/任务名"}';
  const stdout = output();
  const stderr = output();
  const helpCode = await runAtomCli(['--help'], {
    stdout: stdout.stream, stderr: stderr.stream
  });
  assert.equal(helpCode, 0, stderr.value());
  assert.ok(stdout.value().includes(`第1步：${createCommand}`));
  assert.ok(stdout.value().includes(`第2步：${runCommand}`));

  const created = await executeAtomLanguage({
    source: createCommand,
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction: { id: 'documented-agent-create', agent: { path: '当前Agent' } }
  });
  assert.equal(created.ok, true, JSON.stringify(created.errors));

  const result = await executeAtomLanguage({
    source: runCommand,
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction: { id: 'documented-agent-register', agent: { path: '当前Agent' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const [creator] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const [taskArea] = creator.contain;
  const [agent] = taskArea.contain;
  assert.equal(agent['thing@program'], '任务名');
  assert.deepEqual(agent.contain.map((child) => child.thing ?? child['thing@program']), [
    '编标版本', '任务标题', '导航坐标', '设标', '建标', '推进', '收尾', '内部路由'
  ]);
  assert.deepEqual(scheduler.agentSecurity.get('当前Agent/任务区/任务名'), {
    labels: [],
    functionScopes: structuredClone(agentExample.functions),
    functions: agentExample.functions.names
  });
});

test('documented repair command attaches and instantiates a flow below an existing Agent Program', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-help-repair-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const existingAgentSource = `agent(${JSON.stringify(fixtureAgentSpecification)})`;
  await fs.writeFile(contextFile, JSON.stringify([
    atom('已有任务名', existingAgentSource, [], 'program')
  ], null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();

  const result = await executeAtomLanguage({
    source: `transform {"thing":"已有任务名","contain":[{"thing@program":"推进流","situation":"instantiate({'template': 'advancement-flow', 'version': 'latest', 'mode': 'ensure', 'parameters': {'title': '任务标题'}})","contain":[],"support":[]}]}`,
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'existing-agent-ref', path: '已有任务名' } }
  });

  assert.equal(result.ok, true, JSON.stringify({ errors: result.errors, warnings: result.warnings }));
  const [agent] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(agent['thing@program'], '已有任务名');
  assert.equal(agent.contain.length, 1);
  assert.equal(agent.contain[0]['thing@program'], '推进流');
  assert.equal(agent.contain[0].contain.find((child) => child.thing === '导航坐标').situation, '定向');
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
  assert.equal(instantiated.ok, true, JSON.stringify({ errors: instantiated.errors, warnings: instantiated.warnings }));

  const edited = await executeAtomLanguage({
    source: 'transform {"thing":"Editable Flow/推进流/设标/定向/需求","situation.rep.真实需求"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'editable-agent-ref', path: 'Editable Flow' } }
  });

  assert.equal(edited.ok, true, JSON.stringify(edited.errors));
  const [agent] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const requirement = agent.contain[0].contain
    .find((child) => child.thing === '设标').contain
    .find((child) => child.thing === '定向').contain
    .find((child) => child.thing === '需求');
  assert.equal(requirement.situation, '真实需求');
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
