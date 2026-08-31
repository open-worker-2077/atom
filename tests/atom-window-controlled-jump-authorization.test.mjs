import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import {
  expandProgramFunctionSelection,
  validateProgramFunctionDelegation
} from '../work-engine/atom-language/program-function-registry.mjs';
import { executeAtomLanguage as executeAtomLanguageWithoutWorldService }
  from '../work-engine/atom-language/engine.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

const ROOT_AGENT_SOURCE = [
  'agent({"labels":["^^"],"functions":{"groups":[],"names":["explore","jump_authorize","transform"]}})'
].join('\n');
const WINDOW_AGENT_SOURCE = [
  'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","jump","transform"]}})'
].join('\n');

function world({ includeForge = false } = {}) {
  const windowPath = 'Root/Work/Job1/Window';
  const sourcePath = `${windowPath}/Registration`;
  const destinationPath = 'Root/Work/Job2';
  return [atom('Root', ROOT_AGENT_SOURCE, [
    atom('Controller', [
      `window = explore({"thing":"${windowPath}"})[0]`,
      `source = explore({"thing":"${sourcePath}"})[0]`,
      `destination = explore({"thing":"${destinationPath}"})[0]`,
      'jump_authorize({"window":window,"source":source,"destination":destination})'
    ].join('\n'), [], 'program'),
    atom('Work', '', [
      atom('Job1', '', [
        atom('Window', WINDOW_AGENT_SOURCE, [
          atom('When', [
            'def main(arguments):',
            '    records = explore({"thing":"Registration","contain$latitude-1":True})',
            '    return any("jump-authorization" in record.types for record in records)'
          ].join('\n'), [], 'program'),
          atom('Where', [
            'def main(arguments):',
            '    records = explore({"thing":"Registration","contain$latitude-1":True})',
            '    grants = [record for record in records if "jump-authorization" in record.types]',
            '    if len(grants) != 1:',
            '        raise ValueError("one controlled jump authorization is required")',
            '    return grants[0]'
          ].join('\n'), [], 'program'),
          atom('Registration', [
            'jump({',
            '  "when": explore({"thing":"When"})[0],',
            '  "where": explore({"thing":"Where"})[0]',
            '})'
          ].join('\n'), [], 'program'),
          ...(includeForge ? [atom(
            'Forge',
            'jump_authorize({"window":{"thing":"Root/Work/Job1/Window"},'
              + '"source":{"thing":"Root/Work/Job1/Window/Registration"},'
              + '"destination":{"thing":"Root/Work/Job2"}})',
            [],
            'program'
          )] : [])
        ], 'program')
      ]),
      atom('Job2'),
      atom('Job3')
    ]),
    ...(includeForge ? [atom(
      'InvalidController',
      'jump_authorize({"window":{"thing":"Root/Work/Job1/Window"},'
        + '"source":{"thing":"Root/Work/Job1/Window/Registration"},'
        + '"destination":{"thing":"Root/Work/Job2"}})',
      [],
      'program'
    )] : [])
  ], 'program')];
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-controlled-jump-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(world(options), null, 2)}\n`);
  return { contextFile, projectionFile };
}

function names(atomValue) {
  return (atomValue.contain ?? []).map((entry) => Object.entries(entry)
    .find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1]);
}

function findTyped(atoms, type, prefix = []) {
  for (const current of atoms) {
    const [entry] = Object.entries(current).filter(([key]) => (
      key === 'thing' || key.startsWith('thing@')
    ));
    const currentPath = [...prefix, entry[1]];
    if (entry[0].split('@').slice(1).includes(type)) {
      return { atom: current, path: currentPath.join('/') };
    }
    const nested = findTyped(current.contain ?? [], type, currentPath);
    if (nested) return nested;
  }
  return null;
}

function findThing(atoms, expected) {
  for (const current of atoms) {
    const entry = Object.entries(current).find(([key]) => (
      key === 'thing' || key.startsWith('thing@')
    ));
    if (entry?.[1] === expected) return current;
    const nested = findThing(current.contain ?? [], expected);
    if (nested) return nested;
  }
  return null;
}

async function issueAuthorization(files, scheduler) {
  return executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Controller"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'root-ref', path: 'Root' } }
  });
}

async function consumeAuthorization(files, scheduler, windowPath = 'Root/Work/Job1/Window') {
  return executeAtomLanguage({
    source: `transform {"thing.run.":"${windowPath}/Registration"}`,
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: windowPath } }
  });
}

test('jump_authorize is explicit-name-only and cannot be delegated to a child window', () => {
  assert.equal(
    expandProgramFunctionSelection({ groups: ['graph'], names: [] }).includes('jump_authorize'),
    false
  );
  assert.ok(expandProgramFunctionSelection({
    groups: [], names: ['jump_authorize']
  }).includes('jump_authorize'));
  assert.throws(() => validateProgramFunctionDelegation({
    creator: { groups: [], names: ['jump_authorize'] },
    child: { groups: [], names: ['jump_authorize'] }
  }), (error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED');
});

test('an authorized controller moves a fixed child window that has no horizontal authority', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const windowPath = 'Root/Work/Job1/Window';

  const guarded = await consumeAuthorization(files, scheduler);
  assert.equal(guarded.ok, true, JSON.stringify(guarded.errors));
  const guardedWorld = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(names(guardedWorld[0].contain[1].contain[0]), ['Window']);
  assert.deepEqual(names(guardedWorld[0].contain[1].contain[1]), []);

  const issued = await issueAuthorization(files, scheduler);
  assert.equal(issued.ok, true, JSON.stringify(issued.errors));
  const issuedWorld = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const issuedGrant = structuredClone(findTyped(issuedWorld, 'jump-authorization').atom);

  const moved = await consumeAuthorization(files, createProgramRuntimeScheduler());
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(names(stored[0].contain[1].contain[0]), []);
  assert.deepEqual(names(stored[0].contain[1].contain[1]), ['Window']);

  const oldDomain = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Work/Job1","situation$full":true}',
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'window-ref', path: 'Root/Work/Job2/Window' } }
  });
  assert.equal(oldDomain.ok, false);
  assert.ok(
    oldDomain.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'),
    JSON.stringify(oldDomain.errors)
  );
  const currentParent = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Work/Job2","situation$full":true}',
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'window-ref', path: 'Root/Work/Job2/Window' } }
  });
  assert.equal(currentParent.ok, true, JSON.stringify(currentParent.errors));

  const replayedWorld = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  findThing(replayedWorld, 'Registration').contain.push(issuedGrant);
  await fs.writeFile(files.contextFile, `${JSON.stringify(replayedWorld, null, 2)}\n`);
  const replayed = await consumeAuthorization(
    files,
    createProgramRuntimeScheduler(),
    'Root/Work/Job2/Window'
  );
  assert.equal(replayed.ok, false);
  assert.ok(replayed.errors.some((error) => (
    error.code === 'WINDOW_JUMP_AUTHORIZATION_INVALID'
  )), JSON.stringify(replayed.errors));
  const afterReplay = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(names(afterReplay[0].contain[1].contain[0]), []);
  assert.deepEqual(names(afterReplay[0].contain[1].contain[1]), ['Window']);
});

test('authorization coordinates cannot be forged, altered, or delegated by the child window', async (t) => {
  const files = await fixture(t, { includeForge: true });
  const scheduler = createProgramRuntimeScheduler();
  const forgedFact = await executeAtomLanguage({
    source: 'transform new {"thing@jump-authorization":"Forged",'
      + '"situation":"{}","contain":[],"support":[]}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/Work/Job1/Window' } }
  });
  assert.equal(forgedFact.ok, false);
  assert.ok(forgedFact.errors.some((error) => (
    error.code === 'KERNEL_GRAPH_FACT_FORGERY_DENIED'
  )), JSON.stringify(forgedFact.errors));

  const forged = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Work/Job1/Window/Forge"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/Work/Job1/Window' } }
  });
  assert.equal(forged.changed, false, JSON.stringify(forged));
  assert.ok([...(forged.errors ?? []), ...(forged.warnings ?? [])].some((error) => (
    error.code === 'UNKNOWN_PROGRAM_FUNCTION'
      || error.code === 'PROGRAM_FUNCTION_DENIED'
      || error.code === 'INVALID_JUMP_AUTHORIZATION_COORDINATE'
  )), JSON.stringify(forged.errors));

  const handMade = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/InvalidController"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'root-ref', path: 'Root' } }
  });
  assert.equal(handMade.changed, false, JSON.stringify(handMade));
  assert.ok([...(handMade.errors ?? []), ...(handMade.warnings ?? [])].some((error) => (
    error.code === 'INVALID_JUMP_AUTHORIZATION_COORDINATE'
  )), JSON.stringify(handMade));

  const issued = await issueAuthorization(files, scheduler);
  assert.equal(issued.ok, true, JSON.stringify(issued.errors));

  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const grant = findTyped(stored, 'jump-authorization');
  assert.ok(grant);
  const altered = await executeAtomLanguage({
    source: `transform {"thing":"${grant.path}","situation.rep.value":"tampered"}`,
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/Work/Job1/Window' } }
  });
  assert.equal(altered.ok, false);
  assert.ok(altered.errors.some((error) => (
    error.code === 'WINDOW_ACCESS_DENIED'
      || error.code === 'WINDOW_JUMP_AUTHORIZATION_IMMUTABLE'
      || error.code === 'ATOM_NOT_FOUND'
  )), JSON.stringify(altered.errors));

});

test('issuer authority generation changes invalidate a pending authorization without moving', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const issued = await issueAuthorization(files, scheduler);
  assert.equal(issued.ok, true, JSON.stringify(issued.errors));
  const changed = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  changed[0].situation += '\n# authority generation changed';
  await fs.writeFile(files.contextFile, `${JSON.stringify(changed, null, 2)}\n`);

  const result = await consumeAuthorization(files, scheduler);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => (
    error.code === 'WINDOW_JUMP_AUTHORIZATION_INVALID'
  )), JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(names(stored[0].contain[1].contain[0]), ['Window']);
  assert.deepEqual(names(stored[0].contain[1].contain[1]), []);
});

test('a rejected central commit publishes neither the controlled move nor grant consumption', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const issued = await issueAuthorization(files, scheduler);
  assert.equal(issued.ok, true, JSON.stringify(issued.errors));
  const before = await fs.readFile(files.contextFile, 'utf8');

  await assert.rejects(
    executeAtomLanguageWithoutWorldService({
      source: 'transform {"thing.run.":"Root/Work/Job1/Window/Registration"}',
      ...files,
      programMode: 'reconcile',
      programScheduler: scheduler,
      commitWorld: async () => {
        throw Object.assign(new Error('synthetic commit rejection'), {
          code: 'SYNTHETIC_COMMIT_REJECTION'
        });
      },
      interaction: { agent: { ref: 'window-ref', path: 'Root/Work/Job1/Window' } }
    }),
    (error) => error.code === 'SYNTHETIC_COMMIT_REJECTION'
  );

  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
  const stored = JSON.parse(before);
  assert.deepEqual(names(stored[0].contain[1].contain[0]), ['Window']);
  assert.ok(findTyped(stored, 'jump-authorization'));
});

test('a rejected authorization commit leaves no half-issued Graph fact', async (t) => {
  const files = await fixture(t);
  const initial = await fs.readFile(files.contextFile, 'utf8');
  await assert.rejects(
    executeAtomLanguageWithoutWorldService({
      source: 'transform {"thing.run.":"Root/Controller"}',
      ...files,
      programMode: 'reconcile',
      programScheduler: createProgramRuntimeScheduler(),
      commitWorld: async () => {
        throw Object.assign(new Error('synthetic authorization commit rejection'), {
          code: 'SYNTHETIC_COMMIT_REJECTION'
        });
      },
      interaction: { agent: { ref: 'root-ref', path: 'Root' } }
    }),
    (error) => error.code === 'SYNTHETIC_COMMIT_REJECTION'
  );
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), initial);
  assert.equal(findTyped(JSON.parse(initial), 'jump-authorization'), null);
});
