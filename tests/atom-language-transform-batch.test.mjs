import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';

function atom(name, detail = '', partners = []) {
  return { name, detail, children: [], partners };
}

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
      { name: '来源甲', 'partners.rep.': [{ verb: '先导', object: '来源乙' }] },
      { name: '来源乙', 'partners.rep.': [{ verb: '支持', object: '来源甲' }] }
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
      name: item.name
    })),
    [
      { index: 0, changed: true, name: '来源甲' },
      { index: 1, changed: true, name: '来源乙' }
    ]
  );
  assert.equal(writes.length, 1, 'the whole batch is one authoritative commit');
  assert.equal(refreshes, 2, 'Programs refresh once before and once after the batch, not per item');

  const [sourceA, sourceB] = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(sourceA.partners, [{ verb: '先导', object: '来源乙' }]);
  assert.deepEqual(sourceB.partners, [{ verb: '支持', object: '来源甲' }]);
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
      { name: '来源甲', 'partners.rep.': [{ verb: '先导', object: '来源乙' }] },
      { name: '不存在', 'partners.rep.': [] }
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
    { name: '来源甲', 'partners.rep.': [{ verb: '先导', object: '来源乙' }] },
    { name: '来源乙', 'partners.rep.': [{ verb: '支持', object: '来源甲' }] }
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
    { 'name~updated': '来源甲' },
    { 'name~updated': '来源乙' }
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
      { 'name.mov.目标域': '来源甲' },
      { 'name.mov.目标域': '来源乙' }
    ])}`
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.batch, true);
  assert.equal(writes.length, 1);
  const current = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(current.map((item) => item.name), ['目标域']);
  assert.deepEqual(current[0].children.map((item) => item.name), ['来源甲', '来源乙']);
});

test('batch receipts preserve the exact path when short names repeat', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-batch-path-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify([
    { ...atom('P1'), children: [atom('X', '旧一')] },
    { ...atom('P2'), children: [atom('X', '旧二')] }
  ], null, 2)}\n`, 'utf8');

  const world = createLegacyWorldService();
  const result = await world.executeLegacy({
    contextFile,
    projectionFile,
    source: `transform ${JSON.stringify([
      { name: 'P2/X', 'partners.rep.': [{ verb: '精确', object: 'P1/X' }] }
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
            transforms: [{ name: '来源乙', 'partners.rep.': [{ verb: '自动', object: '来源甲' }] }]
          }
        : { messages: [], locks: [], records: [], transforms: [], failures: [] };
    }
  };

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { name: '来源甲', 'partners.rep.': [{ verb: '批量', object: '来源乙' }] }
    ])}`,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1);
  const [sourceA, sourceB] = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(sourceA.partners, [{ verb: '批量', object: '来源乙' }]);
  assert.deepEqual(sourceB.partners, [{ verb: '自动', object: '来源甲' }]);
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
        transforms: [{ name: '来源乙', 'detail.rep.自动乙': null }]
      };
    }
  };

  const result = await world.executeLegacy({
    ...files,
    source: 'transform {"name":"来源甲","detail.rep.新甲"}',
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(writes.length, 1, 'user change and Program consequences form one commit');
  const [sourceA, sourceB] = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(sourceA.detail, '新甲');
  assert.equal(sourceB.detail, '自动乙');
  assert.equal(result.revisionAfter, crypto.createHash('sha256')
    .update(JSON.stringify([sourceA, sourceB])).digest('hex'));
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
            transforms: [{ name: '来源甲', 'name.ren.Z': null }]
          }
        : { messages: [], locks: [], records: [], transforms: [], failures: [] };
    }
  };

  const result = await world.executeLegacy({
    ...files,
    source: `transform ${JSON.stringify([
      { name: '来源甲', 'partners.rep.': [{ verb: '批量', object: '来源乙' }] }
    ])}`,
    programScheduler: scheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.results[0].result.path, 'Z');
  assert.equal(result.results[0].result.selector, 'Z');
});
