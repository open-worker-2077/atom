import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  executeAtomCommandEndpoint,
  runAtomCli
} from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', slot = [], strut = [], types = [], agentLabels = []) {
  const agent = types.includes('agent');
  const storedTypes = agent ? ['program', ...types.filter((type) => !['agent', 'program'].includes(type))] : types;
  const source = agent
    ? `${situation}\nagent(${JSON.stringify({ labels: agentLabels, functions: { groups: [], names: ['agent', 'explore', 'jump', 'jump_authorize', 'json_parse', 'lock', 'slot_body', 'transform', 'trigger', 'use_program'] } })})`
    : situation;
  return { [`thing${storedTypes.map((type) => `@${type}`).join('')}`]: thing, situation: source, slot, strut };
}

function thingOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@#]/u)[0] === 'thing')?.[1];
}

function find(atoms, selector) {
  let children = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = children.find((candidate) => thingOf(candidate) === segment);
    if (!current) return null;
    children = current.slot ?? [];
  }
  return current;
}

function fixture() {
  const body = 'Root/两步槽体';
  const model = `${body}/两步流程`;
  const execution = `${body}/槽例/甲/步骤一/执行`;
  const registration = `${execution}/Registration`;
  const advance = [
    'def advance(delivery):',
    '    if delivery["decision"] is not True:',
    '        return',
    `    next_stage = explore({"thing":"${model}/步骤二","situation$full":True})[0]`,
    '    if next_stage.situation == "🏃‍♀️ 进行中":',
    '        return',
    `    transform({"thing":"${model}/步骤二","situation$replace":"🏃‍♀️ 进行中"})`,
    '    transform({"thing":"./步骤二/业务锁","situation$replace":"def main(arguments):\\n    return True"})',
    '    window = explore({"thing":"./步骤一/执行"})[0]',
    '    source = explore({"thing":"./步骤一/执行/Registration"})[0]',
    `    destination = explore({"thing":"${model}/步骤二"})[0]`,
    '    jump_authorize({"window":window,"source":source,"destination":destination})',
    'trigger("strut", {}, advance)'
  ].join('\n');
  const executionSource = 'agent({"labels":["总控"],"functions":{"groups":[],"names":["explore","jump","trigger"]}})';
  const whenSource = [
    'def main(arguments):',
    '    records = explore({"thing":"Registration","slot$latitude-1":True})',
    '    return any("jump-authorization" in record.types for record in records)'
  ].join('\n');
  const whereSource = [
    'def main(arguments):',
    '    records = explore({"thing":"Registration","slot$latitude-1":True})',
    '    grants = [record for record in records if "jump-authorization" in record.types]',
    '    if len(grants) != 1:',
    '        raise ValueError("one controlled jump authorization is required")',
    '    return grants[0]'
  ].join('\n');
  const registrationSource = [
    'def handoff():',
    '    jump({"when":explore({"thing":"When"})[0],"where":explore({"thing":"Where"})[0]})',
    `trigger("transform", {"nodes":[${JSON.stringify(registration)}]}, handoff)`
  ].join('\n');
  const printer = (name) => `use_program({"name":"${body}/print","arguments":{"name":"${name}"}})`;
  return { world: [atom('Root', '', [
    atom('两步槽体', 'slot_body({"action":"seal"})', [
      atom('两步流程', '', [
        atom('步骤一', '🏃‍♀️ 进行中', [], [{ 'if@current': true, then: [{ 'thing@program': '推进' }] }]),
        atom('步骤二', '⌛️ 等待'),
        atom('推进', advance, [], [], ['program'])
      ])
    ], [], ['agent'], ['总控']),
    atom('打印甲', printer('甲'), [], [], ['program']),
    atom('打印乙', printer('乙'), [], [], ['program'])
  ], [], ['agent'])], executionSource, whenSource, whereSource, registrationSource };
}

async function runPublicCli(endpoint, agent, source) {
  let stdout = '';
  let stderr = '';
  const code = await runAtomCli([
    '--json', '--endpoint', endpoint, '--agent', agent, ...source
  ], {
    execute: executeAtomCommandEndpoint,
    requireAgent: true,
    stdin: { isTTY: false },
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });
  return { code, stdout, stderr };
}

