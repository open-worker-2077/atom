import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { executeAtomLanguage as executeAtomLanguageKernel } from '../work-engine/atom-language/engine.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { writeAtomGraphProjection } from '../work-engine/atom-language/context-store.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import {
  appendTransformLog,
  applyTransform,
  readTransformLog,
  transformLogEventFileFor
} from '../work-engine/atom-language/transform-executor.mjs';
import {
  TRANSFORM_COMMANDS,
  parseTransformKey
} from '../work-engine/atom-language/transform-key-parser.mjs';

function atom(thing, situation = '', contain = [], support = []) {
  return { thing, situation, contain, support };
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

function findAtom(atoms, thing) {
  const queue = [...atoms];
  while (queue.length) {
    const candidate = queue.shift();
    const nameEntry = Object.entries(candidate).find(([rawKey]) => (
      rawKey === 'thing' || rawKey.startsWith('thing@') || rawKey.startsWith('thing#')
    ));
    if (nameEntry?.[1] === thing) return candidate;
    const childrenEntry = Object.entries(candidate).find(([rawKey]) => (
      rawKey === 'contain'
      || rawKey.startsWith('contain@')
      || rawKey.startsWith('contain#')
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

test('transform dot lexer keeps situation rep replacement bytes opaque', () => {
  const parsed = parseTransformKey(
    'situation.rep.新句有 v1.2、#标题与普通句点.sum.新的简介'
  );
  assert.equal(parsed.baseKey, 'situation');
  assert.deepEqual(parsed.commands, [
    { name: 'rep', parameter: '新句有 v1.2、#标题与普通句点.sum.新的简介' }
  ]);
  assert.equal(parsed.persistentKey, 'situation');
  assert.equal(parsed.errors.length, 0);

  const ordinary = parseTransformKey('situation.v1.2.not-a-command');
  assert.equal(ordinary.baseKey, 'situation.v1.2.not-a-command');
  assert.deepEqual(ordinary.commands, []);
});

test('situation rep preserves command-like Program source and rejects a real outer invalid axis', async (t) => {
  const original = '开始\n旧片段\n结束';
  const files = await fixture(t, [atom('文档', original)]);
  const replacement = [
    'def main(arguments):',
    "    transform({'thing.ren.X': 'Target', 'situation.rep.done': None})",
    "    return '.dsc. and .rep. remain bytes'"
  ].join('\n');

  const localSource = `transform ${JSON.stringify({
    thing: '文档',
    [`situation.rep.${replacement}`]: '旧片段'
  })}`;
  const local = await execute(files, localSource);
  assert.equal(local.ok, true, JSON.stringify(local.errors));
  assert.equal(
    findAtom(await readAtoms(files.contextFile), '文档').situation,
    `开始\n${replacement}\n结束`
  );

  const fullSource = `transform {"thing":"文档",${JSON.stringify(`situation.rep.${replacement}`)}}`;
  const full = await execute(files, fullSource);
  assert.equal(full.ok, true, JSON.stringify(full.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '文档').situation, replacement);

  const beforeRejected = await fs.readFile(files.contextFile, 'utf8');
  const rejected = await execute(
    files,
    'transform {"thing":"文档","situation.ren.不得写入"}'
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.at(-1).code, 'INVALID_TRANSFORM_COMMAND_AXIS');
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), beforeRejected);
});

test('transform parsing is isolated from unchanged explore $ parsing', async (t) => {
  const files = await fixture(t, [atom('根', '正文', [atom('子')])]);
  const explored = await execute(files, 'explore {"thing":"根","contain$latitude-1","situation$full"}');
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.deepEqual(explored.items[0].matches.map((item) => item.thing), ['根', '子']);
  assert.equal(explored.items[0].matches[0].situation, '正文');

  const rejected = createAtomLanguageReceiver().receive(
    'transform {"thing$exact":"根","situation":"不得写入"}'
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.at(-1).code, 'TRANSFORM_DOLLAR_COMMAND_REJECTED');
});

test('situation rep performs local replacement with Value and full replacement without Value', async (t) => {
  const files = await fixture(t, [atom('文档', '旧片段 + 保留内容')]);

  const local = await execute(
    files,
    'transform {"thing":"文档","situation.rep.新片段":"旧片段"}'
  );
  assert.equal(local.ok, true, JSON.stringify(local.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '文档').situation, '新片段 + 保留内容');

  const full = await execute(
    files,
    'transform {"thing":"文档","situation.rep.全文含中文\\n与 symbols #@$~=."}'
  );
  assert.equal(full.ok, true, JSON.stringify(full.errors));
  assert.equal(
    findAtom(await readAtoms(files.contextFile), '文档').situation,
    '全文含中文\n与 symbols #@$~=.'
  );

  const cleared = await execute(files, 'transform {"thing":"文档","situation.rep."}');
  assert.equal(cleared.ok, true, JSON.stringify(cleared.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '文档').situation, '');
});

test('summary, field type, rename, and complete support replacement strip commands', async (t) => {
  const files = await fixture(t, [
    {
      'thing@agent': '甲',
      'situation#旧简介': '正文',
      contain: [],
      support: [{ 'if@current': true, then: [{ thing: '乙' }] }]
    },
    atom('乙')
  ]);
  for (const source of [
    'transform {"thing":"甲","situation.sum.新简介"}',
    'transform {"thing.typ.program":"甲"}',
    'transform {"thing.ren.甲新版":"甲"}',
    'transform {"thing":"甲新版","support.rep.":[{"if@current":true,"then":[{"thing":"乙"}]}]}'
  ]) {
    const result = await execute(files, source);
    assert.equal(result.ok, true, `${source}\n${JSON.stringify(result.errors)}`);
  }

  const updated = findAtom(await readAtoms(files.contextFile), '甲新版');
  assert.ok(updated);
  assert.equal(updated['thing@program'], '甲新版');
  assert.equal(updated['situation#新简介'], '正文');
  assert.deepEqual(updated.support, [{ 'if@current': true, then: [{ thing: '乙' }] }]);
  assert.equal(
    JSON.stringify(await readAtoms(files.contextFile)).includes('.rep.'),
    false
  );
});

test('an empty thing typ command removes the registration type without changing the thing', async (t) => {
  const files = await fixture(t, [{ 'thing@agent': 'Window', situation: '', contain: [], support: [] }]);
  const result = await execute(files, 'transform {"thing.typ.":"Window"}');

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const updated = findAtom(await readAtoms(files.contextFile), 'Window');
  assert.equal(updated.thing, 'Window');
  assert.equal(Object.hasOwn(updated, 'thing@agent'), false);
});

test('contain only creates or transforms explicitly submitted nodes', async (t) => {
  const files = await fixture(t, [
    atom('父', '', [
      atom('显式子', '旧正文', [atom('未提交后代', '保持原样')]),
      atom('未提交同级', '也保持原样')
    ])
  ]);
  const result = await execute(files, `transform {
    "thing": "父",
    "contain": [
      {"thing":"显式子","situation.rep.新正文"},
      {"thing":"新增子","situation":"完整正文","contain":[],"support":[]}
    ]
  }`);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const parent = findAtom(await readAtoms(files.contextFile), '父');
  assert.equal(findAtom([parent], '显式子').situation, '新正文');
  assert.equal(findAtom([parent], '未提交后代').situation, '保持原样');
  assert.equal(findAtom([parent], '未提交同级').situation, '也保持原样');
  assert.equal(findAtom([parent], '新增子').situation, '完整正文');
});

test('move, copy, discard, and restore use explicit thing-axis commands and reversible log', async (t) => {
  const files = await fixture(t, [
    atom('源父', '', [atom('目标', '正文', [atom('后代', '完整保留')])]),
    atom('目的父'),
    {
      'thing@backup@default': '默认备份仓',
      situation: '',
      contain: [],
      support: []
    }
  ]);

  const moved = await execute(files, 'transform {"thing.mov.目的父":"目标"}');
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '源父').contain.length, 0);
  assert.ok(findAtom(findAtom(await readAtoms(files.contextFile), '目的父').contain, '目标'));

  const copied = await execute(files, 'transform {"thing.cpy.源父":"目标"}');
  assert.equal(copied.ok, true, JSON.stringify(copied.errors));
  assert.ok(findAtom(findAtom(await readAtoms(files.contextFile), '源父').contain, '目标'));

  const discarded = await execute(files, 'transform {"thing.dsc.":"目的父/目标"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const backup = findAtom(await readAtoms(files.contextFile), '默认备份仓');
  assert.ok(findAtom(backup.contain, '目标'));
  const log = await readTransformLog(files.contextFile);
  assert.equal(log.at(-1).operation, 'discard');
  assert.equal(log.at(-1).target, '目标');
  assert.equal(Object.hasOwn(findAtom(backup.contain, '目标'), 'transform_log'), false);

  const restored = await execute(files, 'transform {"thing.rst.":"默认备份仓/目标"}');
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.ok(findAtom(findAtom(await readAtoms(files.contextFile), '目的父').contain, '目标'));
  assert.equal(findAtom(await readAtoms(files.contextFile), '默认备份仓').contain.length, 0);
});

test('discard moves an authorized descendant into kernel backup without granting backup access', async (t) => {
  const files = await fixture(t, [
    atom('Agent', '', [atom('可丢弃')]),
    { 'thing@backup@default': '默认备份仓', situation: '', contain: [], support: [] }
  ]);
  const atoms = await readAtoms(files.contextFile);
  const parsed = createAtomLanguageReceiver().receive(
    'transform {"thing.dsc.":"Agent/可丢弃"}'
  );
  const authorizationPaths = [];
  const result = await applyTransform({
    atoms,
    item: parsed.items[0],
    contextFile: files.contextFile,
    authorize: async (match) => {
      const targetPath = match.path.join('/');
      authorizationPaths.push(targetPath);
      return targetPath === 'Agent' || targetPath.startsWith('Agent/')
        ? { decision: 'allow' }
        : { decision: 'deny', code: 'WINDOW_ACCESS_DENIED' };
    }
  });

  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.equal(authorizationPaths.includes('默认备份仓'), false);
  assert.ok(findAtom(findAtom(result.atoms, '默认备份仓').contain, '可丢弃'));
  assert.equal(findAtom(result.atoms, 'Agent').contain.length, 0);

  await appendTransformLog(files.contextFile, result.logRecord);
  const restoreParsed = createAtomLanguageReceiver().receive(
    'transform {"thing.rst.":"默认备份仓/可丢弃"}'
  );
  authorizationPaths.length = 0;
  const restored = await applyTransform({
    atoms: result.atoms,
    item: restoreParsed.items[0],
    contextFile: files.contextFile,
    authorize: async (match) => {
      const targetPath = match.path.join('/');
      authorizationPaths.push(targetPath);
      return targetPath === 'Agent' || targetPath.startsWith('Agent/')
        ? { decision: 'allow' }
        : { decision: 'deny', code: 'WINDOW_ACCESS_DENIED' };
    }
  });
  assert.equal(restored.error, undefined, JSON.stringify(restored.error));
  assert.equal(authorizationPaths.includes('默认备份仓'), false);
  assert.ok(findAtom(findAtom(restored.atoms, 'Agent').contain, '可丢弃'));
  assert.equal(findAtom(restored.atoms, '默认备份仓').contain.length, 0);
});

test('discard copies a frozen optimized snapshot instead of mutating its contain arrays', async (t) => {
  const files = await fixture(t, [
    atom('Synthetic Agent', '', [atom('Disposable')]),
    { 'thing@backup@default': 'Synthetic Backup', situation: '', contain: [], support: [] }
  ]);
  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freeze(child);
    return Object.freeze(value);
  };
  const atoms = freeze(await readAtoms(files.contextFile));
  const before = JSON.stringify(atoms);
  const parsed = createAtomLanguageReceiver().receive(
    'transform {"thing.dsc.":"Synthetic Agent/Disposable"}'
  );

  const result = await applyTransform({
    atoms,
    item: parsed.items[0],
    contextFile: files.contextFile,
    mutateInput: true
  });

  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.equal(JSON.stringify(atoms), before, 'the immutable input snapshot remains byte-equivalent');
  assert.equal(findAtom(result.atoms, 'Synthetic Agent').contain.length, 0);
  assert.ok(findAtom(findAtom(result.atoms, 'Synthetic Backup').contain, 'Disposable'));
});

test('same-name Things from different paths receive distinct traceable archive coordinates', async (t) => {
  const files = await fixture(t, [
    atom('Synthetic East', '', [atom('Duplicate', 'east payload')]),
    atom('Synthetic West', '', [atom('Duplicate', 'west payload')]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      contain: [],
      support: []
    }
  ]);
  const atoms = await readAtoms(files.contextFile);
  await writeAtomGraphProjection(files.projectionFile, atoms, {
    rootName: path.basename(files.contextFile)
  });
  const east = await execute(files, 'transform {"thing.dsc.":"Synthetic East/Duplicate"}');
  const west = await execute(files, 'transform {"thing.dsc.":"Synthetic West/Duplicate"}');

  assert.equal(east.ok, true, JSON.stringify(east.errors));
  assert.equal(west.ok, true, JSON.stringify(west.errors));
  assert.notEqual(east.result.path, west.result.path);
  assert.match(east.result.path, /^Synthetic Backup\/Duplicate/u);
  assert.match(west.result.path, /^Synthetic Backup\/Duplicate/u);
  assert.match(
    west.result.thing,
    /^Duplicate · 归档自 Synthetic West · [0-9a-f-]{36}$/u
  );
  assert.ok(west.archive, 'discard receipt must expose the exact archive contract');
  assert.equal(west.archive.identity, west.result.thing);
  assert.equal(west.archive.path, west.result.path);
  assert.equal(west.archive.restoreCoordinate, west.result.path);
  assert.match(west.archive.discardId, /^[0-9a-f-]{36}$/u);

  const backup = findAtom(await readAtoms(files.contextFile), 'Synthetic Backup');
  assert.equal(backup.contain.length, 2);
  assert.equal(new Set(backup.contain.map((entry) => entry.thing)).size, 2);
  assert.deepEqual(
    backup.contain.map((entry) => entry.situation).sort(),
    ['east payload', 'west payload']
  );
  const discards = (await readTransformLog(files.contextFile)).filter((entry) => (
    entry.operation === 'discard'
  ));
  assert.deepEqual(discards.map((entry) => entry.originalParentPath), [
    'Synthetic East',
    'Synthetic West'
  ]);
  assert.deepEqual(discards.map((entry) => entry.archivePath), [
    east.result.path,
    west.result.path
  ]);
});

test('each archive coordinate restores only its own original Thing and name', async (t) => {
  const files = await fixture(t, [
    atom('Synthetic East', '', [atom('Duplicate', 'east payload')]),
    atom('Synthetic West', '', [atom('Duplicate', 'west payload')]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      contain: [],
      support: []
    }
  ]);
  const east = await execute(files, 'transform {"thing.dsc.":"Synthetic East/Duplicate"}');
  const west = await execute(files, 'transform {"thing.dsc.":"Synthetic West/Duplicate"}');
  assert.equal(east.ok, true, JSON.stringify(east.errors));
  assert.equal(west.ok, true, JSON.stringify(west.errors));

  const restoredWest = await execute(
    files,
    `transform {"thing.rst.":${JSON.stringify(west.result.path)}}`
  );
  assert.equal(restoredWest.ok, true, JSON.stringify(restoredWest.errors));
  let world = await readAtoms(files.contextFile);
  const westThing = findAtom(findAtom(world, 'Synthetic West').contain, 'Duplicate');
  assert.ok(westThing, 'the selected archive must recover its original business name');
  assert.equal(westThing.situation, 'west payload');
  assert.equal(findAtom(world, 'Synthetic East').contain.length, 0);

  const restoredEast = await execute(
    files,
    `transform {"thing.rst.":${JSON.stringify(east.result.path)}}`
  );
  assert.equal(restoredEast.ok, true, JSON.stringify(restoredEast.errors));
  world = await readAtoms(files.contextFile);
  const eastThing = findAtom(findAtom(world, 'Synthetic East').contain, 'Duplicate');
  assert.ok(eastThing, 'the remaining archive must retain its independent restore record');
  assert.equal(eastThing.situation, 'east payload');
  assert.equal(westThing.situation, 'west payload');
  assert.equal(findAtom(world, 'Synthetic Backup').contain.length, 0);
});

test('restore conflict preserves the existing Thing, archive, projection, and active discard record', async (t) => {
  const files = await fixture(t, [
    atom('Synthetic East', '', [atom('Duplicate', 'archived payload')]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      contain: [],
      support: []
    }
  ]);
  const discarded = await execute(files, 'transform {"thing.dsc.":"Synthetic East/Duplicate"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const recreated = await execute(
    files,
    'transform new {"thing":"Synthetic East/Duplicate","situation":"current payload","contain":[],"support":[]}'
  );
  assert.equal(recreated.ok, true, JSON.stringify(recreated.errors));
  const contextBefore = await fs.readFile(files.contextFile, 'utf8');
  const projectionBefore = await fs.readFile(files.projectionFile, 'utf8');
  const logBefore = await readTransformLog(files.contextFile);

  const restored = await execute(
    files,
    `transform {"thing.rst.":${JSON.stringify(discarded.archive.restoreCoordinate)}}`
  );

  assert.equal(restored.ok, false, JSON.stringify(restored));
  assert.equal(restored.errors[0].code, 'DUPLICATE_DESTINATION_CHILD');
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), contextBefore);
  assert.equal(await fs.readFile(files.projectionFile, 'utf8'), projectionBefore);
  assert.deepEqual(await readTransformLog(files.contextFile), logBefore);
});

