import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { applyTransform } from '../work-engine/atom-language/transform-executor.mjs';

function fieldByBase(item, baseKey) {
  return item.fields.find((field) => field.baseKey === baseKey);
}

function atom(thing, situation = '', contain = []) {
  return { thing, situation, contain, support: [] };
}

test('a non-structural Transform copies only the target ancestry', async () => {
  const untouched = atom('Untouched', 'stable', [atom('Untouched Child', 'stable')]);
  const target = atom('Target', 'before');
  const branch = atom('Branch', '', [target]);
  const atoms = [untouched, branch];
  const parsed = createAtomLanguageReceiver().receive(
    'transform {"thing":"Branch/Target","situation.rep.after"}'
  );

  const result = await applyTransform({
    atoms,
    item: parsed.items[0],
    contextFile: 'atom.json'
  });

  assert.equal(result.atoms[0], untouched);
  assert.notEqual(result.atoms[1], branch);
  assert.notEqual(result.atoms[1].contain[0], target);
  assert.equal(result.atoms[1].contain[0].situation, 'after');
  assert.equal(target.situation, 'before');
});

test('a non-structural Transform does not serialize the untouched target subtree', async () => {
  const children = [atom('Large Child', 'x'.repeat(10_000))];
  const target = atom('Target', 'before', children);
  const parsed = createAtomLanguageReceiver().receive(
    'transform {"thing":"Target","situation.rep.after"}'
  );
  const stringify = JSON.stringify;
  JSON.stringify = (value, ...options) => {
    if (value?.contain === children) throw new Error('target subtree was serialized');
    return stringify(value, ...options);
  };

  try {
    const result = await applyTransform({
      atoms: [target],
      item: parsed.items[0],
      contextFile: 'atom.json'
    });
    assert.equal(result.atoms[0].situation, 'after');
    assert.equal(target.situation, 'before');
  } finally {
    JSON.stringify = stringify;
  }
});

test('transform reuses Graph-JSON and key normalization without executing a change', () => {
  const result = createAtomLanguageReceiver().receive(`
    transform {
      "thing": "石器工坊",
      "situation#工坊简介": "更新后的正文"
    }
  `);

  assert.equal(result.ok, true);
  assert.equal(result.command, 'transform');
  assert.equal(result.createNew, false);
  assert.equal(result.newExploration, false);
  assert.equal(result.batch, false);
  assert.equal(result.items.length, 1);
  assert.deepEqual(fieldByBase(result.items[0], 'thing').matcher, {
    mode: 'exact',
    explicit: false,
    registered: true
  });
  const situation = fieldByBase(result.items[0], 'situation');
  assert.equal(situation.description, '工坊简介');
  assert.equal(situation.valuePresent, true);
  assert.equal(situation.value, '更新后的正文');
  assert.equal(Object.hasOwn(result, 'revision'), false);
  assert.equal(Object.hasOwn(result, 'changed'), false);
});

test('transform new is marked explicitly while preserving persistent key metadata', () => {
  const result = createAtomLanguageReceiver().receive(`
    transform new {
      "thing@program": "工坊程序",
      "situation#首轮程序": "正文",
      "contain": [],
      "support": []
    }
  `);

  assert.equal(result.ok, true);
  assert.equal(result.command, 'transform');
  assert.equal(result.createNew, true);
  assert.equal(result.newExploration, false);
  assert.equal(result.items.length, 1);
  assert.equal(fieldByBase(result.items[0], 'thing').persistentKey, 'thing@program');
  assert.equal(fieldByBase(result.items[0], 'situation').persistentKey, 'situation#首轮程序');
});

test('transform batch normalizes each item and keeps item-local errors', () => {
  const result = createAtomLanguageReceiver().receive(`
    transform [
      {"thing":"石器工坊","situation":"新正文"},
      {"thing":"河岸","situation$invent"}
    ]
  `);

  assert.equal(result.command, 'transform');
  assert.equal(result.createNew, false);
  assert.equal(result.batch, true);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.ok), [true, false]);
  assert.equal(fieldByBase(result.items[0], 'situation').value, '新正文');
  assert.equal(
    result.items[1].errors.at(-1).code,
    'TRANSFORM_DOLLAR_COMMAND_REJECTED'
  );
});

test('transform parse failures retain command and create-new intent', () => {
  const result = createAtomLanguageReceiver().receive('transform new {"thing":');

  assert.equal(result.ok, false);
  assert.equal(result.command, 'transform');
  assert.equal(result.createNew, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.errors[0].code, 'INVALID_GRAPH_JSON');
});

test('explore new keeps its existing exploration-reset meaning', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore new {"thing":"河岸"}'
  );

  assert.equal(result.ok, true);
  assert.equal(result.command, 'explore');
  assert.equal(result.newExploration, true);
  assert.equal(result.items.length, 1);
});

test('unknown command diagnostics list the recognized transform forms', () => {
  const result = createAtomLanguageReceiver().receive('move {"thing":"石器工坊"}');

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'UNKNOWN_ATOM_LANGUAGE_COMMAND');
  assert.match(result.errors[0].message, /transform/);
  assert.match(result.errors[0].message, /transform new/);
});
