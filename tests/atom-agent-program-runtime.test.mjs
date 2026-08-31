import test from 'node:test';
import assert from 'node:assert/strict';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(key, name, situation = '', contain = []) {
  return { [key]: name, situation, contain, support: [] };
}

const agentSource = [
  'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","use_program"]}})',
  'def main(arguments):',
  '    return arguments'
].join('\n');

const lineContinuedAgentSource = [
  'agent \\',
  '  ({"labels":["^"],"functions":{"groups":[],"names":["explore"]}})',
  'def main(arguments):',
  '    return arguments'
].join('\n');

test('Agent registry is derived from literal declarations on ordinary Programs', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
  const world = [
    atom('thing@program', 'AgentProgram', agentSource),
    atom('thing@program', 'OrdinaryProgram', 'value = 1')
  ];
  const security = await scheduler.deriveAgentSecurity(world);
  assert.deepEqual([...security.keys()], ['AgentProgram']);
  assert.deepEqual(security.get('AgentProgram'), {
    labels: ['^'],
    functionScopes: { groups: [], names: ['explore', 'use_program'] },
    functions: ['explore', 'use_program']
  });
  assert.equal(world[0]['thing@program'], 'AgentProgram');
  assert.equal(Object.keys(world[0]).some((key) => key.includes('@agent')), false);
});

test('ordinary Programs stay ordinary and nonliteral Agent declarations fail closed', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
  assert.deepEqual(
    [...(await scheduler.deriveAgentSecurity([
      atom('thing@program', 'Ordinary', 'value = 1')
    ])).keys()],
    []
  );
  await assert.rejects(
    scheduler.deriveAgentSecurity([
      atom('thing@program', 'Dynamic', 'spec = {"functions":{"groups":[],"names":["explore"]}}\nagent(spec)')
    ]),
    (error) => error.code === 'AGENT_REGISTRATION_LITERAL_REQUIRED'
  );
});

test('Agent registry recognizes a literal declaration using Python explicit line continuation', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
  const security = await scheduler.deriveAgentSecurity([
    atom('thing@program', 'ContinuedAgentProgram', lineContinuedAgentSource)
  ]);

  assert.deepEqual(security.get('ContinuedAgentProgram'), {
    labels: ['^'],
    functionScopes: { groups: [], names: ['explore'] },
    functions: ['explore']
  });
});

test('executing an Agent Program does not emit a registration mutation', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
  const result = await scheduler.refresh([
    atom('thing@program', 'AgentProgram', agentSource)
  ], { programSelector: 'AgentProgram', isolateFailures: false });
  assert.deepEqual(result.agentRegistrations, []);
  assert.equal(scheduler.agentSecurity.get('AgentProgram').functions.includes('explore'), true);
});

test('an Agent Program dispatches another Agent Program through use_program', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
  const child = [
    'agent({"labels":[],"functions":{"groups":[],"names":["agent"]}})',
    'def main(arguments):',
    '    return {"value": arguments["value"] + "-child"}'
  ].join('\n');
  const parent = [
    'agent({"labels":[],"functions":{"groups":[],"names":["agent","message","use_program"]}})',
    'result = use_program({"name":"Parent/Child","arguments":{"value":"program"}})',
    'message({"level":"info","text":result["value"]})'
  ].join('\n');
  const world = [atom('thing@program', 'Parent', parent, [
    atom('thing@program', 'Child', child)
  ])];
  await scheduler.rebuildAgentSecurity(world);
  const cycle = await scheduler.refresh(world, {
    programSelector: 'Parent',
    isolateFailures: false
  });
  assert.deepEqual(cycle.failures, []);
  assert.deepEqual(cycle.messages.map((message) => message.text), ['program-child']);
});

test('Agent ownership follows the nearest declared Program, not a Key type', async () => {
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
  const world = [atom('thing@program', 'Window', agentSource, [
    atom('thing@program', 'Worker', 'value = 1')
  ])];
  await scheduler.rebuildAgentSecurity(world);
  assert.equal(scheduler.agentSecurity.has('Window'), true);
  assert.equal(scheduler.agentSecurity.has('Window/Worker'), false);
});
