import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { ensureThingIdentities, storedField, walkAtoms } from '../work-engine/atom-language/slot-graph-semantics.mjs';
import { inspectProgramReferenceSites } from '../work-engine/atom-language/program-reference-runtime.mjs';
import { thingIdForOrdinal } from '../work-engine/atom-language/thing-id-allocator.mjs';
import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../work-engine/atom-language/program-ref-binding-ledger.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  const agentProgram = type === 'agent';
  const storedType = agentProgram ? 'program' : type;
  const storedSituation = agentProgram
    ? `LEGACY_AGENT_SITUATION = ${JSON.stringify(situation)}\nagent({"labels":[],"functions":{"groups":[],"names":["explore","transform"]}})`
    : situation;
  return {
    [`thing${storedType ? `@${storedType}` : ''}`]: thing,
    situation: storedSituation,
    slot: slot,
    strut: []
  };
}

function memoryProjectionRepository() {
  let stored = null;
  return {
    async load() {
      return stored ? structuredClone(stored) : null;
    },
    async save(projection) {
      stored = structuredClone(projection);
      return stored;
    },
    replace(projection) {
      stored = structuredClone(projection);
    }
  };
}

let nextFixtureIdentity = 1_000;
function identify(atoms) {
  const missing = walkAtoms(atoms).filter(({ atom: value }) => (
    !storedField(value, 'thing')?.parsed.identity
  ));
  ensureThingIdentities(atoms, {
    identities: missing.map(() => thingIdForOrdinal(nextFixtureIdentity++))
  });
  return atoms;
}

async function bindingsFor(atoms) {
  const records = walkAtoms(atoms);
  const replacements = [];
  for (const { atom: value } of records) {
    const thing = storedField(value, 'thing');
    if (!thing?.parsed.types.some(type => type.raw === 'program')) continue;
    const source = storedField(value, 'situation')?.value ?? '';
    if (!source.trim()) continue;
    const inspected = await inspectProgramReferenceSites({ source });
    replacements.push({
      programThingId: thing.parsed.identity,
      sourceHash: inspected.sourceHash,
      sites: inspected.sites.map(site => {
        const matches = records.filter(record => {
          const pathValue = record.path.join('/');
          return pathValue === site.selector || pathValue.endsWith(`/${site.selector}`);
        });
        return {
          fingerprint: site.fingerprint,
          role: site.role,
          targetThingId: matches.length === 1
            ? storedField(matches[0].atom, 'thing').parsed.identity
            : 'zzz'
        };
      })
    });
  }
  const update = createProgramRefBindingUpdate({ replacements });
  return rebuildProgramRefBindings([{ receipt: { result: { programRefBindings: update } } }]);
}

test('startup reference rebuild preserves bytes and revision while isolating missing targets from execution', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-reference-startup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const world = [atom('Agent', '', [atom('Target', 'before'),
    atom('Good', 'explore({"thing":ref("Agent/Target")})', [], 'program'),
    atom('Bad', 'explore({"thing":ref("Missing")})', [], 'program')], 'agent'),
    atom('Archive', '', [atom('Archived', 'explore({"thing":ref("Missing")})', [], 'program')], 'backup@default')];
  identify(world);
  await fs.writeFile(contextFile, JSON.stringify(world));
  const bytes = await fs.readFile(contextFile, 'utf8');
  const revision = revisionOfWorldFacts(world);
  const executions = [];
  const scheduler = createProgramRuntimeScheduler({
    programRefBindings: await bindingsFor(world),
    runProgram: async ({ program }) => {
    executions.push(program.path);
    return { locks: [], messages: [], transforms: [] };
    }
  });
  const prepared = await executeAtomLanguage({ source: 'atom', contextFile,
    projectionFile: path.join(directory, 'graph.json'), programScheduler: scheduler, programMode: 'project' });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  assert.ok(scheduler.programReferenceIndex, 'startup must publish a derived reference index');
  assert.equal(scheduler.programReferenceIndex.failures[0].code, 'PROGRAM_REF_TARGET_MISSING');
  assert.deepEqual(executions.sort(), ['Agent', 'Agent/Good']);
  assert.equal(await fs.readFile(contextFile, 'utf8'), bytes);
  assert.equal(revisionOfWorldFacts(JSON.parse(bytes)), revision);
  const id = storedField(world[0].slot[0], 'thing').parsed.identity;
  assert.equal(scheduler.programReferenceIndex.sitesForTargets([id]).length, 1);
  const interaction = { id: 'reference-isolation', agent: { ref: storedField(world[0], 'thing').parsed.identity, path: 'Agent' } };
  const explored = await executeAtomLanguage({ source: 'explore {"thing":"Agent/Target"}', contextFile,
    programScheduler: scheduler, interaction });
  assert.equal(explored.ok, true, JSON.stringify(explored.errors));
  const transformed = await executeAtomLanguage({ source: 'transform {"thing":"Agent/Target","situation.rep.after"}',
    contextFile, projectionFile: path.join(directory, 'graph.json'), programScheduler: scheduler, interaction,
    commitWorld: async ({ facts }) => fs.writeFile(contextFile, JSON.stringify(facts)) });
  assert.equal(transformed.ok, true, JSON.stringify(transformed.errors));
  assert.equal(transformed.changed, true);
  assert.equal(executions.includes('Agent/Bad'), false);
  assert.equal(executions.includes('Archive/Archived'), false);
});

test('a query consumes the current Program projection without executing Programs', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-query-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [], 'agent'),
    atom('Program', "message({'level':'info','text':'must-not-run'})", [], 'program')
  ]));
  let reads = 0;
  const scheduler = {
    current: async () => {
      reads += 1;
      return {
        fingerprint: 'projection', cached: true, records: [], locks: [],
        messages: [], transforms: [], failures: []
      };
    },
    refresh: async () => {
      throw new Error('ordinary query executed Programs');
    }
  };

  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    interaction: { id: 'query-1', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(reads, 1);
  assert.equal(result.changed, false);
});

