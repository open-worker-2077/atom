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
import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

test('function groups expand once to a fixed deduplicated function-name grant', () => {
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
    creator: { labels: ['^^'], functions: ['agent', 'message'] },
    child: { labels: ['^', 'new-business'], functions: ['message'] }
  }), { labels: ['^', 'new-business'], functions: ['message'] });
  assert.throws(() => validateAgentDelegation({
    creator: { labels: [], functions: ['message'] },
    child: { labels: ['new-business'], functions: ['message'] }
  }), (error) => error.code === 'AGENT_LABEL_DELEGATION_DENIED');
  assert.throws(() => validateAgentDelegation({
    creator: { labels: ['^'], functions: ['message'] },
    child: { labels: [], functions: ['transform'] }
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

test('agent() declares the current Program node and freezes expanded function names', async () => {
  const cycle = await createProgramRuntimeScheduler().refresh([
    atom('Registrar', 'agent({"labels":["^^","audit"],"functions":{"groups":["form"],"names":["message","form"]}})', [], 'program')
  ], { programSelector: 'Registrar', force: true, agentOrigin: { path: 'Root/Controller' } });
  assert.deepEqual(cycle.agentRegistrations, [{
    sourceProgramPath: 'Registrar',
    labels: ['^^', 'audit'],
    functions: ['form', 'form_status', 'message', 'missing_details', 'plan_form_flow']
  }]);
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

test('registered Agent execution only exposes its frozen function-name grant', async () => {
  const repository = {
    async load() {
      return {
        version: 1,
        locks: [],
        agentRegistrations: [{ agentPath: 'Root/Agent', labels: ['^'], functions: ['message'] }]
      };
    },
    async save(value) { return value; }
  };
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  await assert.rejects(scheduler.refresh([
    atom('Root', '', [
      atom('Agent', '', [atom('Writer', 'transform({"thing":"Root/Agent","situation.rep.x":None})', [], 'program')], 'agent')
    ])
  ], { programSelector: 'Root/Agent/Writer', force: true, agentOrigin: { path: 'Root/Agent' } }),
  (error) => error.code === 'PROGRAM_FUNCTION_DENIED');
});

test('registered Program Explore uses the same fixed Graph path before reading situation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-program-explore-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const lockFile = path.join(directory, 'request-driven-locks.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Area', '', [atom('Window', '', [atom('Probe', [
      'outside = explore({"thing":"Root/Outside","situation$full":True})[0]',
      'message({"level":"info","text":outside.situation})'
    ].join('\n'), [], 'program')], 'agent')]),
    atom('Outside', 'secret')
  ])], null, 2));
  const repository = createJsonRequestDrivenLockRepository({ file: lockFile });
  await repository.save({
    version: 1,
    locks: [],
    agentRegistrations: [{
      agentPath: 'Root/Area/Window', labels: ['^'], functions: ['explore', 'message']
    }]
  });
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Area/Window/Probe"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler({ requestDrivenLockRepository: repository }),
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
    atom('Locker', [
      'target = explore({"thing":"Target"})[0]',
      'lock({"targets":{"refs":[target.ref],"scope":"subtree"},"actions":["explore","transform"],"labels":["approved"]})'
    ].join('\n'), [], 'program')
  ], { programSelector: 'Locker', force: true });
  assert.deepEqual(cycle.locks, [{
    kind: 'contain', path: 'Target', actions: ['explore', 'transform'], labels: ['approved'],
    sourceProgramPath: 'Locker'
  }]);
});

test('agent() atomically registers its Program node and persists fixed security names', async (t) => {
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
  const scheduler = createProgramRuntimeScheduler({
    requestDrivenLockRepository: createJsonRequestDrivenLockRepository({ file: lockFile })
  });
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Registrar"}',
    contextFile, projectionFile, programScheduler: scheduler,
    interaction: { id: 'register-leaf', agent: { path: 'Root/Controller' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(Object.hasOwn(world[0].contain[1], 'thing@program@agent'), true);
  const snapshot = JSON.parse(await fs.readFile(lockFile, 'utf8'));
  assert.deepEqual(snapshot.agentRegistrations, [{
    agentPath: 'Root/Registrar', labels: ['^', 'leaf'], functions: ['message']
  }]);
});

test('agent() security persistence failure leaves the Program node unregistered', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-register-fail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const initial = [atom('Root', '', [
    atom('Controller', '', [], 'agent'),
    atom('Registrar', 'agent({"functions":{"groups":[],"names":["message"]}})', [], 'program')
  ])];
  await fs.writeFile(contextFile, JSON.stringify(initial, null, 2));
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: {
    async load() { return { version: 1, locks: [] }; },
    async save() { throw Object.assign(new Error('sidecar failed'), { code: 'LOCK_SIDECAR_FAILED' }); }
  } });
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Registrar"}',
    contextFile, projectionFile, programScheduler: scheduler,
    interaction: { id: 'register-fail', agent: { path: 'Root/Controller' } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'LOCK_SIDECAR_FAILED');
  assert.equal(scheduler.agentSecurity.has('Root/Registrar'), false);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), initial);
});

test('Agent move and recycle security mutations roll back when sidecar persistence fails', async () => {
  let rejectSave = false;
  let stored = { version: 1, locks: [] };
  const repository = {
    async load() { return structuredClone(stored); },
    async save(value) {
      if (rejectSave) throw Object.assign(new Error('sidecar failed'), { code: 'LOCK_SIDECAR_FAILED' });
      stored = structuredClone(value);
    }
  };
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  await scheduler.registerAgentWindow({
    sourceProgramPath: 'Root/Window', labels: ['^'], functions: ['jump']
  });
  rejectSave = true;
  await assert.rejects(
    scheduler.remapAgentWindow('Root/Window', 'Root/Next/Window'),
    (error) => error.code === 'LOCK_SIDECAR_FAILED'
  );
  assert.equal(scheduler.agentSecurity.has('Root/Window'), true);
  assert.equal(scheduler.agentSecurity.has('Root/Next/Window'), false);
  await assert.rejects(
    scheduler.recycleAgentWindow('Root/Window'),
    (error) => error.code === 'LOCK_SIDECAR_FAILED'
  );
  assert.equal(scheduler.agentSecurity.has('Root/Window'), true);
});
