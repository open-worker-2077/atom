import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

function nameOf(value) {
  return Object.entries(value).find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1];
}

function fixture(lockSource) {
  return [atom('Root', '', [
    atom('允许窗口', '', [], 'agent@研发'),
    atom('其他窗口', '', [], 'agent@执行'),
    atom('非窗口'),
    atom('受控目标', '', [], '槽例@待处理'),
    atom('窗口锁程序', lockSource, [], 'program')
  ])];
}

function programWithAllowedWindows(allowedWindows) {
  return [
    'rows = explore({"thing":"Root/受控目标"})',
    'lock({',
    '  "targets": {"refs": [rows[0].ref]},',
    '  "mode": "write",',
    '  "fields": ["situation"],',
    `  "allowed_windows": ${JSON.stringify(allowedWindows)},`,
    '  "refresh": {"policy": "on_request"}',
    '})'
  ].join('\n');
}

test('Program lock accepts exact Agent paths and on-request refresh', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh(fixture(programWithAllowedWindows({
    paths: ['Root/允许窗口']
  })), { programSelector: 'Root/窗口锁程序', force: true });

  assert.deepEqual(cycle.locks[0].allowed_windows, { paths: ['Root/允许窗口'] });
  assert.deepEqual(cycle.locks[0].refresh, { policy: 'on_request' });
});

test('Program lock accepts normalized window types, target state and actions', async () => {
  const source = programWithAllowedWindows({
    types: { all: ['agent'], any: ['研发', '总控'], none: ['执行'] }
  }).replace(
    '  "refresh": {"policy": "on_request"}',
    '  "when": {"target_types":{"all":["槽例"],"any":["待处理"]},"actions":["transform"]},\n  "refresh": {"policy": "on_request"}'
  );
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh(fixture(source), {
    programSelector: 'Root/窗口锁程序', force: true
  });

  assert.deepEqual(cycle.locks[0].allowed_windows, {
    types: { all: ['agent'], any: ['研发', '总控'], none: ['执行'] }
  });
  assert.deepEqual(cycle.locks[0].when, {
    target_types: { all: ['槽例'], any: ['待处理'] },
    actions: ['transform']
  });
});

