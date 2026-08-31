import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createAtomLanguageReceiver,
  createMatcherRegistry,
  formatGraphJson,
  mergePersistentAtom,
  parseGraphJson,
  runAtomCli,
  writeAtomJson
} from '../work-engine/atom-language/index.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function field(item, rawKey) {
  return item.fields.find((candidate) => candidate.rawKey === rawKey);
}

function fieldByBase(item, baseKey) {
  return item.fields.find((candidate) => candidate.baseKey === baseKey);
}

async function runCli(args = []) {
  let stdout = '';
  let stderr = '';
  const code = await runAtomCli(['--json', ...args], {
    execute: executeAtomLanguage,
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });
  return { code, stdout, stderr };
}

test('Graph-JSON result formatting preserves decorated and absent-Value keys', () => {
  const value = {
    kind: 'object',
    entries: [
      {
        key: 'thing@program~updated',
        valuePresent: true,
        value: '石器工坊'
      },
      {
        key: 'situation#简介中的 @/$/~ 都是原文',
        valuePresent: false
      }
    ]
  };
  const text = formatGraphJson(value);
  assert.equal(text, `{
  "thing@program~updated": "石器工坊",
  "situation#简介中的 @/$/~ 都是原文"
}`);
  assert.deepEqual(parseGraphJson(text), value);
});

test('Graph-JSON display formatting omits only explicitly empty contain and support', () => {
  const empty = { kind: 'array', values: [] };
  const child = {
    kind: 'object',
    entries: [{ key: 'thing', valuePresent: true, value: '子节点' }]
  };
  const value = {
    kind: 'object',
    entries: [
      { key: 'thing', valuePresent: true, value: '入口' },
      { key: 'contain', valuePresent: true, value: { kind: 'array', values: [child] } },
      { key: 'support', valuePresent: true, value: empty },
      { key: 'contain~truncated', valuePresent: false }
    ]
  };

  assert.match(formatGraphJson(value), /"support": \[\]/u);
  const text = formatGraphJson(value, { omitEmptyStructuralArrays: true });

  assert.match(text, /"contain": \[/u);
  assert.doesNotMatch(text, /"support"/u);
  assert.match(text, /"contain~truncated"/u);
  assert.deepEqual(formatGraphJson({
    kind: 'object',
    entries: [
      { key: 'contain', valuePresent: true, value: empty },
      { key: 'support', valuePresent: true, value: empty }
    ]
  }, { omitEmptyStructuralArrays: true }), '{}');
});

test('1. atom is the registered Atom Language entry and the package CLI thing', async () => {
  const receiver = createAtomLanguageReceiver();
  const entry = receiver.receive('atom');
  assert.equal(entry.ok, true);
  assert.equal(entry.language, 'atom');
  assert.equal(entry.kind, 'entry');
  assert.equal(entry.command, 'atom');
  assert.deepEqual(entry.items, []);

  const packageDocument = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageDocument.bin.atom, 'work-engine/atom-language/cli.mjs');
  assert.equal(
    packageDocument.scripts.start,
    'node work-engine/atom-language/graph-server.mjs',
    'the canonical human entry must start the 4784 Atom Graph'
  );

  const cli = await runCli();
  assert.equal(cli.code, 0, cli.stderr);
  const cliGraph = parseGraphJson(cli.stdout);
  assert.equal(cliGraph.kind, 'object');
  assert.equal(cliGraph.entries[0].key, 'atom~ready');
  assert.equal(cliGraph.entries[0].valuePresent, false);
});

test('2. explore recognizes the complete first-round request', () => {
  const result = createAtomLanguageReceiver().receive(`
    explore {
      "thing": "石器工坊",
      "situation$full",
      "contain$latitude2$latitude-3$longitude-4$longitude4"
    }
  `);
  assert.equal(result.ok, true);
  assert.equal(result.command, 'explore');
  assert.equal(result.newExploration, false);
  assert.equal(result.batch, false);
  assert.equal(result.items.length, 1);
  assert.deepEqual(
    fieldByBase(result.items[0], 'contain').actions.map(({ name, parameter }) => ({ name, parameter })),
    [
      { name: 'latitude', parameter: 2 },
      { name: 'latitude', parameter: -3 },
      { name: 'longitude', parameter: -4 },
      { name: 'longitude', parameter: 4 }
    ]
  );
});

test('3. explore new starts a new exploration line, not a new World', () => {
  const result = createAtomLanguageReceiver().receive('explore new {"thing":"河岸"}');
  assert.equal(result.ok, true);
  assert.equal(result.command, 'explore');
  assert.equal(result.newExploration, true);
  assert.equal(Object.hasOwn(result, 'world'), false);
  assert.equal(Object.hasOwn(result, 'createWorld'), false);
});

