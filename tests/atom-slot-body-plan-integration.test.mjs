import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { slotProgramInvocationsForEvent } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(name, detail = '', children = [], partners = [], types = []) {
  return {
    [`name${types.map((type) => `@${type}`).join('')}`]: name,
    detail,
    children,
    partners
  };
}

function nameOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@#]/u)[0] === 'name')?.[1];
}

function find(atoms, selector) {
  let children = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = children.find((candidate) => nameOf(candidate) === segment);
    if (!current) return null;
    children = current.children;
  }
  return current;
}

function world() {
  const calculate = [
    'def main(arguments):',
    '    rows = explore({"name":"./输入/变量料","detail$full":True})',
    '    transform({"name":"./输出","detail.rep." + rows[0].detail:None})',
    '    return {"computed":True}'
  ].join('\n');
  const printer = (name) => (
    `use_program({"name":"Root/订单槽体/print","arguments":{"name":"${name}"}})`
  );
  return [atom('Root', '', [
    atom('研发窗口', '', [], [], ['agent']),
    atom('订单槽体', '', [
      atom('候选流', '', [
        atom('输入', '输入槽契约', [], [{ verb: '触发计算', object: '计算' }]),
        atom('输出', '输出槽契约'),
        atom('备注', '备注槽契约'),
        atom('计算', calculate, [], [], ['program'])
      ])
    ]),
    atom('封装', 'slot_body({"action":"seal","body":"Root/订单槽体"})', [], [], ['program']),
    atom('打印001', printer('订单001'), [], [], ['program']),
    atom('打印002', printer('订单002'), [], [], ['program'])
  ])];
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-plan-integration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  return {
    contextFile,
    projectionFile,
    interaction: { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } }
  };
}

async function run(runtime, source, scheduler) {
  return executeAtomLanguage({ ...runtime, source, programScheduler: scheduler });
}

test('generated print Program seals and prints without a blank template in central atomic commits', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();

  const sealed = await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);
  assert.equal(sealed.ok, true, JSON.stringify(sealed.errors));
  const printed = await run(runtime, 'transform {"name.run.":"Root/打印001"}', scheduler);
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));

  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.deepEqual(slotProgramInvocationsForEvent(committed, {
    mode: 'transform', nodes: ['Root/订单槽体/槽例/订单001/输入']
  }).map((item) => item.programPath), ['Root/订单槽体/槽模/计算']);
  assert.ok(find(committed, 'Root/订单槽体/print'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/空槽例'), null);
  assert.ok(find(committed, 'Root/订单槽体/槽例/订单001/输入'), JSON.stringify(printed));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单001/计算'), null);
});

test('outside orchestration materializes a local variable Thing before triggering only its owning instance', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"name.run.":"Root/打印001"}', scheduler);
  await run(runtime, 'transform {"name.run.":"Root/打印002"}', scheduler);

  const materialized = await run(
    runtime,
    'transform new {"name":"Root/订单槽体/槽例/订单001/输入/变量料","detail":"实例一","children":[],"partners":[]}',
    scheduler
  );
  assert.equal(materialized.ok, true, JSON.stringify(materialized.errors));
  const changed = await run(
    runtime,
    'transform {"name":"Root/订单槽体/槽例/订单001/输入","detail.rep.输入槽契约"}',
    scheduler
  );
  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  let committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单001/输出').detail, '实例一');
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单002/输出').detail, '输出槽契约');

  const unrelated = await run(
    runtime,
    'transform {"name":"Root/订单槽体/槽例/订单002/备注","detail.rep.不触发"}',
    scheduler
  );
  assert.equal(unrelated.ok, true, JSON.stringify(unrelated.errors));
  committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单002/输出').detail, '输出槽契约');
});

test('re-seal recomputes every synchronized instance with the new shared Program in the same commit', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"name.run.":"Root/打印001"}', scheduler);
  await run(runtime, 'transform {"name.run.":"Root/打印002"}', scheduler);
  await run(runtime, 'transform new {"name":"Root/订单槽体/槽例/订单001/输入/变量料","detail":"一","children":[],"partners":[]}', scheduler);
  await run(runtime, 'transform new {"name":"Root/订单槽体/槽例/订单002/输入/变量料","detail":"二","children":[],"partners":[]}', scheduler);
  await run(runtime, 'transform {"name":"Root/订单槽体/槽例/订单001/输入","detail.rep.输入槽契约"}', scheduler);
  await run(runtime, 'transform {"name":"Root/订单槽体/槽例/订单002/输入","detail.rep.输入槽契约"}', scheduler);
  await run(runtime, 'transform {"name":"Root/订单槽体/槽例/订单001/输出","detail.rep.陈旧一"}', scheduler);
  await run(runtime, 'transform {"name":"Root/订单槽体/槽例/订单002/输出","detail.rep.陈旧二"}', scheduler);

  const changed = await run(runtime, `transform ${JSON.stringify({
    name: 'Root/订单槽体/槽模/计算',
    'detail.rep.return {"computed":False}': 'return {"computed":True}'
  })}`, scheduler);
  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const resealed = await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);
  assert.equal(resealed.ok, true, JSON.stringify(resealed.errors));

  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.deepEqual(slotProgramInvocationsForEvent(committed, {
    mode: 'transform', nodes: ['Root/订单槽体/槽例/订单001/输入']
  }).map((item) => item.programPath), ['Root/订单槽体/槽模/计算']);
  assert.equal(
    find(committed, 'Root/订单槽体/槽例/订单001/输出').detail,
    '一',
    JSON.stringify(resealed)
  );
  assert.equal(
    find(committed, 'Root/订单槽体/槽例/订单002/输出').detail,
    '二',
    JSON.stringify(resealed)
  );
});

test('one derived recomputation failure rolls back the entire re-seal candidate transaction', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"name.run.":"Root/打印001"}', scheduler);
  const changed = await run(runtime, `transform ${JSON.stringify({
    name: 'Root/订单槽体/槽模/计算',
    'detail.rep.raise ValueError("recompute")': 'return {"computed":True}'
  })}`, scheduler);
  assert.equal(changed.ok, true, JSON.stringify(changed.errors));
  const before = await fs.readFile(runtime.contextFile, 'utf8');

  const resealed = await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);

  assert.equal(resealed.ok, false, JSON.stringify(resealed));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), before);
});

test('exact Explore, cold projection, and unrelated Program creation never replay a print effect', async (t) => {
  const runtime = await setup(t);
  const scheduler = createProgramRuntimeScheduler();
  await run(runtime, 'transform {"name.run.":"Root/封装"}', scheduler);
  await run(runtime, 'transform {"name.run.":"Root/打印001"}', scheduler);
  const committedText = await fs.readFile(runtime.contextFile, 'utf8');

  const explored = await run(
    runtime,
    'explore {"name":"Root/订单槽体/槽例/订单001","children$latitude-1":true}',
    scheduler
  );
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.equal(explored.changed, false, JSON.stringify(explored));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), committedText);

  const projected = await executeAtomLanguage({
    ...runtime,
    source: 'atom',
    programMode: 'project',
    programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(projected.ok, true, JSON.stringify(projected.errors));
  assert.equal(await fs.readFile(runtime.contextFile, 'utf8'), committedText);

  const created = await run(
    runtime,
    'transform new {"name@program":"Root/无关程序","detail":"def main(arguments):\\n    return arguments","children":[],"partners":[]}',
    scheduler
  );
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const committed = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(
    find(committed, 'Root/订单槽体/槽例').children.filter((child) => nameOf(child) === '订单001').length,
    1
  );
});