test('discard commit failure leaves authoritative world, projection, and transform log unchanged', async (t) => {
  const initial = [
    atom('Synthetic East', '', [atom('Disposable', 'must remain')]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      contain: [],
      support: []
    }
  ];
  const files = await fixture(t, initial);
  await writeAtomGraphProjection(files.projectionFile, initial, {
    rootName: path.basename(files.contextFile)
  });
  const contextBefore = await fs.readFile(files.contextFile, 'utf8');
  const projectionBefore = await fs.readFile(files.projectionFile, 'utf8');

  await assert.rejects(
    executeAtomLanguageKernel({
      ...files,
      source: 'transform {"thing.dsc.":"Synthetic East/Disposable"}',
      commitWorld: async () => {
        throw Object.assign(new Error('synthetic central commit failure'), {
          code: 'SYNTHETIC_COMMIT_FAILURE'
        });
      }
    }),
    (error) => error.code === 'SYNTHETIC_COMMIT_FAILURE'
  );
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), contextBefore);
  assert.equal(await fs.readFile(files.projectionFile, 'utf8'), projectionBefore);
  assert.deepEqual(await readTransformLog(files.contextFile), []);
});

test('audit mirror failure stays fatal when a custom commit receipt does not confirm the reversible record', async (t) => {
  const initial = [
    atom('Synthetic East', '', [atom('Disposable', 'must remain recoverable')]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      contain: [],
      support: []
    }
  ];
  const files = await fixture(t, initial);
  const auditDirectory = path.dirname(transformLogEventFileFor(files.contextFile));
  await fs.writeFile(auditDirectory, 'synthetic obstruction', 'utf8');

  await assert.rejects(
    executeAtomLanguageKernel({
      ...files,
      source: 'transform {"thing.dsc.":"Synthetic East/Disposable"}',
      commitWorld: async ({ expectedRevision, nextRevision }) => ({
        beforeRevision: expectedRevision,
        afterRevision: nextRevision,
        result: {}
      })
    }),
    (error) => error.code === 'EEXIST'
  );
});

