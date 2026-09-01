import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';

function atom(thing, situation = '', support = []) {
  const normalizedSupport = support.length && support.every((item) => Object.keys(item).length === 1 && item.thing)
    ? [{ 'if@current': true, then: support }]
    : support;
  return { thing: thing, situation: situation, contain: [], support: normalizedSupport };
}

const supports = (thing) => [{ 'if@current': true, then: [{ thing }] }];

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-batch-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify([
    atom('来源甲', '旧甲'),
    atom('来源乙', '旧乙')
  ], null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

function idleProgramScheduler(onRefresh = () => {}) {
  return {
    async refresh() {
      onRefresh();
      return { messages: [], locks: [], records: [], transforms: [], failures: [] };
    }
  };
}

test('batch Transform commits all items once and refreshes one interaction lifecycle', async (t) => {
  const files = await fixture(t);
  const writes = [];
  let refreshes = 0;
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { thing: '来源甲', 'support.rep.': supports('来源乙') },
      { thing: '来源乙', 'support.rep.': supports('来源甲') }
    ])}`,
    programScheduler: idleProgramScheduler(() => { refreshes += 1; })
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.batch, true);
  assert.equal(result.changed, true);
  assert.deepEqual(
    result.results.map(({ index, changed, result: item }) => ({
      index,
      changed,
      thing: item.thing
    })),
    [
      { index: 0, changed: true, thing: '来源甲' },
      { index: 1, changed: true, thing: '来源乙' }
    ]
  );
  assert.equal(writes.length, 1, 'the whole batch is one authoritative commit');
  assert.equal(
    refreshes,
    3,
    'Programs refresh before the batch, for trigger consequences, and once for the committed base'
  );

  const [sourceA, sourceB] = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(sourceA.support, supports('来源乙'));
  assert.deepEqual(sourceB.support, supports('来源甲'));
});

test('batch Transform writes nothing when any item fails', async (t) => {
  const files = await fixture(t);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { thing: '来源甲', 'support.rep.': supports('来源乙') },
      { thing: '不存在', 'support.rep.': [] }
    ])}`
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'ATOM_NOT_FOUND');
  assert.equal(result.errors[0].itemIndex, 1);
  assert.equal(writes.length, 0);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

test('CLI returns one compact Graph-JSON receipt per committed batch item', async (t) => {
  const files = await fixture(t);
  const world = createLegacyWorldService();
  let stdout = '';
  let stderr = '';
  const source = JSON.stringify([
    { thing: '来源甲', 'support.rep.': supports('来源乙') },
    { thing: '来源乙', 'support.rep.': supports('来源甲') }
  ]);

  const code = await runAtomCli([
    '--context', files.contextFile,
    '--projection', files.projectionFile,
    'transform', source
  ], {
    execute: (request) => world.executeLegacy(request),
    stdin: { isTTY: false },
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });

  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
  assert.deepEqual(materializeGraphJson(parseGraphJson(stdout)), [
    { 'thing~updated': '来源甲' },
    { 'thing~updated': '来源乙' }
  ]);
});

