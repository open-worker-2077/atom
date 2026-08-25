import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeProgramLock,
  buildProgramLockIndex,
  mergeProgramLockIndexes
} from '../work-engine/atom-language/program-locks.mjs';

const records = [
  { ref: 'r-root', path: '推进流', types: [] },
  { ref: 'r-target', path: '推进流/任务A', types: ['槽例', '待处理'] },
  { ref: 'r-program', path: '冻结程序', types: ['program'] },
  { ref: 'r-allowed', path: '推进流/允许窗口', types: ['agent', '研发'] },
  { ref: 'r-denied', path: '推进流/其他窗口', types: ['agent', '执行'] }
];

test('subtree spatial lock follows the window parent and admits only its scheduler Program', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-spatial', records,
    results: [{
      targets: { refs: ['r-root'], scope: 'subtree' },
      mode: 'read_write',
      fields: ['name', 'detail', 'children', 'partners'],
      protect: { atom: true, messages: false },
      allowed_windows: { relation: 'target_within_window_parent' },
      allowed_programs: { paths: ['推进流/调度程序'] },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A/字段', operation: 'read', field: 'detail',
    agentPath: '推进流/任务A/执行窗口'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务B', operation: 'read', field: 'detail',
    agentPath: '推进流/任务A/执行窗口'
  }).decision, 'truncate');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/状态', operation: 'read', field: 'detail',
    agentPath: '推进流/任务A/执行窗口'
  }).decision, 'truncate');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A/执行窗口', operation: 'write', field: 'name',
    agentPath: '推进流/任务A/执行窗口'
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A/执行窗口', operation: 'write', field: 'name',
    agentPath: '推进流/任务A/执行窗口', programPath: '推进流/调度程序'
  }).decision, 'allow');
});

test('field-specific Program locks restrict only the requested Atom fields', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-1', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['name'],
      protect: { atom: true, messages: false }, sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'name' }).decision, 'deny');
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'detail' }).decision, 'allow');
});

test('message protection is explicit and independent from Atom content protection', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-1', records,
    results: [{
      targets: { refs: ['r-program'] }, mode: 'read_write', fields: ['messages'],
      protect: { atom: false, messages: true }, sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '冻结程序', operation: 'read', field: 'messages' }).decision, 'truncate');
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '冻结程序', operation: 'read', field: 'detail' }).decision, 'allow');
});

test('an allowed Agent window bypasses only its matching Program lock', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-window', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'read_write', fields: ['detail'],
      protect: { atom: true, messages: false },
      allowed_windows: { paths: ['推进流/允许窗口'] },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index,
    targetPath: '推进流/任务A',
    operation: 'write',
    field: 'detail',
    agentPath: '推进流/允许窗口'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index,
    targetPath: '推进流/任务A',
    operation: 'write',
    field: 'detail',
    agentPath: '推进流/其他窗口'
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'read', field: 'detail',
    agentPath: '推进流/允许窗口'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'read', field: 'detail',
    agentPath: '推进流/其他窗口'
  }).decision, 'truncate');
});

test('window Graph types admit a class without matching a concrete path or name', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-types', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['detail'],
      protect: { atom: true, messages: false },
      allowed_windows: { types: { all: ['agent'], any: ['研发', '总控'], none: ['执行'] } },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'detail',
    agentPath: '任意新路径', agentTypes: ['agent', '研发'], targetTypes: ['槽例', '待处理'], action: 'transform'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'detail',
    agentPath: '推进流/其他窗口', agentTypes: ['agent', '执行'], targetTypes: ['槽例', '待处理'], action: 'transform'
  }).decision, 'deny');
});

test('target state and interaction action independently decide whether a lock is active', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-conditions', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'read_write', fields: ['detail'],
      protect: { atom: true, messages: false },
      when: {
        target_types: { all: ['槽例'], any: ['待处理'] },
        actions: ['transform']
      },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'detail',
    targetTypes: ['槽例', '待处理'], action: 'transform'
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'read', field: 'detail',
    targetTypes: ['槽例', '待处理'], action: 'explore'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'detail',
    targetTypes: ['槽例', '已完成'], action: 'transform'
  }).decision, 'allow');
});

test('targeted Program refresh preserves locks emitted by Programs that did not run', () => {
  const previous = buildProgramLockIndex({
    revision: 'rev-before', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['detail'],
      protect: { atom: true, messages: false },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });
  const merged = mergeProgramLockIndexes({
    revision: 'rev-after',
    previous,
    next: buildProgramLockIndex({ revision: 'rev-after', records, results: [] }),
    replacedSources: new Set(['其他程序'])
  });

  assert.equal(authorizeProgramLock({
    lockIndex: merged, targetPath: '推进流/任务A', operation: 'write', field: 'detail'
  }).decision, 'deny');
});

test('targeted Program refresh removes an old lock when its source ran without re-emitting it', () => {
  const previous = buildProgramLockIndex({
    revision: 'rev-before', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['detail'],
      protect: { atom: true, messages: false },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });
  const merged = mergeProgramLockIndexes({
    revision: 'rev-after',
    previous,
    next: buildProgramLockIndex({ revision: 'rev-after', records, results: [] }),
    replacedSources: new Set(['冻结程序'])
  });

  assert.equal(authorizeProgramLock({
    lockIndex: merged, targetPath: '推进流/任务A', operation: 'write', field: 'detail'
  }).decision, 'allow');
});
