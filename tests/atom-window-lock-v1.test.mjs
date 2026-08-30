import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  authorizeWindowGraphPath,
  normalizeAgentLabels,
  validateAgentDelegation,
  validateDelegatedLabels
} from '../work-engine/atom-language/window-lock-v1.mjs';
import { expandProgramFunctionSelection } from '../work-engine/atom-language/program-function-registry.mjs';
import { programFunctionRegistry } from '../work-engine/atom-language/program-function-registry.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

test('function groups resolve through the current registry to deduplicated effective names', () => {
  assert.deepEqual(expandProgramFunctionSelection({ groups: ['form'], names: ['message', 'form'] }), [
    'form', 'form_status', 'message', 'missing_details', 'plan_form_flow'
  ]);
  assert.throws(() => expandProgramFunctionSelection({ groups: ['unknown'], names: [] }),
    (error) => error.code === 'UNKNOWN_PROGRAM_FUNCTION_GROUP');
  assert.throws(() => expandProgramFunctionSelection({ groups: [], names: ['*'] }),
    (error) => error.code === 'UNKNOWN_PROGRAM_FUNCTION');
});

test('agent labels keep caret jurisdiction separate from ordinary business labels', () => {
  assert.deepEqual(normalizeAgentLabels(['^^', 'audit', 'audit']), {
    jurisdiction: 2, business: ['audit']
  });
  assert.deepEqual(validateDelegatedLabels({ creator: ['^^^', 'blue'], child: ['^^', 'green'] }), {
    jurisdiction: 2, business: ['green']
  });
  assert.throws(() => validateDelegatedLabels({ creator: ['^'], child: ['^^'] }),
    (error) => error.code === 'AGENT_JURISDICTION_ESCALATION');
});

