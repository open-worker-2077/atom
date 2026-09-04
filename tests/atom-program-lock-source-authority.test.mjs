import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { validateRequestDrivenLockSnapshot } from '../src/atom-system/public/request-driven-lock-contract.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function lockSource(specification) {
  return `lock(${pythonLiteral(specification)})`;
}

function pythonLiteral(value) {
  return JSON.stringify(value)
    .replaceAll(':true', ':True')
    .replaceAll(':false', ':False')
    .replaceAll(':null', ':None');
}

function newLockWorld(order = [0, 1]) {
  const specifications = [
    {
      targets: { paths: ['Root/Target-0'] },
      actions: ['explore', 'transform'], labels: ['reviewed']
    },
    {
      targets: { paths: ['Root/Target-1'], scope: 'subtree' },
      actions: ['transform'], labels: ['maintainer']
    }
  ];
  return [atom('Root', '', [
    atom('Allowed Program', 'def main(arguments):\n    return arguments', [], 'program'),
    atom('Target-0'), atom('Target-1'),
    ...order.map((index) => atom(
      `Lock Program-${index}`, lockSource(specifications[index]), [], 'program'
    ))
  ])];
}

function semanticLocks(locks) {
  return locks.map((lock) => ({
    ...structuredClone(lock),
    sourceProgramRef: undefined
  })).sort((left, right) => left.path.localeCompare(right.path));
}

test('adding an unrelated ordinary Program does not recompile unchanged business locks', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const inspect = scheduler.inspectProgram;
  let lockInspections = 0;
  scheduler.inspectProgram = async (request) => {
    if (!request.agentDeclarationOnly && request.program.path.includes('Lock Program')) lockInspections += 1;
    return inspect(request);
  };
  const world = newLockWorld();
  const before = await scheduler.rebuildRequestDrivenLocks(world);
  lockInspections = 0;
  const next = structuredClone(world);
  next[0].slot.push(atom('New Program', 'def main(arguments):\n    return True', [], 'program'));
  const after = await scheduler.rebuildRequestDrivenLocks(next);
  assert.deepEqual(semanticLocks(after), semanticLocks(before));
  assert.equal(lockInspections, 0, 'unchanged locks must not relaunch their Python validators');
});

test('cached locks are revalidated when their enclosing Agent loses lock authority', async () => {
  const world = [atom('Owner', 'agent({"labels":[],"functions":{"groups":[],"names":["lock"]}})', [
    atom('Target'),
    atom('Guard', lockSource({ targets: { paths: ['Owner/Target'] }, actions: ['transform'], labels: ['reviewed'] }), [], 'program')
  ], 'program')];
  const scheduler = createProgramRuntimeScheduler();
  assert.equal((await scheduler.rebuildRequestDrivenLocks(world)).length, 1);
  const revoked = structuredClone(world);
  revoked[0].situation = 'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})';
  await assert.rejects(scheduler.rebuildRequestDrivenLocks(revoked),
    (error) => error.code === 'PROGRAM_FUNCTION_DENIED');
});

test('cold start compiles new literal Program lock declarations without sidecar authority', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const locks = await scheduler.rebuildRequestDrivenLocks(newLockWorld());

  assert.equal(locks.length, 2);
  assert.deepEqual(locks.map((lock) => lock.path).sort(),
    ['Root/Target-0', 'Root/Target-1']);
  assert.ok(locks.every((lock) => lock.sourceProgramPath.startsWith('Root/Lock Program-')));
});

test('derived lock ordering has no authorization semantics', async () => {
  const forward = await createProgramRuntimeScheduler()
    .rebuildRequestDrivenLocks(newLockWorld());
  const reverse = await createProgramRuntimeScheduler()
    .rebuildRequestDrivenLocks(newLockWorld([1, 0]));
  assert.deepEqual(semanticLocks(forward), semanticLocks(reverse));
});