test('a missing-reference quarantine blocks explicit execution but expires when the same Program source changes', async () => {
  const world = [atom('Broken', 'explore({"thing":ref("Missing")})', [], 'program')];
  identify(world);
  let inspections = 0;
  const scheduler = createProgramRuntimeScheduler({
    programRefBindings: await bindingsFor(world),
    inspectProgramReferences: async request => {
    inspections += 1;
    return inspectProgramReferenceSites(request);
    }
  });
  const [first, second] = await Promise.all([
    scheduler.prepareProgramReferenceIndex(world), scheduler.prepareProgramReferenceIndex(world)
  ]);
  assert.equal(first, second);
  assert.equal(inspections, 0, 'cold rebuild consumes the persisted binding snapshot');
  await assert.rejects(scheduler.refresh(world, { programSelector: 'Broken', force: true }), {
    code: 'PROGRAM_REF_TARGET_MISSING'
  });
  const renamed = structuredClone(world);
  renamed[0][storedField(renamed[0], 'thing').rawKey] = 'Renamed';
  await assert.rejects(scheduler.refresh(renamed, { programSelector: 'Renamed', force: true }), {
    code: 'PROGRAM_REF_TARGET_MISSING'
  });
  const repaired = structuredClone(world);
  repaired[0].situation = 'message({"level":"info","text":"repaired"})';
  scheduler.setProgramRefBindings(await bindingsFor(repaired));
  const cycle = await scheduler.refresh(repaired, { programSelector: 'Broken', force: true });
  assert.equal(cycle.messages[0].text, 'repaired');
  assert.equal(cycle.runtimeWarnings?.some(warning => warning.code === 'PROGRAM_REF_TARGET_MISSING') ?? false, false);
  assert.equal(inspections, 0, 'ordinary execution does not reparse Program references');
});

test('quarantined Programs stay outside persisted projection fingerprints and unrelated rebases', async () => {
  const world = [atom('Fact', 'before'), atom('Good', 'pass', [], 'program'),
    atom('Broken', 'explore({"thing":ref("Missing")})', [], 'program')];
  identify(world);
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: memoryProjectionRepository(),
    programRefBindings: await bindingsFor(world)
  });
  await scheduler.refresh(world, { isolateFailures: true, prepareAllIndexes: true });
  assert.equal((await scheduler.assertContextFreeProjection(world)).persisted, true);
  const changed = structuredClone(world);
  changed[0].situation = 'after';
  const rebased = await scheduler.rebaseContextFreeProjection(world, changed, { changedPaths: ['Fact'], isolateFailures: true });
  assert.equal(rebased.persisted, true);
  assert.equal((await scheduler.assertContextFreeProjection(changed)).persisted, true);
  assert.equal((await scheduler.persistComputedContextFreeProjection(world)).persisted, true);
});

test('derived-state invalidation preserves same-identity same-source quarantine across an unrelated commit', async () => {
  const world = [atom('Fact', 'before'), atom('Good', 'message({"level":"info","text":"healthy"})', [], 'program'),
    atom('Broken', 'explore({"thing":ref("Missing")})', [], 'program')];
  identify(world);
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: memoryProjectionRepository(),
    programRefBindings: await bindingsFor(world)
  });
  await scheduler.refresh(world, { isolateFailures: true, prepareAllIndexes: true });
  const committed = structuredClone(world);
  committed[0].situation = 'after';
  const committedBytes = JSON.stringify(committed);
  const committedRevision = revisionOfWorldFacts(committed);
  scheduler.invalidateDerivedWorldState();
  await assert.rejects(scheduler.current(committed, { programSelector: 'Broken' }), {
    code: 'PROGRAM_REF_TARGET_MISSING'
  });
  await assert.rejects(scheduler.refresh(committed, { programSelector: 'Broken', force: true }), {
    code: 'PROGRAM_REF_TARGET_MISSING'
  });
  const cycle = await scheduler.refresh(committed, { isolateFailures: true });
  assert.equal(cycle.messages[0].text, 'healthy');
  assert.deepEqual(cycle.failures, []);
  assert.equal(cycle.runtimeWarnings.some(warning => warning.code === 'PROGRAM_REF_TARGET_MISSING'), true);
  assert.equal(JSON.stringify(committed), committedBytes);
  assert.equal(revisionOfWorldFacts(committed), committedRevision);
});

test('reference rebuilds reuse one revision and a newer binding generation replaces it', async () => {
  const older = [atom('Target'), atom('Program', '# older\nexplore({"thing":ref("Target")})', [], 'program')];
  identify(older);
  const newer = structuredClone(older);
  newer[1].situation = '# newer\nexplore({"thing":ref("Missing")})';
  const scheduler = createProgramRuntimeScheduler({
    programRefBindings: await bindingsFor(older)
  });
  const [first, repeated] = await Promise.all([
    scheduler.prepareProgramReferenceIndex(older),
    scheduler.prepareProgramReferenceIndex(older)
  ]);
  assert.equal(first, repeated);
  scheduler.setProgramRefBindings(await bindingsFor(newer));
  const newestIndex = await scheduler.prepareProgramReferenceIndex(newer);
  assert.equal(scheduler.programReferenceIndex, newestIndex);
  assert.equal(scheduler.programReferenceRevision, revisionOfWorldFacts(newer));
  assert.equal(newestIndex.failures[0].code, 'PROGRAM_REF_TARGET_MISSING');
});