test('4. ordinary strict JSON remains valid input', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore {"thing":"石器工坊","situation":null,"contain":[],"support":[]}'
  );
  assert.equal(result.ok, true);
  assert.equal(result.items[0].fields.length, 4);
  assert.equal(fieldByBase(result.items[0], 'thing').value, '石器工坊');
  assert.equal(fieldByBase(result.items[0], 'situation').value, null);
});

test('5. Graph-JSON accepts keys whose Value is absent', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore {"situation$full","contain$latitude-2"}'
  );
  assert.equal(result.ok, true);
  for (const parsed of result.items[0].fields) {
    assert.equal(parsed.valuePresent, false);
    assert.equal(Object.hasOwn(parsed, 'value'), false);
  }

  const nested = createAtomLanguageReceiver().receive(
    'explore {"contain":[{"thing":"子节点","situation$full"}]}'
  );
  const nestedObject = fieldByBase(nested.items[0], 'contain').value[0];
  assert.equal(nestedObject.kind, 'graph-object');
  const nestedDetail = fieldByBase(nestedObject, 'situation');
  assert.equal(nestedDetail.valuePresent, false);
  assert.equal(nestedDetail.actions[0].name, 'full');
});

test('6. absent Value, null, empty string, and an absent key stay distinct', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore {"situation$full","thing":null,"contain":""}'
  );
  const item = result.items[0];
  const situation = fieldByBase(item, 'situation');
  const thing = fieldByBase(item, 'thing');
  const contain = fieldByBase(item, 'contain');
  assert.equal(situation.valuePresent, false);
  assert.equal(Object.hasOwn(situation, 'value'), false);
  assert.equal(thing.valuePresent, true);
  assert.equal(thing.value, null);
  assert.equal(contain.valuePresent, true);
  assert.equal(contain.value, '');
  assert.equal(fieldByBase(item, 'support'), undefined);
});

test('7. the first # terminates engineering-symbol execution', () => {
  const rawKey = 'situation#简介中的@custom$full~more438';
  const result = createAtomLanguageReceiver().receive(`explore {${JSON.stringify(rawKey)}}`);
  const parsed = field(result.items[0], rawKey);
  assert.equal(result.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.types, []);
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.hints, []);
  assert.equal(parsed.descriptionPresent, true);
  assert.equal(parsed.description, '简介中的@custom$full~more438');
  assert.equal(parsed.persistentKey, rawKey);
});

test('8. symbols after # produce a warning that can be disabled without changing parsing', () => {
  const rawKey = 'situation#简介中的@custom$full~more438';
  const source = `explore {${JSON.stringify(rawKey)}}`;
  const warned = createAtomLanguageReceiver().receive(source);
  assert.equal(warned.items[0].warnings[0].code, 'DESCRIPTION_NOT_LAST');
  assert.match(warned.items[0].warnings[0].message, /简介应放在最后/);

  const quiet = createAtomLanguageReceiver({
    descriptionSymbolWarnings: false
  }).receive(source);
  assert.deepEqual(quiet.items[0].warnings, []);
  const withoutWarnings = (fields) => fields.map(({ warnings, ...parsed }) => parsed);
  assert.deepEqual(
    withoutWarnings(quiet.items[0].fields),
    withoutWarnings(warned.items[0].fields)
  );
});

test('9. the left side of # is split and dispatched by @, $, and ~', () => {
  const rawKey = 'thing@program$exact~hidden12#石器工坊窗口';
  const result = createAtomLanguageReceiver().receive(
    `explore {${JSON.stringify(rawKey)}:"窗口一"}`
  );
  const parsed = field(result.items[0], rawKey);
  assert.deepEqual(
    parsed.types.map(({ name, parameter }) => ({ name, parameter })),
    [{ name: 'program', parameter: null }]
  );
  assert.deepEqual(
    parsed.actions.map(({ name, parameter }) => ({ name, parameter })),
    [{ name: 'exact', parameter: null }]
  );
  assert.deepEqual(
    parsed.hints.map(({ name, parameter }) => ({ name, parameter })),
    [{ name: 'hidden', parameter: 12 }]
  );
  assert.equal(parsed.description, '石器工坊窗口');
  assert.equal(parsed.value, '窗口一');
});

