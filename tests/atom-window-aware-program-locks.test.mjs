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

function agentProgramSource(functions = ['explore', 'lock', 'transform']) {
  return [
    `agent({"labels":[],"functions":{"groups":[],"names":${JSON.stringify(functions)}}})`,
    'def main(arguments):',
    '    return arguments'
  ].join('\n');
}

function fixture(lockSource) {
  return [atom('Root', '', [
    atom('允许窗口', agentProgramSource(), [], 'program@研发'),
    atom('其他窗口', agentProgramSource(), [], 'program@执行'),
    atom('非窗口'),
    atom('受控目标', '', [], '槽例@待处理'),
    atom('窗口锁程序', lockSource, [], 'program')
  ])];
}

function programWithAllowedWindows(allowedWindows) {
  return [
    'lock({',
    '  "targets": {"paths": ["Root/受控目标"]},',
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

test('Program lock accepts an allowed window declared by its Program source, not a Key type', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('Root', '', [
    atom('允许窗口', [
      'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})',
      'def main(arguments):',
      '    return arguments'
    ].join('\n'), [], 'program'),
    atom('受控目标'),
    atom('窗口锁程序', programWithAllowedWindows({
      paths: ['Root/允许窗口']
    }), [], 'program')
  ])];

  await scheduler.rebuildAgentSecurity(world);
  const cycle = await scheduler.refresh(world, {
    programSelector: 'Root/窗口锁程序', force: true
  });

  assert.deepEqual(cycle.locks[0].allowed_windows, { paths: ['Root/允许窗口'] });
});

test('Program lock accepts normalized window types, target state and actions', async () => {
  const source = programWithAllowedWindows({
    types: { all: ['program'], any: ['研发', '总控'], none: ['执行'] }
  }).replace(
    '  "refresh": {"policy": "on_request"}',
    '  "when": {"target_types":{"all":["槽例"],"any":["待处理"]},"actions":["transform"]},\n  "refresh": {"policy": "on_request"}'
  );
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh(fixture(source), {
    programSelector: 'Root/窗口锁程序', force: true
  });

  assert.deepEqual(cycle.locks[0].allowed_windows, {
    types: { all: ['program'], any: ['研发', '总控'], none: ['执行'] }
  });
  assert.deepEqual(cycle.locks[0].when, {
    target_types: { all: ['槽例'], any: ['待处理'] },
    actions: ['transform']
  });
});

test('Program lock accepts one subtree spatial scope and explicit scheduler paths', async () => {
  const source = [
    'lock({"targets":{"paths":["Root"],"scope":"subtree"},"mode":"read_write","fields":["thing","situation","contain","support"],"allowed_windows":{"relation":"target_within_window_parent"},"allowed_programs":{"paths":["Root/调度程序"]},"refresh":{"policy":"on_request"}})'
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
    '    transform({"thing":"Root/控制器/状态","situation.rep.2":None})',
    '    transform({"thing.mov.Root/控制器/工单2":window.path})',
    'trigger("transform", {"nodes":["Root/控制器/工单1/回单"]}, main)'
  ].join('\n');
  const lockSource = [
    'lock({"targets":{"paths":["Root/控制器"],"scope":"subtree"},"mode":"read_write","fields":["thing","situation","contain","support"],"allowed_windows":{"relation":"target_within_window_parent"},"allowed_programs":{"paths":["Root/控制器/调度程序"]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('控制器', agentProgramSource(['explore', 'lock', 'transform', 'trigger']), [
      atom('状态', '1'),
      atom('调度程序', schedulerSource, [], 'program'),
      atom('空间锁', lockSource, [], 'program'),
      atom('工单1', '', [atom('回单', '待回'), atom('执行窗口', agentProgramSource(), [], 'program@jump-executor')]),
      atom('工单2', '', [atom('回单', '待回')])
    ], 'program')
  ])], null, 2));
  const scheduler = createProgramRuntimeScheduler({
    requestDrivenLockRepository: createJsonRequestDrivenLockRepository({ file: snapshotFile })
  });
  const interaction = (windowPath) => ({ agent: { ref: `agent:${windowPath}`, path: windowPath } });

  const locked = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/控制器/空间锁"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(locked.ok, true, JSON.stringify(locked.errors));

  const returned = await executeAtomLanguage({
    source: 'transform {"thing":"Root/控制器/工单1/回单","situation.rep.已回"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(returned.ok, true, JSON.stringify(returned.errors));

  const worldAfter = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const controller = worldAfter[0].contain.find((item) => nameOf(item) === '控制器');
  assert.equal(controller.contain.find((item) => nameOf(item) === '状态').situation, '2');
  assert.equal(controller.contain.find((item) => nameOf(item) === '工单1').contain.some((item) => nameOf(item) === '执行窗口'), false);
  assert.equal(
    controller.contain.find((item) => nameOf(item) === '工单2').contain.some((item) => nameOf(item) === '执行窗口'),
    true,
    JSON.stringify(returned.warnings)
  );

  const movedInteraction = interaction('Root/控制器/工单2/执行窗口');
  const current = await executeAtomLanguage({
    source: 'explore {"thing":"Root/控制器/工单2","contain$latitude-1":true}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(current.ok, true, JSON.stringify(current.errors));
  assert.ok(
    current.items[0].matches.some((item) => item.path === 'Root/控制器/工单2/执行窗口'),
    JSON.stringify(current)
  );

  const upper = await executeAtomLanguage({
    source: 'explore {"thing":"Root/控制器/状态","situation$full":true}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(upper.items[0].matches.length, 0);
  assert.equal(upper.warnings[0].code, 'ATOM_READ_PROTECTED');
  assert.match(upper.warnings[0].message, /当前 @agent 上下文未满足放行条件/u);

  const otherOrder = await executeAtomLanguage({
    source: 'explore {"thing":"Root/控制器/工单1","situation$full":true}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: movedInteraction
  });
  assert.equal(otherOrder.items[0].matches.length, 0);
  assert.equal(otherOrder.warnings[0].code, 'ATOM_READ_PROTECTED');
  assert.match(otherOrder.warnings[0].message, /当前 @agent 上下文未满足放行条件/u);

  const selfMove = await executeAtomLanguage({
    source: 'transform {"thing.mov.Root/控制器/工单1":"Root/控制器/工单2/执行窗口"}', contextFile, projectionFile,
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

test('source-derived type lock survives movement and cold restart without sidecar authority', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  const source = [
    'lock({"targets":{"paths":["Root/控制器/受控目标"]},"mode":"write","fields":["situation"],"allowed_windows":{"types":{"all":["program"],"any":["approved"]}},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('控制器', agentProgramSource(), [
      atom('允许窗口', agentProgramSource(), [], 'program@approved'),
      atom('其他窗口', agentProgramSource(), [], 'program'),
      atom('新父'), atom('受控目标', '原值'), atom('窗口锁程序', source, [], 'program')
    ], 'program@approved')
  ])], null, 2));
  const projectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  const scheduler = createProgramRuntimeScheduler({ projectionRepository });
  const interaction = (path) => ({ agent: { ref: `agent:${path}`, path } });

  const calculated = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/控制器/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated.errors));

  const denied = await executeAtomLanguage({
    source: 'transform {"thing":"Root/控制器/受控目标","situation.rep.拒绝"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器/其他窗口')
  });
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED', JSON.stringify(denied));

  const moved = await executeAtomLanguage({
    source: 'transform {"thing.mov.Root/控制器/新父":"Root/控制器/允许窗口"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const admittedAfterMove = await executeAtomLanguage({
    source: 'transform {"thing":"Root/控制器/受控目标","situation.rep.移动后允许"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(admittedAfterMove.ok, true, JSON.stringify(admittedAfterMove.errors));

  const restarted = createProgramRuntimeScheduler({ projectionRepository });
  const stillAllowed = await executeAtomLanguage({
    source: 'transform {"thing":"Root/控制器/受控目标","situation.rep.重启后允许"}', contextFile, projectionFile,
    programScheduler: restarted, interaction: interaction('Root/控制器')
  });
  assert.equal(stillAllowed.ok, true, JSON.stringify(stillAllowed.errors));
});

