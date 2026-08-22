import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeProgramLock,
  buildProgramLockIndex,
  mergeProgramLockIndexes
} from '../work-engine/atom-language/program-locks.mjs';

const records = [
  { ref: 'r-target', path: '推进流/任务A', types: [] },
  { ref: 'r-program', path: '冻结程序', types: ['program'] },
  { ref: 'r-allowed', path: '推进流/允许窗口', types: ['agent'] },
  { ref: 'r-denied', path: '推进流/其他窗口', types: ['agent'] }
];

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