test('audit mirror failure cannot turn a committed discard into a failed unrecoverable request', async (t) => {
  const initial = [
    atom('Synthetic East', '', [atom('Disposable', 'recoverable payload')]),
    {
      'thing@backup@default': 'Synthetic Backup',
      situation: '',
      contain: [],
      support: []
    }
  ];
  const files = await fixture(t, initial);
  await writeAtomGraphProjection(files.projectionFile, initial, {
    rootName: path.basename(files.contextFile)
  });
  const auditDirectory = path.dirname(transformLogEventFileFor(files.contextFile));
  await fs.writeFile(auditDirectory, 'synthetic obstruction', 'utf8');

  let discarded;
  await assert.doesNotReject(async () => {
    discarded = await execute(files, 'transform {"thing.dsc.":"Synthetic East/Disposable"}');
  });
  assert.equal(discarded.ok, true, JSON.stringify(discarded));
  assert.ok(discarded.warnings.some((warning) => (
    warning.code === 'TRANSFORM_LOG_MIRROR_FAILED'
  )), JSON.stringify(discarded));
  assert.equal(findAtom(await readAtoms(files.contextFile), 'Synthetic East').contain.length, 0);
  assert.match(await fs.readFile(files.projectionFile, 'utf8'), /Synthetic Backup/u);
  const transactionEvents = (await fs.readFile(
    path.join(files.directory, 'atom.transactions.json.d', 'events.jsonl'),
    'utf8'
  )).trim().split('\n').map(JSON.parse);
  const committedDiscard = transactionEvents.findLast((event) => (
    event.type === 'committed'
    && event.receipt?.result?.transformLogRecord?.id === discarded.archive.discardId
  ));
  assert.equal(committedDiscard.receipt.result.transformLogRecord.operation, 'discard');

  await fs.unlink(auditDirectory);
  const restarted = createLegacyWorldService();
  const restored = await restarted.executeLegacy({
    ...files,
    source: `transform {"thing.rst.":${JSON.stringify(discarded.archive.restoreCoordinate)}}`
  });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(
    findAtom(findAtom(await readAtoms(files.contextFile), 'Synthetic East').contain, 'Disposable').situation,
    'recoverable payload'
  );
});

