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

test('an empty Program lock result does not index unrelated world records', () => {
  const unrelatedRecords = new Proxy([], {
    get(target, property, receiver) {
      if (property === 'map') throw new Error('unrelated records were indexed');
      return Reflect.get(target, property, receiver);
    }
  });

  const index = buildProgramLockIndex({
    revision: 'rev-empty', records: unrelatedRecords, results: []
  });

  assert.equal(index.revision, 'rev-empty');
  assert.equal(index.byPath.size, 0);
});

test('ref-based Program locks index only referenced records without cloning the world', () => {
  const lazyRecords = new Proxy(records, {
    get(target, property, receiver) {
      if (property === 'map') throw new Error('complete record Map allocation');
      return Reflect.get(target, property, receiver);
    }
  });

  const index = buildProgramLockIndex({
    revision: 'rev-ref', records: lazyRecords,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['thing'],
      protect: { atom: true, messages: false },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(index.byPath.has('推进流/任务A'), true);
});

test('subtree spatial lock follows the window parent and admits only its scheduler Program', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-spatial', records,
    results: [{
      targets: { refs: ['r-root'], scope: 'subtree' },
      mode: 'read_write',
      fields: ['thing', 'situation', 'slot', 'strut'],
      protect: { atom: true, messages: false },
      allowed_windows: { relation: 'target_within_window_parent' },
      allowed_programs: { paths: ['推进流/调度程序'] },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A/字段', operation: 'read', field: 'situation',
    agentPath: '推进流/任务A/执行窗口', agentIdentity: true
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务B', operation: 'read', field: 'situation',
    agentPath: '推进流/任务A/执行窗口', agentIdentity: true
  }).decision, 'truncate');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/状态', operation: 'read', field: 'situation',
    agentPath: '推进流/任务A/执行窗口', agentIdentity: true
  }).decision, 'truncate');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A/执行窗口', operation: 'write', field: 'thing',
    agentPath: '推进流/任务A/执行窗口', agentIdentity: true
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A/执行窗口', operation: 'write', field: 'thing',
    agentPath: '推进流/任务A/执行窗口', agentIdentity: true, programPath: '推进流/调度程序'
  }).decision, 'allow');
});

test('TC-PERF-AFFECTED-CLOSURE: lock selection reads only the exact target and its ancestor chain', () => {
  const reads = [];
  const subtreeSource = {
    readFields: new Set(), writeFields: new Set(['situation']),
    targetScope: 'subtree', sourceProgramPath: 'Root/Guard'
  };
  const index = {
    byPath: {
      get(path) {
        reads.push(path);
        return path === 'Root'
          ? { read: new Set(), write: new Set(['situation']), sources: [subtreeSource] }
          : null;
      }
    }
  };

  const decision = authorizeProgramLock({
    lockIndex: index,
    targetPath: 'Root/Branch/Leaf',
    operation: 'write',
    field: 'situation'
  });

  assert.equal(decision.decision, 'deny');
  assert.deepEqual(reads, ['Root/Branch/Leaf', 'Root/Branch', 'Root']);
  assert.equal(reads.includes('Unrelated'), false);
});

test('field-specific Program locks restrict only the requested Atom fields', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-1', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['thing'],
      protect: { atom: true, messages: false }, sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'thing' }).decision, 'deny');
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation' }).decision, 'allow');
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
  assert.equal(authorizeProgramLock({ lockIndex: index, targetPath: '冻结程序', operation: 'read', field: 'situation' }).decision, 'allow');
});

test('an allowed Agent window bypasses only its matching Program lock', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-window', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'read_write', fields: ['situation'],
      protect: { atom: true, messages: false },
      allowed_windows: { paths: ['推进流/允许窗口'] },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index,
    targetPath: '推进流/任务A',
    operation: 'write',
    field: 'situation',
    agentPath: '推进流/允许窗口', agentIdentity: true
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index,
    targetPath: '推进流/任务A',
    operation: 'write',
    field: 'situation',
    agentPath: '推进流/其他窗口', agentIdentity: true
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'read', field: 'situation',
    agentPath: '推进流/允许窗口', agentIdentity: true
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'read', field: 'situation',
    agentPath: '推进流/其他窗口', agentIdentity: true
  }).decision, 'truncate');
});

