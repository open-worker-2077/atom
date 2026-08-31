import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

const CREATOR_PATH = 'Root/Task/Creator';
const CHILD_PATH = `${CREATOR_PATH}/AllowedChild`;
const TARGET_PATH = `${CREATOR_PATH}/Target`;
const COMMITTED_TRIGGER_PATH = `${CREATOR_PATH}/Committed Trigger`;
const CREATOR_SOURCE = 'agent({"labels":["^"],"functions":{"groups":[],"names":["agent","message","transform","trigger"]}})';
const CHILD_SOURCE = 'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})';
const ESCALATED_SOURCE = 'agent({"labels":["^^"],"functions":{"groups":[],"names":["message"]}})';

function transformProgramSource(targetPath, nextSource) {
  return `transform({${JSON.stringify('thing')}: ${JSON.stringify(targetPath)}, ${
    JSON.stringify(`situation.rep.${nextSource}`)
  }: None})`;
}

function triggerProgramSource(triggerPath, targetPath = CHILD_PATH, nextSource = ESCALATED_SOURCE) {
  return [
    'def main():',
    `    ${transformProgramSource(targetPath, nextSource)}`,
    `trigger('transform', {'nodes': [${JSON.stringify(triggerPath)}]}, main)`
  ].join('\n');
}

function declaredTriggerSource(declaration, triggerPath = TARGET_PATH) {
  return [
    declaration,
    triggerProgramSource(triggerPath, `${CREATOR_PATH}/Leak`, 'candidate')
  ].join('\n');
}

function situationReplacement(path, detail) {
  return `{${JSON.stringify('thing')}:${JSON.stringify(path)},${
    JSON.stringify(`situation.rep.${detail}`)
  }}`;
}

async function fixture(t, programs = [], childPrograms = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-candidate-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const initial = [atom('Root', '', [atom('Task', '', [
    atom('Creator', CREATOR_SOURCE, [
      atom('AllowedChild', CHILD_SOURCE, childPrograms, 'program'),
      atom('Target', 'before'),
      atom('Leak', 'stable'),
      ...programs
    ], 'program')
  ])])];
  await fs.writeFile(contextFile, JSON.stringify(initial, null, 2));
  return { contextFile, projectionFile, initial };
}

function interaction(id) {
  return { id, agent: { path: CREATOR_PATH } };
}

async function assertRejectedWithoutCommit(result, files, before) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some(({ code }) => code === 'AGENT_JURISDICTION_ESCALATION'), JSON.stringify(result));
  assert.equal(result.revisionAfter, result.revisionBefore);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
}

async function seedCommittedSharedRuntime(initial) {
  let projection = Object.freeze({ marker: 'committed-projection' });
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      async load() { return structuredClone(projection); },
      async save(value) { projection = structuredClone(value); }
    }
  });
  await scheduler.refresh(initial, { isolateFailures: true, passive: true });
  assert.equal(scheduler.triggerContractsInitialized, true);
  assert.ok(scheduler.triggerContracts.has(COMMITTED_TRIGGER_PATH));
  assert.ok(scheduler.triggerIndex.size > 0);
  return scheduler;
}

function sharedRuntimeSnapshot(scheduler) {
  return {
    agentSecurity: structuredClone(scheduler.agentSecurity),
    triggerContracts: structuredClone(scheduler.triggerContracts),
    triggerIndex: structuredClone(scheduler.triggerIndex),
    triggerContractsInitialized: scheduler.triggerContractsInitialized,
    latestRecords: scheduler.latestRecords,
    loadedProjection: structuredClone(scheduler.loadedProjection)
  };
}

function assertSharedRuntimeUnchanged(scheduler, before) {
  assert.deepEqual(scheduler.agentSecurity, before.agentSecurity);
  assert.deepEqual(scheduler.triggerContracts, before.triggerContracts);
  assert.deepEqual(scheduler.triggerIndex, before.triggerIndex);
  assert.equal(scheduler.triggerContractsInitialized, before.triggerContractsInitialized);
  assert.deepEqual(scheduler.latestRecords, before.latestRecords);
  assert.deepEqual(scheduler.loadedProjection, before.loadedProjection);
}

test('an explicit Program run cannot commit an unauthorized declaration effect', async (t) => {
  const files = await fixture(t, [
    atom('Escalator', transformProgramSource(CHILD_PATH, ESCALATED_SOURCE), [], 'program')
  ]);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    ...files,
    source: `transform {"thing.run.":${JSON.stringify(`${CREATOR_PATH}/Escalator`)}}`,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: interaction('reject-program-run-effect')
  });
  await assertRejectedWithoutCommit(result, files, before);
});