test('two-step slot instance unlocks without touching template or sibling', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-two-step-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const { world, executionSource, whenSource, whereSource, registrationSource } = fixture();
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2), 'utf8');
  const programScheduler = createProgramRuntimeScheduler();
  const observedTransforms = [];
  const runProgram = programScheduler.runProgram;
  programScheduler.runProgram = async (request) => {
    const result = await runProgram(request);
    if (request.program.path.endsWith('/推进')) {
      observedTransforms.push({ request, transforms: result.transforms });
    }
    return result;
  };
  const run = (source, agentPath = 'Root') => executeAtomLanguage({
    contextFile,
    projectionFile,
    source,
    programScheduler,
    interaction: { id: crypto.randomUUID(), agent: { path: agentPath } }
  });
  const body = 'Root/两步槽体';

  for (const source of [
    'transform {"thing.run.":"Root/两步槽体"}',
    'transform {"thing.run.":"Root/打印甲"}',
    'transform {"thing.run.":"Root/打印乙"}'
  ]) {
    const result = await run(source);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  }
  const next = `${body}/槽例/甲/步骤二`;
  assert.deepEqual(programScheduler.agentSecurity.get(body)?.labels, ['总控']);
  const lockSource = `lock({"targets":{"paths":["${next}"],"scope":"subtree"},"actions":["transform"],"labels":["总控"]})`;
  assert.equal((await run(`transform new ${JSON.stringify({
    'thing@program': `${next}/业务锁`, situation: lockSource, slot: [], strut: []
  })}`)).ok, true);
  const denied = await run(`transform {"thing":"${next}","situation.rep.越权":null}`);
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => error.code === 'GRAPH_LOCK_DENIED'), JSON.stringify(denied));
  const executionPath = `${body}/槽例/甲/步骤一/执行`;
  const executionCreated = await run(`transform new ${JSON.stringify({
    'thing@program': executionPath,
    situation: executionSource,
    slot: [
      { 'thing@program': 'When', situation: whenSource, slot: [], strut: [] },
      { 'thing@program': 'Where', situation: whereSource, slot: [], strut: [] },
      { 'thing@program': 'Registration', situation: registrationSource, slot: [], strut: [] }
    ],
    strut: []
  })}`, body);
  assert.equal(executionCreated.ok, true, JSON.stringify(executionCreated));

  const completed = await run(
    `transform {"thing":"${body}/槽例/甲/步骤一","situation.rep.✅ 完成"}`,
    body
  );
  const triggeredAdvance = observedTransforms.find((entry) => entry.request.triggered === true);
  assert.equal(triggeredAdvance?.request.scopeRoot, `${body}/槽例/甲`, JSON.stringify(observedTransforms));
  assert.ok(triggeredAdvance?.transforms.every((entry) => (
    entry.sourceScopeRoot === `${body}/槽例/甲`
  )), JSON.stringify(observedTransforms));
  assert.equal(completed.ok, true, JSON.stringify(completed));

  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, `${body}/槽例/甲/步骤一`).situation, '✅ 完成');
  assert.equal(find(stored, `${body}/槽例/甲/步骤二`).situation, '🏃‍♀️ 进行中');
  assert.equal(find(stored, `${body}/槽例/乙/步骤二`).situation, '⌛️ 等待');
  assert.equal(find(stored, `${body}/两步流程/步骤二`).situation, '⌛️ 等待');
  assert.equal(find(stored, `${body}/槽例/甲/步骤二/业务锁`).situation.includes('lock('), false);
  assert.equal(find(stored, `${body}/槽例/甲/步骤一/执行`), null, JSON.stringify(completed));
  assert.ok(find(stored, `${body}/槽例/甲/步骤二/执行`), JSON.stringify(completed));
});

test('public CLI preserves one completed mirrored instance across a cold restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-two-step-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const { world, executionSource, whenSource, whereSource, registrationSource } = fixture();
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2), 'utf8');

  let running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  const stop = async () => {
    running?.server.closeAllConnections?.();
    await running?.close();
  };
  t.after(stop);
  let endpoint = `${running.url}/__atom/api/command`;
  const command = async (agent, ...source) => {
    const result = await runPublicCli(endpoint, agent, source);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    return result;
  };
  const body = 'Root/两步槽体';
  const next = `${body}/槽例/甲/步骤二`;

  await command('Root', 'transform', JSON.stringify({ 'thing.run.': body }));
  await command('Root', 'transform', JSON.stringify({ 'thing.run.': 'Root/打印甲' }));
  await command('Root', 'transform', JSON.stringify({ 'thing.run.': 'Root/打印乙' }));
  await command('Root', 'transform', 'new', JSON.stringify({
    'thing@program': `${next}/业务锁`,
    situation: `lock({"targets":{"paths":["${next}"],"scope":"subtree"},"actions":["transform"],"labels":["总控"]})`,
    slot: [], strut: []
  }));
  await command(body, 'transform', 'new', JSON.stringify({
    'thing@program': `${body}/槽例/甲/步骤一/执行`,
    situation: executionSource,
    slot: [
      { 'thing@program': 'When', situation: whenSource, slot: [], strut: [] },
      { 'thing@program': 'Where', situation: whereSource, slot: [], strut: [] },
      { 'thing@program': 'Registration', situation: registrationSource, slot: [], strut: [] }
    ],
    strut: []
  }));
  await command(body, 'transform',
    `{"thing":${JSON.stringify(`${body}/槽例/甲/步骤一`)},"situation.rep.✅ 完成"}`);

  const beforeRestart = await command(body, 'explore', JSON.stringify({
    thing: next, 'situation$full': true, 'slot$latitude-1': true
  }));
  assert.match(beforeRestart.stdout, /🏃‍♀️ 进行中/u);
  assert.match(beforeRestart.stdout, /"thing@program"\s*:\s*"执行"/u);

  await stop();
  running = null;
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  endpoint = `${running.url}/__atom/api/command`;

  const active = await command(body, 'explore', JSON.stringify({
    thing: next, 'situation$full': true, 'slot$latitude-1': true
  }));
  const sibling = await command(body, 'explore', JSON.stringify({
    thing: `${body}/槽例/乙/步骤二`, 'situation$full': true
  }));
  const template = await command(body, 'explore', JSON.stringify({
    thing: `${body}/两步流程/步骤二`, 'situation$full': true
  }));
  assert.match(active.stdout, /🏃‍♀️ 进行中/u);
  assert.match(active.stdout, /"thing@program"\s*:\s*"执行"/u);
  assert.match(sibling.stdout, /⌛️ 等待/u);
  assert.match(template.stdout, /⌛️ 等待/u);
});
