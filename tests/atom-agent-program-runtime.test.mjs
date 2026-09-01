import test from 'node:test';
import assert from 'node:assert/strict';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(key, name, situation = '', slot = []) {
  return { [key]: name, situation, slot, strut: [] };
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

test('Agent ownership dispatches only the nearest nested Agent Program Jump descendants', async () => {
  const executed = [];
  const scheduler = createProgramRuntimeScheduler({
    timeoutMs: 2000,
    runProgram: async ({ program }) => {
      executed.push(program.path);
      if (program.path === 'Outer/Outer Jump') {
        throw Object.assign(new Error('outer jump must not run for an inner Agent cycle'), {
          code: 'ATOM_PROGRAM_TIMEOUT'
        });
      }
      return {
        locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [], choices: [],
        trigger: null
      };
    }
  });
  const jumpAgentSource = 'agent({"labels":[],"functions":{"groups":[],"names":["jump"]}})';
  const world = [atom('thing@program', 'Outer', jumpAgentSource, [
    atom('thing@program', 'Outer Jump', "jump({'thing':'Outer'})"),
    atom('thing@program', 'Inner', jumpAgentSource, [
      atom('thing@program', 'Inner Jump', "jump({'thing':'Inner'})")
    ])
  ])];

  const cycle = await scheduler.refresh(world, {
    agentOrigin: { path: 'Outer/Inner' }, force: true, isolateFailures: true
  });

  assert.deepEqual(executed.filter((path) => path.endsWith('Jump')), ['Outer/Inner/Inner Jump']);
  assert.deepEqual(cycle.failures, []);
});