for (const [name, source] of [
  ['atom', 'atom'],
  ['explore', `explore {"thing":${JSON.stringify(CREATOR_PATH)}}`]
]) {
  test(`${name} cannot commit an unauthorized initial Program effect`, async (t) => {
    const files = await fixture(t, [
      atom('Escalator', transformProgramSource(CHILD_PATH, ESCALATED_SOURCE), [], 'program')
    ]);
    const before = await fs.readFile(files.contextFile, 'utf8');
    const result = await executeAtomLanguage({
      ...files,
      source,
      programMode: 'reconcile',
      programScheduler: createProgramRuntimeScheduler(),
      interaction: interaction(`reject-${name}-effect`)
    });
    await assertRejectedWithoutCommit(result, files, before);
  });
}

test('create rejects an unauthorized declaration produced by post-create reconcile', async (t) => {
  const createdPath = `${CREATOR_PATH}/CreatedTrigger`;
  const files = await fixture(t, [
    atom('Escalation Trigger', triggerProgramSource(createdPath), [], 'program')
  ]);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    ...files,
    source: `transform new ${JSON.stringify({
      thing: createdPath, situation: 'go', contain: [], support: []
    })}`,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: interaction('reject-create-reconcile-effect')
  });
  await assertRejectedWithoutCommit(result, files, before);
});

test('single Transform rejects an unauthorized declaration produced by reconcile', async (t) => {
  const files = await fixture(t, [
    atom('Escalation Trigger', triggerProgramSource(TARGET_PATH), [], 'program')
  ]);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    ...files,
    source: `transform {"thing":${JSON.stringify(TARGET_PATH)},"situation.rep.after"}`,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: interaction('reject-single-reconcile-effect')
  });
  await assertRejectedWithoutCommit(result, files, before);
});

for (const scenario of [
  {
    name: 'create',
    source: (unauthorizedSource) => `transform new ${JSON.stringify({
      'thing@program': `${CREATOR_PATH}/Rejected Candidate`,
      situation: unauthorizedSource,
      contain: [],
      support: []
    })}`
  },
  {
    name: 'single',
    source: (unauthorizedSource) => `transform ${
      situationReplacement(CHILD_PATH, unauthorizedSource)
    }`
  }
]) {
  test(`${scenario.name} rejection cannot publish candidate source contracts to shared runtime`, async (t) => {
    const files = await fixture(t, [
      atom(
        'Committed Trigger',
        triggerProgramSource(TARGET_PATH, `${CREATOR_PATH}/Leak`, 'committed'),
        [],
        'program'
      )
    ]);
    const scheduler = await seedCommittedSharedRuntime(files.initial);
    const sharedBefore = sharedRuntimeSnapshot(scheduler);
    const worldBefore = await fs.readFile(files.contextFile, 'utf8');
    const unauthorizedSource = declaredTriggerSource(ESCALATED_SOURCE);

    const result = await executeAtomLanguage({
      ...files,
      source: scenario.source(unauthorizedSource),
      programScheduler: scheduler,
      interaction: interaction(`reject-${scenario.name}-candidate-contract`)
    });

    await assertRejectedWithoutCommit(result, files, worldBefore);
    assertSharedRuntimeUnchanged(scheduler, sharedBefore);
  });
}

test('rejected batch isolates candidate authority and blocks it before the next reconcile pass', async (t) => {
  const maliciousSource = 'agent({"labels":["^^"],"functions":{"groups":[],"names":["message","transform","trigger"]}})';
  const unauthorizedWorkerSource = [
    'def main():',
    `    ${transformProgramSource(`${CREATOR_PATH}/Leak`, 'acted')}`,
    `trigger('transform', {'nodes': [${JSON.stringify(CHILD_PATH)}]}, main)`
  ].join('\n');
  const files = await fixture(t, [
    atom('Escalation Trigger', triggerProgramSource(TARGET_PATH, CHILD_PATH, maliciousSource), [], 'program')
  ], [atom('Unauthorized Worker', unauthorizedWorkerSource, [], 'program')]);
  const scheduler = createProgramRuntimeScheduler();
  const originalRunProgram = scheduler.runProgram;
  let unauthorizedRuns = 0;
  scheduler.runProgram = async (request) => {
    if (request.program?.path === `${CHILD_PATH}/Unauthorized Worker`
      && request.triggered === true) unauthorizedRuns += 1;
    return originalRunProgram(request);
  };
  await scheduler.rebuildAgentSecurity(files.initial);
  const committedSecurity = structuredClone([...scheduler.agentSecurity]);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    ...files,
    source: `transform ${JSON.stringify([
      { thing: TARGET_PATH, 'situation.rep.after': 'before' },
      { thing: `${CREATOR_PATH}/Leak`, 'situation.rep.still-stable': 'stable' }
    ])}`,
    programScheduler: scheduler,
    interaction: interaction('reject-batch-reconcile-effect')
  });
  await assertRejectedWithoutCommit(result, files, before);
  assert.equal(unauthorizedRuns, 0, 'an unauthorized candidate Agent must not execute in a later pass');
  assert.deepEqual([...scheduler.agentSecurity], committedSecurity);
});

