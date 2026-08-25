import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccessController, walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation: '', contain, support: [] };
}

function program(thing, situation) {
  return { [`thing@program`]: thing, situation, contain: [], support: [] };
}

function world() {
  return [
    atom('祖先', [
      atom('父', [
        atom('窗口', [atom('后代', [atom('深后代')])], 'agent'),
        atom('兄弟')
      ]),
      atom('父同层', [atom('旁支')])
    ]),
    atom('其他分支')
  ];
}

function match(atoms, path) {
  return walkAtoms(atoms).find((entry) => entry.path.join('/') === path);
}

async function decision(controller, atoms, path, operation) {
  return (await controller.authorize(match(atoms, path), operation, 'situation')).decision;
}

test('Agent without jump registration keeps legacy access instead of activating self-lock', async () => {
  const atoms = world();
  const agentPath = '祖先/父/窗口';
  const cycle = await createProgramRuntimeScheduler().refresh(atoms, {
    agentOrigin: { path: agentPath }
  });
  assert.deepEqual(cycle.windowSelfLockAgents, []);

  const controller = createAccessController(atoms, {
    agentPath,
    enforceWindowSelfLock: cycle.windowSelfLockAgents.includes(agentPath)
  });
  assert.equal(await decision(controller, atoms, '祖先', 'read'), 'allow');
  assert.equal(await decision(controller, atoms, agentPath, 'write'), 'allow');
});

test('jump registration activates default self-lock in the same Program cycle', async () => {
  const atoms = [...world(), program('守窗注册', 'jump({})')];
  const agentPath = '祖先/父/窗口';
  const cycle = await createProgramRuntimeScheduler().refresh(atoms, {
    agentOrigin: { path: agentPath }
  });
  assert.deepEqual(cycle.windowSelfLockAgents, [agentPath]);
  assert.deepEqual(cycle.jumps, [{ action: 'guard', sourceProgramPath: '守窗注册' }]);

  const controller = createAccessController(atoms, {
    agentPath,
    enforceWindowSelfLock: cycle.windowSelfLockAgents.includes(agentPath)
  });
  assert.equal(await decision(controller, atoms, '祖先', 'read'), 'deny');
  assert.equal(await decision(controller, atoms, agentPath, 'write'), 'deny');
  assert.equal(await decision(controller, atoms, agentPath, 'read'), 'allow');
});

test('default window self-lock reads current, descendants, peers and only the direct parent', async () => {
  const atoms = world();
  const controller = createAccessController(atoms, { agentPath: '祖先/父/窗口', enforceWindowSelfLock: true });
  for (const path of ['祖先/父/窗口', '祖先/父/窗口/后代', '祖先/父/窗口/后代/深后代', '祖先/父/兄弟', '祖先/父']) {
    assert.equal(await decision(controller, atoms, path, 'read'), 'allow', path);
  }
  for (const path of ['祖先', '祖先/父同层', '祖先/父同层/旁支', '其他分支']) {
    assert.equal(await decision(controller, atoms, path, 'read'), 'deny', path);
  }
});

test('default window self-lock writes descendants only', async () => {
  const atoms = world();
  const controller = createAccessController(atoms, { agentPath: '祖先/父/窗口', enforceWindowSelfLock: true });
  for (const path of ['祖先/父/窗口/后代', '祖先/父/窗口/后代/深后代']) {
    assert.equal(await decision(controller, atoms, path, 'write'), 'allow', path);
  }
  for (const path of ['祖先/父/窗口', '祖先/父/兄弟', '祖先/父', '祖先', '其他分支']) {
    assert.equal(await decision(controller, atoms, path, 'write'), 'deny', path);
  }
});

test('explicit read/write allow and deny use highest priority, deny ties, and default fallback', async () => {
  const atoms = world();
  const policy = {
    read: {
      allow: [
        { priority: 2, fromPath: '祖先/父同层', descendants: 'all' },
        { priority: 3, fromPath: '其他分支' }
      ],
      deny: [
        { priority: 1, fromPath: '祖先/父同层', descendants: 'all' },
        { priority: 3, fromPath: '其他分支' }
      ]
    },
    write: {
      allow: [{ priority: 4, fromPath: '祖先/父', peers: true }],
      deny: [{ priority: 5, fromPath: '祖先/父/兄弟' }]
    }
  };
  const controller = createAccessController(atoms, {
    agentPath: '祖先/父/窗口', windowSelfLock: policy
  });
  assert.equal(await decision(controller, atoms, '祖先/父同层/旁支', 'read'), 'allow');
  assert.equal(await decision(controller, atoms, '其他分支', 'read'), 'deny');
  assert.equal(await decision(controller, atoms, '祖先/父/窗口/后代', 'read'), 'allow');
  assert.equal(await decision(controller, atoms, '祖先/父同层', 'write'), 'allow');
  assert.equal(await decision(controller, atoms, '祖先/父/兄弟', 'write'), 'deny');
  assert.equal(await decision(controller, atoms, '祖先/父/窗口', 'write'), 'deny');
});

test('exact paths use the same self-lock and node-lock denial remains independent', async () => {
  const atoms = world();
  const controller = createAccessController(atoms, { agentPath: '祖先/父/窗口', enforceWindowSelfLock: true });
  const denied = await controller.authorize(match(atoms, '祖先/父同层/旁支'), 'read', 'situation');
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.code, 'WINDOW_ACCESS_DENIED');
  assert.equal(denied.lockKind, 'window-self-lock');
});
