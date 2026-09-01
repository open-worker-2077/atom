import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import {
  createShortcutAtom,
  shortcutMetadata
} from '../work-engine/atom-language/shortcut-runtime.mjs';

function atom(thing, situation = '', slot = [], strut = []) {
  const normalizedStrut = strut.length && strut.every((item) => Object.keys(item).length === 1 && item.thing)
    ? [{ 'if@current': true, then: strut }]
    : strut;
  return { thing, situation, slot, strut: normalizedStrut };
}

async function fixture(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-transform-p2-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

async function execute(files, source) {
  return executeAtomLanguage({ source, ...files });
}

async function readAtoms(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function namedField(atomValue, baseKey) {
  return Object.entries(atomValue).find(([rawKey]) => (
    rawKey === baseKey
    || rawKey.startsWith(`${baseKey}@`)
    || rawKey.startsWith(`${baseKey}#`)
  ))?.[1];
}

function findByPath(atoms, selector) {
  let current = { slot: atoms };
  for (const segment of selector.split('/')) {
    current = namedField(current, 'slot')
      .find((candidate) => namedField(candidate, 'thing') === segment);
    if (!current) return null;
  }
  return current;
}

function partnersOf(atomValue) {
  return namedField(atomValue, 'strut').flatMap((rule) => rule.then ?? []);
}

test('complete Atom paths precisely select duplicate names', async (t) => {
  const files = await fixture(t, [
    atom('左', '', [atom('同名', '左正文')]),
    atom('右', '', [atom('同名', '右正文')])
  ]);
  const result = await execute(
    files,
    'transform {"thing":"左/同名","situation.rep.只改左边"}'
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const atoms = await readAtoms(files.contextFile);
  assert.equal(namedField(findByPath(atoms, '左/同名'), 'situation'), '只改左边');
  assert.equal(namedField(findByPath(atoms, '右/同名'), 'situation'), '右正文');
});

test('rename preserves sibling and cross-tree partner targets', async (t) => {
  const files = await fixture(t, [
    atom('甲', '', [
      atom('目标'),
      atom('同级来源', '', [], [{ thing: '目标' }])
    ]),
    atom('乙', '', [
      atom('目标'),
      atom('跨树来源', '', [], [{ thing: '甲/目标' }])
    ])
  ]);
  const renamed = await execute(
    files,
    'transform {"thing.ren.新目标":"甲/目标"}'
  );
  assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
  assert.deepEqual(renamed.affectedPaths, [
    '乙',
    '乙/跨树来源',
    '甲',
    '甲/同级来源',
    '甲/新目标',
    '甲/目标'
  ]);
  const atoms = await readAtoms(files.contextFile);
  assert.equal(partnersOf(findByPath(atoms, '甲/同级来源'))[0].thing, '新目标');
  assert.equal(partnersOf(findByPath(atoms, '乙/跨树来源'))[0].thing, '甲/新目标');
  const projection = JSON.parse(await fs.readFile(files.projectionFile, 'utf8'));
  assert.equal(
    projection.graph.slot[1].slot[1].strut[0].then[0].thing,
    'atom.json/甲/新目标'
  );
});

test('move rewrites affected paths while keeping internal subtree relations local', async (t) => {
  const files = await fixture(t, [
    atom('甲', '', [
      atom('分支', '', [
        atom('叶'),
        atom('内部来源', '', [], [{ thing: '叶' }])
      ]),
      atom('原同级来源', '', [], [{ thing: '分支' }])
    ]),
    atom('乙', '', [
      atom('新同级来源', '', [], [{ thing: '甲/分支' }]),
      atom('深层来源', '', [], [{ thing: '甲/分支/叶' }])
    ])
  ]);
  const moved = await execute(files, 'transform {"thing.mov.乙":"甲/分支"}');
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.deepEqual(moved.affectedPaths, [
    '乙',
    '乙/分支',
    '乙/分支/内部来源',
    '乙/分支/叶',
    '乙/新同级来源',
    '乙/深层来源',
    '甲',
    '甲/分支',
    '甲/分支/内部来源',
    '甲/分支/叶'
  ]);
  const atoms = await readAtoms(files.contextFile);
  assert.equal(partnersOf(findByPath(atoms, '甲/原同级来源'))[0].thing, '分支');
  assert.equal(partnersOf(findByPath(atoms, '乙/新同级来源'))[0].thing, '乙/分支');
  assert.equal(partnersOf(findByPath(atoms, '乙/深层来源'))[0].thing, '乙/分支/叶');
  assert.equal(partnersOf(findByPath(atoms, '乙/分支/内部来源'))[0].thing, '叶');
});

test('discard and restore keep external relations bound to the same Atom', async (t) => {
  const files = await fixture(t, [
    atom('甲', '', [atom('目标')]),
    atom('来源', '', [], [{ thing: '甲/目标' }]),
    {
      'thing@backup@default': '默认备份仓',
      situation: '',
      slot: [],
      strut: []
    }
  ]);
  const discarded = await execute(files, 'transform {"thing.dsc.":"甲/目标"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  let atoms = await readAtoms(files.contextFile);
  assert.equal(
    partnersOf(findByPath(atoms, '来源'))[0].thing,
    '默认备份仓/目标'
  );

  const restored = await execute(
    files,
    'transform {"thing.rst.":"默认备份仓/目标"}'
  );
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  atoms = await readAtoms(files.contextFile);
  assert.equal(partnersOf(findByPath(atoms, '来源'))[0].thing, '甲/目标');
});

test('restore recovers a discarded subtree with strut and shortcut references intact', async (t) => {
  const files = await fixture(t, [
    atom('Synthetic East', '', [
      atom('Duplicate', 'payload', [atom('Leaf', 'nested')], [{ thing: 'Leaf' }])
    ]),
    atom('Synthetic Source', '', [], [{ thing: 'Synthetic East/Duplicate' }]),
    atom('Synthetic References', '', [createShortcutAtom({
      thing: 'Duplicate Link',
      targetPath: 'Synthetic East/Duplicate',
      referenceId: 'synthetic-duplicate-link'
    })]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      slot: [],
      strut: []
    }
  ]);

  const discarded = await execute(files, 'transform {"thing.dsc.":"Synthetic East/Duplicate"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  let world = await readAtoms(files.contextFile);
  assert.equal(partnersOf(findByPath(world, 'Synthetic Source'))[0].thing, discarded.result.path);
  assert.equal(
    shortcutMetadata(findByPath(world, 'Synthetic References/Duplicate Link')).target.state,
    'broken'
  );

  const restored = await execute(
    files,
    `transform {"thing.rst.":${JSON.stringify(discarded.result.path)}}`
  );
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  world = await readAtoms(files.contextFile);
  const target = findByPath(world, 'Synthetic East/Duplicate');
  assert.equal(namedField(target, 'situation'), 'payload');
  assert.equal(namedField(findByPath(world, 'Synthetic East/Duplicate/Leaf'), 'situation'), 'nested');
  assert.equal(partnersOf(target)[0].thing, 'Leaf');
  assert.equal(partnersOf(findByPath(world, 'Synthetic Source'))[0].thing, 'Synthetic East/Duplicate');
  assert.deepEqual(
    shortcutMetadata(findByPath(world, 'Synthetic References/Duplicate Link')).target,
    { state: 'linked', path: 'Synthetic East/Duplicate' }
  );
});

test('copy preserves original bindings and redirects copied internal relations', async (t) => {
  const files = await fixture(t, [
    atom('甲', '', [
      atom('分支', '', [
        atom('叶'),
        atom('内部来源', '', [], [{ thing: '叶' }])
      ])
    ]),
    atom('乙', '', [
      atom('外部来源', '', [], [{ thing: '甲/分支' }])
    ])
  ]);
  const copied = await execute(files, 'transform {"thing.cpy.乙":"甲/分支"}');
  assert.equal(copied.ok, true, JSON.stringify(copied.errors));
  const atoms = await readAtoms(files.contextFile);
  assert.equal(partnersOf(findByPath(atoms, '乙/外部来源'))[0].thing, '甲/分支');
  assert.equal(
    partnersOf(findByPath(atoms, '乙/分支/内部来源'))[0].thing,
    '叶'
  );

  const original = await execute(
    files,
    'transform {"thing":"甲/分支","situation.rep.原件"}'
  );
  const duplicate = await execute(
    files,
    'transform {"thing":"乙/分支","situation.rep.副本"}'
  );
  assert.equal(original.ok, true, JSON.stringify(original.errors));
  assert.equal(duplicate.ok, true, JSON.stringify(duplicate.errors));
});

test('copy and move reject destination sibling collisions without changing files', async (t) => {
  const files = await fixture(t, [
    atom('甲', '', [atom('同名')]),
    atom('乙', '', [atom('同名')])
  ]);
  for (const source of [
    'transform {"thing.cpy.乙":"甲/同名"}',
    'transform {"thing.mov.乙":"甲/同名"}',
    'transform {"thing.ren.乙":"甲"}'
  ]) {
    const before = await fs.readFile(files.contextFile, 'utf8');
    const result = await execute(files, source);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'DUPLICATE_DESTINATION_CHILD');
    assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
  }
});