test('invalidation rebuilds the latest explicit binding generation', async () => {
  const original = [atom('Target'), atom('Program', '# published\nexplore({"thing":ref("Target")})', [], 'program')];
  identify(original);
  const pending = structuredClone(original);
  pending[1].situation = '# pending\nexplore({"thing":ref("Missing")})';
  const scheduler = createProgramRuntimeScheduler({
    programRefBindings: await bindingsFor(original)
  });
  const published = await scheduler.prepareProgramReferenceIndex(original);
  assert.equal(published.failures.length, 0);
  scheduler.setProgramRefBindings(await bindingsFor(pending));
  scheduler.invalidateDerivedWorldState();
  const rebuilt = await scheduler.prepareProgramReferenceIndex(pending);
  assert.equal(scheduler.programReferenceIndex, rebuilt);
  assert.equal(scheduler.programReferenceRevision, revisionOfWorldFacts(pending));
  assert.equal(rebuilt.failures[0].code, 'PROGRAM_REF_TARGET_MISSING');
});

test('a validated Program projection survives scheduler restart for the exact world revision', async () => {
  const repository = memoryProjectionRepository();
  const world = [atom('Program', '# projection', [], 'program')];
  let executions = 0;
  const first = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const built = await first.refresh(world, { isolateFailures: true });
  assert.equal(built.cached, false);
  assert.equal(executions, 1);

  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      throw new Error('restored projection must not execute a worker');
    }
  });
  const restored = await restarted.current(structuredClone(world), { isolateFailures: true });

  assert.equal(restored.cached, true);
  assert.deepEqual(restored.messages, []);
  assert.deepEqual(restored.transforms, []);
  assert.equal(executions, 1);
});

test('a persisted Program projection restores only versioned exact Explore read paths', async () => {
  const repository = memoryProjectionRepository();
  const world = [atom('Target'), atom('Program', '# reads target', [], 'program')];
  const first = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ executeExplore }) => {
      await executeExplore({ thing: 'Target', 'slot$latitude-1': true });
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await first.refresh(world, {
    isolateFailures: true,
    executeExplore: async () => [{ path: 'Target' }]
  });

  const stored = await repository.load();
  assert.equal(stored.readSetVersion, 1);
  assert.deepEqual(stored.exploreReadPaths, ['Target']);

  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });
  const restored = await restarted.current(structuredClone(world), { isolateFailures: true });
  assert.deepEqual(restored.exploreReadPaths, ['Target']);

});

test('an unrelated situation edit rebases the context-free projection without rerunning Programs', async () => {
  const repository = memoryProjectionRepository();
  const before = [
    atom('Target', 'watched'),
    atom('Unrelated', 'before'),
    atom('Program', '# reads target', [], 'program')
  ];
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ executeExplore }) => {
      executions += 1;
      await executeExplore({ thing: 'Target' });
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await scheduler.refresh(before, {
    isolateFailures: true,
    executeExplore: async () => [{ path: 'Target' }]
  });
  const after = [
    atom('Target', 'watched'),
    atom('Unrelated', 'after'),
    atom('Program', '# reads target', [], 'program')
  ];

  const result = await scheduler.rebaseContextFreeProjection(before, after, {
    changedPaths: ['Unrelated'],
    isolateFailures: true,
    previousRevision: revisionOfWorldFacts(before),
    revision: revisionOfWorldFacts(after)
  });
  const restored = await scheduler.current(after, { isolateFailures: true });

  assert.equal(result.persisted, true);
  assert.equal(result.local, true);
  assert.equal(executions, 1);
  assert.deepEqual(restored.exploreReadPaths, ['Target']);
});

test('a projection with no locks does not traverse unrelated subtrees when rebinding', async () => {
  const repository = memoryProjectionRepository();
  repository.replace({ worldKey: 'before-revision', contextDependent: false,
    failures: [], locks: [], exploreReadPaths: [], choices: [] });
  const scheduler = createProgramRuntimeScheduler({ projectionRepository: repository });
  const unrelated = atom('Unrelated', '', [{ thing: 'Nested', situation: '',
    get slot() { throw new Error('unrelated subtree was traversed'); }, strut: [] }]);
  const before = [atom('Changed', 'before'), unrelated];
  const after = [atom('Changed', 'after'), unrelated];
  const result = await scheduler.rebaseContextFreeProjection(before, after, {
    changedPaths: ['Changed'], previousRevision: 'before-revision', revision: 'after-revision'
  });
  assert.equal(result.persisted, true);
  assert.equal(result.local, true);
  assert.deepEqual((await repository.load()).locks, []);
});

test('a dependency edit cannot rebase the context-free projection', async () => {
  const repository = memoryProjectionRepository();
  const before = [atom('Target', 'before'), atom('Program', '# reads target', [], 'program')];
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ executeExplore }) => {
      await executeExplore({ thing: 'Target' });
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await scheduler.refresh(before, {
    isolateFailures: true,
    executeExplore: async () => [{ path: 'Target' }]
  });

  const result = await scheduler.rebaseContextFreeProjection(
    before,
    [atom('Target', 'after'), atom('Program', '# reads target', [], 'program')],
    { changedPaths: ['Target'], isolateFailures: true }
  );

  assert.equal(result.persisted, false);
  assert.equal(result.reason, 'dependency-changed');
});

