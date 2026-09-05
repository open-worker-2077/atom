import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
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

function find(atoms, targetPath) {
  let children = atoms;
  let current = null;
  for (const segment of targetPath.split('/')) {
    current = children.find((candidate) => Object.entries(candidate).some(([key, value]) => (
      key.split(/[@#]/u)[0] === 'thing' && value === segment
    )));
    if (!current) return null;
    children = current.slot;
  }
  return current;
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

test('a context-free transform trigger authorizes an Agent Program with its own window and labels', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-triggered-agent-authority-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const controllerPath = 'Root/Controller';
  const signalPath = `${controllerPath}/Signal`;
  const targetPath = `${controllerPath}/Target`;
  const controllerSource = [
    'agent({"labels":["总控"],"functions":{"groups":[],"names":["lock","transform","trigger"]}})',
    'def advance():',
    `    transform({"thing":${JSON.stringify(targetPath)},"situation.rep.advanced":"locked"})`,
    `trigger("transform", {"nodes":[${JSON.stringify(signalPath)}]}, advance)`
  ].join('\n');
  const guardSource = `lock({"targets":{"paths":[${JSON.stringify(targetPath)}],"scope":"exact"},"actions":["transform"],"labels":["总控"]})`;
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [
      atom('Controller', controllerSource, [
        atom('Signal', 'before'),
        atom('Target', 'locked'),
        atom('Guard', guardSource, [], 'program')
      ], 'program')
    ])
  ], null, 2));

  const programScheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    source: `transform {"thing":${JSON.stringify(signalPath)},"situation.rep.after":"before"}`,
    programScheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(programScheduler.agentSecurity.get(controllerPath)?.labels, ['总控']);
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(stored[0].slot[0].slot[1].situation, 'advanced', JSON.stringify(result));
  assert.equal(
    result.warnings.some(({ code }) => code === 'PROGRAM_TRANSFORM_REJECTED'),
    false,
    JSON.stringify(result.warnings)
  );
});

test('a context-free ordinary Program does not inherit its enclosing Agent labels', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-triggered-program-no-agent-authority-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const controllerPath = 'Root/Controller';
  const signalPath = `${controllerPath}/Signal`;
  const targetPath = `${controllerPath}/Target`;
  const workerSource = [
    'def advance():',
    `    transform({"thing":${JSON.stringify(targetPath)},"situation.rep.leaked":"locked"})`,
    `trigger("transform", {"nodes":[${JSON.stringify(signalPath)}]}, advance)`
  ].join('\n');
  const guardSource = `lock({"targets":{"paths":[${JSON.stringify(targetPath)}],"scope":"exact"},"actions":["transform"],"labels":["总控"]})`;
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [
      atom('Controller', 'agent({"labels":["总控"],"functions":{"groups":[],"names":["lock","transform","trigger"]}})', [
        atom('Signal', 'before'),
        atom('Target', 'locked'),
        atom('Worker', workerSource, [], 'program'),
        atom('Guard', guardSource, [], 'program')
      ], 'program')
    ])
  ], null, 2));

  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    source: `transform {"thing":${JSON.stringify(signalPath)},"situation.rep.after":"before"}`,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(stored[0].slot[0].slot[1].situation, 'locked');
  assert.equal(
    result.warnings.some(({ code, cause }) => (
      code === 'PROGRAM_TRANSFORM_REJECTED' && cause === 'GRAPH_LOCK_DENIED'
    )),
    true,
    JSON.stringify(result.warnings)
  );
});

