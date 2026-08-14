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
        key: 'name@agent~updated',
        valuePresent: true,
        value: '石器工坊'
      },
      {
        key: 'detail#简介中的 @/$/~ 都是原文',
        valuePresent: false
      }
    ]
  };
  const text = formatGraphJson(value);
  assert.equal(text, `{
  "name@agent~updated": "石器工坊",
  "detail#简介中的 @/$/~ 都是原文"
}`);
  assert.deepEqual(parseGraphJson(text), value);
});

test('Graph-JSON display formatting omits only explicitly empty children and partners', () => {
  const empty = { kind: 'array', values: [] };
  const child = {
    kind: 'object',
    entries: [{ key: 'name', valuePresent: true, value: '子节点' }]
  };
  const value = {
    kind: 'object',
    entries: [
      { key: 'name', valuePresent: true, value: '入口' },
      { key: 'children', valuePresent: true, value: { kind: 'array', values: [child] } },
      { key: 'partners', valuePresent: true, value: empty },
      { key: 'children~truncated', valuePresent: false }
    ]
  };

  assert.match(formatGraphJson(value), /"partners": \[\]/u);
  const text = formatGraphJson(value, { omitEmptyStructuralArrays: true });

  assert.match(text, /"children": \[/u);
  assert.doesNotMatch(text, /"partners"/u);
  assert.match(text, /"children~truncated"/u);
  assert.deepEqual(formatGraphJson({
    kind: 'object',
    entries: [
      { key: 'children', valuePresent: true, value: empty },
      { key: 'partners', valuePresent: true, value: empty }
    ]
  }, { omitEmptyStructuralArrays: true }), '{}');
});

test('1. atom is the registered Atom Language entry and the package CLI name', async () => {
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
      "name": "石器工坊",
      "detail$full",
      "children$latitude2$latitude-3$longitude-4$longitude4"
    }
  `);
  assert.equal(result.ok, true);
  assert.equal(result.command, 'explore');
  assert.equal(result.newExploration, false);
  assert.equal(result.batch, false);
  assert.equal(result.items.length, 1);
  assert.deepEqual(
    fieldByBase(result.items[0], 'children').actions.map(({ name, parameter }) => ({ name, parameter })),
    [
      { name: 'latitude', parameter: 2 },
      { name: 'latitude', parameter: -3 },
      { name: 'longitude', parameter: -4 },
      { name: 'longitude', parameter: 4 }
    ]
  );
});

test('3. explore new starts a new exploration line, not a new World', () => {
  const result = createAtomLanguageReceiver().receive('explore new {"name":"河岸"}');
  assert.equal(result.ok, true);
  assert.equal(result.command, 'explore');
  assert.equal(result.newExploration, true);
  assert.equal(Object.hasOwn(result, 'world'), false);
  assert.equal(Object.hasOwn(result, 'createWorld'), false);
});

test('4. ordinary strict JSON remains valid input', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore {"name":"石器工坊","detail":null,"children":[],"partners":[]}'
  );
  assert.equal(result.ok, true);
  assert.equal(result.items[0].fields.length, 4);
  assert.equal(fieldByBase(result.items[0], 'name').value, '石器工坊');
  assert.equal(fieldByBase(result.items[0], 'detail').value, null);
});

test('5. Graph-JSON accepts keys whose Value is absent', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore {"detail$full","children$latitude-2"}'
  );
  assert.equal(result.ok, true);
  for (const parsed of result.items[0].fields) {
    assert.equal(parsed.valuePresent, false);
    assert.equal(Object.hasOwn(parsed, 'value'), false);
  }

  const nested = createAtomLanguageReceiver().receive(
    'explore {"children":[{"name":"子节点","detail$full"}]}'
  );
  const nestedObject = fieldByBase(nested.items[0], 'children').value[0];
  assert.equal(nestedObject.kind, 'graph-object');
  const nestedDetail = fieldByBase(nestedObject, 'detail');
  assert.equal(nestedDetail.valuePresent, false);
  assert.equal(nestedDetail.actions[0].name, 'full');
});

test('6. absent Value, null, empty string, and an absent key stay distinct', () => {
  const result = createAtomLanguageReceiver().receive(
    'explore {"detail$full","name":null,"children":""}'
  );
  const item = result.items[0];
  const detail = fieldByBase(item, 'detail');
  const name = fieldByBase(item, 'name');
  const children = fieldByBase(item, 'children');
  assert.equal(detail.valuePresent, false);
  assert.equal(Object.hasOwn(detail, 'value'), false);
  assert.equal(name.valuePresent, true);
  assert.equal(name.value, null);
  assert.equal(children.valuePresent, true);
  assert.equal(children.value, '');
  assert.equal(fieldByBase(item, 'partners'), undefined);
});

test('7. the first # terminates engineering-symbol execution', () => {
  const rawKey = 'detail#简介中的@agent$full~more438';
  const result = createAtomLanguageReceiver().receive(`explore {${JSON.stringify(rawKey)}}`);
  const parsed = field(result.items[0], rawKey);
  assert.equal(result.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.types, []);
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.hints, []);
  assert.equal(parsed.descriptionPresent, true);
  assert.equal(parsed.description, '简介中的@agent$full~more438');
  assert.equal(parsed.persistentKey, rawKey);
});

test('8. symbols after # produce a warning that can be disabled without changing parsing', () => {
  const rawKey = 'detail#简介中的@agent$full~more438';
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
  const rawKey = 'name@agent$exact~hidden12#石器工坊窗口';
  const result = createAtomLanguageReceiver().receive(
    `explore {${JSON.stringify(rawKey)}:"窗口一"}`
  );
  const parsed = field(result.items[0], rawKey);
  assert.deepEqual(
    parsed.types.map(({ name, parameter }) => ({ name, parameter })),
    [{ name: 'agent', parameter: null }]
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
  const result = createAtomLanguageReceiver().receive('explore {"children$latitude-2"}');
  const action = fieldByBase(result.items[0], 'children').actions[0];
  assert.equal(result.ok, true);
  assert.equal(action.name, 'latitude');
  assert.equal(action.parameter, -2);
  assert.equal(typeof action.parameter, 'number');
});

test('11. plain name uses the registered exact matcher by default', () => {
  const result = createAtomLanguageReceiver().receive('explore {"name":"石器工坊"}');
  assert.equal(result.ok, true);
  assert.deepEqual(fieldByBase(result.items[0], 'name').matcher, {
    mode: 'exact',
    explicit: false,
    registered: true
  });
});

test('12. name$exact explicitly uses the same registered exact matcher', () => {
  const result = createAtomLanguageReceiver().receive('explore {"name$exact":"石器工坊"}');
  assert.equal(result.ok, true);
  assert.deepEqual(fieldByBase(result.items[0], 'name').matcher, {
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
      `explore {"name$${mode}":"石器工坊"}`
    );
    const parsed = fieldByBase(result.items[0], 'name');
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
  }).receive('explore {"name$fuzzy":"石器工坊"}');
  assert.equal(fieldByBase(extended.items[0], 'name').matcher.registered, true);
  assert.deepEqual(extended.items[0].errors, []);
});

test('14. an unknown $ action returns a parse error instead of guessing', () => {
  const result = createAtomLanguageReceiver().receive('explore {"detail$invent"}');
  const parsed = fieldByBase(result.items[0], 'detail');
  assert.equal(result.ok, false);
  assert.equal(result.items[0].ok, false);
  assert.equal(parsed.errors[0].code, 'UNKNOWN_ACTION');
  assert.match(parsed.errors[0].message, /未知.*\$|未知.*动作/);
});

test('15. transient $ actions and ~ hints are stripped from the persistent key', () => {
  const rawKey = 'detail$full~more438#简介';
  const result = createAtomLanguageReceiver().receive(`explore {${JSON.stringify(rawKey)}}`);
  const parsed = field(result.items[0], rawKey);
  assert.equal(parsed.persistentKey, 'detail#简介');
  assert.equal(parsed.persistentKey.includes('$'), false);
  assert.equal(parsed.persistentKey.includes('~'), false);
});

test('16. ordinary field merging preserves existing @ type and # description', () => {
  const existing = {
    'name@agent': '旧窗口',
    'detail#石器工坊简介': '旧正文',
    children: [],
    partners: []
  };
  const request = createAtomLanguageReceiver().receive(
    'explore {"name~candidate3":"新窗口","detail":"新正文"}'
  );
  const merged = mergePersistentAtom(existing, request.items[0]);
  assert.deepEqual(merged, {
    'name@agent': '新窗口',
    'detail#石器工坊简介': '新正文',
    children: [],
    partners: []
  });
  assert.equal(Object.keys(merged).some((key) => key.includes('~') || key.includes('$')), false);
});

test('17. batch requests keep every item when one item fails', () => {
  const result = createAtomLanguageReceiver().receive(`
    explore [
      {"name":"工具房","children$latitude-2"},
      {"name":"河岸","detail$invent"},
      {"name":"石器工坊","detail$full"}
    ]
  `);
  assert.equal(result.batch, true);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map((item) => item.ok), [true, false, true]);
  assert.equal(fieldByBase(result.items[0], 'name').value, '工具房');
  assert.equal(result.items[1].errors[0].code, 'UNKNOWN_ACTION');
  assert.equal(fieldByBase(result.items[2], 'name').value, '石器工坊');
});

test('18. Chinese, quotes, newlines, and accidental description symbols are never executed', () => {
  const rawKey = 'detail#第一段“引号”\n第二段#仍是简介@agent$full~more9';
  const value = '正文写到“@agent”、“$full”和“~more”，但它们只是正文。';
  const result = createAtomLanguageReceiver().receive(
    `explore {${JSON.stringify(rawKey)}:${JSON.stringify(value)}}`
  );
  const parsed = field(result.items[0], rawKey);
  assert.equal(result.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.description, '第一段“引号”\n第二段#仍是简介@agent$full~more9');
  assert.equal(parsed.value, value);
  assert.deepEqual(parsed.types, []);
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.hints, []);

  const longDigits = '9'.repeat(400);
  const largeHint = createAtomLanguageReceiver().receive(
    `explore {${JSON.stringify(`detail~more${longDigits}#简介`)}}`
  );
  const parameter = fieldByBase(largeHint.items[0], 'detail').hints[0].parameter;
  assert.equal(parameter, longDigits);
  assert.equal(JSON.parse(JSON.stringify(parameter)), longDigits);
});

test('19. persistence defaults to atom.json while allowing contextual JSON files', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-p0-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const document = {
    'name@agent': 'agent001',
    'detail#主观窗口': '严格 JSON 正文',
    children: [],
    partners: []
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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-world-name-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const document = {
    name: '上下文节点',
    detail: '',
    children: [],
    partners: []
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
    writeAtomJson(transientFile, { 'detail$full~more8': '正文' }),
    (error) => error.code === 'TRANSIENT_SYMBOL_PERSISTENCE_REJECTED'
  );
  await assert.rejects(fs.access(transientFile), { code: 'ENOENT' });
});

test('21. type sections come only from keys and never from a detail Value scan', () => {
  const value = '正文中提到 @agent、@program、@backup，但正文不能决定 Atom 类型。';
  const result = createAtomLanguageReceiver().receive(`explore {
    "detail#类型说明":${JSON.stringify(value)},
    "name":"普通节点正文也提到 @agent @program @backup"
  }`);
  assert.deepEqual(fieldByBase(result.items[0], 'detail').types, []);
  assert.deepEqual(fieldByBase(result.items[0], 'name').types, []);

  const typed = createAtomLanguageReceiver().receive(
    'explore {"name@agent":"agent001","detail":"普通正文"}'
  );
  assert.deepEqual(
    fieldByBase(typed.items[0], 'name').types.map((type) => type.name),
    ['agent']
  );

  const numberedType = createAtomLanguageReceiver().receive(
    'explore {"name@agent2":"agent002"}'
  );
  assert.deepEqual(fieldByBase(numberedType.items[0], 'name').types[0], {
    symbol: '@',
    raw: 'agent2',
    name: 'agent2',
    parameter: null
  });
});
