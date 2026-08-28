import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

const CREATOR_SOURCE = 'agent({"labels":["^"],"functions":{"groups":[],"names":["agent","message","transform"]}})';
const CHILD_SOURCE = 'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})';

const DELEGATION_CASES = [
  {
    name: 'delegates a lower jurisdiction, a new business label, and an explicit function beneath a held group',
    creator: 'agent({"labels":["^^"],"functions":{"groups":["form"],"names":["agent","transform"]}})',
    child: 'agent({"labels":["^","fresh-business"],"functions":{"groups":[],"names":["form_status"]}})',
    expectedSecurity: {
      labels: ['^', 'fresh-business'],
      functionScopes: { groups: [], names: ['form_status'] },
      functions: ['form_status']
    }
  },
  {
    name: 'rejects jurisdiction escalation',
    creator: 'agent({"labels":["^^"],"functions":{"groups":[],"names":["agent","message","transform"]}})',
    child: 'agent({"labels":["^^^"],"functions":{"groups":[],"names":["message"]}})',
    error: 'AGENT_JURISDICTION_ESCALATION'
  },
  {
    name: 'rejects a sibling function group outside the creator scope',
    creator: 'agent({"labels":["^"],"functions":{"groups":["form"],"names":["agent","transform"]}})',
    child: 'agent({"labels":[],"functions":{"groups":["graph"],"names":[]}})',
    error: 'PROGRAM_FUNCTION_DELEGATION_DENIED'
  },
  {
    name: 'rejects minting a group from a held concrete function name',
    creator: 'agent({"labels":["^"],"functions":{"groups":[],"names":["agent","message","transform"]}})',
    child: 'agent({"labels":[],"functions":{"groups":["form"],"names":[]}})',
    error: 'PROGRAM_FUNCTION_DELEGATION_DENIED'
  },
  {
    name: 'rejects an unheld business label without jurisdiction',
    creator: 'agent({"labels":["owned"],"functions":{"groups":[],"names":["agent","message","transform"]}})',
    child: 'agent({"labels":["fresh-business"],"functions":{"groups":[],"names":["message"]}})',
    error: 'AGENT_LABEL_DELEGATION_DENIED'
  }
];

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-registration-path-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Task', '', [
      atom('Creator', CREATOR_SOURCE, [
        atom('AllowedChild', CHILD_SOURCE, [], 'program')
      ], 'program@agent')
    ]),
    atom('Outside', '', [
      atom('ForbiddenChild', CHILD_SOURCE, [], 'program')
    ])
  ])], null, 2));
  return { contextFile, projectionFile };
}

function findAtom(atoms, expected) {
  for (const current of atoms) {
    const entry = Object.entries(current).find(([key]) => (
      key === 'thing' || key.startsWith('thing@')
    ));
    if (entry?.[1] === expected) return { atom: current, key: entry[0] };
    const nested = findAtom(current.contain ?? [], expected);
    if (nested) return nested;
  }
  return null;
}

test('a registered Agent may register a descendant but cannot register an out-of-window Program', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();

  const allowed = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Task/Creator/AllowedChild"}',
    ...files,
    programScheduler: scheduler,
    interaction: { id: 'register-descendant', agent: { path: 'Root/Task/Creator' } }
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  let stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(stored, 'AllowedChild').key, 'thing@program@agent');

  const denied = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Outside/ForbiddenChild"}',
    ...files,
    programScheduler: scheduler,
    interaction: { id: 'reject-outside-registration', agent: { path: 'Root/Task/Creator' } }
  });
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'), JSON.stringify(denied));
  stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(stored, 'ForbiddenChild').key, 'thing@program');
  assert.equal(scheduler.agentSecurity.has('Root/Outside/ForbiddenChild'), false);
});

for (const [index, scenario] of DELEGATION_CASES.entries()) {
  test(`public Program registration ${scenario.name}`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-agent-delegation-${index}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const contextFile = path.join(directory, 'atom.json');
    const projectionFile = path.join(directory, 'graph.json');
    const creatorPath = `Root/Task/Creator${index}`;
    const childPath = `${creatorPath}/Child${index}`;
    await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
      atom('Task', '', [
        atom(`Creator${index}`, scenario.creator, [
          atom(`Child${index}`, scenario.child, [], 'program')
        ], 'program@agent')
      ])
    ])], null, 2));
    const scheduler = createProgramRuntimeScheduler();

    const result = await executeAtomLanguage({
      source: `transform {"thing.run.":${JSON.stringify(childPath)}}`,
      contextFile,
      projectionFile,
      programScheduler: scheduler,
      interaction: { id: `delegate-${index}`, agent: { path: creatorPath } }
    });
    const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));

    if (scenario.error) {
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.ok(result.errors.some((error) => error.code === scenario.error), JSON.stringify(result));
      assert.equal(findAtom(stored, `Child${index}`).key, 'thing@program');
      assert.equal(scheduler.agentSecurity.has(childPath), false);
      return;
    }

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(findAtom(stored, `Child${index}`).key, 'thing@program@agent');
    assert.deepEqual(scheduler.agentSecurity.get(childPath), scenario.expectedSecurity);

    const coldScheduler = createProgramRuntimeScheduler();
    await coldScheduler.rebuildAgentSecurity(stored);
    assert.deepEqual(coldScheduler.agentSecurity.get(childPath), scenario.expectedSecurity);
  });
}
