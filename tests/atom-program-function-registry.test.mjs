import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

function output() {
  let value = '';
  return {
    stream: { write(chunk) { value += chunk; } },
    value: () => value
  };
}

test('Program function catalog exposes coarse function families and Atom types', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('函数目录验收', [
      'catalog = function_catalog({})',
      'selected = [[item for item in catalog["functions"] if item["name"] == name][0] for name in sorted(["explore", "transform", "form", "work_order"])]',
      'program = [item for item in catalog["types"] if item["id"] == "program"][0]',
      'text = "|".join([item["name"] + ":" + item["layer"] + ":" + item["family"] + ":" + item["scope"] for item in selected])',
      'message({"level": "info", "text": text + "|program:" + program["layer"] + ":" + str(program["executable"])})'
    ].join('\n'), [], 'program')
  ]);

  assert.equal(cycle.messages[0].text, [
    'explore:kernel:graph:public',
    'form:kernel:form:public',
    'transform:kernel:graph:public',
    'work_order:application:work-order:public',
    'program:kernel:True'
  ].join('|'));
});

test('Program function catalog filters coarse families without a public hierarchy', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('函数目录筛选', [
      'catalog = function_catalog({"layer": "kernel", "family": "graph"})',
      'names = sorted([item["name"] for item in catalog["functions"]])',
      'has_hierarchy = "publicScopes" in catalog or any(["effectiveConstraints" in item or "path" in item["scope"] for item in catalog["functions"]])',
      'message({"level": "info", "text": ",".join(names) + "|" + str(has_hierarchy)})'
    ].join('\n'), [], 'program')
  ]);

  assert.equal(
    cycle.messages[0].text,
    'child_detail,direct_children,explore,lock,subtree_refs,transform|False'
  );
});

test('Program function catalog discovers JSON codecs and their result contracts', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh([
    atom('JSON函数目录验收', [
      'catalog = function_catalog({"layer": "kernel", "family": "program"})',
      'codecs = [item for item in catalog["functions"] if item["name"] in ["json_parse", "json_stringify"]]',
      'text = ",".join(sorted([item["name"] + ":" + item["contract"]["result"]["type"] for item in codecs]))',
      'message({"level": "info", "text": text})'
    ].join('\n'), [], 'program')
  ]);

  assert.equal(cycle.messages[0].text, 'json_parse:json,json_stringify:string');
});

test('function registry validator fails closed on duplicate or structurally invalid entries', async () => {
  const registryModule = await import('../work-engine/atom-language/program-function-registry.mjs');
  assert.equal(typeof registryModule.validateProgramFunctionRegistry, 'function');
  const duplicate = registryModule.programFunctionRegistry();
  duplicate.functions.push(structuredClone(duplicate.functions[0]));
  assert.throws(
    () => registryModule.validateProgramFunctionRegistry(duplicate),
    (error) => error?.code === 'INVALID_PROGRAM_FUNCTION_REGISTRY'
  );
  const invalidScope = registryModule.programFunctionRegistry();
  invalidScope.functions[0].scope = 'cross-atom';
  assert.throws(
    () => registryModule.validateProgramFunctionRegistry(invalidScope),
    (error) => error?.code === 'INVALID_PROGRAM_FUNCTION_REGISTRY'
  );
});

test('CLI and Web expose equivalent function registry data without an Agent context', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-function-registry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('接口Agent', '', [], 'agent')]), 'utf8');
  const running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  t.after(() => running.close());

  const response = await fetch(`${running.url}/__atom/api/program-function-registry`);
  assert.equal(response.status, 200);
  const webPayload = await response.json();
  assert.equal(webPayload.ok, true);
  assert.equal(webPayload.result.contract, 'atom-program-function-registry');
  assert.equal(webPayload.result.version, 2);

  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--program-function-registry'], {
    requireAgent: true,
    stdout: stdout.stream,
    stderr: stderr.stream,
    programFunctionRegistry: async () => webPayload.result
  });
  assert.equal(code, 0, stderr.value());
  assert.deepEqual(JSON.parse(stdout.value()), webPayload.result);
});

test('CLI Help renders coarse families and keeps local Program research open', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /内核函数[\s\S]*Graph 函数[\s\S]*explore[\s\S]*transform/u);
  assert.match(stdout.value(), /Form 函数[\s\S]*Program 函数/u);
  assert.match(stdout.value(), /应用函数[\s\S]*work_order/u);
  assert.match(stdout.value(), /本 Atom Program[\s\S]*自行研发[\s\S]*use_program/u);
  assert.match(stdout.value(), /注册表[\s\S]*底层运行时[\s\S]*不通过 Program 开放修改/u);
});