test('10. latitude-2 becomes a signed coordinate action', () => {
  const result = createAtomLanguageReceiver().receive('explore {"contain$latitude-2"}');
  const action = fieldByBase(result.items[0], 'contain').actions[0];
  assert.equal(result.ok, true);
  assert.equal(action.name, 'latitude');
  assert.equal(action.parameter, -2);
  assert.equal(typeof action.parameter, 'number');
});

test('11. plain thing uses the registered exact matcher by default', () => {
  const result = createAtomLanguageReceiver().receive('explore {"thing":"石器工坊"}');
  assert.equal(result.ok, true);
  assert.deepEqual(fieldByBase(result.items[0], 'thing').matcher, {
    mode: 'exact',
    explicit: false,
    registered: true
  });
});

test('12. thing$exact explicitly uses the same registered exact matcher', () => {
  const result = createAtomLanguageReceiver().receive('explore {"thing$exact":"石器工坊"}');
  assert.equal(result.ok, true);
  assert.deepEqual(fieldByBase(result.items[0], 'thing').matcher, {
    mode: 'exact',
    explicit: true,
    registered: true
  });
});

test('13. reserved match modes use one registry and stay unsupported by default', () => {
  const matcherRegistry = createMatcherRegistry();
  assert.equal(matcherRegistry.has('exact'), true);
  assert.equal(matcherRegistry.resolve('exact').match('石器工坊', '石器工坊'), true);
  assert.equal(matcherRegistry.resolve('exact').match('石器工坊', '河岸'), false);
  for (const mode of ['fuzzy', 'regex', 'vector']) {
    assert.equal(matcherRegistry.has(mode), false);
    const result = createAtomLanguageReceiver({ matcherRegistry }).receive(
      `explore {"thing$${mode}":"石器工坊"}`
    );
    const parsed = fieldByBase(result.items[0], 'thing');
    assert.equal(result.ok, false);
    assert.equal(result.items[0].ok, false);
    assert.equal(parsed.matcher.mode, mode);
    assert.equal(parsed.matcher.registered, false);
    assert.equal(parsed.matcher.mode === 'exact', false);
    assert.equal(parsed.errors[0].code, 'UNSUPPORTED_MATCHER');
    assert.match(parsed.errors[0].message, /不支持此匹配模式/);
  }

  const extensionRegistry = createMatcherRegistry();
  extensionRegistry.register('fuzzy', Object.freeze({
    id: 'test-extension-only',
    match() { return false; }
  }));
  const extended = createAtomLanguageReceiver({
    matcherRegistry: extensionRegistry
  }).receive('explore {"thing$fuzzy":"石器工坊"}');
  assert.equal(fieldByBase(extended.items[0], 'thing').matcher.registered, true);
  assert.deepEqual(extended.items[0].errors, []);
});

test('14. an unknown $ action returns a parse error instead of guessing', () => {
  const result = createAtomLanguageReceiver().receive('explore {"situation$invent"}');
  const parsed = fieldByBase(result.items[0], 'situation');
  assert.equal(result.ok, false);
  assert.equal(result.items[0].ok, false);
  assert.equal(parsed.errors[0].code, 'UNKNOWN_ACTION');
  assert.match(parsed.errors[0].message, /未知.*\$|未知.*动作/);
});

test('15. transient $ actions and ~ hints are stripped from the persistent key', () => {
  const rawKey = 'situation$full~more438#简介';
  const result = createAtomLanguageReceiver().receive(`explore {${JSON.stringify(rawKey)}}`);
  const parsed = field(result.items[0], rawKey);
  assert.equal(parsed.persistentKey, 'situation#简介');
  assert.equal(parsed.persistentKey.includes('$'), false);
  assert.equal(parsed.persistentKey.includes('~'), false);
});

test('16. ordinary field merging preserves existing @ type and # description', () => {
  const existing = {
    'thing@program': '旧窗口',
    'situation#石器工坊简介': '旧正文',
    contain: [],
    support: []
  };
  const request = createAtomLanguageReceiver().receive(
    'explore {"thing~candidate3":"新窗口","situation":"新正文"}'
  );
  const merged = mergePersistentAtom(existing, request.items[0]);
  assert.deepEqual(merged, {
    'thing@program': '新窗口',
    'situation#石器工坊简介': '新正文',
    contain: [],
    support: []
  });
  assert.equal(Object.keys(merged).some((key) => key.includes('~') || key.includes('$')), false);
});

