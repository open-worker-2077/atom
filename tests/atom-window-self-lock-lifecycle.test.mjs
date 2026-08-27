import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRequestDrivenLockSnapshot } from '../src/atom-system/public/request-driven-lock-contract.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { authorizeWindowGraphPath } from '../work-engine/atom-language/window-lock-v1.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

test('jump.lock is a retired permission ABI and is rejected before any effect', async () => {
  await assert.rejects(createProgramRuntimeScheduler().refresh([
    atom('Root'),
    atom('Registration', 'jump({"lock":{"read":{"allow":[]}}})', [], 'program')
  ], { programSelector: 'Registration', force: true, agentOrigin: { path: 'Root/Window' } }),
  (error) => error.code === 'INVALID_JUMP_CONTRACT');
});

test('the v1 scheduler does not expose the retired mutable self-lock control surface', () => {
  const scheduler = createProgramRuntimeScheduler();
  assert.equal(typeof scheduler.replaceWindowSelfLock, 'undefined');
  assert.equal(scheduler.activeWindowSelfLocks, undefined);
});

test('fixed Agent paths allow current descendants peers and one parent but deny ancestors', () => {
  const authorize = (targetPath, operation = 'explore') => authorizeWindowGraphPath({
    agentPath: 'Root/Area/Window', targetPath, operation, labels: [], locks: []
  });
  for (const target of [
    'Root/Area/Window', 'Root/Area/Window/Child', 'Root/Area/Peer', 'Root/Area'
  ]) assert.equal(authorize(target).decision, 'allow', target);
  for (const target of ['Root', 'Root/Other']) {
    const denied = authorize(target);
    assert.equal(denied.decision, 'deny', target);
    assert.equal(denied.code, 'WINDOW_ACCESS_DENIED', target);
  }
  assert.equal(authorize('Root/Area/Window', 'transform').decision, 'deny');
  assert.equal(authorize('Root/Area/Window/Child', 'transform').decision, 'allow');
});

test('request-driven snapshots reject both retired window self-lock encodings', () => {
  for (const retired of [
    { windowSelfLockAgents: ['Root/Area/Window'] },
    { windowSelfLocks: [{ agentPath: 'Root/Area/Window', policy: {} }] }
  ]) {
    assert.throws(
      () => validateRequestDrivenLockSnapshot({ version: 1, locks: [], ...retired }),
      (error) => error.code === 'RETIRED_WINDOW_SELF_LOCK_SNAPSHOT'
    );
  }
});
