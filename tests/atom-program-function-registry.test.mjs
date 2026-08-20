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
