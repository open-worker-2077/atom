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
      ], 'program')
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

test('a declared Agent may reconfigure a descendant but not an out-of-window declaration', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const allowedSource = 'agent({"labels":["worker"],"functions":{"groups":[],"names":["message"]}})';

  const allowed = await executeAtomLanguage({
    source: 'transform {' + JSON.stringify('thing') + ':'
      + JSON.stringify('Root/Task/Creator/AllowedChild') + ','
      + JSON.stringify(`situation.rep.${allowedSource}`) + '}',
    ...files,
    programScheduler: scheduler,
    interaction: { id: 'register-descendant', agent: { path: 'Root/Task/Creator' } }
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  let stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(stored, 'AllowedChild').key, 'thing@program');
  assert.equal(findAtom(stored, 'AllowedChild').atom.situation, allowedSource);

  const denied = await executeAtomLanguage({
    source: 'transform {' + JSON.stringify('thing') + ':'
      + JSON.stringify('Root/Outside/ForbiddenChild') + ','
      + JSON.stringify('situation.rep.value = 1') + '}',
    ...files,
    programScheduler: scheduler,
    interaction: { id: 'reject-outside-registration', agent: { path: 'Root/Task/Creator' } }
  });
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'), JSON.stringify(denied));
  stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(stored, 'ForbiddenChild').key, 'thing@program');
  assert.equal(findAtom(stored, 'ForbiddenChild').atom.situation, CHILD_SOURCE);
  assert.equal(scheduler.agentSecurity.has('Root/Outside/ForbiddenChild'), true);
});

test('authorized creation of an Agent Program keeps the Key as thing@program', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const childPath = 'Root/Task/Creator/CreatedChild';
  const childSource = 'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})';
  const result = await executeAtomLanguage({
    source: 'transform new ' + JSON.stringify({
      'thing@program': childPath,
      situation: childSource,
      contain: [],
      support: []
    }),
    ...files,
    programScheduler: scheduler,
    interaction: {
      id: 'create-declared-child',
      agent: { path: 'Root/Task/Creator' }
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(stored, 'CreatedChild').key, 'thing@program');
  assert.equal(scheduler.agentSecurity.has(childPath), true);
});

test('declaration escalation fails without changing world bytes', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const childPath = 'Root/Task/Creator/AllowedChild';
  const escalated = 'agent({"labels":["^^"],"functions":{"groups":[],"names":["message"]}})';
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    source: 'transform {' + JSON.stringify('thing') + ':' + JSON.stringify(childPath)
      + ',' + JSON.stringify('situation.rep.' + escalated) + '}',
    ...files,
    programScheduler: scheduler,
    interaction: {
      id: 'reject-declaration-escalation',
      agent: { path: 'Root/Task/Creator' }
    }
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some((error) => (
    error.code === 'AGENT_JURISDICTION_ESCALATION'
  )), JSON.stringify(result));
  assert.equal(result.revisionAfter, result.revisionBefore);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

test('an authorized parent may demote its child Program without mutating its Key', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const childPath = 'Root/Task/Creator/AllowedChild';
  const result = await executeAtomLanguage({
    source: 'transform {' + JSON.stringify('thing') + ':' + JSON.stringify(childPath)
      + ',' + JSON.stringify('situation.rep.value = 1') + '}',
    ...files,
    programScheduler: scheduler,
    interaction: {
      id: 'demote-declared-child',
      agent: { path: 'Root/Task/Creator' }
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(findAtom(stored, 'AllowedChild').key, 'thing@program');
  assert.equal(scheduler.agentSecurity.has(childPath), false);
});

test('creator-less declaration changes fail without changing world bytes', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const childPath = 'Root/Task/Creator/AllowedChild';
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    source: 'transform {' + JSON.stringify('thing') + ':' + JSON.stringify(childPath)
      + ',' + JSON.stringify('situation.rep.value = 1') + '}',
    ...files,
    programScheduler: scheduler,
    interaction: { id: 'reject-creator-less-declaration-change', agent: null }
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some((error) => (
    error.code === 'AGENT_RECONFIGURATION_CREATOR_REQUIRED'
  )), JSON.stringify(result));
  assert.equal(result.revisionAfter, result.revisionBefore);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
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
          atom(`Child${index}`, 'value = 1', [], 'program')
        ], 'program')
      ])
    ])], null, 2));
    const scheduler = createProgramRuntimeScheduler();

    const result = await executeAtomLanguage({
      source: 'transform {' + JSON.stringify('thing') + ':' + JSON.stringify(childPath)
        + ',' + JSON.stringify(`situation.rep.${scenario.child}`) + '}',
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
    assert.equal(findAtom(stored, `Child${index}`).key, 'thing@program');
    assert.deepEqual(scheduler.agentSecurity.get(childPath), scenario.expectedSecurity);

    const coldScheduler = createProgramRuntimeScheduler();
    await coldScheduler.rebuildAgentSecurity(stored);
    assert.deepEqual(coldScheduler.agentSecurity.get(childPath), scenario.expectedSecurity);
  });
}