test('an ordinary situation Transform commits without a full Program projection rebuild', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-rebase-transform-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [atom('Target', 'before')], 'agent')
  ]));
  const security = { labels: [], functionScopes: { groups: [], names: [] }, functions: [] };
  let sourceValidations = 0;
  let registrationInspections = 0;
  const scheduler = {
    agentSecurity: new Map([['Agent', security]]),
    activeRequestDrivenLocks: async () => [],
    current: async () => ({
      fingerprint: 'current', records: [], locks: [], messages: [], transforms: [],
      shortcuts: [], slotBodies: [], failures: [], agentSecurity: security
    }),
    validateProgramSources: async () => { sourceValidations += 1; },
    inspectAgentRegistration: async () => {
      registrationInspections += 1;
      return ({
      labels: [], functionScopes: { groups: [], names: [] }, functions: []
      });
    },
    refresh: async (_atoms, options) => {
      if (!options.triggerEvent) {
        throw Object.assign(new Error('full rebuild must not run'), { code: 'FULL_REBUILD' });
      }
      return {
        records: [], locks: [], messages: [], transforms: [], shortcuts: [], slotBodies: [],
        failures: [], agentSecurity: security, reconcileSummary: {}
      };
    },
    rebaseContextFreeProjection: async () => ({ persisted: true })
  };

  const result = await executeAtomLanguage({
    source: 'transform {"thing":"Agent/Target","situation.rep.after"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    commitWorld: async () => {},
    interaction: { id: 'rebase-transform', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, true);
  assert.equal(sourceValidations, 0);
  assert.equal(registrationInspections, 0);
  assert.equal(result.warnings.some(({ code }) => (
    code === 'PROGRAM_PROJECTION_RECOVERY_PENDING'
  )), false, JSON.stringify(result.warnings));
});

test('an ordinary nested create skips whole-world Program source validation', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-rebase-create-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [atom('Work')], 'agent')
  ]));
  const security = { labels: [], functionScopes: { groups: [], names: [] }, functions: [] };
  let validations = 0;
  const cycle = {
    fingerprint: 'current', records: [], locks: [], messages: [], transforms: [],
    shortcuts: [], slotBodies: [], failures: [], agentSecurity: security, reconcileSummary: {}
  };
  const scheduler = {
    agentSecurity: new Map([['Agent', security]]),
    activeRequestDrivenLocks: async () => [],
    current: async () => cycle,
    validateProgramSources: async () => { validations += 1; },
    refresh: async () => cycle,
    rebaseContextFreeProjection: async () => ({ persisted: true })
  };

  const result = await executeAtomLanguage({
    source: 'transform new {"thing":"Agent/Work/Note","situation":"local","slot":[],"strut":[]}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    commitWorld: async () => ({
      afterRevision: 'sha256:synthetic-after',
      result: { affectedAtoms: [{ path: 'Agent/Work/Note', axes: ['thing', 'situation', 'slot', 'strut'] }] }
    }),
    interaction: { id: 'rebase-create', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, true);
  assert.equal(validations, 0);
});

test('a failed projection rebase falls back to a complete context-free settlement', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-rebase-fallback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [atom('Target', 'before')], 'agent')
  ]));
  const security = { labels: [], functionScopes: { groups: [], names: [] }, functions: [] };
  let settlements = 0;
  const cycle = {
    fingerprint: 'current', records: [], locks: [], messages: [], transforms: [],
    shortcuts: [], slotBodies: [], failures: [], agentSecurity: security, reconcileSummary: {}
  };
  const scheduler = {
    agentSecurity: new Map([['Agent', security]]),
    activeRequestDrivenLocks: async () => [],
    current: async () => cycle,
    validateProgramSources: async () => [],
    inspectAgentRegistration: async () => ({
      labels: [], functionScopes: { groups: [], names: [] }, functions: []
    }),
    refresh: async (_atoms, options) => {
      if (!options.triggerEvent) settlements += 1;
      return cycle;
    },
    rebaseContextFreeProjection: async () => {
      throw Object.assign(new Error('synthetic corrupt projection'), {
        code: 'SYNTHETIC_PROJECTION_REBASE_FAILED'
      });
    }
  };

  const result = await executeAtomLanguage({
    source: 'transform {"thing":"Agent/Target","situation.rep.after"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    commitWorld: async () => {},
    interaction: { id: 'rebase-fallback', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(settlements, 1);
  assert.equal(result.warnings.some(({ code }) => (
    code === 'PROGRAM_PROJECTION_RECOVERY_PENDING'
  )), false, JSON.stringify(result.warnings));
});

test('an explicit selected Program run cannot replace the persisted full-world projection', async () => {
  const repository = memoryProjectionRepository();
  const world = [
    atom('Program A', '# selected', [], 'program'),
    atom('Program B', '# remains active', [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => ({ locks: [], messages: [], transforms: [] })
  });

  await scheduler.refresh(world, { isolateFailures: true });
  await scheduler.refresh(structuredClone(world), {
    isolateFailures: true,
    programSelector: 'Program A',
    force: true
  });

  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      throw new Error('the preserved full-world projection must be restored');
    }
  });
  const restored = await restarted.current(structuredClone(world), {
    isolateFailures: true
  });

  assert.equal(restored.cached, true);
  assert.deepEqual(restored.failures, []);
});