test('batch Transform moves multiple existing Atoms in one authoritative commit', async (t) => {
  const files = await fixture(t);
  await fs.writeFile(files.contextFile, `${JSON.stringify([
    atom('来源甲', '旧甲'),
    atom('来源乙', '旧乙'),
    atom('目标域')
  ], null, 2)}\n`, 'utf8');
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { 'thing.mov.目标域': '来源甲' },
      { 'thing.mov.目标域': '来源乙' }
    ])}`
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.batch, true);
  assert.equal(writes.length, 1);
  const current = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(current.map((item) => item.thing), ['目标域']);
  assert.deepEqual(current[0].contain.map((item) => item.thing), ['来源甲', '来源乙']);
});

test('trusted maintenance atomically moves the backup root and renames its former parent', async (t) => {
  const files = await fixture(t);
  await fs.writeFile(files.contextFile, `${JSON.stringify([{
    ...atom('🧊'),
    contain: [{
      'thing@backup@default': '默认备份仓', situation: '', contain: [], support: []
    }, atom('工务')]
  }], null, 2)}\n`, 'utf8');
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    ...files,
    trustedMaintenance: true,
    source: `transform ${JSON.stringify([
      { 'thing.mov.世界之外': '🧊/默认备份仓' },
      { 'thing.ren.🧊manage': '🧊' }
    ])}`
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1, 'the maintenance migration is one authoritative commit');
  const current = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(current.map((item) => item.thing ?? item['thing@backup@default']), [
    '🧊manage', '默认备份仓'
  ]);
  assert.deepEqual(current[0].contain.map((item) => item.thing), ['工务']);
});

test('trusted maintenance mixed structural batch rolls back every item when a later rename fails', async (t) => {
  const files = await fixture(t);
  await fs.writeFile(files.contextFile, `${JSON.stringify([{
    ...atom('🧊'),
    contain: [{
      'thing@backup@default': '默认备份仓', situation: '', contain: [], support: []
    }]
  }], null, 2)}\n`, 'utf8');
  const before = await fs.readFile(files.contextFile, 'utf8');
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    ...files,
    trustedMaintenance: true,
    source: `transform ${JSON.stringify([
      { 'thing.mov.世界之外': '🧊/默认备份仓' },
      { 'thing.ren.默认备份仓': '🧊' }
    ])}`
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(writes.length, 0);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

test('batch Transform swaps sibling names from one final-state plan and rewrites relations once', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-batch-rename-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify([
    {
      ...atom('域'),
      contain: [
        { ...atom('甲'), contain: [atom('甲子')] },
        atom('乙'),
        atom('观察者', '', [{ thing: '域/甲/甲子' }])
      ]
    }
  ], null, 2)}\n`, 'utf8');
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    contextFile,
    projectionFile,
    source: `transform ${JSON.stringify([
      { 'thing.ren.乙': '域/甲' },
      { 'thing.ren.甲': '域/乙' }
    ])}`
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1);
  assert.deepEqual(
    result.results.map(({ result: item }) => item.path),
    ['域/乙', '域/甲']
  );
  const [domain] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(domain.contain.map((child) => child.thing), ['乙', '甲', '观察者']);
  assert.equal(domain.contain[0].contain[0].thing, '甲子');
  assert.deepEqual(
    domain.contain[2].support,
    supports('域/乙/甲子')
  );
});

test('batch Transform rejects a final sibling-thing collision without writing any item', async (t) => {
  const files = await fixture(t);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { 'thing.ren.共同名称': '来源甲' },
      { 'thing.ren.共同名称': '来源乙' }
    ])}`
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'DUPLICATE_DESTINATION_CHILD');
  assert.equal(writes.length, 0);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

test('batch receipts preserve the exact path when short names repeat', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-batch-path-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify([
    { ...atom('P1'), contain: [atom('X', '旧一')] },
    { ...atom('P2'), contain: [atom('X', '旧二')] }
  ], null, 2)}\n`, 'utf8');

  const world = createLegacyWorldService();
  const result = await world.executeLegacy({
    contextFile,
    projectionFile,
    source: `transform ${JSON.stringify([
      { thing: 'P2/X', 'support.rep.': supports('P1/X') }
    ])}`
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.results[0].result.path, 'P2/X');
  assert.equal(result.results[0].result.selector, 'P2/X');
});