test('window Graph types admit a class without matching a concrete path or name', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-types', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['situation'],
      protect: { atom: true, messages: false },
      allowed_windows: { types: { all: ['agent'], any: ['研发', '总控'], none: ['执行'] } },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation',
    agentPath: '任意新路径', agentTypes: ['agent', '研发'], agentIdentity: true, targetTypes: ['槽例', '待处理'], action: 'transform'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation',
    agentPath: '推进流/其他窗口', agentTypes: ['agent', '执行'], agentIdentity: true, targetTypes: ['槽例', '待处理'], action: 'transform'
  }).decision, 'deny');
});

test('undeclared origins cannot satisfy exact, type, or relation Program-lock window exceptions', () => {
  const target = '推进流/任务A';
  const cases = [
    {
      name: 'ordinary Program path',
      allowed_windows: { paths: ['推进流/普通程序'] },
      agentPath: '推进流/普通程序',
      agentTypes: ['program']
    },
    {
      name: 'legacy Agent Key without a declaration',
      allowed_windows: { types: { all: ['agent'], any: ['研发'] } },
      agentPath: '推进流/遗留窗口',
      agentTypes: ['agent', '研发']
    },
    {
      name: 'relation-matching non-Agent path',
      allowed_windows: { relation: 'target_within_window_parent' },
      agentPath: '推进流/任务A/普通程序',
      agentTypes: ['program']
    }
  ];

  for (const entry of cases) {
    const index = buildProgramLockIndex({
      revision: `undeclared-${entry.name}`,
      records,
      results: [{
        targets: { refs: ['r-target'] }, mode: 'write', fields: ['situation'],
        protect: { atom: true, messages: false }, allowed_windows: entry.allowed_windows,
        sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
      }]
    });
    assert.equal(authorizeProgramLock({
      lockIndex: index,
      targetPath: target,
      operation: 'write',
      field: 'situation',
      agentPath: entry.agentPath,
      agentTypes: entry.agentTypes,
      agentIdentity: false
    }).decision, 'deny', entry.name);
  }
});

test('Program-lock window exceptions require an explicit derived Agent identity', () => {
  const index = buildProgramLockIndex({
    revision: 'implicit-agent-identity', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['situation'],
      protect: { atom: true, messages: false },
      allowed_windows: { paths: ['推进流/允许窗口'] },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation',
    agentPath: '推进流/允许窗口'
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation',
    agentPath: '推进流/允许窗口', agentIdentity: true
  }).decision, 'allow');
});

test('target state and interaction action independently decide whether a lock is active', () => {
  const index = buildProgramLockIndex({
    revision: 'rev-conditions', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'read_write', fields: ['situation'],
      protect: { atom: true, messages: false },
      when: {
        target_types: { all: ['槽例'], any: ['待处理'] },
        actions: ['transform']
      },
      sourceProgramRef: 'r-program', sourceProgramPath: '冻结程序'
    }]
  });

  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation',
    targetTypes: ['槽例', '待处理'], action: 'transform'
  }).decision, 'deny');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'read', field: 'situation',
    targetTypes: ['槽例', '待处理'], action: 'explore'
  }).decision, 'allow');
  assert.equal(authorizeProgramLock({
    lockIndex: index, targetPath: '推进流/任务A', operation: 'write', field: 'situation',
    targetTypes: ['槽例', '已完成'], action: 'transform'
  }).decision, 'allow');
});

test('targeted Program refresh preserves locks emitted by Programs that did not run', () => {
  const previous = buildProgramLockIndex({
    revision: 'rev-before', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['situation'],
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
    lockIndex: merged, targetPath: '推进流/任务A', operation: 'write', field: 'situation'
  }).decision, 'deny');
});

test('targeted Program refresh removes an old lock when its source ran without re-emitting it', () => {
  const previous = buildProgramLockIndex({
    revision: 'rev-before', records,
    results: [{
      targets: { refs: ['r-target'] }, mode: 'write', fields: ['situation'],
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
    lockIndex: merged, targetPath: '推进流/任务A', operation: 'write', field: 'situation'
  }).decision, 'allow');
});