test('child Agent functions and jurisdiction are monotonic while caret holders may mint business labels', () => {
  assert.deepEqual(validateAgentDelegation({
    creator: {
      labels: ['^^'], functionScopes: { groups: [], names: ['agent', 'message'] }
    },
    child: { labels: ['^', 'new-business'], functionScopes: { groups: [], names: ['message'] } }
  }), {
    labels: ['^', 'new-business'],
    functionScopes: { groups: [], names: ['message'] },
    functions: ['message']
  });
  assert.throws(() => validateAgentDelegation({
    creator: { labels: [], functionScopes: { groups: [], names: ['message'] } },
    child: {
      labels: ['new-business'], functionScopes: { groups: [], names: ['message'] }
    }
  }), (error) => error.code === 'AGENT_LABEL_DELEGATION_DENIED');
  assert.throws(() => validateAgentDelegation({
    creator: { labels: ['^'], functionScopes: { groups: [], names: ['message'] } },
    child: { labels: [], functionScopes: { groups: [], names: ['transform'] } }
  }), (error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED');
});

test('fixed Agent window lock authorizes the real path and only peeks at the direct parent', () => {
  const decide = (targetPath, operation = 'explore') => authorizeWindowGraphPath({
    agentPath: 'Root/Order/Agent', targetPath, operation, locks: [], labels: []
  });
  assert.equal(decide('Root/Order/Agent').decision, 'allow');
  assert.equal(decide('Root/Order/Agent/Material', 'transform').decision, 'allow');
  assert.equal(decide('Root/Order/Peer').decision, 'allow');
  assert.equal(decide('Root/Order').decision, 'allow');
  assert.equal(decide('Root/Order', 'transform').code, 'WINDOW_ACCESS_DENIED');
  assert.equal(decide('Root').code, 'WINDOW_ACCESS_DENIED');
  assert.equal(decide('Root/Other').code, 'WINDOW_ACCESS_DENIED');
});

test('contain locks are checked before target node locks and labels are action-specific', () => {
  const locks = [
    { kind: 'contain', path: 'Root/Order/Agent/Area', actions: ['explore'], labels: ['pass'] },
    { kind: 'node', path: 'Root/Order/Agent/Area/Record', actions: ['transform'], labels: ['edit'] }
  ];
  const decide = (targetPath, operation, labels) => authorizeWindowGraphPath({
    agentPath: 'Root/Order/Agent', targetPath, operation, locks, labels
  });
  assert.equal(decide('Root/Order/Agent/Area/Record', 'explore', []).lockKind, 'contain');
  assert.equal(decide('Root/Order/Agent/Area/Record', 'explore', ['pass']).decision, 'allow');
  assert.equal(decide('Root/Order/Agent/Area/Record', 'transform', ['pass']).lockKind, 'node');
  assert.equal(decide('Root/Order/Agent/Area/Record', 'transform', ['edit']).decision, 'allow');
});

test('Agent targets use caret jurisdiction and exact business labels through the ordinary matcher', () => {
  const targetPath = 'Root/Order/Agent';
  const decide = (labels, required) => authorizeWindowGraphPath({
    agentPath: targetPath,
    targetPath,
    operation: 'transform',
    labels,
    locks: [{ kind: 'node', path: targetPath, actions: ['transform'], labels: required }]
  });

  assert.equal(decide(['^^', 'finance'], ['^', 'finance']).decision, 'allow');
  assert.equal(decide(['^', 'finance'], ['^^', 'finance']).code, 'GRAPH_LOCK_DENIED');
  assert.equal(decide(['^^', 'Finance'], ['^', 'finance']).code, 'GRAPH_LOCK_DENIED');
});

test('agent() declares the current Program node and preserves symbolic scopes with effective names', async () => {
  const cycle = await createProgramRuntimeScheduler().refresh([
    atom('Registrar', 'agent({"labels":["^^","audit"],"functions":{"groups":["form"],"names":["message","form"]}})', [], 'program')
  ], { programSelector: 'Registrar', force: true, agentOrigin: { path: 'Root/Controller' } });
  assert.deepEqual(cycle.agentRegistrations, [{
    sourceProgramPath: 'Registrar',
    labels: ['^^', 'audit'],
    functionScopes: { groups: ['form'], names: ['form', 'message'] },
    functions: ['form', 'form_status', 'message', 'missing_details', 'plan_form_flow']
  }]);
});

test('projection modes never turn concurrent agent declarations into a registration transaction', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-passive-agent-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const initial = [atom('Root', '', [
    atom('Registrar A', 'agent({"labels":["^"],"functions":{"groups":[],"names":["message"]}})', [], 'program'),
    atom('Registrar B', 'agent({"labels":["^"],"functions":{"groups":[],"names":["message"]}})', [], 'program')
  ])];
  for (const programMode of ['project', 'passive']) {
    const contextFile = path.join(directory, `${programMode}-atom.json`);
    const projectionFile = path.join(directory, `${programMode}-graph.json`);
    await fs.writeFile(contextFile, JSON.stringify(initial, null, 2));

    const result = await executeAtomLanguage({
      source: 'atom',
      programMode,
      contextFile,
      projectionFile,
      programScheduler: createProgramRuntimeScheduler(),
      interaction: { id: `${programMode}-cold-program-context`, agent: null }
    });

    assert.equal(result.ok, true, `${programMode}: ${JSON.stringify(result.errors)}`);
    assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), initial);
  }
});

test('exact Explore never aggregates unrelated agent declarations into a registration transaction', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-explore-agent-read-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const initial = [atom('Root', '', [
    atom('Registrar A', 'agent({"labels":["^"],"functions":{"groups":[],"names":["message"]}})', [], 'program'),
    atom('Registrar B', 'agent({"labels":["^"],"functions":{"groups":[],"names":["message"]}})', [], 'program'),
    atom('Target', 'must-remain-readable')
  ])];
  await fs.writeFile(contextFile, JSON.stringify(initial, null, 2));
  const scheduler = createProgramRuntimeScheduler();
  const initialized = await executeAtomLanguage({
    source: 'atom',
    programMode: 'project',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction: { id: 'initial-program-projection', agent: null }
  });
  assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));

  const result = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Target","situation$full":true}',
    programMode: null,
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    interaction: { id: 'exact-read-with-unrelated-agent-declarations', agent: null }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].situation, 'must-remain-readable');
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), initial);
});