test('each committed Program create settles the next independent request onto its new revision', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-create-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    { 'thing@program&id=101': 'Root', situation: 'agent({"labels":[],"functions":{"groups":[],"names":["explore","transform"]}})', slot: [], strut: [] }
  ], null, 2));
  const projectionRepository = memoryProjectionRepository();
  const programExecutions = [];
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository,
    runProgram: async ({ program, validateOnly }) => {
      if (validateOnly) {
        const inspection = await inspectProgramReferenceSites({ source: program.detail });
        return { locks: [], triggers: [], sourceHash: inspection.sourceHash, referenceSites: inspection.sites };
      }
      programExecutions.push(program.path);
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const interaction = { agent: { ref: 'audit-ref', path: 'Root' } };
  const commitWorld = async ({ facts }) => {
    await fs.writeFile(contextFile, JSON.stringify(facts, null, 2));
  };

  const initialized = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'project', interaction: { id: 'create-startup', agent: null }
  });
  assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));

  const createdPredicate = await executeAtomLanguage({
    source: 'transform new {"thing@program":"Root/Predicate","situation":"def main(arguments):\\n    return False","slot":[],"strut":[]}',
    contextFile, projectionFile, programScheduler: scheduler, commitWorld,
    thingIdentityWatermark: '101',
    interaction: { id: 'create-predicate', ...interaction }
  });
  assert.equal(createdPredicate.ok, true, JSON.stringify(createdPredicate.errors));
  const predicateExecutionsAfterCreate = programExecutions.filter((programPath) => (
    programPath === 'Root/Predicate'
  )).length;
  assert.ok(predicateExecutionsAfterCreate > 0);

  const createdRegistration = await executeAtomLanguage({
    source: 'transform new {"thing@program":"Root/Registration","situation":"def main(arguments):\\n    return None","slot":[],"strut":[]}',
    contextFile, projectionFile, programScheduler: scheduler, commitWorld,
    thingIdentityWatermark: '102',
    interaction: { id: 'create-registration', ...interaction }
  });
  assert.equal(createdRegistration.ok, true, JSON.stringify(createdRegistration.errors));
  assert.equal(programExecutions.filter((programPath) => (
    programPath === 'Root/Predicate'
  )).length, predicateExecutionsAfterCreate);
  assert.ok(programExecutions.includes('Root/Registration'));

  let readExecutions = 0;
  const restarted = createProgramRuntimeScheduler({
    projectionRepository,
    runProgram: async () => {
      readExecutions += 1;
      throw new Error('ordinary exact Explore must consume the committed passive base');
    }
  });
  const audited = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Registration","situation$full":true}',
    contextFile, projectionFile, programScheduler: restarted,
    interaction: { id: 'audit-registration', ...interaction }
  });
  assert.equal(audited.ok, true, JSON.stringify(audited.errors));
  assert.equal(audited.items[0].matches[0].path, 'Root/Registration');
  assert.equal(readExecutions, 0);
});

test('a persisted Program projection cannot be reused for a different world revision', async () => {
  const repository = memoryProjectionRepository();
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => ({ locks: [], messages: [], transforms: [] })
  });
  await scheduler.refresh([atom('Fact', 'before'), atom('Program', '# projection', [], 'program')], {
    isolateFailures: true
  });
  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });

  await assert.rejects(
    restarted.current([atom('Fact', 'after'), atom('Program', '# projection', [], 'program')], {
      isolateFailures: true
    }),
    (error) => error.code === 'ATOM_PROGRAM_PROJECTION_MISSING'
  );
});

test('passive read preparation computes on a cache miss and reuses the computed index', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const world = [atom('Program', '# compute once', [], 'program')];
  const first = await scheduler.refresh(world, {
    passive: true,
    agentOrigin: { path: 'Agent' }
  });
  assert.equal(first.cached, false);
  assert.equal(executions, 1);

  const second = await scheduler.refresh(structuredClone(world), {
    passive: true,
    agentOrigin: { path: 'Agent' }
  });
  assert.equal(second.cached, true);
  assert.equal(executions, 1);
});

test('Agent key, lock, and path changes invalidate accelerated Program results', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const world = [atom('Root', '', [
    atom('Agent', 'agent({"labels":["^"],"functions":{"groups":[],"names":["transform"]}})', [], 'program'),
    atom('Lock', 'lock({"targets":{"paths":["Root/Agent"],"scope":"exact"},"actions":["transform"],"labels":["^"]})', [], 'program')
  ])];

  await scheduler.refresh(world, { agentOrigin: { path: 'Root/Agent' } });
  assert.equal(executions, 3);
  await scheduler.refresh(structuredClone(world), { agentOrigin: { path: 'Root/Agent' } });
  assert.equal(executions, 3, 'an unchanged world should reuse accelerated results');

  const keyChanged = structuredClone(world);
  keyChanged[0].slot[0].situation = keyChanged[0].slot[0].situation.replace('["^"]', '["^^"]');
  await scheduler.refresh(keyChanged, { agentOrigin: { path: 'Root/Agent' } });
  assert.equal(executions, 5, 'an Agent key change must invalidate its affected accelerated result');

  const lockChanged = structuredClone(keyChanged);
  lockChanged[0].slot[1].situation = lockChanged[0].slot[1].situation.replace('["^"]', '["^^"]');
  await scheduler.refresh(lockChanged, { agentOrigin: { path: 'Root/Agent' } });
  assert.equal(executions, 7, 'a lock change must invalidate its affected accelerated result');

  const pathChanged = structuredClone(lockChanged);
  pathChanged[0].slot[0]['thing@program'] = 'RenamedAgent';
  pathChanged[0].slot[1].situation = pathChanged[0].slot[1].situation.replace('Root/Agent', 'Root/RenamedAgent');
  await scheduler.refresh(pathChanged, { agentOrigin: { path: 'Root/RenamedAgent' } });
  assert.equal(executions, 10, 'a valid path move must invalidate the Agent and its affected lock result');
});