test('a completed stage lets its total-control Agent activate and unlock the next strut stage', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-triggered-stage-advance-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const controllerPath = 'Root/Controller';
  const firstPath = `${controllerPath}/🏃‍♀️第一步`;
  const nextPath = `${controllerPath}/⌛️🔒第二步`;
  const guardPath = `${controllerPath}/第二步业务锁`;
  const inertGuard = 'def main(arguments):\n    return True';
  const disableGuard = `situation.rep.${inertGuard}`;
  const controllerSource = [
    'agent({"labels":["总控"],"functions":{"groups":[],"names":["lock","transform","trigger"]}})',
    'def advance():',
    `    transform({${JSON.stringify('thing')}:${JSON.stringify(guardPath)},${JSON.stringify(disableGuard)}:None})`,
    `    transform({${JSON.stringify('thing.ren.🏃‍♀️第二步')}:${JSON.stringify(nextPath)}})`,
    `trigger("transform", {"nodes":[${JSON.stringify(firstPath)}]}, advance)`
  ].join('\n');
  const guardSource = `lock({"targets":{"paths":[${JSON.stringify(nextPath)}],"scope":"subtree"},"actions":["transform"],"labels":["总控"]})`;
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [
      atom('Controller', controllerSource, [
        {
          'thing': '🏃‍♀️第一步', situation: '', slot: [],
          strut: [{ 'if@current': true, then: [{ thing: nextPath }] }]
        },
        atom('⌛️🔒第二步'),
        atom('第二步业务锁', guardSource, [], 'program')
      ], 'program')
    ])
  ], null, 2));

  const programScheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    source: `transform {${JSON.stringify('thing.ren.✅第一步')}:${JSON.stringify(firstPath)}}`,
    programScheduler
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(stored[0].slot[0].slot[0].thing, '✅第一步');
  assert.equal(stored[0].slot[0].slot[1].thing, '🏃‍♀️第二步');
  assert.equal(stored[0].slot[0].slot[2].situation, inertGuard);
  assert.deepEqual(await programScheduler.activeRequestDrivenLocks(stored), []);
});