test('agent() rejects target, lock, mode, missing functions, null and wildcard grants', async () => {
  for (const expression of [
    '{"target":"Elsewhere","functions":{"groups":[],"names":["message"]}}',
    '{"lock":{},"functions":{"groups":[],"names":["message"]}}',
    '{"mode":"global","functions":{"groups":[],"names":["message"]}}',
    '{"labels":[]}',
    '{"functions":None}',
    '{"functions":{"groups":[],"names":["*"]}}'
  ]) {
    await assert.rejects(createProgramRuntimeScheduler().refresh([
      atom('Registrar', `agent(${expression})`, [], 'program')
    ], { programSelector: 'Registrar', force: true, agentOrigin: { path: 'Root/Controller' } }),
    (error) => ['INVALID_AGENT_REGISTRATION', 'UNKNOWN_PROGRAM_FUNCTION'].includes(error.code));
  }
});

test('agent registry does not define a separate management authority', () => {
  const registration = programFunctionRegistry().functions.find((entry) => entry.name === 'agent');
  assert.equal(Object.hasOwn(registration.contract, 'management'), false);
});

test('ordinary Transform cannot create or type a Thing as Agent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-forgery-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root')], null, 2));
  const created = await executeAtomLanguage({
    source: 'transform new {"thing@agent":"Forged","situation":"","contain":[],"support":[]}',
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(created.ok, false);
  assert.equal(created.errors[0].code, 'AGENT_REGISTRATION_REQUIRED');
  const typed = await executeAtomLanguage({
    source: 'transform {"thing.typ.agent":"Root"}',
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler()
  });
  assert.equal(typed.ok, false);
  assert.equal(typed.errors[0].code, 'AGENT_REGISTRATION_REQUIRED');
});

test('an Agent key may satisfy its own node lock and reconfigure without exceeding its authority', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-self-reconfigure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const initialSource = 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","transform"]}})';
  const updatedSource = 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Window', initialSource, [], 'program@agent'),
    atom(
      'Window Lock',
      'lock({"targets":{"paths":["Root/Window"],"scope":"exact"},"actions":["transform"],"labels":["^"]})',
      [],
      'program'
    )
  ])], null, 2));

  const result = await executeAtomLanguage({
    source: `transform {"thing":"Root/Window",${JSON.stringify(`situation.rep.${updatedSource}`)}}`,
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { id: 'agent-self-reconfigure', agent: { path: 'Root/Window' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(world[0].contain[0].situation, updatedSource);
});

test('an unmatched Agent node lock denies self-reconfiguration without mutation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-self-lock-denied-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const initialSource = 'agent({"labels":["finance"],"functions":{"groups":[],"names":["explore","transform"]}})';
  const updatedSource = 'agent({"labels":["finance"],"functions":{"groups":[],"names":["explore"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Window', initialSource, [], 'program@agent'),
    atom(
      'Window Lock',
      'lock({"targets":{"paths":["Root/Window"],"scope":"exact"},"actions":["transform"],"labels":["audit"]})',
      [],
      'program'
    )
  ])], null, 2));

  const result = await executeAtomLanguage({
    source: `transform {"thing":"Root/Window",${JSON.stringify(`situation.rep.${updatedSource}`)}}`,
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { id: 'agent-self-lock-denied', agent: { path: 'Root/Window' } }
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some((error) => error.code === 'GRAPH_LOCK_DENIED'), JSON.stringify(result));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(world[0].contain[0].situation, initialSource);
});