test('startup isolates Agent-bound jump failures into a restartable context-free passive projection', async () => {
  const repository = memoryProjectionRepository();
  const world = [
    atom('Stable Program', '# context-free lock', [], 'program'),
    atom('Jump Program', '# Agent-bound jump', [], 'program')
  ];
  const startup = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ program }) => {
      if (program.path === 'Jump Program') {
        throw Object.assign(new Error('jump requires one active Agent window'), {
          code: 'WINDOW_JUMP_DESTINATION_INVALID'
        });
      }
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const built = await startup.refresh(world, { isolateFailures: true });
  assert.deepEqual(built.failures, []);
  assert.equal(built.contextIncomplete, true);
  assert.ok(await repository.load(), 'startup must persist the validated context-free base');

  const agentCycle = await startup.refresh(structuredClone(world), {
    isolateFailures: true,
    force: true,
    agentOrigin: { ref: 'agent-ref', path: 'Root/Window' }
  });
  assert.deepEqual(agentCycle.failures.map(({ code }) => code), [
    'WINDOW_JUMP_DESTINATION_INVALID'
  ]);

  let restartedExecutions = 0;
  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      restartedExecutions += 1;
      throw new Error('passive restore must not execute Programs');
    }
  });
  const restored = await restarted.refresh(structuredClone(world), {
    isolateFailures: true,
    passive: true,
    allowContextIncomplete: true,
    agentOrigin: { ref: 'agent-ref', path: 'Root/Window' }
  });

  assert.equal(restored.cached, true);
  assert.equal(restored.contextIncomplete, true);
  assert.equal(restartedExecutions, 0);
});

test('an Agent exact read reuses a valid context-incomplete projection without executing an unrelated jump', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-context-incomplete-exact-read-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const repository = memoryProjectionRepository();
  const world = [atom('Root', '', [
    atom('Audit', 'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})', [], 'program'),
    atom('Target'),
    atom('Legacy Jump', '# agent-bound jump', [], 'program')
  ])];
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2));

  const startup = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ program }) => {
      if (program.path === 'Root/Legacy Jump') {
        throw Object.assign(new Error('missing destination'), {
          code: 'WINDOW_JUMP_DESTINATION_INVALID'
        });
      }
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await startup.refresh(world, { isolateFailures: true });

  let executions = 0;
  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      throw new Error('an exact read must not rebuild unrelated Programs');
    }
  });
  const result = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Target","situation$full":true}',
    contextFile,
    projectionFile,
    programScheduler: restarted,
    interaction: { id: 'context-incomplete-exact-read', agent: { ref: 'audit-ref', path: 'Root/Audit' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].path, 'Root/Target');
  assert.equal(executions, 0);
});

test('passive Agent readiness completes contextual Programs without retrying a startup-isolated failure', async () => {
  const executions = new Map();
  const world = [
    atom('Agent', '', [], 'agent'),
    atom('Context Lock', '# reads current Agent', [], 'program'),
    atom('Broken Jump', '# invalid without an explicit repair', [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, executeExplore }) => {
      executions.set(program.path, (executions.get(program.path) ?? 0) + 1);
      if (program.path === 'Broken Jump') {
        throw Object.assign(new Error('missing destination'), {
          code: 'WINDOW_JUMP_DESTINATION_INVALID'
        });
      }
      await executeExplore({});
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const startup = await scheduler.refresh(world, {
    isolateFailures: true,
    executeExplore: async () => []
  });
  assert.equal(startup.contextIncomplete, true);
  assert.equal(executions.get('Broken Jump'), 1);

  const ready = await scheduler.refresh(structuredClone(world), {
    isolateFailures: true,
    passive: true,
    reuseDormantContextFailureCodes: ['WINDOW_JUMP_DESTINATION_INVALID'],
    agentOrigin: { ref: 'agent-ref', path: 'Agent' },
    executeExplore: async () => [{ path: 'Agent' }]
  });

  assert.deepEqual(ready.failures, []);
  assert.equal(executions.get('Context Lock'), 2);
  assert.equal(executions.get('Broken Jump'), 1);
});

test('startup settles isolated Program failures before replacing a stale passive projection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-startup-settle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const repository = memoryProjectionRepository();
  repository.replace({
    version: 1,
    readSetVersion: 1,
    worldKey: 'stale-world',
    programSetKey: 'stale-programs',
    contextDependent: false,
    contextIncomplete: false,
    scopePath: null,
    locks: [],
    choices: [],
    exploreReadPaths: [],
    failures: []
  });
  const world = [
    atom('Target'),
    atom('Healthy Program', '# healthy', [], 'program'),
    atom('Broken Program', '# deterministic isolated failure', [], 'program'),
    atom('Scoped Program', '# requires one slot scope', [], 'program')
  ];
  await fs.writeFile(contextFile, JSON.stringify(world));
  let startupExecutions = 0;
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ program }) => {
      startupExecutions += 1;
      if (program.path === 'Broken Program') {
        throw Object.assign(new Error('invalid isolated message effect'), {
          code: 'INVALID_PROGRAM_MESSAGE'
        });
      }
      if (program.path === 'Scoped Program') {
        throw Object.assign(new Error('slot scope is required'), {
          code: 'SLOT_SCOPE_ROOT_UNBOUND'
        });
      }
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const initialized = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile,
    programScheduler: scheduler,
    programMode: 'project',
    interaction: { id: 'startup-settle', agent: null }
  });

  assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));
  assert.equal(startupExecutions, 3, 'the settle pass must reuse success and isolated failure state');
  assert.ok(initialized.warnings.some(({ code }) => code === 'INVALID_PROGRAM_MESSAGE'));
  const stored = await repository.load();
  assert.notEqual(stored.worldKey, 'stale-world');
  assert.notEqual(stored.programSetKey, 'stale-programs');
  assert.equal(stored.contextIncomplete, true);
  assert.deepEqual(stored.failures, []);

  let restartedExecutions = 0;
  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      restartedExecutions += 1;
      throw new Error('same-revision passive restore must not execute Programs');
    }
  });
  const restored = await restarted.refresh(structuredClone(world), {
    isolateFailures: true,
    passive: true,
    allowContextIncomplete: true,
    agentOrigin: { ref: 'agent-ref', path: 'Agent' }
  });
  assert.equal(restored.cached, true);
  assert.equal(restartedExecutions, 0);
});

