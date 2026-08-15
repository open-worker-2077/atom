import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { writeAtomGraphProjection } from '../work-engine/atom-language/context-store.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-explore-full-path-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const atoms = [
    {
      name: '甲区', detail: '甲区正文', partners: [], children: [
        { name: '同名节点', detail: '甲区节点正文', partners: [{ verb: '相邻', object: '甲区/甲末' }], children: [] },
        { name: '甲末', detail: '甲末正文', partners: [], children: [] }
      ]
    },
    {
      name: '乙区', detail: '乙区正文', partners: [], children: [
        { name: '乙前', detail: '乙前正文', partners: [], children: [] },
        { name: '同名节点', detail: '乙区节点正文', partners: [{ verb: '相邻', object: '乙区/乙后' }], children: [] },
        { name: '乙后', detail: '乙后正文', partners: [], children: [] }
      ]
    },
    {
      name: '丙区', detail: '', partners: [], children: [
        { name: '规划', detail: '', partners: [], children: [
          { name: '登记册', detail: '丙区登记册', partners: [], children: [] }
        ] }
      ]
    },
    {
      name: '丁区', detail: '', partners: [], children: [
        { name: '执行', detail: '', partners: [], children: [
          { name: '登记册', detail: '丁区登记册', partners: [], children: [] }
        ] }
      ]
    }
  ];
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  await writeAtomGraphProjection(projectionFile, atoms, { rootName: path.basename(contextFile) });
  return { contextFile, projectionFile };
}

function names(result) {
  return result.items[0].matches.map((match) => match.name);
}

async function runCli(files, source) {
  let stdout = '';
  let stderr = '';
  const code = await runAtomCli([
    '--context', files.contextFile,
    '--projection', files.projectionFile,
    ...source
  ], {
    execute: executeAtomLanguage,
    stdin: { isTTY: false },
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });
  return { code, stdout, stderr };
}