test('17. batch requests keep every item when one item fails', () => {
  const result = createAtomLanguageReceiver().receive(`
    explore [
      {"thing":"工具房","contain$latitude-2"},
      {"thing":"河岸","situation$invent"},
      {"thing":"石器工坊","situation$full"}
    ]
  `);
  assert.equal(result.batch, true);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map((item) => item.ok), [true, false, true]);
  assert.equal(fieldByBase(result.items[0], 'thing').value, '工具房');
  assert.equal(result.items[1].errors[0].code, 'UNKNOWN_ACTION');
  assert.equal(fieldByBase(result.items[2], 'thing').value, '石器工坊');
});

test('18. Chinese, quotes, newlines, and accidental description symbols are never executed', () => {
  const rawKey = 'situation#第一段“引号”\n第二段#仍是简介@custom$full~more9';
  const value = '正文写到“@custom”、“$full”和“~more”，但它们只是正文。';
  const result = createAtomLanguageReceiver().receive(
    `explore {${JSON.stringify(rawKey)}:${JSON.stringify(value)}}`
  );
  const parsed = field(result.items[0], rawKey);
  assert.equal(result.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.description, '第一段“引号”\n第二段#仍是简介@custom$full~more9');
  assert.equal(parsed.value, value);
  assert.deepEqual(parsed.types, []);
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.hints, []);

  const longDigits = '9'.repeat(400);
  const largeHint = createAtomLanguageReceiver().receive(
    `explore {${JSON.stringify(`situation~more${longDigits}#简介`)}}`
  );
  const parameter = fieldByBase(largeHint.items[0], 'situation').hints[0].parameter;
  assert.equal(parameter, longDigits);
  assert.equal(JSON.parse(JSON.stringify(parameter)), longDigits);
});

test('19. persistence defaults to atom.json while allowing contextual JSON files', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-p0-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const document = {
    'thing@note': 'agent001',
    'situation#主观窗口': '严格 JSON 正文',
    contain: [],
    support: []
  };

  const defaultFile = await writeAtomJson(directory, document);
  assert.equal(path.basename(defaultFile), 'atom.json');
  assert.deepEqual(JSON.parse(await fs.readFile(defaultFile, 'utf8')), document);

  const contextualFile = path.join(directory, 'contexts', 'stone-workshop.json');
  assert.equal(await writeAtomJson(contextualFile, document), contextualFile);
  assert.deepEqual(JSON.parse(await fs.readFile(defaultFile, 'utf8')), document);
  assert.deepEqual(JSON.parse(await fs.readFile(contextualFile, 'utf8')), document);
});

test('20. the new writer rejects and never creates active world.json names', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-world-thing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const document = {
    thing: '上下文节点',
    situation: '',
    contain: [],
    support: []
  };
  const worldFile = path.join(directory, 'world.json');
  const legacyWorldFile = path.join(directory, 'legacy.world.json');

  await assert.rejects(
    writeAtomJson(worldFile, document),
    (error) => error.code === 'ACTIVE_WORLD_JSON_REJECTED'
  );
  await assert.rejects(
    writeAtomJson(legacyWorldFile, document),
    (error) => error.code === 'ACTIVE_WORLD_JSON_REJECTED'
  );
  await assert.rejects(fs.access(worldFile), { code: 'ENOENT' });
  await assert.rejects(fs.access(legacyWorldFile), { code: 'ENOENT' });

  const transientFile = path.join(directory, 'transient.json');
  await assert.rejects(
    writeAtomJson(transientFile, { 'situation$full~more8': '正文' }),
    (error) => error.code === 'TRANSIENT_SYMBOL_PERSISTENCE_REJECTED'
  );
  await assert.rejects(fs.access(transientFile), { code: 'ENOENT' });
});

test('21. type sections come only from keys and never from a situation Value scan', () => {
  const value = '正文中提到 @custom、@program、@backup，但正文不能决定 Atom 类型。';
  const result = createAtomLanguageReceiver().receive(`explore {
    "situation#类型说明":${JSON.stringify(value)},
    "thing":"普通节点正文也提到 @custom @program @backup"
  }`);
  assert.deepEqual(fieldByBase(result.items[0], 'situation').types, []);
  assert.deepEqual(fieldByBase(result.items[0], 'thing').types, []);

  const typed = createAtomLanguageReceiver().receive(
    'explore {"thing@program":"agent001","situation":"普通正文"}'
  );
  assert.deepEqual(
    fieldByBase(typed.items[0], 'thing').types.map((type) => type.name),
    ['program']
  );

  const numberedType = createAtomLanguageReceiver().receive(
    'explore {"thing@custom2":"agent002"}'
  );
  assert.deepEqual(fieldByBase(numberedType.items[0], 'thing').types[0], {
    symbol: '@',
    raw: 'custom2',
    name: 'custom2',
    parameter: null
  });
});