test('a five-stage strut chain hands one execution Agent to each activated successor', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-triggered-stage-handoff-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const controllerPath = 'Root/Controller';
  const stageNames = ['第一步', '第二步', '第三步', '第四步', '第五步'];
  const activePath = (index) => `${controllerPath}/🏃‍♀️${stageNames[index]}`;
  const pendingPath = (index) => `${controllerPath}/⌛️🔒${stageNames[index]}`;
  const completedPath = (index) => `${controllerPath}/✅${stageNames[index]}`;
  const executionPath = (index) => `${activePath(index)}/执行`;
  const registrationPath = (index) => `${executionPath(index)}/Registration`;
  const inertGuard = 'def main(arguments):\n    return True';
  const disableGuard = `situation.rep.${inertGuard}`;
  const controllerSource = [
    'agent({"labels":["总控"],"functions":{"groups":[],"names":["explore","jump","jump_authorize","lock","transform","trigger"]}})',
    'def activate():',
    '    window = explore({"thing":"执行"})[0]',
    '    source = explore({"thing":"Registration"})[0]',
    '    ancestry = explore({"thing":window.path,"slot$latitude+1":True})',
    '    stages = [record for record in ancestry if record.path != window.path]',
    '    if len(stages) != 1:',
    '        raise ValueError("execution window must have one direct stage")',
    '    stage = stages[0]',
    '    declared = explore({"thing":stage.path,"strut":True})',
    '    owner = [record for record in declared if record.path == stage.path][0]',
    '    if len(owner.strut) != 1 or len(owner.strut[0]["then"]) != 1:',
    '        raise ValueError("completed stage must declare one successor")',
    '    destination = explore({"thing":owner.strut[0]["then"][0]["thing"]})[0]',
    `    transform({"thing":destination.path + "/业务锁",${JSON.stringify(disableGuard)}:None})`,
    '    active_name = "🏃‍♀️" + destination.thing.replace("⌛️🔒", "", 1)',
    '    transform({"thing.ren." + active_name:destination.path})',
    '    jump_authorize({"window":window,"source":source,"destination":destination})',
    `trigger("transform", {"nodes":[${stageNames.slice(0, -1).map((_, index) => JSON.stringify(completedPath(index))).join(',')}]}, activate)`
  ].join('\n');
  const executionSource = 'agent({"labels":["总控"],"functions":{"groups":[],"names":["explore","jump","trigger"]}})';
  const whenSource = [
    'def main(arguments):',
    '    records = explore({"thing":"Registration","slot$latitude-1":True})',
    '    return any("jump-authorization" in record.types for record in records)'
  ].join('\n');
  const whereSource = [
    'def main(arguments):',
    '    records = explore({"thing":"Registration","slot$latitude-1":True})',
    '    grants = [record for record in records if "jump-authorization" in record.types]',
    '    if len(grants) != 1:',
    '        raise ValueError("one controlled jump authorization is required")',
    '    return grants[0]'
  ].join('\n');
  const registrationSource = [
    'def handoff():',
    '    jump({',
    '      "when": explore({"thing":"When"})[0],',
    '      "where": explore({"thing":"Where"})[0]',
    '    })',
    `trigger("transform", {"nodes":[${JSON.stringify(registrationPath(0))}]}, handoff)`
  ].join('\n');
  const stageAtoms = stageNames.map((name, index) => {
    const strut = index < stageNames.length - 1
      ? [{ 'if@current': true, then: [{ thing: pendingPath(index + 1) }] }]
      : [];
    if (index === 0) {
      return {
        thing: `🏃‍♀️${name}`, situation: '', strut, slot: [
          atom('执行', executionSource, [
            atom('When', whenSource, [], 'program'),
            atom('Where', whereSource, [], 'program'),
            atom('Registration', registrationSource, [], 'program')
          ], 'program')
        ]
      };
    }
    return {
      thing: `⌛️🔒${name}`,
      situation: '',
      strut,
      slot: [atom(
        '业务锁',
        `lock({"targets":{"paths":[${JSON.stringify(pendingPath(index))}],"scope":"subtree"},"actions":["transform"],"labels":["总控"]})`,
        [],
        'program'
      )]
    };
  });
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [
      atom('Controller', controllerSource, [
        ...stageAtoms
      ], 'program')
    ])
  ], null, 2));

  const programScheduler = createProgramRuntimeScheduler();
  for (let index = 0; index < stageNames.length - 1; index += 1) {
    const result = await executeAtomLanguage({
      contextFile,
      projectionFile,
      source: `transform {${JSON.stringify(`thing.ren.✅${stageNames[index]}`)}:${JSON.stringify(activePath(index))}}`,
      programScheduler,
      interaction: {
        id: `complete-stage-and-handoff-${index + 1}`,
        agent: { path: controllerPath }
      }
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
    const paths = new Set((function walk(atoms, prefix = []) {
      return atoms.flatMap((entry) => {
        const thing = Object.entries(entry).find(([key]) => (
          key === 'thing' || key.startsWith('thing@')
        ))[1];
        const current = [...prefix, thing];
        return [current.join('/'), ...walk(entry.slot ?? [], current)];
      });
    })(stored));
    assert.ok(paths.has(completedPath(index)));
    assert.ok(
      paths.has(activePath(index + 1)),
      `${JSON.stringify(result.warnings)}\n${[...paths].join('\n')}`
    );
    assert.ok(paths.has(executionPath(index + 1)), [...paths].join('\n'));
    assert.equal(paths.has(`${completedPath(index)}/执行`), false);
    assert.equal([...paths].some((entry) => entry.includes('迁窗授权-')), false);
  }

  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(await programScheduler.activeRequestDrivenLocks(stored), []);
});