test('Program lock accepts one subtree spatial scope and explicit scheduler paths', async () => {
  const source = [
    'root = explore({"thing":"Root"})[0]',
    'lock({"targets":{"refs":[root.ref],"scope":"subtree"},"mode":"read_write","fields":["thing","situation","contain","support"],"allowed_windows":{"relation":"target_within_window_parent"},"allowed_programs":{"paths":["Root/调度程序"]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  const scheduler = createProgramRuntimeScheduler();
  const world = fixture(source);
  world[0].contain.push(atom('调度程序', 'def main(arguments):\n    return arguments', [], 'program'));
  const cycle = await scheduler.refresh(world, {
    programSelector: 'Root/窗口锁程序', force: true
  });

  assert.deepEqual(cycle.locks[0].targets.scope, 'subtree');
  assert.deepEqual(cycle.locks[0].allowed_windows, {
    relation: 'target_within_window_parent'
  });
  assert.deepEqual(cycle.locks[0].allowed_programs, { paths: ['Root/调度程序'] });
});

test('Program lock rejects an unknown target scope', async () => {
  const source = [
    'root = explore({"thing":"Root"})[0]',
    'lock({"targets":{"refs":[root.ref],"scope":"world"},"mode":"read_write"})'
  ].join('\n');
  await assert.rejects(
    createProgramRuntimeScheduler().refresh(fixture(source), {
      programSelector: 'Root/窗口锁程序', force: true
    }),
    (error) => error?.code === 'INVALID_PROGRAM_LOCK_TARGET_SCOPE'
  );
});

test('Program lock rejects an unknown window relation', async () => {
  const source = programWithAllowedWindows({ relation: 'window_within_target' });
  await assert.rejects(
    createProgramRuntimeScheduler().refresh(fixture(source), {
      programSelector: 'Root/窗口锁程序', force: true
    }),
    (error) => error?.code === 'INVALID_PROGRAM_LOCK_WINDOW_RELATION'
  );
});

test('Program lock rejects scheduler paths that do not resolve to Programs', async () => {
  const source = [
    'root = explore({"thing":"Root"})[0]',
    'lock({"targets":{"refs":[root.ref]},"mode":"write","allowed_programs":{"paths":["Root/受控目标"]}})'
  ].join('\n');
  await assert.rejects(
    createProgramRuntimeScheduler().refresh(fixture(source), {
      programSelector: 'Root/窗口锁程序', force: true
    }),
    (error) => error?.code === 'INVALID_PROGRAM_LOCK_ALLOWED_PROGRAMS'
  );
});

test('scheduler Program moves one fixed window while its spatial scope follows the new parent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-spatial-scope-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const snapshotFile = path.join(directory, 'request-driven-locks.json');
  const schedulerSource = [
    'def main():',
    '    window = explore({"thing":"执行窗口"})[0]',
    '    transform({"thing":"Root/状态","situation.rep.2":None})',
    '    transform({"thing.mov.Root/工单2":window.path})',
    'trigger("transform", {"nodes":["Root/工单1/回单"]}, main)'
  ].join('\n');
  const lockSource = [
    'root = explore({"thing":"Root"})[0]',
    'lock({"targets":{"refs":[root.ref],"scope":"subtree"},"mode":"read_write","fields":["thing","situation","contain","support"],"allowed_windows":{"relation":"target_within_window_parent"},"allowed_programs":{"paths":["Root/调度程序"]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('状态', '1'),
    atom('调度程序', schedulerSource, [], 'program'),
    atom('空间锁', lockSource, [], 'program'),
    atom('工单1', '', [atom('回单', '待回'), atom('执行窗口', '', [], 'agent@jump-executor')]),
    atom('工单2', '', [atom('回单', '待回')])
  ])], null, 2));
  const scheduler = createProgramRuntimeScheduler({
    requestDrivenLockRepository: createJsonRequestDrivenLockRepository({ file: snapshotFile })
  });
  const interaction = (windowPath) => ({ agent: { ref: `agent:${windowPath}`, path: windowPath } });

  const locked = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/空间锁"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/工单1/执行窗口')
  });
  assert.equal(locked.ok, true, JSON.stringify(locked.errors));

  const returned = await executeAtomLanguage({
    source: 'transform {"thing":"Root/工单1/回单","situation.rep.已回"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/工单1/执行窗口')
  });
  assert.equal(returned.ok, true, JSON.stringify(returned.errors));

  const worldAfter = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const root = worldAfter[0];
  assert.equal(root.contain.find((item) => item.thing === '状态').situation, '2');
  assert.equal(root.contain.find((item) => item.thing === '工单1').contain.some((item) => nameOf(item) === '执行窗口'), false);
  assert.equal(
    root.contain.find((item) => item.thing === '工单2').contain.some((item) => nameOf(item) === '执行窗口'),
    true,
    JSON.stringify(returned.warnings)
  );

  const movedInteraction = interaction('Root/工单2/执行窗口');
  const current = await executeAtomLanguage({
    source: 'explore {"thing":"Root/工单2","contain$latitude-1":true}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(current.ok, true, JSON.stringify(current.errors));
  assert.ok(current.items[0].matches.some((item) => item.path === 'Root/工单2/执行窗口'));

  const upper = await executeAtomLanguage({
    source: 'explore {"thing":"Root/状态","situation$full":true}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(upper.items[0].matches.length, 0);
  assert.equal(upper.warnings[0].code, 'ATOM_READ_PROTECTED');
  assert.match(upper.warnings[0].message, /当前 @agent 上下文未满足放行条件/u);

  const otherOrder = await executeAtomLanguage({
    source: 'explore {"thing":"Root/工单1","situation$full":true}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(otherOrder.items[0].matches.length, 0);
  assert.equal(otherOrder.warnings[0].code, 'ATOM_READ_PROTECTED');
  assert.match(otherOrder.warnings[0].message, /当前 @agent 上下文未满足放行条件/u);

  const selfMove = await executeAtomLanguage({
    source: 'transform {"thing.mov.Root/工单1":"Root/工单2/执行窗口"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(selfMove.errors[0].code, 'PROGRAM_LOCK_DENIED');
});

for (const [name, predicate] of [
  ['empty predicate', {}],
  ['empty all', { all: [] }],
  ['duplicate type', { any: ['研发', '研发'] }],
  ['unknown key', { every: ['研发'] }],
  ['required and excluded type', { all: ['研发'], none: ['研发'] }]
]) {
  test(`Program lock rejects ${name} in allowed_windows.types`, async () => {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.refresh(fixture(programWithAllowedWindows({ types: predicate })), {
        programSelector: 'Root/窗口锁程序', force: true
      }),
      (error) => error?.code === 'INVALID_PROGRAM_LOCK_WINDOW_TYPES'
    );
  });
}

for (const [name, when, code] of [
  ['empty when', {}, 'INVALID_PROGRAM_LOCK_WHEN'],
  ['unknown when key', { state: '待处理' }, 'INVALID_PROGRAM_LOCK_WHEN'],
  ['empty target types', { target_types: {} }, 'INVALID_PROGRAM_LOCK_TARGET_TYPES'],
  ['unknown action', { actions: ['write'] }, 'INVALID_PROGRAM_LOCK_ACTIONS'],
  ['duplicate action', { actions: ['explore', 'explore'] }, 'INVALID_PROGRAM_LOCK_ACTIONS']
]) {
  test(`Program lock rejects ${name}`, async () => {
    const source = programWithAllowedWindows({ paths: ['Root/允许窗口'] }).replace(
      '  "refresh": {"policy": "on_request"}',
      `  "when": ${JSON.stringify(when)},\n  "refresh": {"policy": "on_request"}`
    );
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.refresh(fixture(source), {
        programSelector: 'Root/窗口锁程序', force: true
      }),
      (error) => error?.code === code
    );
  });
}

for (const [name, allowedWindows] of [
  ['missing paths', {}],
  ['empty paths', { paths: [] }],
  ['duplicate paths', { paths: ['Root/允许窗口', 'Root/允许窗口'] }],
  ['short path', { paths: ['允许窗口'] }],
  ['unknown path', { paths: ['Root/不存在窗口'] }],
  ['non-Agent path', { paths: ['Root/非窗口'] }],
  ['unknown key', { paths: ['Root/允许窗口'], names: ['允许窗口'] }]
]) {
  test(`Program lock rejects ${name} in allowed_windows`, async () => {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(
      scheduler.refresh(fixture(programWithAllowedWindows(allowedWindows)), {
        programSelector: 'Root/窗口锁程序', force: true
      }),
      (error) => error?.code === 'INVALID_PROGRAM_LOCK_ALLOWED_WINDOWS'
    );
  });
}

test('Program lock rejects unsupported refresh policy', async () => {
  const source = programWithAllowedWindows({ paths: ['Root/允许窗口'] })
    .replace('"on_request"', '"automatic"');
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(
    scheduler.refresh(fixture(source), {
      programSelector: 'Root/窗口锁程序', force: true
    }),
    (error) => error?.code === 'INVALID_PROGRAM_LOCK_REFRESH'
  );
});

test('request-driven window lock survives movement until explicit recomputation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const snapshotFile = path.join(directory, 'request-driven-locks.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  const source = [
    'target = explore({"thing":"Root/受控目标"})[0]',
    'window = explore({"thing":"允许窗口"})[0]',
    'lock({"targets":{"refs":[target.ref]},"mode":"write","fields":["situation"],"allowed_windows":{"paths":[window.path]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('允许窗口', '', [], 'agent'), atom('其他窗口', '', [], 'agent'),
    atom('新父'), atom('受控目标', '原值'), atom('窗口锁程序', source, [], 'program')
  ])], null, 2));
  const repository = createJsonRequestDrivenLockRepository({ file: snapshotFile });
  const projectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  const scheduler = createProgramRuntimeScheduler({
    requestDrivenLockRepository: repository, projectionRepository
  });
  const interaction = (path) => ({ agent: { ref: `agent:${path}`, path } });

  const calculated = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated.errors));

  const denied = await executeAtomLanguage({
    source: 'transform {"thing":"Root/受控目标","situation.rep.拒绝"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/其他窗口')
  });
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED', JSON.stringify(denied));

  const moved = await executeAtomLanguage({
    source: 'transform {"thing.mov.Root/新父":"Root/允许窗口"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const stale = await executeAtomLanguage({
    source: 'transform {"thing":"Root/受控目标","situation.rep.仍拒绝"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/新父/允许窗口')
  });
  assert.equal(stale.errors[0].code, 'PROGRAM_LOCK_DENIED');

  const restarted = createProgramRuntimeScheduler({
    requestDrivenLockRepository: repository, projectionRepository
  });
  const recomputed = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: restarted, interaction: interaction('Root/新父/允许窗口')
  });
  assert.equal(recomputed.ok, true, JSON.stringify(recomputed.errors));
  const allowed = await executeAtomLanguage({
    source: 'transform {"thing":"Root/受控目标","situation.rep.允许"}', contextFile, projectionFile,
    programScheduler: restarted, interaction: interaction('Root/新父/允许窗口')
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
  const root = JSON.parse(await fs.readFile(contextFile, 'utf8'))[0];
  assert.equal(root.contain.find((item) => item.thing === '受控目标').situation, '允许');
});