test('CLI Help exposes the complete adaptive form evaluation contract', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /form\(\{"action":"evaluate","components":\[/u);
  assert.match(stdout.value(), /"activation":"required\|optional\|disabled"/u);
  assert.match(stdout.value(), /"requirements":\[\{"path":\["JSON键"/u);
  assert.match(stdout.value(), /components 可递归/u);
  assert.match(stdout.value(), /valid、required、optional、disabled、active、missing/u);
  assert.match(stdout.value(), /missing[\s\S]*component[\s\S]*path/u);
  assert.match(stdout.value(), /disabled[\s\S]*不参与校验[\s\S]*未使用的 optional[\s\S]*不形成缺项/u);
});

test('public registry exposes the deferred Program Transform create and update contract', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const transform = programFunctionRegistry().functions.find((item) => item.name === 'transform');

  assert.deepEqual(transform.contract.argument, { type: 'object', name: 'spec' });
  assert.deepEqual(transform.contract.create.requiredAxes, [
    'name', 'detail', 'children', 'partners'
  ]);
  assert.equal(transform.contract.create.dotCommands, 'forbidden');
  assert.equal(transform.contract.update.dotCommands, 'supported');
  assert.deepEqual(transform.contract.result, {
    type: 'null',
    value: null,
    meaning: 'deferred-effect'
  });
  assert.deepEqual(transform.contract.confirmation, [
    'interaction-receipt', 'exact-explore'
  ]);
});

test('public registry exposes the complete window-aware Program lock contract', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const lock = programFunctionRegistry().functions.find((item) => item.name === 'lock');

  assert.deepEqual(lock.contract.argument.required, ['targets', 'mode']);
  assert.deepEqual(lock.contract.argument.properties.allowed_windows, {
    type: 'object',
    required: ['paths'],
    additionalProperties: false,
    properties: {
      paths: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', format: 'exact-agent-path' } }
    }
  });
  assert.deepEqual(lock.contract.argument.properties.refresh, {
    type: 'object',
    required: ['policy'],
    additionalProperties: false,
    properties: { policy: { const: 'on_request' } }
  });
  assert.equal(lock.contract.recompute.command, 'transform {"name.run.":"EXACT_PROGRAM_PATH"}');
  assert.equal(lock.contract.denial.write, 'PROGRAM_LOCK_DENIED');
});

test('CLI Help explains window allowlists and explicit lock recomputation', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /allowed_windows[\s\S]*paths[\s\S]*exact.*@agent/iu);
  assert.match(stdout.value(), /refresh[\s\S]*on_request[\s\S]*name\.run\./u);
  assert.match(stdout.value(), /PROGRAM_LOCK_DENIED[\s\S]*旧锁快照/u);
});

test('CLI Help explains Program Transform creation, compatibility and confirmation', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /Program transform 创建/u);
  assert.match(stdout.value(), /name[\s\S]*detail[\s\S]*children[\s\S]*partners/u);
  assert.match(stdout.value(), /完整四轴[\s\S]*无点号指令[\s\S]*创建/u);
  assert.match(stdout.value(), /点号指令[\s\S]*更新/u);
  assert.match(stdout.value(), /返回 None[\s\S]*交互回执[\s\S]*exact explore/u);
});

test('public registry exposes strict Program JSON codec contracts', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const registry = programFunctionRegistry();
  const parse = registry.functions.find((item) => item.name === 'json_parse');
  const stringify = registry.functions.find((item) => item.name === 'json_stringify');

  assert.deepEqual(parse.contract.argument, {
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: { text: { type: 'string' } }
  });
  assert.deepEqual(parse.contract.result, { type: 'json' });
  assert.equal(parse.contract.strictNumbers, true);
  assert.equal(parse.contract.failureBoundary, 'program-evaluation');
  assert.equal(parse.contract.effectsPublishedOnFailure, false);

  assert.deepEqual(stringify.contract.argument, {
    type: 'object',
    required: ['value'],
    additionalProperties: false,
    properties: {
      value: { type: 'json' },
      indent: { type: 'integer', minimum: 0, maximum: 8 }
    }
  });
  assert.deepEqual(stringify.contract.result, { type: 'string' });
  assert.equal(stringify.contract.strictNumbers, true);
  assert.equal(stringify.contract.failureBoundary, 'program-evaluation');
  assert.equal(stringify.contract.effectsPublishedOnFailure, false);
});

test('CLI Help exposes JSON detail processing without opening import or eval', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /json_parse\(\{"text":"\.\.\."\}\)/u);
  assert.match(stdout.value(), /json_stringify\(\{"value":\.\.\.,"indent"\?:0\.\.8\}\)/u);
  assert.match(stdout.value(), /默认紧凑[\s\S]*NaN[\s\S]*Infinity[\s\S]*非 JSON 值/u);
  assert.match(stdout.value(), /不开放 import\/eval[\s\S]*detail\.rep\./u);
  assert.match(stdout.value(), /失败将终止整个 Program 评估[\s\S]*不发布已登记效果/u);
});

test('CLI rejects selecting both public registry projections at once', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli([
    '--program-function-registry',
    '--work-order-registry'
  ], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 4);
  assert.equal(stdout.value(), '');
  assert.match(stderr.value(), /AMBIGUOUS_COMMAND_SOURCE/u);
});
