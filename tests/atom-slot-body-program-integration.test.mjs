import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
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
  const key = Object.keys(value).find((candidate) => candidate.split(/[@#]/u)[0] === 'name');
  return value[key];
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
  const program = [
    'slot_body({"action":"seal","body":"Root/订单槽体"})',
    'slot_body({"action":"print","body":"Root/订单槽体","name":"订单001"})'
  ].join('\n');
  return [atom('Root', '', [
    atom('研发窗口', '', [], [], ['agent', '研发']),
    atom('订单槽体', '', [
      atom('槽模', '', [
        atom('客户', '定义', [], [{ verb: '触发', object: '金额' }], ['text']),
        atom('金额', '定义', [], [], ['number']),
        atom('共享计算', 'def main(arguments):\n    return arguments', [], [], ['program'])
      ]),
      atom('槽例', '', [
        atom('空槽例', '', [
          atom('客户', '', [], [{ verb: '触发', object: '金额' }], ['text']),
          atom('金额', '', [], [{ verb: '计算', object: 'Root/订单槽体/槽模/共享计算' }], ['number'])
        ])
      ])
    ]),
    atom('槽体装配程序', program, [], [], ['program'])
  ])];
}

test('Program slot_body effects seal and print in one central commit and reject duplicate atomically', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-body-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const interaction = { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } };

  const first = await executeAtomLanguage({
    source: 'transform {"name.run.":"Root/槽体装配程序"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction
  });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const committedText = await fs.readFile(contextFile, 'utf8');
  const committed = JSON.parse(committedText);
  const printed = find(committed, 'Root/订单槽体/槽例/订单001');
  assert.ok(printed, JSON.stringify(first));
  assert.equal(find(committed, 'Root/订单槽体/槽例/订单001/共享计算'), null);
  assert.equal(
    find(committed, 'Root/订单槽体/槽例/订单001/金额').partners
      .find((partner) => partner.verb === '计算')?.object,
    'Root/订单槽体/槽模/共享计算'
  );

  const restartedScheduler = createProgramRuntimeScheduler();
  const projected = await executeAtomLanguage({
    source: 'atom',
    contextFile,
    projectionFile,
    programScheduler: restartedScheduler,
    programMode: 'project',
    interaction
  });
  assert.equal(projected.ok, true, JSON.stringify(projected.errors));
  assert.equal(await fs.readFile(contextFile, 'utf8'), committedText);

  const duplicate = await executeAtomLanguage({
    source: 'transform {"name.run.":"Root/槽体装配程序"}',
    contextFile,
    projectionFile,
    programScheduler: restartedScheduler,
    interaction
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors[0].code, 'SLOT_BODY_EXAMPLE_EXISTS');
  assert.equal(await fs.readFile(contextFile, 'utf8'), committedText);
});

test('creating an unrelated Program does not replay an existing slot-body print', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-body-unrelated-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const interaction = { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } };

  const printed = await executeAtomLanguage({
    source: 'transform {"name.run.":"Root/槽体装配程序"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction
  });
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));

  const created = await executeAtomLanguage({
    source: 'transform new {"name@program":"Root/无关共享程序","detail":"def main(arguments):\\n    return arguments","children":[],"partners":[]}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction
  });

  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const committed = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.ok(find(committed, 'Root/无关共享程序'));
  assert.equal(
    find(committed, 'Root/订单槽体/槽例').children
      .filter((child) => nameOf(child) === '订单001').length,
    1
  );
});

test('a cold interaction runtime projects legacy Programs without replaying slot-body effects', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-body-cold-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(world(), null, 2), 'utf8');
  const interaction = { agent: { ref: 'agent:Root/研发窗口', path: 'Root/研发窗口' } };

  const printed = await executeAtomLanguage({
    source: 'transform {"name.run.":"Root/槽体装配程序"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    programMode: undefined,
    interaction
  });
  assert.equal(printed.ok, true, JSON.stringify(printed.errors));
  assert.ok(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Root/订单槽体/槽例/订单001'));

  const restarted = createProgramRuntimeScheduler();
  const projected = await executeAtomLanguage({
    source: 'atom',
    contextFile,
    projectionFile,
    programScheduler: restarted,
    programMode: 'project',
    interaction
  });
  assert.equal(projected.ok, true, JSON.stringify(projected.errors));

  const unrelated = await executeAtomLanguage({
    source: 'transform {"name":"Root/研发窗口","detail.rep.仍可工作"}',
    contextFile,
    projectionFile,
    programScheduler: restarted,
    programMode: undefined,
    interaction
  });

  assert.equal(unrelated.ok, true, JSON.stringify(unrelated.errors));
  const committed = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(
    find(committed, 'Root/订单槽体/槽例').children
      .filter((child) => nameOf(child) === '订单001').length,
    1
  );
});