test('world-record window types enforce transform locks and persist without concrete window paths', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-type-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const snapshotFile = path.join(directory, 'request-driven-locks.json');
  const source = [
    'target = explore({"thing":"Root/受控目标"})[0]',
    'lock({"targets":{"refs":[target.ref]},"mode":"write","fields":["situation"],"allowed_windows":{"types":{"all":["agent"],"any":["研发"],"none":["执行"]}},"when":{"target_types":{"all":["槽例","待处理"]},"actions":["transform"]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify(fixture(source), null, 2));
  const repository = createJsonRequestDrivenLockRepository({ file: snapshotFile });
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  const interaction = (windowPath) => ({ agent: { ref: `agent:${windowPath}`, path: windowPath } });

  const calculated = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated.errors));
  const stored = await repository.load();
  assert.deepEqual(stored.locks[0].allowed_windows, {
    types: { all: ['agent'], any: ['研发'], none: ['执行'] }
  });
  assert.equal(JSON.stringify(stored).includes('Root/允许窗口'), false);

  const admitted = await executeAtomLanguage({
    source: 'transform {"thing":"Root/受控目标","situation.rep.研发可写"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(admitted.ok, true, JSON.stringify(admitted.errors));

  const denied = await executeAtomLanguage({
    source: 'transform {"thing":"Root/受控目标","situation.rep.执行不可写"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/其他窗口')
  });
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED', JSON.stringify(denied));
});

