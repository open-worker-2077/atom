import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', contain = [], support = [], types = []) {
  return { [`thing${types.map((type) => `@${type}`).join('')}`]: thing, situation, contain, support };
}
function thingOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@#]/u)[0] === 'thing')?.[1];
}
function find(atoms, selector) {
  let contain = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = contain.find((candidate) => thingOf(candidate) === segment);
    if (!current) return null;
    contain = current.contain;
  }
  return current;
}
function world() {
  return [atom('Root', '', [
    atom('研发窗口', '', [], [], ['agent', '研发']),
    atom('订单槽体', '', [atom('候选流', '', [
      atom('客户', '客户槽契约', [], [{ 'if@current': true, then: [{ thing: '金额' }] }], ['text']),
      atom('金额', '金额槽契约', [], [{
        'if@current': true,
        if: [{ 'thing@program': '共享计算' }],
        then: [{ thing: '结果' }]
      }], ['number']),
      atom('结果', '结果槽契约'),
      atom('共享计算', 'def main(arguments):\n    return True', [], [], ['program'])
    ])]),
    atom('槽体封装程序', 'slot_body({"action":"seal","body":"Root/订单槽体"})', [], [], ['program']),
    atom('槽体打印程序', 'use_program({"name":"Root/订单槽体/print","arguments":{"name":"订单001"}})', [], [], ['program'])
  ])];
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-body-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  return {
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } }
  };
}
const run = (runtime, source) => executeAtomLanguage({ ...runtime, source });

test('Program seals then prints one instance with shared Program and owner-local support', async (t) => {
  const runtime = await setup(t);
  const sealed = await run(runtime, 'transform {"thing.run.":"Root/槽体封装程序"}');
  assert.equal(sealed.ok, true, JSON.stringify(sealed.errors));
  const printed = await run(runtime, 'transform {"thing.run.":"Root/槽体打印程序"}');
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));
  const committedText = await fs.readFile(runtime.contextFile, 'utf8');
  const committed = JSON.parse(committedText);
  assert.ok(find(committed, 'Root/订单槽体/槽例/订单001'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单001/共享计算'), null);
  assert.deepEqual(find(committed, 'Root/订单槽体/槽例/订单001/金额').support, [{
    'if@current': true,
    if: [{ 'thing@program': 'Root/订单槽体/槽模/共享计算' }],
    then: [{ thing: 'Root/订单槽体/槽例/订单001/结果' }]
  }]);
  const projected = await executeAtomLanguage({
    ...runtime, source: 'atom', programScheduler: createProgramRuntimeScheduler(), programMode: 'project'
  });
  assert.equal(projected.ok, true, JSON.stringify(projected.errors));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), committedText);
  const duplicate = await run(runtime, 'transform {"thing.run.":"Root/槽体打印程序"}');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors[0].code, 'SLOT_BODY_EXAMPLE_EXISTS');
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), committedText);
});

test('unrelated Program creation does not replay an existing print effect', async (t) => {
  const runtime = await setup(t);
  assert.equal((await run(runtime, 'transform {"thing.run.":"Root/槽体封装程序"}')).ok, true);
  assert.equal((await run(runtime, 'transform {"thing.run.":"Root/槽体打印程序"}')).ok, true);
  const created = await run(runtime, 'transform new {"thing@program":"Root/无关共享程序","situation":"def main(arguments):\\n    return arguments","contain":[],"support":[]}');
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.ok(find(committed, 'Root/无关共享程序'));
  assert.equal(find(committed, 'Root/订单槽体/槽例').contain.filter((child) => thingOf(child) === '订单001').length, 1);
});