test('post-batch Program transforms join the same authoritative commit', async (t) => {
  const files = await fixture(t);
  const writes = [];
  let refreshes = 0;
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });
  const scheduler = {
    async refresh() {
      refreshes += 1;
      return refreshes === 2
        ? {
            messages: [], locks: [], records: [], failures: [],
            transforms: [{ thing: '来源乙', 'support.rep.': supports('来源甲') }]
          }
        : { messages: [], locks: [], records: [], transforms: [], failures: [] };
    }
  };

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { thing: '来源甲', 'support.rep.': supports('来源乙') }
    ])}`,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1);
  const [sourceA, sourceB] = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(sourceA.support, supports('来源乙'));
  assert.deepEqual(sourceB.support, supports('来源甲'));
  assert.equal(
    result.revisionAfter,
    crypto.createHash('sha256').update(JSON.stringify([sourceA, sourceB])).digest('hex')
  );
});

test('a single Transform and its Program consequences share one authoritative commit', async (t) => {
  const files = await fixture(t);
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });
  const scheduler = {
    async current() {
      return { messages: [], locks: [], records: [], transforms: [], failures: [] };
    },
    async refresh() {
      return {
        messages: [], locks: [], records: [], failures: [],
        transforms: [{ thing: '来源乙', 'situation.rep.自动乙': null }]
      };
    }
  };

  const result = await world.executeLegacy({
    ...files,
    source: 'transform {"thing":"来源甲","situation.rep.新甲"}',
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1, 'user change and Program consequences form one commit');
  const [sourceA, sourceB] = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(sourceA.situation, '新甲');
  assert.equal(sourceB.situation, '自动乙');
  assert.equal(result.revisionAfter, crypto.createHash('sha256')
    .update(JSON.stringify([sourceA, sourceB])).digest('hex'));
});

test('a real Program creates then updates one new Atom inside the triggering central commit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-update-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    { thing: 'test', situation: '', contain: [], support: [] },
    { thing: 'Trigger', situation: 'wait', contain: [], support: [] },
    {
      'thing@program': 'Create Then Update',
      situation: [
        "trigger = explore({'thing': 'Trigger', 'situation$full': None})[0]",
        "if trigger.situation == 'go':",
        "    transform({'thing': 'test/Created In Reconcile', 'situation': 'created', 'contain': [], 'support': []})",
        "    transform({'thing': 'test/Created In Reconcile', 'situation.rep.final': None})"
      ].join('\n'),
      contain: [],
      support: []
    }
  ], null, 2));
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    contextFile,
    projectionFile,
    source: 'transform {"thing":"Trigger","situation.rep.go"}',
    programMode: 'reconcile',
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1);
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(persisted[0].contain.length, 1, JSON.stringify({ result, persisted }));
  assert.equal(persisted[0].contain[0].thing, 'Created In Reconcile');
  assert.equal(persisted[0].contain[0].situation, 'final');
  assert.equal(result.revisionAfter, crypto.createHash('sha256')
    .update(JSON.stringify(persisted)).digest('hex'));
});

test('a Transform request triggers its declared Program even when the requested value is unchanged', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-trigger-same-value-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    {
      thing: 'test',
      situation: '',
      contain: [
        atom('Target', 'stable'),
        atom('Result', 'pending'),
        {
          'thing@program': 'Target Trigger',
          situation: [
            'def main():',
            "    transform({'thing': 'test/Target Trigger Case/Result', 'situation.rep.fired': None})",
            "trigger('transform', {'nodes': ['test/Target Trigger Case/Target']}, main)"
          ].join('\n'),
          contain: [],
          support: []
        }
      ],
      support: []
    }
  ], null, 2));
  const initial = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  initial[0].contain = [{
    thing: 'Target Trigger Case',
    situation: '',
    contain: initial[0].contain,
    support: []
  }];
  await fs.writeFile(contextFile, JSON.stringify(initial, null, 2));
  const writes = [];
  const world = createLegacyWorldService({
    onAuthoritativeWrite: (write) => writes.push(write)
  });

  const result = await world.executeLegacy({
    contextFile,
    projectionFile,
    source: 'transform {"thing":"test/Target Trigger Case/Target","situation.rep.stable"}',
    programMode: 'reconcile',
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1);
  const persisted = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(persisted[0].contain[0].contain.find(({ thing }) => thing === 'Result').situation, 'fired');
});

test('batch receipt follows a final Program rename in the same commit', async (t) => {
  const files = await fixture(t);
  let refreshes = 0;
  const world = createLegacyWorldService();
  const scheduler = {
    async refresh() {
      refreshes += 1;
      return refreshes === 2
        ? {
            messages: [], locks: [], records: [], failures: [],
            transforms: [{ thing: '来源甲', 'thing.ren.Z': null }]
          }
        : { messages: [], locks: [], records: [], transforms: [], failures: [] };
    }
  };

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { thing: '来源甲', 'support.rep.': supports('来源乙') }
    ])}`,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.results[0].result.path, 'Z');
  assert.equal(result.results[0].result.selector, 'Z');
});