test('startup publishes with a persistent context-free Program failure kept as a warning', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-startup-isolated-warning-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root')]));
  const failure = {
    code: 'REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED',
    message: 'lock declaration requires literal paths',
    programPath: 'Root/Legacy Lock'
  };
  const programScheduler = {
    agentSecurity: new Map(),
    async refresh() {
      return {
        cached: false,
        records: [],
        locks: [],
        messages: [],
        transforms: [],
        failures: [failure],
        runtimeWarnings: []
      };
    }
  };

  const initialized = await executeAtomLanguage({
    source: 'atom',
    contextFile,
    projectionFile,
    programScheduler,
    programMode: 'project',
    interaction: { id: 'startup-isolated-warning', agent: null }
  });

  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  assert.ok(initialized.warnings.some((warning) => (
    warning.code === 'REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED'
  )), JSON.stringify(initialized));
});

test('a legacy persisted failure is rejected and retried instead of becoming authoritative', async () => {
  const repository = memoryProjectionRepository();
  const world = [atom('Program', '# retry legacy failure', [], 'program')];
  let executions = 0;
  const first = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await first.refresh(world, { isolateFailures: true });
  const stored = await repository.load();
  repository.replace({
    ...stored,
    failures: [{ code: 'ATOM_PROGRAM_TIMEOUT', message: 'legacy transient failure' }]
  });

  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const rebuilt = await restarted.refresh(structuredClone(world), { isolateFailures: true });

  assert.equal(rebuilt.cached, false);
  assert.deepEqual(rebuilt.failures, []);
  assert.equal(executions, 2);
});

test('concurrent Programs share one cycle deadline', async () => {
  const budgets = [];
  const scheduler = createProgramRuntimeScheduler({
    timeoutMs: 12_345,
    maxWorkers: 1,
    runProgram: async ({ timeoutMs }) => {
      budgets.push(timeoutMs);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { locks: [], messages: [], transforms: [] };
    }
  });

  await scheduler.refresh([
    atom('Program A', '# a', [], 'program'),
    atom('Program B', '# b', [], 'program'),
    atom('Program C', '# c', [], 'program')
  ]);

  assert.equal(budgets.length, 3);
  assert.equal(budgets.every((budget) => budget > 12_000 && budget <= 12_345), true);
  assert.ok(budgets[1] < budgets[0]);
  assert.ok(budgets[2] < budgets[1]);
});

test('a Program that explores the current Agent cannot reuse another Agent projection', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program, executeExplore }) => {
      if (program.path === 'Program') executions += 1;
      await executeExplore({});
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const world = [
    atom('Agent A', '', [], 'agent'),
    atom('Agent B', '', [], 'agent'),
    atom('Program', '# contextual', [], 'program')
  ];

  await scheduler.refresh(world, {
    agentOrigin: { ref: 'agent-a-ref', path: 'Agent A' },
    executeExplore: async () => [{ path: 'Agent A' }]
  });
  await scheduler.refresh(structuredClone(world), {
    agentOrigin: { ref: 'agent-b-ref', path: 'Agent B' },
    executeExplore: async () => [{ path: 'Agent B' }]
  });
  await scheduler.refresh(structuredClone(world), {
    agentOrigin: { ref: 'agent-a-ref-2', path: 'Agent A' },
    executeExplore: async () => [{ path: 'Agent A' }]
  });

  assert.equal(executions, 2);
});

test('a persisted Agent-scoped projection is restored only for the same Agent path', async () => {
  const repository = memoryProjectionRepository();
  const world = [
    atom('Agent A', '', [], 'agent'),
    atom('Agent B', '', [], 'agent'),
    atom('Program', '# contextual', [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ executeExplore }) => {
      await executeExplore({});
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await scheduler.refresh(world, {
    agentOrigin: { ref: 'agent-a-ref', path: 'Agent A' },
    executeExplore: async () => [{ path: 'Agent A' }]
  });

  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });
  await assert.rejects(
    restarted.current(structuredClone(world), {
      agentOrigin: { ref: 'agent-b-ref', path: 'Agent B' }
    }),
    (error) => error.code === 'ATOM_PROGRAM_PROJECTION_MISSING'
  );
  const restored = await restarted.current(structuredClone(world), {
    agentOrigin: { ref: 'agent-a-new-ref', path: 'Agent A' }
  });
  assert.equal(restored.cached, true);
});

test('replaceable projection persistence failure does not discard a valid in-memory Program cycle', async () => {
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      async load() { return null; },
      async save() {
        throw Object.assign(new Error('projection file is busy'), { code: 'EPERM' });
      }
    },
    runProgram: async () => ({ locks: [], messages: [], transforms: [] })
  });

  const cycle = await scheduler.refresh([atom('Program', '# valid', [], 'program')]);

  assert.equal(cycle.cached, false);
  assert.equal(cycle.runtimeWarnings[0].code, 'PROGRAM_PROJECTION_PERSIST_FAILED');
  const current = await scheduler.current([atom('Program', '# valid', [], 'program')]);
  assert.equal(current.cached, true);
});

test('a transient Program failure is retried by an explicit Program refresh', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      if (executions === 1) {
        throw Object.assign(new Error('worker timed out'), { code: 'ATOM_PROGRAM_TIMEOUT' });
      }
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const program = atom('Program', '# retryable', [], 'program');

  const failed = await scheduler.refresh([atom('Fact', 'before'), program], {
    isolateFailures: true
  });
  const recovered = await scheduler.refresh([
    atom('Fact', 'after'), structuredClone(program)
  ], { isolateFailures: true, force: true });

  assert.equal(failed.failures[0].code, 'ATOM_PROGRAM_TIMEOUT');
  assert.equal(executions, 2);
  assert.deepEqual(recovered.failures, []);
});

