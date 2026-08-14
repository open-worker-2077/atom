import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeProgramLock, buildProgramLockIndex } from '../work-engine/atom-language/program-locks.mjs';

const records = [
  { ref: 'r-target', path: '推进流/任务A' },
  { ref: 'r-program', path: '冻结程序' }
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
