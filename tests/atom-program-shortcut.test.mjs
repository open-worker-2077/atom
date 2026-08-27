import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { executeAtomLanguage as executeAtomLanguageKernel } from '../work-engine/atom-language/engine.mjs';
import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';
import { executeExploreItem } from '../work-engine/atom-language/query-capability.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import {
  applyShortcutEffect,
  createShortcutAtom,
  resolveShortcutMatch,
  shortcutMetadata
} from '../work-engine/atom-language/shortcut-runtime.mjs';

function atom(thing, situation = '', contain = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    contain,
    support: []
  };
}

function program(thing, source) {
  return atom(thing, source, [], ['program']);
}

async function fixture(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-shortcut-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'atom.graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

function findAtom(atoms, exactPath) {
  const parts = exactPath.split('/');
  let children = atoms;
  let current = null;
  for (const part of parts) {
    current = children.find((candidate) => Object.entries(candidate).some(([key, value]) => (
      (key === 'thing' || key.startsWith('thing@') || key.startsWith('thing#')) && value === part
    )));
    if (!current) return null;
    children = current.contain;
  }
  return current;
}

function creatorSource(targetPath, shortcutName) {
  return [
    `target = explore({"thing":${JSON.stringify(targetPath)}})[0]`,
    `shortcut({"placement":"contain","thing":${JSON.stringify(shortcutName)},"target":target})`
  ].join('\n');
}

function deleteShortcutSource(parentPath) {
  return [
    `rows = explore({"thing":${JSON.stringify(parentPath)},"contain$latitude-1":True})`,
    'reference = [row for row in rows if "shortcut" in row.types][0]',
    'shortcut({"action":"delete","reference":reference})'
  ].join('\n');
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
  return {
    code,
    stderr,
    output: stdout ? materializeGraphJson(parseGraphJson(stdout)) : null
  };
}

test('exact Graph-JSON exposes the resolved target with stable shortcut audit metadata', async (t) => {
  const files = await fixture(t, [
    atom('目标域', '', [atom('权威 Thing', '唯一正文')]),
    atom('引用域', '', [program('创建引用', '')]),
    atom('备份', '', [], ['backup', 'default'])
  ]);
  const atoms = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  findAtom(atoms, '引用域/创建引用').contain.push(createShortcutAtom({
    thing: '常用入口',
    targetPath: '目标域/权威 Thing',
    referenceId: 'shortcut-audit-id'
  }));
  await fs.writeFile(files.contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');

  const explored = await runCli(files, [
    'explore', '{"thing":"引用域/创建引用/常用入口","situation$full"}'
  ]);

  assert.equal(explored.code, 0, explored.stderr);
  assert.equal(explored.output.thing, '权威 Thing');
  assert.equal(explored.output.situation, '唯一正文');
  assert.deepEqual(explored.output['shortcut~resolved'], {
    identity: 'shortcut-audit-id',
    thing: '常用入口',
    placement: 'contain',
    path: '引用域/创建引用/常用入口'
  });
});

test('a parent Graph-JSON contain projection keeps its shortcut as one direct auditable member', async (t) => {
  const files = await fixture(t, [
    atom('目标域', '', [atom('权威 Thing', '唯一正文')]),
    atom('引用域', '', [program('创建引用', '')]),
    atom('备份', '', [], ['backup', 'default'])
  ]);
  const atoms = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  findAtom(atoms, '引用域/创建引用').contain.push(createShortcutAtom({
    thing: '常用入口',
    targetPath: '目标域/权威 Thing',
    referenceId: 'shortcut-member-id'
  }));
  await fs.writeFile(files.contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');

  const explored = await runCli(files, [
    'explore', '{"thing":"引用域/创建引用","contain$latitude-1","situation$full"}'
  ]);

  assert.equal(explored.code, 0, explored.stderr);
  assert.equal(explored.output['thing@program'], '创建引用');
  assert.equal(explored.output.contain.length, 1);
  assert.equal(explored.output.contain[0].thing, '权威 Thing');
  assert.equal(explored.output.contain[0].situation, '唯一正文');
  assert.deepEqual(explored.output.contain[0]['shortcut~resolved'], {
    identity: 'shortcut-member-id',
    thing: '常用入口',
    placement: 'contain',
    path: '引用域/创建引用/常用入口'
  });
});

test('shortcut() creates one owner-local reference without copying target facts and exact Explore resolves it', async (t) => {
  const world = [
    atom('目标域', '', [atom('权威 Thing', '唯一正文', [atom('唯一子项')])]),
    atom('引用域', '', [program('创建引用', creatorSource('目标域/权威 Thing', '常用入口'))]),
    atom('备份', '', [], ['backup', 'default'])
  ];
  const files = await fixture(t, world);

  const created = await executeAtomLanguage({
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing.run.":"引用域/创建引用"}'
  });
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  assert.equal(created.changed, true);

  const persisted = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const target = findAtom(persisted, '目标域/权威 Thing');
  const shortcut = findAtom(persisted, '引用域/创建引用/常用入口');
  assert.equal(target.situation, '唯一正文');
  assert.equal(target.contain.length, 1);
  assert.ok(shortcut);
  assert.equal(shortcut.situation.includes('唯一正文'), false);
  assert.deepEqual(shortcut.contain, []);
  assert.deepEqual(shortcut.support, []);

  const explored = await executeAtomLanguage({
    ...files,
    source: 'explore {"thing":"引用域/创建引用/常用入口","situation$full"}'
  });
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  assert.equal(explored.items[0].matches[0].path, '目标域/权威 Thing');
  assert.equal(explored.items[0].matches[0].thing, '权威 Thing');
  assert.equal(explored.items[0].matches[0].situation, '唯一正文');
  assert.deepEqual(explored.items[0].matches[0].resolvedThroughShortcut, {
    identity: shortcutMetadata(shortcut).referenceId,
    placement: 'contain',
    path: '引用域/创建引用/常用入口',
    thing: '常用入口'
  });

  const ordinary = await executeAtomLanguage({
    ...files,
    source: 'explore {"thing":"引用域/创建引用","contain$latitude-1","situation$full"}'
  });
  assert.equal(ordinary.ok, true, JSON.stringify(ordinary.errors));
  const ordinaryShortcut = ordinary.items[0].matches.find((match) => (
    match.resolvedThroughShortcut?.path === '引用域/创建引用/常用入口'
  ));
  assert.equal(ordinaryShortcut.path, '引用域/创建引用/常用入口');
  assert.equal(ordinaryShortcut.situation, '唯一正文');
});

test('shortcut locator follows target move and becomes broken when the target is discarded', async (t) => {
  const world = [
    atom('甲', '', [atom('权威 Thing', '唯一正文')]),
    atom('乙'),
    atom('引用域', '', [program('创建引用', creatorSource('甲/权威 Thing', '入口'))]),
    atom('备份', '', [], ['backup', 'default'])
  ];
  const files = await fixture(t, world);
  assert.equal((await executeAtomLanguage({
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing.run.":"引用域/创建引用"}'
  })).ok, true);

  const moved = await executeAtomLanguage({
    ...files, source: 'transform {"thing.mov.乙":"甲/权威 Thing"}'
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const afterMove = await executeAtomLanguage({
    ...files, source: 'explore {"thing":"引用域/创建引用/入口","situation$full"}'
  });
  assert.equal(afterMove.ok, true, JSON.stringify(afterMove.errors));
  assert.equal(afterMove.items[0].matches[0].path, '乙/权威 Thing');

  const renamed = await executeAtomLanguage({
    ...files, source: 'transform {"thing.ren.权威新名":"乙/权威 Thing"}'
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
  const afterRename = await executeAtomLanguage({
    ...files, source: 'explore {"thing":"引用域/创建引用/入口","situation$full"}'
  });
  assert.equal(afterRename.ok, true, JSON.stringify(afterRename.errors));
  assert.equal(afterRename.items[0].matches[0].path, '乙/权威新名');

  const discarded = await executeAtomLanguage({
    ...files, source: 'transform {"thing.dsc.":"乙/权威新名"}'
  });
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const broken = await executeAtomLanguage({
    ...files, source: 'explore {"thing":"引用域/创建引用/入口","situation$full"}'
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.errors[0].code, 'SHORTCUT_TARGET_BROKEN');
  assert.equal(JSON.stringify(broken).includes('乙/权威 Thing'), false);
});

test('discarding a shortcut does not mutate the target facts', async (t) => {
  const world = [
    atom('目标', '权威正文'),
    atom('引用域', '', [program('创建引用', creatorSource('目标', '入口'))]),
    atom('备份', '', [], ['backup', 'default'])
  ];
  const files = await fixture(t, world);
  assert.equal((await executeAtomLanguage({
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing.run.":"引用域/创建引用"}'
  })).ok, true);
  const before = findAtom(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), '目标');

  const discarded = await executeAtomLanguage({
    ...files, source: 'transform {"thing.dsc.":"引用域/创建引用/入口"}'
  });
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const after = findAtom(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), '目标');
  assert.deepEqual(after, before);
});

test('shortcut creation requires an opaque exact ThingCoordinate and never accepts a path string', async (t) => {
  const files = await fixture(t, [
    atom('目标'),
    atom('引用域', '', [program('坏创建', [
      'shortcut({"placement":"contain","thing":"入口","target":"目标"})'
    ].join('\n'))])
  ]);
  const result = await executeAtomLanguage({
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing.run.":"引用域/坏创建"}'
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'INVALID_SHORTCUT_TARGET_COORDINATE');
  assert.equal(result.changed, false);
});

test('a cached Program projection never replays a previously emitted shortcut effect', async () => {
  const world = [
    atom('目标'),
    atom('引用域', '', [program('创建引用', creatorSource('目标', '入口'))])
  ];
  const scheduler = createProgramRuntimeScheduler();
  const first = await scheduler.refresh(world);
  assert.equal(first.shortcuts.length, 1);
  const cached = await scheduler.refresh(world);
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.shortcuts, []);
});

test('shortcut resolution reuses the caller access controller and denies without leaking the target', async () => {
  const target = atom('秘密目标', '秘密正文');
  const shortcut = createShortcutAtom({
    thing: '公共入口',
    targetPath: '上级/秘密目标',
    referenceId: '11111111-1111-4111-8111-111111111111'
  });
  const atoms = [atom('上级', '', [target]), atom('下级', '', [shortcut])];
  const receiver = createAtomLanguageReceiver();
  const parsed = receiver.receive('explore {"thing":"下级/公共入口","situation$full"}');
  const result = await executeExploreItem(
    atoms,
    parsed.items[0],
    receiver.matcherRegistry,
    {
      restricted: true,
      authorize: async (match) => ({
        decision: match.path.join('/') === '上级/秘密目标' ? 'deny' : 'allow',
        matchedLocks: []
      })
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'SHORTCUT_TARGET_ACCESS_DENIED');
  assert.equal(JSON.stringify(result).includes('秘密目标'), false);
  assert.equal(JSON.stringify(result).includes('秘密正文'), false);
});

test('shortcut creation checks target read and placement write through one supplied Graph evaluator', async () => {
  const atoms = [atom('目标'), program('创建器', '')];
  const calls = [];
  const denied = await applyShortcutEffect({
    atoms,
    effect: {
      placement: 'contain', thing: '入口', targetPath: '目标', targetRef: 'coordinate-ref',
      sourceProgramPath: '创建器'
    },
    authorize: async (match, operation, field) => {
      calls.push({ path: match.path.join('/'), operation, field });
      return {
        decision: match.path.join('/') === '目标' ? 'deny' : 'allow'
      };
    }
  });
  assert.equal(denied.error.code, 'SHORTCUT_TARGET_ACCESS_DENIED');
  assert.deepEqual(calls, [{ path: '目标', operation: 'read', field: 'thing' }]);
  assert.equal(findAtom(atoms, '创建器').contain.length, 0);
});

test('shortcut resolver rejects forged cycles and chains beyond the fixed maximum depth', () => {
  const cycleA = createShortcutAtom({ thing: 'A', targetPath: 'B', referenceId: 'a' });
  const cycleB = createShortcutAtom({ thing: 'B', targetPath: 'A', referenceId: 'b' });
  assert.throws(
    () => resolveShortcutMatch([cycleA, cycleB], { atom: cycleA, path: ['A'] }),
    (error) => error.code === 'SHORTCUT_REFERENCE_CYCLE'
  );

  const chain = [atom('目标')];
  for (let index = 9; index >= 0; index -= 1) {
    chain.push(createShortcutAtom({
      thing: `R${index}`,
      targetPath: index === 9 ? '目标' : `R${index + 1}`,
      referenceId: `id-${index}`
    }));
  }
  assert.throws(
    () => resolveShortcutMatch(chain, { atom: chain.at(-1), path: ['R0'] }),
    (error) => error.code === 'SHORTCUT_REFERENCE_DEPTH_EXCEEDED'
  );
});

test('public Transform cannot forge shortcut persistence or redirect a write through a shortcut', async (t) => {
  const files = await fixture(t, [atom('目标', '原文')]);
  const forged = await executeAtomLanguage({
    ...files,
    source: 'transform new {"thing@shortcut":"伪造","situation":"{}","contain":[],"support":[]}'
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.errors[0].code, 'SHORTCUT_PERSISTENCE_FORGERY_DENIED');

  const nestedForgery = await executeAtomLanguage({
    ...files,
    source: `transform new ${JSON.stringify(atom('容器', '', [
      createShortcutAtom({ thing: '嵌套伪造', targetPath: '目标', referenceId: 'forged' })
    ]))}`
  });
  assert.equal(nestedForgery.ok, false);
  assert.equal(nestedForgery.errors[0].code, 'SHORTCUT_PERSISTENCE_FORGERY_DENIED');

  const persistedShortcut = createShortcutAtom({
    thing: '入口', targetPath: '目标', referenceId: 'reference-id'
  });
  await fs.writeFile(files.contextFile, `${JSON.stringify([
    atom('目标', '原文'), persistedShortcut
  ], null, 2)}\n`, 'utf8');
  const redirected = await executeAtomLanguage({
    ...files,
    source: 'transform {"thing":"入口","situation.rep.":"不得转发"}'
  });
  assert.equal(redirected.ok, false);
  assert.equal(redirected.errors[0].code, 'SHORTCUT_TRANSFORM_REDIRECT_FORBIDDEN');
  assert.equal(findAtom(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), '目标').situation, '原文');

  const atoms = [atom('目标', '原文')];
  const effect = await applyShortcutEffect({
    atoms,
    effect: {
      placement: 'contain', thing: '入口', targetPath: '目标', targetRef: 'coordinate-ref',
      sourceProgramPath: '创建器'
    },
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(effect.error.code, 'SHORTCUT_PLACEMENT_PROGRAM_NOT_FOUND');
});

test('shortcut persistence survives a cold read and rolls back with the authoritative world transaction', async (t) => {
  const before = [atom('目标', '权威正文'), atom('容器')];
  const after = [
    before[0],
    atom('容器', '', [
      createShortcutAtom({ thing: '入口', targetPath: '目标', referenceId: 'stable-reference' })
    ])
  ];
  const files = await fixture(t, before);
  const persistence = createTransactionalWorldPersistence({
    ...files,
    publishLegacyProjection: false
  });
  const receipt = await persistence.commit({
    correlationId: 'shortcut-commit',
    expectedRevision: revisionOfWorldFacts(before),
    nextRevision: revisionOfWorldFacts(after),
    facts: after,
    source: 'shortcut-test'
  });

  const coldRead = await executeAtomLanguage({
    ...files,
    source: 'explore {"thing":"容器/入口","situation$full"}'
  });
  assert.equal(coldRead.ok, true, JSON.stringify(coldRead.errors));
  assert.equal(coldRead.items[0].matches[0].path, '目标');
  assert.equal(coldRead.items[0].matches[0].situation, '权威正文');

  await persistence.rollback({
    targetCommandId: receipt.commandId,
    correlationId: 'shortcut-rollback',
    expectedRevision: receipt.afterRevision
  });
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), before);
});

test('shortcut delete removes only the reference while preserving target facts and both Programs', async (t) => {
  const target = atom('权威目标', '目标正文', [atom('目标子项')]);
  const creator = program('创建引用', 'created = True');
  creator.contain.push(createShortcutAtom({
    thing: '待删入口', targetPath: '权威目标', referenceId: 'delete-reference-id'
  }));
  const deleter = program('删除引用', deleteShortcutSource('创建引用'));
  const before = [target, creator, deleter, atom('备份', '', [], ['backup', 'default'])];
  const files = await fixture(t, before);
  const targetRevision = revisionOfWorldFacts([target]);

  const deleted = await executeAtomLanguage({
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing.run.":"删除引用"}'
  });

  assert.equal(deleted.ok, true, JSON.stringify(deleted.errors));
  assert.equal(deleted.changed, true);
  const persisted = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(persisted, '创建引用/待删入口'), null);
  assert.equal(revisionOfWorldFacts([findAtom(persisted, '权威目标')]), targetRevision);
  assert.deepEqual(findAtom(persisted, '权威目标'), target);
  assert.equal(findAtom(persisted, '创建引用').situation, 'created = True');
  assert.equal(findAtom(persisted, '删除引用').situation, deleter.situation);
});

test('shortcut delete rejects strings and target coordinates without changing any facts', async (t) => {
  const programs = [
    program('字符串删除', 'shortcut({"action":"delete","reference":"创建引用/入口"})'),
    program('目标删除', [
      'target = explore({"thing":"权威目标"})[0]',
      'shortcut({"action":"delete","reference":target})'
    ].join('\n'))
  ];
  const creator = program('创建引用', 'created = True');
  creator.contain.push(createShortcutAtom({
    thing: '入口', targetPath: '权威目标', referenceId: 'protected-reference-id'
  }));
  const before = [atom('权威目标', '不可改变'), creator, ...programs];
  const files = await fixture(t, before);

  for (const [programPath, expectedCode] of [
    ['字符串删除', 'INVALID_SHORTCUT_REFERENCE_COORDINATE'],
    ['目标删除', 'SHORTCUT_DELETE_REFERENCE_REQUIRED']
  ]) {
    const result = await executeAtomLanguage({
      ...files,
      programScheduler: createProgramRuntimeScheduler(),
      source: `transform {"thing.run.":${JSON.stringify(programPath)}}`
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, expectedCode);
    assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), before);
  }
});

test('shortcut delete rejects unknown, denied, and repeated reference effects without extra mutation', async () => {
  const creator = program('创建引用', 'created = True');
  creator.contain.push(createShortcutAtom({
    thing: '入口', targetPath: '权威目标', referenceId: 'stable-delete-id'
  }));
  const atoms = [atom('权威目标', '不可改变'), creator, program('删除器', 'deleted = True')];
  const effect = {
    action: 'delete', referenceRef: 'opaque-coordinate', referencePath: '创建引用/入口',
    referenceIdentity: 'stable-delete-id', sourceProgramPath: '删除器'
  };

  const unknown = await applyShortcutEffect({
    atoms,
    effect: { ...effect, referencePath: '创建引用/不存在' },
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(unknown.error.code, 'SHORTCUT_REFERENCE_NOT_FOUND');
  assert.strictEqual(unknown.atoms ?? atoms, atoms);

  const denied = await applyShortcutEffect({
    atoms,
    effect,
    authorize: async () => ({ decision: 'deny', code: 'GRAPH_LOCK_DENIED' })
  });
  assert.equal(denied.error.code, 'SHORTCUT_REFERENCE_ACCESS_DENIED');
  assert.strictEqual(denied.atoms ?? atoms, atoms);

  const first = await applyShortcutEffect({
    atoms,
    effect,
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(first.changed, true);
  const afterFirst = structuredClone(first.atoms);
  const repeated = await applyShortcutEffect({
    atoms: first.atoms,
    effect,
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(repeated.error.code, 'SHORTCUT_REFERENCE_NOT_FOUND');
  assert.deepEqual(first.atoms, afterFirst);
  assert.deepEqual(findAtom(first.atoms, '权威目标'), findAtom(atoms, '权威目标'));
  assert.ok(findAtom(first.atoms, '创建引用'));
});

test('shortcut delete leaves the authoritative world unchanged when its central commit fails', async (t) => {
  const creator = program('创建引用', 'created = True');
  creator.contain.push(createShortcutAtom({
    thing: '入口', targetPath: '权威目标', referenceId: 'rollback-delete-id'
  }));
  const before = [
    atom('权威目标', '不可改变'), creator,
    program('删除引用', deleteShortcutSource('创建引用'))
  ];
  const files = await fixture(t, before);

  await assert.rejects(
    () => executeAtomLanguageKernel({
      ...files,
      programScheduler: createProgramRuntimeScheduler(),
      source: 'transform {"thing.run.":"删除引用"}',
      commitWorld: async () => {
        throw Object.assign(new Error('synthetic commit failure'), {
          code: 'SYNTHETIC_COMMIT_FAILURE'
        });
      }
    }),
    (error) => error.code === 'SYNTHETIC_COMMIT_FAILURE'
  );
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), before);
});
