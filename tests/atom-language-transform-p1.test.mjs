import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { writeAtomGraphProjection } from '../work-engine/atom-language/context-store.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import {
  TRANSFORM_COMMANDS,
  parseTransformKey
} from '../work-engine/atom-language/transform-key-parser.mjs';

function atom(name, detail = '', children = [], partners = []) {
  return { name, detail, children, partners };
}

async function fixture(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-p1-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { directory, contextFile, projectionFile };
}

async function execute(files, source) {
  return executeAtomLanguage({ source, ...files });
}

async function readAtoms(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function findAtom(atoms, name) {
  const queue = [...atoms];
  while (queue.length) {
    const candidate = queue.shift();
    const nameEntry = Object.entries(candidate).find(([rawKey]) => (
      rawKey === 'name' || rawKey.startsWith('name@') || rawKey.startsWith('name#')
    ));
    if (nameEntry?.[1] === name) return candidate;
    const childrenEntry = Object.entries(candidate).find(([rawKey]) => (
      rawKey === 'children'
      || rawKey.startsWith('children@')
      || rawKey.startsWith('children#')
    ));
    queue.push(...(childrenEntry?.[1] ?? []));
  }
  return null;
}

test('Transform P1 freezes one short dot-command registry without aliases', () => {
  assert.deepEqual([...TRANSFORM_COMMANDS], [
    'rep',
    'sum',
    'typ',
    'ren',
    'mov',
    'cpy',
    'dsc',
    'rst',
    'run'
  ]);
});

test('transform dot lexer segments only exact registered .word. markers', () => {
  const parsed = parseTransformKey(
    'detail.rep.新句有 v1.2、#标题与普通句点.sum.新的简介'
  );
  assert.equal(parsed.baseKey, 'detail');
  assert.deepEqual(parsed.commands, [
    { name: 'rep', parameter: '新句有 v1.2、#标题与普通句点' },
    { name: 'sum', parameter: '新的简介' }
  ]);
  assert.equal(parsed.persistentKey, 'detail');
  assert.equal(parsed.errors.length, 0);

  const ordinary = parseTransformKey('detail.v1.2.not-a-command');
  assert.equal(ordinary.baseKey, 'detail.v1.2.not-a-command');
  assert.deepEqual(ordinary.commands, []);
});

test('transform parsing is isolated from unchanged explore $ parsing', async (t) => {
  const files = await fixture(t, [atom('根', '正文', [atom('子')])]);
  const explored = await execute(files, 'explore {"name":"根","children$latitude-1","detail$full"}');
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.deepEqual(explored.items[0].matches.map((item) => item.name), ['根', '子']);
  assert.equal(explored.items[0].matches[0].detail, '正文');

  const rejected = createAtomLanguageReceiver().receive(
    'transform {"name$exact":"根","detail":"不得写入"}'
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.at(-1).code, 'TRANSFORM_DOLLAR_COMMAND_REJECTED');
});

test('detail rep performs local replacement with Value and full replacement without Value', async (t) => {
  const files = await fixture(t, [atom('文档', '旧片段 + 保留内容')]);

  const local = await execute(
    files,
    'transform {"name":"文档","detail.rep.新片段":"旧片段"}'
  );
  assert.equal(local.ok, true, JSON.stringify(local.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '文档').detail, '新片段 + 保留内容');

  const full = await execute(
    files,
    'transform {"name":"文档","detail.rep.全文含中文\\n与 symbols #@$~=."}'
  );
  assert.equal(full.ok, true, JSON.stringify(full.errors));
  assert.equal(
    findAtom(await readAtoms(files.contextFile), '文档').detail,
    '全文含中文\n与 symbols #@$~=.'
  );

  const cleared = await execute(files, 'transform {"name":"文档","detail.rep."}');
  assert.equal(cleared.ok, true, JSON.stringify(cleared.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '文档').detail, '');
});

test('summary, field type, rename, and complete partners replacement strip commands', async (t) => {
  const files = await fixture(t, [
    {
      'name@agent': '甲',
      'detail#旧简介': '正文',
      children: [],
      partners: [{ verb: '旧关系', object: '乙' }]
    },
    atom('乙')
  ]);
  for (const source of [
    'transform {"name":"甲","detail.sum.新简介"}',
    'transform {"name.typ.program":"甲"}',
    'transform {"name.ren.甲新版":"甲"}',
    'transform {"name":"甲新版","partners.rep.":[{"verb":"新关系","object":"乙"}]}'
  ]) {
    const result = await execute(files, source);
    assert.equal(result.ok, true, `${source}\n${JSON.stringify(result.errors)}`);
  }

  const updated = findAtom(await readAtoms(files.contextFile), '甲新版');
  assert.ok(updated);
  assert.equal(updated['name@program'], '甲新版');
  assert.equal(updated['detail#新简介'], '正文');
  assert.deepEqual(updated.partners, [{ verb: '新关系', object: '乙' }]);
  assert.equal(
    JSON.stringify(await readAtoms(files.contextFile)).includes('.rep.'),
    false
  );
});

test('an empty name typ command removes the registration type without changing the name', async (t) => {
  const files = await fixture(t, [{ 'name@agent': 'Window', detail: '', children: [], partners: [] }]);
  const result = await execute(files, 'transform {"name.typ.":"Window"}');

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const updated = findAtom(await readAtoms(files.contextFile), 'Window');
  assert.equal(updated.name, 'Window');
  assert.equal(Object.hasOwn(updated, 'name@agent'), false);
});

test('children only creates or transforms explicitly submitted nodes', async (t) => {
  const files = await fixture(t, [
    atom('父', '', [
      atom('显式子', '旧正文', [atom('未提交后代', '保持原样')]),
      atom('未提交同级', '也保持原样')
    ])
  ]);
  const result = await execute(files, `transform {
    "name": "父",
    "children": [
      {"name":"显式子","detail.rep.新正文"},
      {"name":"新增子","detail":"完整正文","children":[],"partners":[]}
    ]
  }`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const parent = findAtom(await readAtoms(files.contextFile), '父');
  assert.equal(findAtom([parent], '显式子').detail, '新正文');
  assert.equal(findAtom([parent], '未提交后代').detail, '保持原样');
  assert.equal(findAtom([parent], '未提交同级').detail, '也保持原样');
  assert.equal(findAtom([parent], '新增子').detail, '完整正文');
});

test('move, copy, discard, and restore use explicit name-axis commands and reversible log', async (t) => {
  const files = await fixture(t, [
    atom('源父', '', [atom('目标', '正文', [atom('后代', '完整保留')])]),
    atom('目的父'),
    {
      'name@backup@default': '默认备份仓',
      detail: '',
      children: [],
      partners: []
    }
  ]);

  const moved = await execute(files, 'transform {"name.mov.目的父":"目标"}');
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '源父').children.length, 0);
  assert.ok(findAtom(findAtom(await readAtoms(files.contextFile), '目的父').children, '目标'));

  const copied = await execute(files, 'transform {"name.cpy.源父":"目标"}');
  assert.equal(copied.ok, true, JSON.stringify(copied.errors));
  assert.ok(findAtom(findAtom(await readAtoms(files.contextFile), '源父').children, '目标'));

  const discarded = await execute(files, 'transform {"name.dsc.":"目的父/目标"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const backup = findAtom(await readAtoms(files.contextFile), '默认备份仓');
  assert.ok(findAtom(backup.children, '目标'));
  const logFile = path.join(files.directory, 'atom.transform-log.json');
  const log = JSON.parse(await fs.readFile(logFile, 'utf8'));
  assert.equal(log.at(-1).operation, 'discard');
  assert.equal(log.at(-1).target, '目标');
  assert.equal(Object.hasOwn(findAtom(backup.children, '目标'), 'transform_log'), false);

  const restored = await execute(files, 'transform {"name.rst.":"默认备份仓/目标"}');
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.ok(findAtom(findAtom(await readAtoms(files.contextFile), '目的父').children, '目标'));
  assert.equal(findAtom(await readAtoms(files.contextFile), '默认备份仓').children.length, 0);
});

test('Atom to Graph projection preserves long multilingual detail without clipping', async (t) => {
  const longDetail = `${'长正文\n@$~= 工程符号。'.repeat(401)}尾`;
  assert.ok(longDetail.length > 4000);
  const files = await fixture(t, [atom('长正文', longDetail)]);
  await writeAtomGraphProjection(files.projectionFile, [atom('长正文', longDetail)], {
    rootName: path.basename(files.contextFile)
  });
  const graph = parseGraphDocument(JSON.parse(await fs.readFile(files.projectionFile, 'utf8')));
  assert.equal(graph.graph.children[0].detail, longDetail);
});

test('Graph validator and public schema impose no business length caps', async () => {
  const longName = '长名称'.repeat(1500);
  const longVerb = '长关系'.repeat(1500);
  const parsed = parseGraphDocument({
    config: { schema_version: '1.0.0' },
    graph: {
      name: '根',
      detail: '',
      children: [
        {
          name: '来源',
          detail: '',
          children: [],
          partners: [{ verb: longVerb, object: longName }]
        },
        atom(longName)
      ],
      partners: []
    }
  });
  assert.equal(parsed.graph.children[0].partners[0].verb, longVerb);
  assert.equal(parsed.graph.children[0].partners[0].object, longName);

  const schema = JSON.parse(await fs.readFile(
    new URL('../schemas/graph-json-1.0.0.schema.json', import.meta.url),
    'utf8'
  ));
  assert.equal(JSON.stringify(schema).includes('"maxLength"'), false);
});
