import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccessController, walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation: '', contain, support: [] };
}

const AGENT_SOURCE = 'agent({"labels":["^","approved"],"functions":{"groups":[],"names":["explore","jump","transform"]}})';

function registeredWindow(thing, contain = []) {
  const value = atom(thing, contain, 'program');
  value.situation = AGENT_SOURCE;
  return value;
}

function world() {
  return [
    atom('祖先', [
      atom('父', [
        registeredWindow('窗口', [atom('后代', [atom('深后代')])]),
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

const security = {
  labels: ['^', 'approved'],
  functionScopes: { groups: [], names: ['explore', 'jump', 'transform'] },
  functions: ['explore', 'jump', 'transform']
};

test('an unregistered legacy Agent has no v1 security context until bootstrap migration', async () => {
  const atoms = world();
  const agentPath = '祖先/父/窗口';
  const controller = createAccessController(atoms, { agentPath });
  assert.equal(controller.restricted, false);
  assert.equal(await decision(controller, atoms, '祖先', 'read'), 'allow');
  assert.equal(await decision(controller, atoms, agentPath, 'write'), 'allow');
});

test('a source-derived Agent registration activates its fixed window in the same cycle', async () => {
  const atoms = world();
  const agentPath = '祖先/父/窗口';
  const scheduler = createProgramRuntimeScheduler();
  const cycle = await scheduler.refresh(atoms, { agentOrigin: { path: agentPath } });
  assert.deepEqual(cycle.agentSecurity, security);

  const controller = createAccessController(atoms, { agentPath, agentSecurity: cycle.agentSecurity });
  assert.equal(await decision(controller, atoms, '祖先', 'read'), 'deny');
  assert.equal(await decision(controller, atoms, agentPath, 'write'), 'allow');
  assert.equal(await decision(controller, atoms, agentPath, 'read'), 'allow');
});

test('fixed window Explore allows current descendants peers and only the direct parent', async () => {
  const atoms = world();
  const controller = createAccessController(atoms, {
    agentPath: '祖先/父/窗口', agentSecurity: security
  });
  for (const path of ['祖先/父/窗口', '祖先/父/窗口/后代', '祖先/父/窗口/后代/深后代', '祖先/父/兄弟', '祖先/父']) {
    assert.equal(await decision(controller, atoms, path, 'read'), 'allow', path);
  }
  for (const path of ['祖先', '祖先/父同层', '祖先/父同层/旁支', '其他分支']) {
    assert.equal(await decision(controller, atoms, path, 'read'), 'deny', path);
  }
});

test('fixed window Transform allows the current Agent and descendants only', async () => {
  const atoms = world();
  const controller = createAccessController(atoms, {
    agentPath: '祖先/父/窗口', agentSecurity: security
  });
  for (const path of ['祖先/父/窗口', '祖先/父/窗口/后代', '祖先/父/窗口/后代/深后代']) {
    assert.equal(await decision(controller, atoms, path, 'write'), 'allow', path);
  }
  for (const path of ['祖先/父/兄弟', '祖先/父', '祖先', '其他分支']) {
    assert.equal(await decision(controller, atoms, path, 'write'), 'deny', path);
  }
});

test('business Graph locks require labels independently for Explore and Transform', async () => {
  const atoms = world();
  const locks = [
    { kind: 'node', path: '祖先/父/兄弟', actions: ['explore'], labels: ['approved'] },
    { kind: 'node', path: '祖先/父/窗口/后代', actions: ['transform'], labels: ['writer'] }
  ];
  const controller = createAccessController(atoms, {
    agentPath: '祖先/父/窗口', agentSecurity: security, graphLocks: locks
  });
  assert.equal(await decision(controller, atoms, '祖先/父/兄弟', 'read'), 'allow');
  assert.equal(await decision(controller, atoms, '祖先/父/窗口/后代', 'read'), 'allow');
  assert.equal(await decision(controller, atoms, '祖先/父/窗口/后代', 'write'), 'deny');
});

test('exact paths use the fixed window and node-lock denial remains independent', async () => {
  const atoms = world();
  const agentPath = '祖先/父/窗口';
  const controller = createAccessController(atoms, {
    agentPath,
    agentSecurity: security,
    graphLocks: [{
      kind: 'node', path: `${agentPath}/后代`, actions: ['explore'], labels: ['missing']
    }]
  });
  const outside = await controller.authorize(match(atoms, '祖先/父同层/旁支'), 'read', 'situation');
  assert.equal(outside.code, 'WINDOW_ACCESS_DENIED');
  assert.equal(outside.lockKind, 'agent-window');
  const node = await controller.authorize(match(atoms, `${agentPath}/后代`), 'read', 'situation');
  assert.equal(node.code, 'GRAPH_LOCK_DENIED');
  assert.equal(node.lockKind, 'node');
});
