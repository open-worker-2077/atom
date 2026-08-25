import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeProgramExplore } from '../work-engine/atom-language/engine.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

function world(rule) {
  return [atom('Root', '', [
    atom('Area', '', [atom('Window', '', [], 'agent')]),
    atom('Other'),
    atom('Registration', [
      'other = explore({"thing":"Root/Other"})[0]',
      `jump({"lock":{"read":${JSON.stringify(rule).replaceAll('"from":"other"', '"from":other')}}})`
    ].join('\n'), [], 'program')
  ])];
}

test('an active window may tighten but cannot expand its own effective self-lock', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const agentOrigin = { path: 'Root/Area/Window' };
  await scheduler.refresh(world({
    allow: [{ priority: 1, from: 'other' }],
    deny: [{ priority: 2, from: 'other' }]
  }), { agentOrigin });

  await scheduler.refresh(world({
    allow: [{ priority: 1, from: 'other' }],
    deny: [{ priority: 3, from: 'other' }]
  }), { agentOrigin });

  await assert.rejects(scheduler.refresh(world({
    allow: [{ priority: 4, from: 'other' }],
    deny: [{ priority: 3, from: 'other' }]
  }), { agentOrigin }), { code: 'WINDOW_SELF_LOCK_EXPANSION_DENIED' });
});

test('a different reachable window can replace or remove an override without a privileged role', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const records = [
    { path: 'Root/Upper' }, { path: 'Root/Area/Window' }, { path: 'Root/Other' }
  ];
  const restrictive = {
    read: { deny: [{ priority: 2, fromPath: 'Root/Other' }] }
  };
  await scheduler.replaceWindowSelfLock({
    callerPath: 'Root/Upper', targetPath: 'Root/Area/Window',
    policy: restrictive, records,
    authorize: async () => ({ decision: 'allow' })
  });
  assert.deepEqual(scheduler.activeWindowSelfLocks.get('Root/Area/Window'), restrictive);

  await assert.rejects(scheduler.replaceWindowSelfLock({
    callerPath: 'Root/Denied', targetPath: 'Root/Area/Window',
    policy: null, records,
    authorize: async () => ({ decision: 'deny' })
  }), { code: 'WINDOW_ACCESS_DENIED' });
  assert.notEqual(scheduler.activeWindowSelfLocks.get('Root/Area/Window'), undefined);

  await scheduler.replaceWindowSelfLock({
    callerPath: 'Root/Upper', targetPath: 'Root/Area/Window',
    policy: null, records,
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(scheduler.activeWindowSelfLocks.get('Root/Area/Window'), undefined);
  assert.equal(scheduler.activeWindowAgents.has('Root/Area/Window'), true);
});

test('window self-lock normalizes current and current-relative exact explore starts', async () => {
  const currentScheduler = createProgramRuntimeScheduler();
  const currentCycle = await currentScheduler.refresh([
    atom('Policy', 'jump({"lock":{"read":{"allow":[{"priority":1,"from":"current","parent":True,"peers":True,"descendants":2}]}}})', [], 'program')
  ], { agentOrigin: { path: 'Root/Area/Window' } });
  assert.deepEqual(currentCycle.windowSelfLocks[0].policy.read.allow[0], {
    priority: 1,
    fromPath: 'Root/Area/Window',
    currentRelative: true,
    parent: true,
    peers: true,
    descendants: 2
  });

  const scopedWorld = [atom('Root', '', [atom('Area', '', [
    atom('Window', '', [], 'agent'), atom('Child'),
    atom('Policy', [
      'near = explore({"thing":"./Child"})[0]',
      'jump({"lock":{"write":{"deny":[{"priority":3,"from":near}]}}})'
    ].join('\n'), [], 'program')
  ])])];
  const relativeCycle = await createProgramRuntimeScheduler().refresh(scopedWorld, {
    programSelector: 'Root/Area/Policy', force: true, slotScopeRoot: 'Root/Area',
    agentOrigin: { path: 'Root/Area/Window' },
    executeExplore: (request, context = {}) => executeProgramExplore({
      atoms: scopedWorld, request, scopeRoot: context.scopeRoot ?? null
    })
  });
  assert.equal(
    relativeCycle.windowSelfLocks[0].policy.write.deny[0].fromPath,
    'Root/Area/Child'
  );
});

test('window self-lock rejects fuzzy starts, invalid priorities, depths, booleans and keys', async () => {
  const invalidRules = [
    '{"priority":0,"from":"current"}',
    '{"priority":1,"from":"fuzzy"}',
    '{"priority":1,"from":"current","descendants":-1}',
    '{"priority":1,"from":"current","parent":1}',
    '{"priority":1,"from":"current","adjacent":True}'
  ];
  for (const rule of invalidRules) {
    await assert.rejects(createProgramRuntimeScheduler().refresh([
      atom('Invalid', `jump({"lock":{"read":{"allow":[${rule}]}}})`, [], 'program')
    ], { agentOrigin: { path: 'Window' } }), { code: 'ATOM_PROGRAM_FAILED' });
  }
});
