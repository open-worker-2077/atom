import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
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

test('Program function catalog filters declared groups without exposing a second permission engine', async () => {
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
    'agent,changed,child_detail,direct_children,explore,jump,jump_authorize,lock,shortcut,slot_body,subtree_refs,transform|False'
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
  assert.equal(webPayload.result.version, 5);

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
    'thing', 'situation', 'contain', 'support'
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

test('public shortcut contract exposes coordinate-only create and delete operations', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const shortcut = programFunctionRegistry().functions.find((item) => item.name === 'shortcut');
  assert.deepEqual(shortcut.contract.argument.oneOf[1], {
    type: 'object',
    required: ['action', 'reference'],
    additionalProperties: false,
    properties: {
      action: { const: 'delete' },
      reference: { $ref: '#/runtimeTypes/ThingCoordinate', role: 'shortcut-record' }
    }
  });
  assert.equal(shortcut.contract.delete, 'reference-only-central-atomic-commit');
  assert.deepEqual(shortcut.contract.errors.slice(-4), [
    'INVALID_SHORTCUT_REFERENCE_COORDINATE',
    'SHORTCUT_DELETE_REFERENCE_REQUIRED',
    'SHORTCUT_REFERENCE_NOT_FOUND',
    'SHORTCUT_REFERENCE_ACCESS_DENIED'
  ]);

  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /shortcut\(\{"action":"delete","reference":reference\}\)/u);
  assert.match(stdout.value(), /只删除引用.*不改变目标.*不删除创建 Program/u);
});