async function descendantAgentCandidateFixture(t, suffix, lockFields = ['thing']) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-agent-descendant-${suffix}-`));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const agentSource = 'agent({"labels":["worker"],"functions":{"groups":[],"names":["agent","explore","lock","transform"]}})';
  const initialProgramSource = 'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Window', agentSource, [
      atom('Child Program', initialProgramSource, [], 'program')
    ], 'program@agent'),
    ...(lockFields ? [atom(
      'Registration Lock',
      `lock({"targets":{"paths":["Root/Window/Child Program"]},"mode":"write","fields":${JSON.stringify(lockFields)}})`,
      [],
      'program'
    )] : []),
    atom('Default Backup', '', [], 'backup@default')
  ])], null, 2));
  return { contextFile, projectionFile };
}

const UPDATED_DESCENDANT_AGENT_SOURCE = 'agent({"labels":[],"functions":{"groups":[],"names":["explore","transform"]}})';

for (const scenario of [
  {
    name: 'situation',
    source: `transform {"thing":"Root/Window/Child Program",${JSON.stringify(`situation.rep.${UPDATED_DESCENDANT_AGENT_SOURCE}`)}}`,
    assertStored(world) {
      assert.match(world[0].contain[0].contain[0].situation, /"transform"/u);
    }
  },
  {
    name: 'support',
    source: 'transform {"thing":"Root/Window/Child Program","support.rep.":[{"if@current":true,"then":[{"thing":"Root"}]}]}',
    assertStored(world) {
      assert.equal(world[0].contain[0].contain[0].support[0].then[0].thing, 'Root');
    }
  },
  {
    name: 'discard',
    lockFields: null,
    source: 'transform {"thing.dsc.":"Root/Window/Child Program"}',
    assertStored(world) {
      assert.deepEqual(world[0].contain[0].contain, []);
      const backup = world[0].contain.find((entry) => Object.entries(entry).some(([key, value]) => (
        key.startsWith('thing') && value === 'Default Backup'
      )));
      assert.equal(backup.contain[0]['thing@program'], 'Child Program');
      assert.equal(Object.hasOwn(backup.contain[0], 'thing@program@agent'), false);
    }
  }
]) {
  test(`${scenario.name} Transform on a descendant Agent candidate does not register it`, async (t) => {
    const files = await descendantAgentCandidateFixture(t, scenario.name, scenario.lockFields);

    const result = await executeAtomLanguage({
      source: scenario.source,
      ...files,
      programScheduler: createProgramRuntimeScheduler(),
      interaction: { id: `agent-descendant-${scenario.name}`, agent: { path: 'Root/Window' } }
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const world = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
    scenario.assertStored(world);
    const child = world[0].contain[0].contain[0];
    if (child) {
      assert.equal(Object.hasOwn(child, 'thing@program'), true);
      assert.equal(Object.hasOwn(child, 'thing@program@agent'), false);
    }
  });
}

test('explicitly running an out-of-window Agent candidate still uses the registration gate', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-registration-gate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const candidateSource = 'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Task', '', [
      atom(
        'Window',
        'agent({"labels":["worker"],"functions":{"groups":[],"names":["agent","explore","transform"]}})',
        [],
        'program@agent'
      )
    ]),
    atom('Outside Candidate', candidateSource, [], 'program')
  ])], null, 2));
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Outside Candidate"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { id: 'agent-outside-registration-denied', agent: { path: 'Root/Task/Window' } }
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'), JSON.stringify(result));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(world[0].contain[1].situation, candidateSource);
  assert.equal(Object.hasOwn(world[0].contain[1], 'thing@program@agent'), false);
});

test('jump and slot_body no longer expose caller-defined fixed-lock switches', async () => {
  const registry = programFunctionRegistry();
  const jump = registry.functions.find((entry) => entry.name === 'jump');
  const slotBody = registry.functions.find((entry) => entry.name === 'slot_body');
  assert.deepEqual(Object.keys(jump.contract.argument.properties).sort(), ['recycle', 'when', 'where']);
  assert.equal(Object.hasOwn(slotBody.contract.argument.properties, 'lock'), false);

  for (const [name, source] of [
    ['Jump', 'jump({"lock":{}})'],
    ['Slot', 'slot_body({"action":"seal","body":"Root","lock":False})']
  ]) {
    await assert.rejects(createProgramRuntimeScheduler().refresh([
      atom('Root'), atom(name, source, [], 'program')
    ], { programSelector: name, force: true, agentOrigin: { path: 'Root/Controller' } }),
    (error) => ['INVALID_JUMP_CONTRACT', 'INVALID_SLOT_BODY_EFFECT'].includes(error.code));
  }
});

test('registered Agent execution only exposes functions resolved from its persisted symbolic scopes', async () => {
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(scheduler.refresh([
    atom('Root', '', [
      atom('Agent', 'agent({"labels":["^"],"functions":{"groups":[],"names":["message"]}})', [
        atom('Writer', 'transform({"thing":"Root/Agent","situation.rep.x":None})', [], 'program')
      ], 'program@agent')
    ])
  ], { programSelector: 'Root/Agent/Writer', force: true, agentOrigin: { path: 'Root/Agent' } }),
  (error) => error.code === 'PROGRAM_FUNCTION_DENIED');
});

test('registered Program Explore uses the same fixed Graph path before reading situation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-program-explore-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Area', '', [atom('Window', 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","message"]}})', [atom('Probe', [
      'outside = explore({"thing":"Root/Outside","situation$full":True})[0]',
      'message({"level":"info","text":outside.situation})'
    ].join('\n'), [], 'program')], 'program@agent')]),
    atom('Outside', 'secret')
  ])], null, 2));
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Area/Window/Probe"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { id: 'program-explore-auth', agent: { path: 'Root/Area/Window' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.warnings.some((warning) => warning.code === 'WINDOW_ACCESS_DENIED'));
  assert.deepEqual(result.messages, []);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('lock() publishes only range, Explore or Transform actions, and required labels', async () => {
  const registryLock = programFunctionRegistry().functions.find((entry) => entry.name === 'lock');
  assert.deepEqual(registryLock.contract.argument.required, ['targets', 'actions', 'labels']);
  const cycle = await createProgramRuntimeScheduler().refresh([
    atom('Target'),
    atom('Locker',
      'lock({"targets":{"paths":["Target"],"scope":"subtree"},"actions":["explore","transform"],"labels":["approved"]})',
      [], 'program')
  ], { programSelector: 'Locker', force: true });
  assert.deepEqual(cycle.locks, [{
    kind: 'contain', path: 'Target', actions: ['explore', 'transform'], labels: ['approved'],
    sourceProgramPath: 'Locker'
  }]);
});

test('agent() atomically registers its Program node with no security sidecar authority', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-register-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const lockFile = path.join(directory, 'request-driven-locks.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [
      atom('Controller', '', [], 'agent'),
      atom('Registrar', 'agent({"labels":["^","leaf"],"functions":{"groups":[],"names":["message"]}})', [], 'program')
    ])
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Registrar"}',
    contextFile, projectionFile, programScheduler: scheduler,
    interaction: { id: 'register-leaf', agent: { path: 'Root/Controller' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(Object.hasOwn(world[0].contain[1], 'thing@program@agent'), true);
  await assert.rejects(fs.stat(lockFile), (error) => error.code === 'ENOENT');
  const restarted = createProgramRuntimeScheduler();
  await restarted.rebuildAgentSecurity(world);
  assert.deepEqual(restarted.agentSecurity.get('Root/Registrar'), {
    labels: ['^', 'leaf'],
    functionScopes: { groups: [], names: ['message'] },
    functions: ['message']
  });
});

test('agent() in-memory publication never writes registration authority to the sidecar', async () => {
  let saves = 0;
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: {
    async load() { return { version: 1, locks: [] }; },
    async save() { saves += 1; }
  } });
  await scheduler.registerAgentWindow({
    sourceProgramPath: 'Root/Registrar',
    labels: ['^'],
    functionScopes: { groups: [], names: ['message'] },
    functions: ['message']
  });
  assert.equal(saves, 0);
  assert.equal(scheduler.agentSecurity.has('Root/Registrar'), true);
});

test('Agent move and recycle update only reconstructible in-memory paths, never sidecar authority', async () => {
  let saves = 0;
  const repository = {
    async load() { return { version: 1, locks: [] }; },
    async save() { saves += 1; }
  };
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  await scheduler.registerAgentWindow({
    sourceProgramPath: 'Root/Window', labels: ['^'],
    functionScopes: { groups: [], names: ['jump'] }, functions: ['jump']
  });
  await scheduler.remapAgentWindow('Root/Window', 'Root/Next/Window');
  assert.equal(scheduler.agentSecurity.has('Root/Window'), false);
  assert.equal(scheduler.agentSecurity.has('Root/Next/Window'), true);
  await scheduler.recycleAgentWindow('Root/Next/Window');
  assert.equal(scheduler.agentSecurity.has('Root/Next/Window'), false);
  assert.equal(saves, 0);
});
