import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessController } from '../work-engine/atom-language/query-capability.mjs';

test('reading many nodes filters write-only Graph locks once per access controller', async () => {
  let actionReads = 0;
  const locks = Array.from({ length: 100 }, (_, i) => ({
    kind: 'node', path: `Root/N${i}`, labels: ['locked'],
    get actions() { actionReads += 1; return ['transform']; }
  }));
  const world = [{ thing: 'Root', situation: '', slot: [], strut: [] }];
  const controller = createAccessController(world, {
    agentPath: 'Root', agentSecurity: { labels: [] }, graphLocks: locks
  });
  for (let i = 0; i < 20; i += 1) {
    const match = { path: ['Root', `N${i}`], atom: { thing: `N${i}` } };
    assert.equal((await controller.authorize(match, 'read', 'thing')).decision, 'allow');
  }
  assert.ok(actionReads <= 400, `lock action classification must not repeat for every node: ${actionReads}`);
  assert.equal((await controller.authorize({ path: ['Root', 'N0'], atom: { thing: 'N0' } }, 'write', 'thing')).decision, 'deny');
});