test('public registry and CLI Help expose the complete槽体 kernel contract', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const registry = programFunctionRegistry();
  const slotBody = registry.functions.find((item) => item.name === 'slot_body');
  const useProgram = registry.functions.find((item) => item.name === 'use_program');
  assert.deepEqual(useProgram.contract.argument, {
    type: 'object',
    required: ['name', 'arguments'],
    additionalProperties: false,
    properties: {
      name: {
        oneOf: [
          { $ref: '#/runtimeTypes/ThingCoordinate' },
          { type: 'string', format: 'exact-program-name-or-path' }
        ]
      },
      arguments: { type: 'object' }
    }
  });
  assert.equal(useProgram.contract.coordinateAuthorization, 'repeat-exact-explore-current-access-boundary');
  assert.deepEqual(useProgram.contract.errors, [
    'USE_PROGRAM_COORDINATE_NOT_FOUND',
    'USE_PROGRAM_TARGET_NOT_PROGRAM',
    'WINDOW_ACCESS_DENIED'
  ]);
  assert.equal(slotBody.layer, 'kernel');
  assert.equal(slotBody.family, 'graph');
  assert.deepEqual(slotBody.contract.argument.required, ['action', 'body']);
  assert.deepEqual(slotBody.contract.argument.properties.action.enum, ['seal', 'print']);
  assert.deepEqual(slotBody.contract.argument.properties.name.requiredWhen, { action: 'print' });
  assert.equal(Object.hasOwn(slotBody.contract.argument.properties, 'revision'), false);
  assert.deepEqual(slotBody.contract.internalPrintEffect, {
    source: 'current-body-print-program',
    callerAccessible: false,
    revisionBinding: 'current-visible-print-plan'
  });
  assert.deepEqual(useProgram.contract.slotBodyPrint, {
    selector: 'EXACT-body/print',
    arguments: {
      type: 'object', required: ['name'], additionalProperties: false,
      properties: { name: { type: 'string', format: 'single-atom-name' } }
    },
    revisionArgument: 'forbidden',
    revisionBinding: 'current-visible-print-plan'
  });
  assert.deepEqual(slotBody.contract.layout.sealedChildren, ['槽模', 'print', '槽例']);
  assert.equal(slotBody.contract.layout.physicalBlankExample, 'forbidden');
  assert.equal(slotBody.contract.layout.sharedPrograms, '槽模-only');
  assert.equal(slotBody.contract.layout.material, 'unmapped-Thing-subtree-below-mapped-slot');
  assert.equal(slotBody.contract.layout.defaultMaterial, 'forbidden');
  assert.equal(slotBody.contract.revisionSync.mode, 'all-instances-one-seal');
  assert.equal(slotBody.contract.revisionSync.material, 'byte-preserved');
  assert.equal(Object.hasOwn(slotBody.contract.revisionSync, 'batch'), false);
  assert.equal(Object.hasOwn(slotBody.contract.argument.properties, 'limit'), false);
  assert.equal(Object.hasOwn(slotBody.contract.argument.properties, 'cursor'), false);
  assert.match(slotBody.contract.development.scopeBinding, /thing\.run/u);
  assert.doesNotMatch(slotBody.contract.development.scopeBinding, /name\.run/u);
  assert.equal(slotBody.contract.transaction, 'central-atomic-commit');
  assert.deepEqual(slotBody.contract.confirmation, ['interaction-receipt', 'exact-explore']);
  assert.ok(slotBody.contract.errors.includes('SLOT_MATERIAL_CONTAINMENT_CONFLICT'));
  assert.equal(slotBody.contract.errors.some((code) => code.includes('CURSOR')), false);
  assert.ok(slotBody.contract.errors.includes('SLOT_SCOPE_BOUNDARY_CROSSING'));

  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });
  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /普通可自运行候选 DataFlow/u);
  assert.match(stdout.value(), /槽模／print@program／槽例/u);
  assert.match(stdout.value(), /explore \{"thing":"EXACT槽体\/print\/修订","contain\$latitude-1":true\}/u);
  assert.doesNotMatch(stdout.value(), /explore \{"name":"EXACT槽体\/print\/修订"|复制[^\n]*默认料/u);
  assert.match(stdout.value(), /use_program[\s\S]*arguments[\s\S]*name[\s\S]*修订由当前 print@program 内部绑定/u);
  assert.match(stdout.value(), /use_program\(\{"name": explore\(\{.*\}\)\[0\], "arguments": \{.*\}\}\)/u);
  assert.match(stdout.value(), /坐标会按当前窗口与 Program 边界重新授权/u);
  assert.match(stdout.value(), /精确字符串名称或路径继续兼容/u);
  assert.match(stdout.value(), /调用方不得传 revision/u);
  assert.match(stdout.value(), /thing\.run\.EXACT候选根路径[\s\S]*\.\/相对 contain 路径[\s\S]*当前槽例域/u);
  assert.match(stdout.value(), /"thing":"EXACT槽体\/槽例\/实例\/槽"[\s\S]*situation\.rep\.填写值/u);
  assert.doesNotMatch(stdout.value(), /name\.run\.EXACT候选根路径|detail\.rep\.填写值/u);
  assert.match(stdout.value(), /本地料 Thing[\s\S]*逐字节/u);
  assert.match(stdout.value(), /SLOT_MATERIAL_CONTAINMENT_CONFLICT[\s\S]*不产生半份槽例/u);
  assert.doesNotMatch(stdout.value(), /next_cursor|SLOT_SYNC_CURSOR|三方比较/u);
});

test('public registry exposes the business state lock range, action, and label contract', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const lock = programFunctionRegistry().functions.find((item) => item.name === 'lock');

  assert.deepEqual(lock.contract.argument.required, ['targets', 'actions', 'labels']);
  assert.equal(lock.contract.argument.additionalProperties, false);
  assert.deepEqual(lock.contract.argument.properties.targets, {
    type: 'object', additionalProperties: false,
    oneOf: [{ required: ['refs'] }, { required: ['paths'] }],
    properties: {
      refs: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', format: 'atom-ref' } },
      paths: { type: 'array', minItems: 1, maxItems: 1, uniqueItems: true, items: { type: 'string', format: 'exact-atom-path' } },
      scope: { enum: ['exact', 'subtree'], default: 'exact' }
    }
  });
  assert.deepEqual(lock.contract.argument.properties.actions.items.enum, ['explore', 'transform']);
  assert.equal(lock.contract.argument.properties.labels.minItems, 1);
  assert.equal(lock.contract.authorization, 'shared-cli-graph-chain');
  assert.equal(lock.contract.denial, 'GRAPH_LOCK_DENIED');
  assert.equal(lock.contract.persistence, 'literal-path-declaration-in-program-source');
});

