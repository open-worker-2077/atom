import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
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
    'rows = explore({"name":"Root/受控目标"})',
    'lock({',
    '  "targets": {"refs": [rows[0].ref]},',
    '  "mode": "write",',
    '  "fields": ["detail"],',
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
    'target = explore({"name":"Root/受控目标"})[0]',
    'window = explore({"name":"允许窗口"})[0]',
    'lock({"targets":{"refs":[target.ref]},"mode":"write","fields":["detail"],"allowed_windows":{"paths":[window.path]},"refresh":{"policy":"on_request"}})'
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
    source: 'transform {"name.run.":"Root/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated.errors));

  const denied = await executeAtomLanguage({
    source: 'transform {"name":"Root/受控目标","detail.rep.拒绝"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/其他窗口')
  });
  assert.equal(denied.errors[0].code, 'PROGRAM_LOCK_DENIED', JSON.stringify(denied));

  const moved = await executeAtomLanguage({
    source: 'transform {"name.mov.Root/新父":"Root/允许窗口"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const stale = await executeAtomLanguage({
    source: 'transform {"name":"Root/受控目标","detail.rep.仍拒绝"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/新父/允许窗口')
  });
  assert.equal(stale.errors[0].code, 'PROGRAM_LOCK_DENIED');

  const restarted = createProgramRuntimeScheduler({
    requestDrivenLockRepository: repository, projectionRepository
  });
  const recomputed = await executeAtomLanguage({
    source: 'transform {"name.run.":"Root/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: restarted, interaction: interaction('Root/新父/允许窗口')
  });
  assert.equal(recomputed.ok, true, JSON.stringify(recomputed.errors));
  const allowed = await executeAtomLanguage({
    source: 'transform {"name":"Root/受控目标","detail.rep.允许"}', contextFile, projectionFile,
    programScheduler: restarted, interaction: interaction('Root/新父/允许窗口')
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.errors));
  const root = JSON.parse(await fs.readFile(contextFile, 'utf8'))[0];
  assert.equal(root.children.find((item) => item.name === '受控目标').detail, '允许');
});

test('world-record window types enforce transform locks and persist without concrete window paths', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-type-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const snapshotFile = path.join(directory, 'request-driven-locks.json');
  const source = [
    'target = explore({"name":"Root/受控目标"})[0]',
    'lock({"targets":{"refs":[target.ref]},"mode":"write","fields":["detail"],"allowed_windows":{"types":{"all":["agent"],"any":["研发"],"none":["执行"]}},"when":{"target_types":{"all":["槽例","待处理"]},"actions":["transform"]},"refresh":{"policy":"on_request"}})'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify(fixture(source), null, 2));
  const repository = createJsonRequestDrivenLockRepository({ file: snapshotFile });
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  const interaction = (windowPath) => ({ agent: { ref: `agent:${windowPath}`, path: windowPath } });

  const calculated = await executeAtomLanguage({
    source: 'transform {"name.run.":"Root/窗口锁程序"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated.errors));
  const stored = await repository.load();
  assert.deepEqual(stored.locks[0].allowed_windows, {
    types: { all: ['agent'], any: ['研发'], none: ['执行'] }
  });
  assert.equal(JSON.stringify(stored).includes('Root/允许窗口'), false);

  const admitted = await executeAtomLanguage({
    source: 'transform {"name":"Root/受控目标","detail.rep.研发可写"}', contextFile, projectionFile,
    programScheduler: scheduler, interaction: interaction('Root/允许窗口')
  });
  assert.equal(admitted.ok, true, JSON.stringify(admitted.errors));

  const denied = await executeAtomLanguage({
    source: 'transform {"name":"Root/受控目标","detail.rep.执行不可写"}', contextFile, projectionFile,
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
  broken[0].children[4].detail = 'raise ValueError("broken recomputation")';
  const failure = await scheduler.refresh(broken, {
    programSelector: 'Root/窗口锁程序', force: true, isolateFailures: true
  });
  assert.equal(failure.failures[0].code, 'ATOM_PROGRAM_FAILED');
  assert.equal((await repository.load()).locks.length, 1);

  const empty = structuredClone(locked);
  empty[0].children[4].detail = 'message({"level":"info","text":"no locks"})';
  await scheduler.refresh(empty, { programSelector: 'Root/窗口锁程序', force: true });
  assert.deepEqual((await repository.load()).locks, []);
});