test('an isolated context-free startup failure stays dormant while Agent context is completed', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      if (program.path !== 'Agent') executions += 1;
      if (program.path !== 'Broken Program') {
        return { locks: [], messages: [], transforms: [] };
      }
      throw Object.assign(new Error('unrelated persistent failure'), {
        code: 'ATOM_PROGRAM_FAILED'
      });
    }
  });
  const world = [
    atom('Agent', '', [], 'agent'),
    atom('Broken Program', '# fails without reading the Agent', [], 'program')
  ];

  const startup = await scheduler.refresh(world, { isolateFailures: true });
  const changedWorld = [
    ...structuredClone(world),
    atom('Unrelated New Program', '# added elsewhere', [], 'program')
  ];
  const agentProjection = await scheduler.refresh(changedWorld, {
    isolateFailures: true,
    agentOrigin: { ref: 'agent-ref', path: 'Agent' }
  });

  assert.equal(startup.failures.length, 1);
  assert.equal(executions, 2);
  assert.deepEqual(agentProjection.failures, []);
  assert.equal(agentProjection.cached, false);
});

test('a cold Agent Transform does not replay or report an unrelated startup failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-cold-agent-transform-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [
      atom('Target', 'before'),
      atom('Broken Program', "raise ValueError('unrelated persistent failure')", [], 'program')
    ], 'agent')
  ], null, 2));
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      if (program.path === 'Agent') {
        return { locks: [], messages: [], transforms: [] };
      }
      executions += 1;
      throw Object.assign(new Error('unrelated persistent failure'), {
        code: 'ATOM_PROGRAM_FAILED'
      });
    }
  });

  const startup = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'project', interaction: { id: 'startup', agent: null }
  });
  const preparation = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'reconcile',
    interaction: { id: 'agent-preparation', agent: { ref: 'agent-ref', path: 'Agent' } }
  });
  const transformed = await executeAtomLanguage({
    source: 'transform {"thing":"Agent/Target","situation.rep.after"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    commitWorld: async () => {},
    interaction: { id: 'agent-transform', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(startup.ok, true, JSON.stringify(startup.errors));
  assert.equal(preparation.ok, true, JSON.stringify(preparation.errors));
  assert.equal(preparation.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
  )), false, JSON.stringify(preparation.warnings));
  assert.equal(transformed.ok, true, JSON.stringify(transformed.errors));
  assert.equal(transformed.changed, true, JSON.stringify(transformed));
  assert.equal(executions, 1);
  assert.equal(transformed.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
  )), false, JSON.stringify(transformed.warnings));
});

test('concurrent invalidated refreshes share the complete dependency-check and worker pipeline', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ executeExplore }) => {
      executions += 1;
        await executeExplore({ thing: 'Fact' });
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const program = atom('Program', '# dependent', [], 'program');
  const executeBefore = async () => [{ path: 'Fact' }];
  await scheduler.refresh([atom('Fact', 'before'), program], { executeExplore: executeBefore });

  const changed = [atom('Fact', 'after'), structuredClone(program)];
  const executeAfter = async () => [{ path: 'Fact' }];
  await Promise.all([
    scheduler.refresh(changed, { executeExplore: executeAfter }),
    scheduler.refresh(structuredClone(changed), { executeExplore: executeAfter })
  ]);

  assert.equal(executions, 2);
});

test('Program structural facts invalidate reusable effects even without explore calls', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const program = atom('Program', '# current_atom strut', [], 'program');
  program.strut = [];
  await scheduler.refresh([atom('Target'), program]);

  const changed = structuredClone(program);
  changed.strut = [{ 'if@current': true, then: [{ thing: 'Target' }] }];
  await scheduler.refresh([atom('Target'), changed]);

  assert.equal(executions, 2);
});

test('changing one referenced Program invalidates callers that may use use_program', async () => {
  const executions = new Map();
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      executions.set(program.path, (executions.get(program.path) ?? 0) + 1);
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const caller = atom('Caller', "use_program({'name':'Library','arguments':{}})", [], 'program');
  const library = atom('Library', 'def main(arguments):\n    return 1', [], 'program');
  await scheduler.refresh([caller, library]);

  const changedLibrary = atom('Library', 'def main(arguments):\n    return 2', [], 'program');
  await scheduler.refresh([structuredClone(caller), changedLibrary]);

  assert.equal(executions.get('Caller'), 2);
  assert.equal(executions.get('Library'), 2);
});

test('a corrupt replaceable projection is ignored and rebuilt with a warning', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      async load() {
        throw Object.assign(new Error('invalid projection JSON'), {
          code: 'INVALID_PROGRAM_PROJECTION'
        });
      },
      async save() {}
    },
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const cycle = await scheduler.refresh([atom('Program', '# rebuild', [], 'program')]);

  assert.equal(executions, 1);
  assert.equal(cycle.runtimeWarnings[0].code, 'PROGRAM_PROJECTION_LOAD_FAILED');
});

test('a context-free projection excludes Programs that resolve the current Agent implicitly', async () => {
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ executeExplore }) => {
      await executeExplore({});
      return {
        locks: [{ targets: { refs: ['agent-ref'] }, mode: 'write', fields: [] }],
        messages: [{ level: 'info', text: 'agent-only' }],
        transforms: [{ name: 'Agent', detail: 'agent-only' }]
      };
    }
  });
  const world = [atom('Agent', '', [], 'agent'), atom('Program', '# contextual', [], 'program')];

  const global = await scheduler.refresh(world, {
    executeExplore: async () => [{ path: 'Agent' }]
  });

  assert.deepEqual(global.locks, []);
  assert.deepEqual(global.messages, []);
  assert.deepEqual(global.transforms, []);
});