test('public registry exposes indexed Transform trigger dispatch and function-reference entrypoints', async () => {
  const { programFunctionRegistry } = await import('../work-engine/atom-language/program-function-registry.mjs');
  const trigger = programFunctionRegistry().functions.find((item) => item.name === 'trigger');

  assert.deepEqual(trigger.contract.arguments, [
    { name: 'mode', const: 'transform' },
    {
      name: 'parameters',
      type: 'object',
      required: ['nodes'],
      additionalProperties: false,
      properties: {
        nodes: {
          type: 'array', minItems: 1, uniqueItems: true,
          items: { type: 'string', format: 'exact-atom-path' }
        }
      }
    },
    { name: 'entrypoint', type: 'function-reference', arguments: 0 }
  ]);
  assert.equal(trigger.contract.dispatch, 'reverse-index');
  assert.equal(trigger.contract.event, 'transform-request');
  assert.equal(trigger.contract.sameValueTriggers, true);
  assert.equal(
    trigger.contract.untriggeredProgramDispatch,
    'explicit-run-program-self-transform-or-known-dependency-change'
  );
});

test('CLI Help documents the three-argument Transform trigger without eager main invocation', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /trigger\("transform",\s*\{"nodes":\["exact 节点路径"\]\},\s*main\)/u);
  assert.match(stdout.value(), /main 是函数引用[\s\S]*不能写 main\(\)/u);
  assert.match(stdout.value(), /相同值[\s\S]*仍属于 Transform 事件/u);
  assert.match(stdout.value(), /反向索引[\s\S]*只运行命中的 Program/u);
  assert.match(stdout.value(), /未声明 trigger[\s\S]*无关 Transform[\s\S]*不会重放/u);
});

test('CLI Help explains fixed Agent registration and the shared Graph authorization chain', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /agent\(\{"labels"[\s\S]*"functions"[\s\S]*"groups"[\s\S]*"names"/u);
  assert.match(stdout.value(), /functions 必填[\s\S]*禁止 null、通配/u);
  assert.match(stdout.value(), /groups 是正式分层权限[\s\S]*当前 registry/u);
  assert.match(stdout.value(), /names 是冻结的具体函数授权/u);
  assert.match(stdout.value(), /后代组[\s\S]*不能上铸祖先组[\s\S]*同级其他职能树/u);
  assert.match(stdout.value(), /当前 Agent 起点[\s\S]*contain 路径[\s\S]*目标 node 锁/u);
  assert.match(stdout.value(), /jump 定位复用 Explore、移动复用 Transform/u);
  assert.match(stdout.value(), /windowSelfLocks[\s\S]*RETIRED_WINDOW_SELF_LOCK_SNAPSHOT/u);
  assert.match(stdout.value(), /agentRegistrations[\s\S]*RETIRED_AGENT_REGISTRATION_SNAPSHOT/u);
  assert.match(stdout.value(), /slot_body[\s\S]*不接受 lock 开关/u);
});

test('CLI Help explains Program Transform creation, compatibility and confirmation', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], { stdout: stdout.stream, stderr: stderr.stream });

  assert.equal(code, 0, stderr.value());
  assert.match(stdout.value(), /Program transform 创建/u);
  assert.match(stdout.value(), /thing[\s\S]*situation[\s\S]*contain[\s\S]*support/u);
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
  assert.match(stdout.value(), /不开放 import\/eval[\s\S]*situation\.rep\./u);
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