for (const scenario of [
  {
    name: 'single',
    source: (replacement) => `transform ${replacement}`
  },
  {
    name: 'batch',
    source: (replacement) => `transform [${replacement},${
      situationReplacement(`${CREATOR_PATH}/Leak`, 'batch-uncommitted')
    }]`
  }
]) {
  test(`uncommitted ${scenario.name} source validation and commit failure cannot pollute shared runtime`, async (t) => {
    const files = await fixture(t, [
      atom(
        'Committed Trigger',
        triggerProgramSource(TARGET_PATH, `${CREATOR_PATH}/Leak`, 'committed'),
        [],
        'program'
      )
    ]);
    const scheduler = await seedCommittedSharedRuntime(files.initial);
    const sharedBefore = sharedRuntimeSnapshot(scheduler);

    let commitAttempts = 0;
    let commitError = null;
    const world = createLegacyWorldService({
      transactionProvider: () => ({
        async recover() {},
        async compatibilityManifest() { return null; },
        async transformLogEntries() { return []; },
        async commit() {
          commitAttempts += 1;
          throw Object.assign(new Error('synthetic commit failure'), { code: 'SYNTHETIC_COMMIT_FAILED' });
        }
      })
    });
    let executionResult = null;
    try {
      const replacement = situationReplacement(
        COMMITTED_TRIGGER_PATH,
        triggerProgramSource(CHILD_PATH, `${CREATOR_PATH}/Leak`, 'uncommitted')
      );
      executionResult = await world.executeLegacy({
        ...files,
        source: scenario.source(replacement),
        programScheduler: scheduler,
        interaction: interaction(`reject-${scenario.name}-commit-after-source-validation`)
      });
    } catch (error) {
      commitError = error;
    }

    assert.equal(commitAttempts, 1, JSON.stringify(executionResult));
    assert.equal(commitError?.code, 'SYNTHETIC_COMMIT_FAILED');
    assertSharedRuntimeUnchanged(scheduler, sharedBefore);
  });
}

test('durable commit survives shared Agent-security rebuild failure and recovers on next use', async (t) => {
  const files = await fixture(t);
  const scheduler = createProgramRuntimeScheduler();
  const rebuild = scheduler.rebuildAgentSecurity.bind(scheduler);
  let injected = false;
  scheduler.rebuildAgentSecurity = async (atoms) => {
    const target = atoms[0]?.contain?.[0]?.contain?.[0]?.contain
      ?.find((entry) => entry.thing === 'Target');
    if (!injected && target?.situation === 'after') {
      injected = true;
      throw Object.assign(new Error('synthetic rebuild failure'), {
        code: 'SYNTHETIC_AGENT_SECURITY_REBUILD_FAILED'
      });
    }
    return rebuild(atoms);
  };

  const committed = await executeAtomLanguage({
    ...files,
    source: `transform {"thing":${JSON.stringify(TARGET_PATH)},"situation.rep.after"}`,
    programScheduler: scheduler,
    interaction: interaction('commit-with-rebuild-recovery')
  });
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.ok(committed.warnings.some(({ code }) => (
    code === 'AGENT_SECURITY_REBUILD_RECOVERY_PENDING'
  )), JSON.stringify(committed));
  assert.equal(JSON.parse(await fs.readFile(files.contextFile, 'utf8'))[0]
    .contain[0].contain[0].contain.find((entry) => entry.thing === 'Target').situation, 'after');
  assert.equal(scheduler.agentSecurityWorldRevision, null);

  const recovered = await executeAtomLanguage({
    ...files,
    source: `explore {"thing":${JSON.stringify(CREATOR_PATH)}}`,
    programScheduler: scheduler,
    interaction: interaction('recover-shared-agent-security')
  });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(scheduler.agentSecurity.has(CREATOR_PATH), true);
});