test('renaming an editable antecedent preserves a strut stored on a business-locked consequent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-locked-incoming-strut-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const rootPath = 'Root';
  const activePath = `${rootPath}/🏃‍♀️前项`;
  const pendingPath = `${rootPath}/⌛️🔒后项`;
  const rootSource = 'agent({"labels":[],"functions":{"groups":[],"names":["lock","transform"]}})';
  const guardSource = `lock({"targets":{"paths":[${JSON.stringify(pendingPath)}],"scope":"subtree"},"actions":["transform"],"labels":["总控"]})`;
  await fs.writeFile(contextFile, JSON.stringify([
    {
      'thing@program': rootPath,
      situation: rootSource,
      slot: [
        atom('🏃‍♀️前项'),
        {
          thing: '⌛️🔒后项', situation: '', slot: [],
          strut: [{ if: [{ thing: activePath }], 'then@current': true }]
        },
        atom('业务锁', guardSource, [], 'program')
      ],
      strut: []
    }
  ], null, 2));

  const programScheduler = createProgramRuntimeScheduler();
  const renamed = await executeAtomLanguage({
    contextFile,
    projectionFile,
    source: `transform {${JSON.stringify('thing.ren.✅前项')}:${JSON.stringify(activePath)}}`,
    programScheduler,
    interaction: { id: 'rename-active-stage', agent: { path: rootPath } }
  });

  assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
  const [root] = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(root.slot[0].thing, '✅前项');
  assert.equal(root.slot[1].strut[0].if[0].thing, `${rootPath}/✅前项`);

  const directPendingEdit = await executeAtomLanguage({
    contextFile,
    projectionFile,
    source: `transform {"thing":${JSON.stringify(pendingPath)},"situation.rep.should-not-write"}`,
    programScheduler,
    interaction: { id: 'direct-pending-edit', agent: { path: rootPath } }
  });
  assert.equal(directPendingEdit.ok, false);
  assert.equal(directPendingEdit.errors[0].code, 'GRAPH_LOCK_DENIED');
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

test('create commits its source and rejects an unauthorized declaration from subsequent reconcile', async (t) => {
  const createdPath = `${CREATOR_PATH}/CreatedTrigger`;
  const files = await fixture(t, [
    atom('Escalation Trigger', triggerProgramSource(createdPath), [], 'program')
  ]);
  const result = await executeAtomLanguage({
    ...files,
    source: `transform new ${JSON.stringify({
      thing: createdPath, situation: 'go', slot: [], strut: []
    })}`,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: interaction('reject-create-reconcile-effect')
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => (
    code === 'AGENT_JURISDICTION_ESCALATION'
  )), JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.ok(find(stored, createdPath));
  assert.equal(find(stored, CHILD_PATH).situation, CHILD_SOURCE);
});

test('single Transform commits its source and rejects an unauthorized declaration from subsequent reconcile', async (t) => {
  const files = await fixture(t, [
    atom('Escalation Trigger', triggerProgramSource(TARGET_PATH), [], 'program')
  ]);
  const result = await executeAtomLanguage({
    ...files,
    source: `transform {"thing":${JSON.stringify(TARGET_PATH)},"situation.rep.after"}`,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: interaction('reject-single-reconcile-effect')
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => (
    code === 'AGENT_JURISDICTION_ESCALATION'
  )), JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(find(stored, TARGET_PATH).situation, 'after');
  assert.equal(find(stored, CHILD_PATH).situation, CHILD_SOURCE);
});

for (const scenario of [
  {
    name: 'create',
    source: (unauthorizedSource) => `transform new ${JSON.stringify({
      'thing@program': `${CREATOR_PATH}/Rejected Candidate`,
      situation: unauthorizedSource,
      slot: [],
      strut: []
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

test('batch commits its source while isolating rejected candidate authority before the next reconcile pass', async (t) => {
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
  const result = await executeAtomLanguage({
    ...files,
    source: `transform ${JSON.stringify([
      { thing: TARGET_PATH, 'situation.rep.after': 'before' },
      { thing: `${CREATOR_PATH}/Leak`, 'situation.rep.still-stable': 'stable' }
    ])}`,
    programScheduler: scheduler,
    interaction: interaction('reject-batch-reconcile-effect')
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => (
    code === 'AGENT_JURISDICTION_ESCALATION'
  )), JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(find(stored, TARGET_PATH).situation, 'after');
  assert.equal(find(stored, `${CREATOR_PATH}/Leak`).situation, 'still-stable');
  assert.equal(find(stored, CHILD_PATH).situation, CHILD_SOURCE);
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
    const target = atoms[0]?.slot?.[0]?.slot?.[0]?.slot
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
    .slot[0].slot[0].slot.find((entry) => entry.thing === 'Target').situation, 'after');
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