test('cold lock compilation fails closed for dynamic declarations and unknown Graph targets', async () => {
  const dynamic = [atom('Root', '', [
    atom('Target'),
    atom('Lock Program', [
      `spec = ${pythonLiteral({
        targets: { paths: ['Root/Target'] }, actions: ['transform'], labels: ['reviewed']
      })}`,
      'lock(spec)'
    ].join('\n'), [], 'program')
  ])];
  await assert.rejects(
    createProgramRuntimeScheduler().rebuildRequestDrivenLocks(dynamic),
    (error) => error.code === 'REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED'
  );

  const unknown = [atom('Root', '', [
    atom('Lock Program', lockSource({
      targets: { paths: ['Root/Missing'] }, actions: ['transform'], labels: ['reviewed']
    }), [], 'program')
  ])];
  await assert.rejects(
    createProgramRuntimeScheduler().rebuildRequestDrivenLocks(unknown),
    (error) => error.code === 'INVALID_PROGRAM_LOCK_TARGET'
  );
});

test('Program and Graph revisions replace derived locks and a fresh scheduler rebuilds the same result', async () => {
  const locked = [atom('Root', '', [
    atom('Target'),
    atom('Lock Program', lockSource({
      targets: { paths: ['Root/Target'] }, actions: ['transform'], labels: ['reviewed']
    }), [], 'program')
  ])];
  const scheduler = createProgramRuntimeScheduler();
  assert.equal((await scheduler.rebuildRequestDrivenLocks(locked)).length, 1);

  const renamed = [atom('Root', '', [
    atom('Renamed Target'),
    atom('Lock Program', lockSource({
      targets: { paths: ['Root/Renamed Target'] }, actions: ['transform'], labels: ['reviewed']
    }), [], 'program')
  ])];
  const rebuilt = await scheduler.rebuildRequestDrivenLocks(renamed);
  assert.equal(rebuilt[0].path, 'Root/Renamed Target');
  assert.deepEqual(
    await createProgramRuntimeScheduler().rebuildRequestDrivenLocks(renamed),
    rebuilt
  );

  const removed = [atom('Root', '', [
    atom('Renamed Target'),
    atom('Lock Program', 'message({"level":"info","text":"unlocked"})', [], 'program')
  ])];
  assert.deepEqual(await scheduler.rebuildRequestDrivenLocks(removed), []);
});

test('all legacy sidecar locks are retired and cannot expand runtime authorization', () => {
  assert.throws(() => validateRequestDrivenLockSnapshot({
    version: 1,
    locks: [{
      sourceProgramPath: 'Root/Legacy',
      targets: { paths: ['Root/Target'] },
      mode: 'write', fields: ['situation'], protect: { atom: true, messages: false },
      refresh: { policy: 'on_request' }
    }]
  }), (error) => error.code === 'RETIRED_REQUEST_DRIVEN_LOCK_SNAPSHOT');
});

test('manage-agent reconstruction never guesses a lock absent from its Program declaration', async () => {
  const world = [atom('Root', '', [
    atom('manage-agent', [
      'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})',
      'message({"level":"info","text":"manage"})'
    ].join('\n'), [], 'program'),
    atom('Managed Target')
  ])];
  const scheduler = createProgramRuntimeScheduler();

  assert.deepEqual(await scheduler.rebuildRequestDrivenLocks(world), []);
  const security = await scheduler.rebuildAgentSecurity(world);
  assert.deepEqual(security.get('Root/manage-agent').functions, ['message']);
});

test('an Agent Program cannot reconstruct a lock outside its registered function scope', async () => {
  const world = [atom('Root', '', [
    atom('manage-agent',
      'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})', [
        atom('Unauthorized Lock', lockSource({
          targets: { paths: ['Root/Managed Target'] },
          actions: ['transform'], labels: ['reviewed']
        }), [], 'program')
      ], 'program'),
    atom('Managed Target')
  ])];
  await assert.rejects(
    createProgramRuntimeScheduler().rebuildRequestDrivenLocks(world),
    (error) => error.code === 'PROGRAM_FUNCTION_DENIED'
  );
});