test('world-record window types enforce transform locks and persist without concrete window paths', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-type-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = [
    'lock({"targets":{"paths":["Root/控制器/受控目标"]},"mode":"write","fields":["situation"],"allowed_windows":{"types":{"all":["program"],"any":["研发"],"none":["执行"]}},"when":{"target_types":{"all":["槽例","待处理"]},"actions":["transform"]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('控制器', agentProgramSource(), [
      atom('其他窗口', agentProgramSource(), [], 'program@执行'),
      atom('受控目标', '', [], '槽例@待处理'),
      atom('窗口锁程序', source, [], 'program')
    ], 'program@研发')
  ])], null, 2));
  const scheduler = createProgramRuntimeScheduler();
  const interaction = (windowPath) => ({ agent: { ref: `agent:${windowPath}`, path: windowPath } });

  const calculated = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/控制器/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated.errors));
  const derived = await scheduler.activeRequestDrivenLocks(JSON.parse(await fs.readFile(contextFile, 'utf8')));
  assert.deepEqual(derived[0].allowed_windows, {
    types: { all: ['program'], any: ['研发'], none: ['执行'] }
  });
  assert.equal(JSON.stringify(derived).includes('Root/允许窗口'), false);

  const admitted = await executeAtomLanguage({
    source: 'transform {"thing":"Root/控制器/受控目标","situation.rep.研发可写"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器')
  });
  assert.equal(admitted.ok, true, JSON.stringify(admitted.errors));

  const denied = await executeAtomLanguage({
    source: 'transform {"thing":"Root/控制器/受控目标","situation.rep.执行不可写"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/控制器/其他窗口')
  });
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED', JSON.stringify(denied));
});

test('invalid persisted request-driven lock snapshots fail closed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-lock-invalid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'locks.json');
  await fs.writeFile(file, '{"version":1,"locks":[{"sourceProgramPath":"P"}]}');
  const repository = createJsonRequestDrivenLockRepository({ file });
  await assert.rejects(repository.load(), (error) => error.code === 'RETIRED_REQUEST_DRIVEN_LOCK_SNAPSHOT');
});

test('Program source changes rebuild or remove request-driven locks without a persisted snapshot', async () => {
  const locked = fixture(programWithAllowedWindows({ paths: ['Root/允许窗口'] }));
  const scheduler = createProgramRuntimeScheduler();
  assert.equal((await scheduler.rebuildRequestDrivenLocks(locked)).length, 1);

  const broken = structuredClone(locked);
  broken[0].contain[4].situation = 'spec = {"refresh":{"policy":"on_request"}}\nlock(spec)';
  await assert.rejects(
    scheduler.rebuildRequestDrivenLocks(broken),
    (error) => error.code === 'REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED'
  );

  const empty = structuredClone(locked);
  empty[0].contain[4].situation = 'message({"level":"info","text":"no locks"})';
  assert.deepEqual(await scheduler.rebuildRequestDrivenLocks(empty), []);
});
