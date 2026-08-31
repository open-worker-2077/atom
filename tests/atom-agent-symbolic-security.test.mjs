import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expandProgramFunctionSelection,
  programFunctionRegistry,
  validateProgramFunctionDelegation,
  validateProgramFunctionRegistry
} from '../work-engine/atom-language/program-function-registry.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { validateRequestDrivenLockSnapshot } from '../src/atom-system/public/request-driven-lock-contract.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

function hierarchicalRegistry() {
  const registry = programFunctionRegistry();
  registry.functionFamilies.push(
    { layer: 'application', id: 'company', label: 'Company' },
    { layer: 'application', id: 'development', label: 'Development', parent: 'company' },
    { layer: 'application', id: 'frontend', label: 'Frontend', parent: 'development' },
    { layer: 'application', id: 'finance', label: 'Finance', parent: 'company' }
  );
  registry.functions.push(
    { name: 'develop_ui', layer: 'application', family: 'frontend', scope: 'public' },
    { name: 'close_books', layer: 'application', family: 'finance', scope: 'public' }
  );
  return validateProgramFunctionRegistry(registry);
}

test('symbolic function groups follow the current registry hierarchy while explicit names stay frozen', () => {
  const before = hierarchicalRegistry();
  assert.deepEqual(before.functionScopeHierarchy, {
    groupField: 'functionFamilies[].id',
    parentField: 'functionFamilies[].parent',
    rootWhenParentOmitted: true,
    functionMembership: 'single-family',
    groupEffectiveMembership: 'self-and-descendants'
  });
  assert.deepEqual(
    expandProgramFunctionSelection({ groups: ['development'], names: ['message'] }, before),
    ['develop_ui', 'message']
  );

  const after = structuredClone(before);
  after.functions.push({
    name: 'develop_api', layer: 'application', family: 'development', scope: 'public'
  });
  validateProgramFunctionRegistry(after);
  assert.deepEqual(
    expandProgramFunctionSelection({ groups: ['development'], names: ['message'] }, after),
    ['develop_api', 'develop_ui', 'message']
  );
  assert.deepEqual(
    expandProgramFunctionSelection({ groups: [], names: ['message'] }, after),
    ['message']
  );
});

test('function scope delegation permits descendants but rejects ancestors, sibling trees, and name-to-group minting', () => {
  const registry = hierarchicalRegistry();
  assert.deepEqual(validateProgramFunctionDelegation({
    creator: { groups: ['development'], names: [] },
    child: { groups: ['frontend'], names: ['develop_ui'] },
    registry
  }), {
    groups: ['frontend'], names: ['develop_ui'], functions: ['develop_ui']
  });
  for (const child of [
    { groups: ['company'], names: [] },
    { groups: ['finance'], names: [] },
    { groups: [], names: ['close_books'] }
  ]) {
    assert.throws(() => validateProgramFunctionDelegation({
      creator: { groups: ['development'], names: [] }, child, registry
    }), (error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED');
  }
  assert.throws(() => validateProgramFunctionDelegation({
    creator: { groups: [], names: ['develop_ui'] },
    child: { groups: ['frontend'], names: [] },
    registry
  }), (error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED');
});

test('function registry rejects unknown parents and group cycles', () => {
  const unknownParent = programFunctionRegistry();
  unknownParent.functionFamilies.push({
    layer: 'application', id: 'development', label: 'Development', parent: 'missing'
  });
  assert.throws(() => validateProgramFunctionRegistry(unknownParent),
    (error) => error.code === 'INVALID_PROGRAM_FUNCTION_REGISTRY');

  const cycle = programFunctionRegistry();
  cycle.functionFamilies.push(
    { layer: 'application', id: 'development', label: 'Development', parent: 'finance' },
    { layer: 'application', id: 'finance', label: 'Finance', parent: 'development' }
  );
  assert.throws(() => validateProgramFunctionRegistry(cycle),
    (error) => error.code === 'INVALID_PROGRAM_FUNCTION_REGISTRY');
});

test('cold start rebuilds symbolic Agent security only from literal Program source', async () => {
  let saves = 0;
  const scheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: {
    async load() { return { version: 1, locks: [] }; },
    async save() { saves += 1; }
  } });
  const world = [atom('Root', '', [
    atom('Window', 'agent({"labels":["^","audit"],"functions":{"groups":["form"],"names":["message"]}})', [], 'program')
  ])];

  await scheduler.rebuildAgentSecurity(world);
  assert.deepEqual(scheduler.agentSecurity.get('Root/Window'), {
    labels: ['^', 'audit'],
    functionScopes: { groups: ['form'], names: ['message'] },
    functions: ['form', 'form_status', 'message', 'missing_details', 'plan_form_flow']
  });
  assert.equal(saves, 0);
});

test('cold start rejects dynamic Agent grants, unknown scopes, and undeclared Programs', async () => {
  for (const [source, code] of [
    [
      'grant = {"labels":[],"functions":{"groups":[],"names":["message"]}}\nagent(grant)',
      'AGENT_REGISTRATION_LITERAL_REQUIRED'
    ],
    [
      'agent({"labels":[],"functions":{"groups":["missing"],"names":[]}})',
      'UNKNOWN_PROGRAM_FUNCTION_GROUP'
    ]
  ]) {
    const scheduler = createProgramRuntimeScheduler();
    await assert.rejects(scheduler.rebuildAgentSecurity([
      atom('Root', '', [atom('Window', source, [], 'program')])
    ]), (error) => error.code === code);
  }
});

test('legacy sidecar Agent registrations are fail-closed and never become runtime authority', () => {
  assert.throws(() => validateRequestDrivenLockSnapshot({
    version: 1,
    locks: [],
    agentRegistrations: [{
      agentPath: 'Root/Window', labels: ['^'], functions: ['message']
    }]
  }), (error) => error.code === 'RETIRED_AGENT_REGISTRATION_SNAPSHOT');
});