test('explore exact supports top-level business Atom full paths without mutating context or projection', async (t) => {
  const files = await fixture(t);
  const contextBefore = await fs.readFile(files.contextFile, 'utf8');
  const projectionBefore = await fs.readFile(files.projectionFile, 'utf8');

  const fullDetail = await executeAtomLanguage({
    source: 'explore {"name":"乙区/同名节点","detail$full"}', ...files
  });
  assert.equal(fullDetail.ok, true, JSON.stringify(fullDetail.errors));
  assert.deepEqual(names(fullDetail), ['同名节点']);
  assert.equal(fullDetail.items[0].matches[0].path, '乙区/同名节点');
  assert.equal(fullDetail.items[0].matches[0].detail, '乙区节点正文');

  const scopes = [
    ['children$latitude1', ['乙区', '同名节点']],
    ['children$latitude-1', ['同名节点']],
    ['children$longitude-1', ['乙前', '同名节点']],
    ['children$longitude1', ['同名节点', '乙后']]
  ];
  for (const [scope, expected] of scopes) {
    const result = await executeAtomLanguage({
      source: `explore {"name":"乙区/同名节点","${scope}"}`,
      ...files
    });
    assert.equal(result.ok, true, `${scope}: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(names(result), expected, scope);
  }

  const merged = await executeAtomLanguage({
    source: 'explore {"name":"乙区/同名节点","children$latitude1","children$longitude-1","children$longitude1"}',
    ...files
  });
  assert.equal(merged.ok, true, JSON.stringify(merged.errors));
  assert.deepEqual(names(merged), ['乙区', '乙前', '同名节点', '乙后']);
  assert.equal(new Set(merged.items[0].matches.map((match) => match.path)).size, 4);

  assert.equal(await fs.readFile(files.contextFile, 'utf8'), contextBefore);
  assert.equal(await fs.readFile(files.projectionFile, 'utf8'), projectionBefore);
  assert.equal(hash(await fs.readFile(files.contextFile, 'utf8')), hash(contextBefore));
  assert.equal(hash(await fs.readFile(files.projectionFile, 'utf8')), hash(projectionBefore));
  assert.equal(fullDetail.revisionBefore, fullDetail.revisionAfter);
});

test('explore full path remains exact while short-name ambiguity and virtual roots are rejected', async (t) => {
  const files = await fixture(t);
  const cases = [
    ['explore {"name":"同名节点","detail$full"}', 'AMBIGUOUS_ATOM_NAME'],
    ['explore {"name":"丙区/同名节点","detail$full"}', 'ATOM_NOT_FOUND'],
    ['explore {"name":"atom.json/乙区/同名节点","detail$full"}', 'ATOM_NOT_FOUND']
  ];
  for (const [source, code] of cases) {
    const result = await executeAtomLanguage({ source, ...files });
    assert.equal(result.ok, false, source);
    assert.equal(result.errors[0].code, code, JSON.stringify(result.errors));
  }
});

test('explore partners returns the stored directed relation body through the CLI', async (t) => {
  const files = await fixture(t);
  const contextBefore = await fs.readFile(files.contextFile, 'utf8');
  const projectionBefore = await fs.readFile(files.projectionFile, 'utf8');

  const result = await runCli(files, [
    'explore', '{"name":"乙区/同名节点","partners"}'
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /"partners"/u);
  assert.match(result.stdout, /"verb"\s*:\s*"相邻"/u);
  assert.match(result.stdout, /"object"\s*:\s*"乙区\/乙后"/u);
  assert.equal(hash(await fs.readFile(files.contextFile, 'utf8')), hash(contextBefore));
  assert.equal(hash(await fs.readFile(files.projectionFile, 'utf8')), hash(projectionBefore));
});

test('explore accepts standard JSON true values for read projections', async (t) => {
  const files = await fixture(t);
  const result = await executeAtomLanguage({
    source: 'explore {"name":"乙区/同名节点","detail$full":true,"children$latitude+1":true,"children$longitude+1":true,"partners":true}',
    ...files
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(names(result), ['乙区', '同名节点', '乙后']);
  assert.equal(result.items[0].matches[1].detail, '乙区节点正文');
  assert.deepEqual(result.items[0].matches[1].partners, [{ verb: '相邻', object: '乙区/乙后' }]);
});

test('CLI preserves descendant containment and uses only the shortest distinguishing selector', async (t) => {
  const files = await fixture(t);
  const result = await runCli(files, [
    'explore', '{"name":"丙区","children$latitude-2":true,"detail$full":true}'
  ]);
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.name, '丙区');
  assert.equal(parsed.children[0].name, '规划');
  assert.equal(parsed.children[0].children[0].name, '规划/登记册');
  assert.equal(parsed.children[0].children[0].detail, '丙区登记册');
});

test('exact selectors use the shortest unique path suffix for reads and writes', async (t) => {
  const files = await fixture(t);
  const ambiguous = await executeAtomLanguage({
    source: 'explore {"name":"登记册","detail$full"}', ...files
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.errors[0].code, 'AMBIGUOUS_ATOM_NAME');

  const explored = await executeAtomLanguage({
    source: 'explore {"name":"规划/登记册","detail$full"}', ...files
  });
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.equal(explored.items[0].matches[0].path, '丙区/规划/登记册');
  assert.equal(explored.items[0].matches[0].detail, '丙区登记册');

  const transformed = await executeAtomLanguage({
    source: 'transform {"name":"规划/登记册","detail.rep.已核验"}', ...files
  });
  assert.equal(transformed.ok, true, JSON.stringify(transformed.errors));
  const verified = await executeAtomLanguage({
    source: 'explore {"name":"规划/登记册","detail$full"}', ...files
  });
  assert.equal(verified.items[0].matches[0].detail, '已核验');
});

test('transform new creates a nested Atom by exact parent path without replacing siblings', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-nested-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    { name: 'Root', detail: '', children: [{ name: 'Existing', detail: 'keep', children: [], partners: [] }], partners: [] }
  ], null, 2));

  const result = await executeAtomLanguage({
    source: 'transform new {"name":"Root/New","detail":"created","children":[],"partners":[]}',
    contextFile,
    projectionFile
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(world[0].children.map((child) => child.name), ['Existing', 'New']);
  assert.equal(world[0].children[1].detail, 'created');
});

test('CLI full-path success and rejection receipts are exact and read-only', async (t) => {
  const files = await fixture(t);
  const contextBefore = await fs.readFile(files.contextFile, 'utf8');
  const projectionBefore = await fs.readFile(files.projectionFile, 'utf8');

  for (const [businessPath, expected, excluded] of [
    ['甲区/同名节点', '甲区节点正文', '乙区节点正文'],
    ['乙区/同名节点', '乙区节点正文', '甲区节点正文']
  ]) {
    const result = await runCli(files, [
      'explore', `{"name":"${businessPath}","detail$full"}`
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(expected, 'u'));
    assert.doesNotMatch(result.stdout, new RegExp(excluded, 'u'));
    assert.equal(result.stderr, '');
  }

  for (const [selector, code] of [
    ['同名节点', 'AMBIGUOUS_ATOM_NAME'],
    ['丙区/同名节点', 'ATOM_NOT_FOUND'],
    ['atom.json/乙区/同名节点', 'ATOM_NOT_FOUND']
  ]) {
    const result = await runCli(files, [
      'explore', `{"name":"${selector}","detail$full"}`
    ]);
    assert.equal(result.code, 4, selector);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(code, 'u'));
  }

  assert.equal(hash(await fs.readFile(files.contextFile, 'utf8')), hash(contextBefore));
  assert.equal(hash(await fs.readFile(files.projectionFile, 'utf8')), hash(projectionBefore));
});