test('Atom to Graph projection preserves long multilingual situation without clipping', async (t) => {
  const longDetail = `${'长正文\n@$~= 工程符号。'.repeat(401)}尾`;
  assert.ok(longDetail.length > 4000);
  const files = await fixture(t, [atom('长正文', longDetail)]);
  await writeAtomGraphProjection(files.projectionFile, [atom('长正文', longDetail)], {
    rootName: path.basename(files.contextFile)
  });
  const graph = parseGraphDocument(JSON.parse(await fs.readFile(files.projectionFile, 'utf8')));
  assert.equal(graph.graph.contain[0].situation, longDetail);
});

test('Graph validator and public schema impose no business length caps', async () => {
  const longName = '长名称'.repeat(1500);
  const longVerb = '长关系'.repeat(1500);
  const parsed = parseGraphDocument({
    config: { schema_version: '2.0.0' },
    graph: {
      thing: '根',
      situation: '',
      contain: [
        {
          thing: '来源',
          situation: '',
          contain: [],
          support: [{ 'if@current': true, then: [{ thing: longName }] }]
        },
        atom(longName)
      ],
      support: []
    }
  });
  assert.equal(parsed.graph.contain[0].support[0].then[0].thing, longName);

  const schema = JSON.parse(await fs.readFile(
    new URL('../schemas/graph-json-2.0.0.schema.json', import.meta.url),
    'utf8'
  ));
  assert.equal(JSON.stringify(schema).includes('"maxLength"'), false);
});