test('invalid persisted request-driven lock snapshots fail closed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-lock-invalid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'locks.json');
  await fs.writeFile(file, '{"version":1,"locks":[{"sourceProgramPath":"P"}]}');
  const repository = createJsonRequestDrivenLockRepository({ file });
  await assert.rejects(repository.load(), (error) => error.code === 'INVALID_REQUEST_DRIVEN_LOCK_SNAPSHOT');
});

test('successful empty recomputation removes snapshots while failed recomputation retains them', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-lock-recompute-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'locks.json');
  const repository = createJsonRequestDrivenLockRepository({ file });
  const locked = fixture(programWithAllowedWindows({ paths: ['Root/允许窗口'] }));
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  await scheduler.refresh(locked, { programSelector: 'Root/窗口锁程序', force: true });
  assert.equal((await repository.load()).locks.length, 1);

  const broken = structuredClone(locked);
  broken[0].contain[4].situation = 'raise ValueError("broken recomputation")';
  const failure = await scheduler.refresh(broken, {
    programSelector: 'Root/窗口锁程序', force: true, isolateFailures: true
  });
  assert.equal(failure.failures[0].code, 'ATOM_PROGRAM_FAILED');
  assert.equal((await repository.load()).locks.length, 1);

  const empty = structuredClone(locked);
  empty[0].contain[4].situation = 'message({"level":"info","text":"no locks"})';
  await scheduler.refresh(empty, { programSelector: 'Root/窗口锁程序', force: true });
  assert.deepEqual((await repository.load()).locks, []);
});
