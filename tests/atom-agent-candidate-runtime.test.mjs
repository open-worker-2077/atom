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

test('candidate reconcile and an injected commit failure cannot pollute shared runtime indexes', async (t) => {
  const files = await fixture(t, [
    atom('Ordinary Trigger', triggerProgramSource(TARGET_PATH, `${CREATOR_PATH}/Leak`, 'candidate'), [], 'program')
  ]);
  const scheduler = createProgramRuntimeScheduler();
  await scheduler.refresh(files.initial, { isolateFailures: true, passive: true });
  const initialRecords = scheduler.latestRecords;
  const initialAgentSecurity = structuredClone([...scheduler.agentSecurity]);

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
    executionResult = await world.executeLegacy({
      ...files,
      source: `transform {"thing":${JSON.stringify(TARGET_PATH)},"situation.rep.after"}`,
      programScheduler: scheduler,
      interaction: interaction('reject-commit-after-reconcile')
    });
  } catch (error) {
    commitError = error;
  }

  assert.equal(commitAttempts, 1, JSON.stringify(executionResult));
  assert.equal(commitError?.code, 'SYNTHETIC_COMMIT_FAILED');

  assert.deepEqual([...scheduler.agentSecurity], initialAgentSecurity);
  assert.equal(scheduler.latestRecords, initialRecords);
});

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
