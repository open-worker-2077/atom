import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createLegacyRuntimeComposition,
  createLegacyHumanStatusTranslator,
  createLegacyHumanWorkspaceTranslator
} from '../src/atom-system/adapters/legacy-runtime-composition.mjs';
import { createRuntimeCliExecutor } from '../src/atom-system/adapters/runtime-cli-executor.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import {
  advanceCompatibilityManifest,
  createCompatibilityManifest
} from '../src/atom-system/world-runtime/legacy-graph-compat.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { rewriteProgramSourcePathLiterals } from '../work-engine/atom-language/transform-executor.mjs';
import {
  createProgramRuntimeScheduler,
  resolveExactPathFromCurrentContext,
  validateProgramResult
} from '../work-engine/atom-language/program-runtime.mjs';
import { authorizeWindowGraphPath } from '../work-engine/atom-language/window-lock-v1.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

test('Program relocation rewrites an exact ancestor-qualified suffix but leaves prose intact', () => {
  const source = [
    '# Area/LockedSuffix is prose.',
    'lock({"targets":{"paths":["Area/Locked/Child"]}})',
    'lock({"targets":{"paths":["世界之外/World/Area/Locked/Child"]}})'
  ].join('\n');
  const rewritten = rewriteProgramSourcePathLiterals(source, [{
    sourcePath: 'World/Area/Locked',
    resultPath: 'World/Destination/Locked'
  }]);
  assert.match(rewritten, /World\/Destination\/Locked\/Child/u);
  assert.match(rewritten, /世界之外\/World\/Destination\/Locked\/Child/u);
  assert.match(rewritten, /Area\/LockedSuffix/u);
});

async function waitUntil(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function findAtom(atoms, expectedPath, parentPath = []) {
  for (const current of atoms) {
    const thing = Object.entries(current).find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1];
    const currentPath = [...parentPath, thing];
    if (currentPath.join('/') === expectedPath) return current;
    const nested = findAtom(current.contain ?? [], expectedPath, currentPath);
    if (nested) return nested;
  }
  return null;
}

test('maintenance CLI requests enter through the same interaction runtime contract', async () => {
  const intents = [];
  const execute = createRuntimeCliExecutor({
    interactionRuntime: { execute: async (intent) => { intents.push(intent); return { ok: true }; } },
    randomId: () => 'generated-correlation'
  });

  assert.deepEqual(await execute({
    source: 'atom',
    interaction: { agent: { path: 'Root/Maintainer' } },
    history: [{ source: 'explore {}' }]
  }), { ok: true });
  assert.deepEqual(intents, [{
    source: 'atom',
    correlationId: 'generated-correlation',
    agentPath: 'Root/Maintainer',
    history: [{ source: 'explore {}' }]
  }]);
});

test('trusted maintenance is composition-only and reaches the interaction runtime as an execution option', async () => {
  const calls = [];
  const trusted = createRuntimeCliExecutor({
    trustedMaintenance: true,
    interactionRuntime: {
      initialize: async () => ({ projectionStatus: 'published' }),
      execute: async (...args) => { calls.push(args); return { ok: true }; }
    },
    randomId: () => 'trusted-maintenance-correlation'
  });

  await trusted({ source: 'atom', history: [] });

  assert.deepEqual(calls, [[{
    source: 'atom', correlationId: 'trusted-maintenance-correlation', history: []
  }, { trustedMaintenance: true, programMode: 'project' }]]);
});

test('trusted maintenance atomically moves a Program-locked subtree while ordinary maintenance-shaped execution stays denied', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-trusted-maintenance-move-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', '', [
      atom('Locked', 'preserve', [
        atom('Child', 'preserve'),
        atom(
          'Nested Agent',
          [
            'agent({"labels":[],"functions":{"groups":[],"names":["agent","lock"]}})',
            'lock({"targets":{"paths":["Root/Locked/Child"],"scope":"exact"},"actions":["transform"],"labels":["nested"]})'
          ].join('\n'),
          [],
          'program'
        ),
        atom(
          'Reactive Program',
          [
            '# Root/LockedSuffix is prose, not a path reference.',
            'def main():',
            "    transform({'thing': 'Root/Locked/Child', 'situation.rep.fired': None})",
            "trigger('transform', {'nodes': ['Root/Locked']}, main)"
          ].join('\n'),
          [],
          'program'
        )
      ]),
      atom('Destination'),
      atom('Guard', 'lock({"targets":{"paths":["Root"],"scope":"subtree"},"actions":["transform"],"labels":["migration-key"]})', [], 'program')
    ])
  ]), 'utf8');
  const source = 'transform {"thing.mov.Root/Destination":"Root/Locked"}';

  const ordinary = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  const denied = await ordinary({ source, interaction: { id: 'ordinary-maintenance-shaped' } });
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => ['GRAPH_LOCK_DENIED', 'WINDOW_ACCESS_DENIED'].includes(error.code)), JSON.stringify(denied));
  assert.ok(findAtom(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Root/Locked'));

  const trusted = createRuntimeCliExecutor({
    contextFile, graphFile, storeFile, trustedMaintenance: true
  });
  const moved = await trusted({ source, interaction: { id: 'approved-maintenance-move' } });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, 'Root/Locked'), null);
  assert.equal(findAtom(world, 'Root/Destination/Locked').situation, 'preserve');
  assert.equal(findAtom(world, 'Root/Destination/Locked/Child').situation, 'preserve');
  assert.match(
    findAtom(world, 'Root/Destination/Locked/Reactive Program').situation,
    /Root\/Destination\/Locked\/Child/u
  );
  assert.match(
    findAtom(world, 'Root/Destination/Locked/Reactive Program').situation,
    /Root\/LockedSuffix/u
  );
  assert.equal(
    findAtom(world, 'Root/Destination/Locked/Nested Agent').situation,
    [
      'agent({"labels":[],"functions":{"groups":[],"names":["agent","lock"]}})',
      'lock({"targets":{"paths":["Root/Destination/Locked/Child"],"scope":"exact"},"actions":["transform"],"labels":["nested"]})'
    ].join('\n')
  );
  const rebuilt = createProgramRuntimeScheduler();
  await rebuilt.rebuildAgentSecurity(world);
  assert.equal(rebuilt.agentSecurity.has('Root/Locked/Nested Agent'), false);
  assert.equal(rebuilt.agentSecurity.has('Root/Destination/Locked/Nested Agent'), true);

  const reconfigured = await trusted({
    source: `transform {"thing":"Root/Destination/Locked/Nested Agent",${JSON.stringify('situation.rep.agent({"labels":["expanded"],"functions":{"groups":[],"names":["agent"]}})')}}`,
    interaction: { id: 'maintenance-must-not-bypass-agent-reconfiguration' }
  });
  assert.equal(reconfigured.ok, false, JSON.stringify(reconfigured));
  assert.ok(reconfigured.errors.some(({ code }) => (
    code === 'AGENT_RECONFIGURATION_CREATOR_REQUIRED'
  )), JSON.stringify(reconfigured));
});

test('an upper Agent window moves a descendant subtree while a lower Agent window cannot move upward', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-ordinary-agent-subtree-move-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Root', 'agent({"labels":[],"functions":{"groups":[],"names":["agent","lock","transform"]}})', [
      atom('Locked', 'preserve', [
        atom('Child', 'preserve'),
        atom(
          'Nested Agent',
          'agent({"labels":[],"functions":{"groups":[],"names":["agent","transform"]}})',
          [],
          'program'
        ),
        atom(
          'Reactive Program',
          [
            'def main():',
            "    transform({'thing': 'Root/Locked/Child', 'situation.rep.fired': None})",
            "trigger('transform', {'nodes': ['Root/Locked']}, main)"
          ].join('\n'),
          [],
          'program'
        )
      ]),
      atom('Destination'),
      {
        ...atom('External Source'),
        support: [{ 'if@current': true, then: [{ thing: 'Root/Locked/Child' }] }]
      },
      atom(
        'External Guard',
        'lock({"targets":{"paths":["Root/External Source"],"scope":"exact"},"actions":["transform"],"labels":["external"]})',
        [],
        'program'
      )
    ], 'program')
  ]), 'utf8');

  const execute = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  const lowerDenied = await execute({
    source: 'transform {"thing.mov.Root/Destination":"Root/Locked"}',
    interaction: {
      id: 'lower-agent-cannot-move-its-parent',
      agent: { path: 'Root/Locked/Nested Agent' }
    }
  });
  assert.equal(lowerDenied.ok, false, JSON.stringify(lowerDenied));
  assert.ok(lowerDenied.errors.some(({ code }) => code === 'WINDOW_ACCESS_DENIED'));
  assert.ok(findAtom(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Root/Locked'));

  const moved = await execute({
    source: 'transform {"thing.mov.Root/Destination":"Root/Locked"}',
    interaction: {
      id: 'upper-agent-moves-descendant-subtree',
      agent: { path: 'Root' }
    }
  });

  assert.equal(moved.ok, true, JSON.stringify(moved));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, 'Root/Locked'), null);
  assert.equal(findAtom(world, 'Root/Destination/Locked/Child').situation, 'preserve');
  assert.deepEqual(
    findAtom(world, 'Root/External Source').support,
    [{ 'if@current': true, then: [{ thing: 'Root/Destination/Locked/Child' }] }]
  );
  assert.match(
    findAtom(world, 'Root/Destination/Locked/Reactive Program').situation,
    /Root\/Destination\/Locked\/Child/u
  );
  const rebuilt = createProgramRuntimeScheduler();
  await rebuilt.rebuildAgentSecurity(world);
  assert.equal(rebuilt.agentSecurity.has('Root/Locked/Nested Agent'), false);
  assert.equal(rebuilt.agentSecurity.has('Root/Destination/Locked/Nested Agent'), true);
});

test('maintenance CLI refuses an intent before world dispatch when projection preparation fails', async () => {
  let dispatched = false;
  const execute = createRuntimeCliExecutor({
    interactionRuntime: {
      async initialize() {
        throw Object.assign(new Error('projection unavailable'), {
          code: 'RUNTIME_INITIALIZATION_FAILED'
        });
      },
      async execute() {
        dispatched = true;
        return { ok: true };
      }
    }
  });

  await assert.rejects(execute({
    source: 'transform new {"thing":"Must Not Commit","situation":"","contain":[],"support":[]}',
    interaction: { id: 'maintenance-projection-failure' }
  }), (error) => error.code === 'RUNTIME_INITIALIZATION_FAILED');
  assert.equal(dispatched, false);
});

test('maintenance CLI refuses an intent while prepared projection publication is pending', async () => {
  let dispatched = false;
  const execute = createRuntimeCliExecutor({
    interactionRuntime: {
      async initialize() {
        return {
          projectionStatus: 'pending',
          projectionFailure: { projection: 'graph', cause: 'EPERM' }
        };
      },
      async execute() {
        dispatched = true;
        return { ok: true };
      }
    }
  });

  await assert.rejects(execute({
    source: 'transform new {"thing":"Must Not Commit","situation":"","contain":[],"support":[]}',
    interaction: { id: 'maintenance-projection-pending' }
  }), (error) => error.code === 'RUNTIME_INITIALIZATION_FAILED');
  assert.equal(dispatched, false);
});

test('maintenance CLI reloads the persisted context-free Program projection for an agentless read', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-maintenance-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('test', '', [atom('Bootstrap')])]), 'utf8');

  const projectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  const primingScheduler = createProgramRuntimeScheduler({ projectionRepository });
  const primed = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile: graphFile,
    programMode: 'project', interaction: { id: 'prime', agent: null },
    programScheduler: primingScheduler
  });
  assert.equal(primed.ok, true, JSON.stringify(primed.errors));

  const execute = createRuntimeCliExecutor({
    contextFile,
    graphFile,
    storeFile
  });
  const result = await execute({
    source: 'explore {"thing":"test","contain$latitude-1":true}',
    interaction: { id: 'maintenance-read' }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.items[0].matches[0].path, 'test');
});

test('cold startup replaces a stale Program base before publishing and a restarted scheduler consumes it', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-cold-program-base-settle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  const world = [atom('Root', '', [
    atom('Target', 'classified'),
    atom('Read Lock', 'lock({"targets":{"paths":["Root/Target"],"scope":"exact"},"actions":["explore"],"labels":["audit"]})', [], 'program')
  ])];
  await fs.writeFile(contextFile, JSON.stringify(world), 'utf8');
  const repository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  await repository.save({
    version: 1,
    readSetVersion: 1,
    worldKey: 'old-world-key',
    programSetKey: 'old-program-set',
    contextDependent: false,
    contextIncomplete: false,
    scopePath: null,
    locks: [],
    choices: [],
    exploreReadPaths: [],
    failures: []
  });
  const scheduler = createProgramRuntimeScheduler({ projectionRepository: repository });
  const runtime = createLegacyRuntimeComposition({
    contextFile, graphFile, storeFile, programScheduler: scheduler
  });

  const initialized = await runtime.initialize({ correlationId: 'cold-current-base' });
  assert.equal(initialized.projectionStatus, 'published');
  const currentWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  await scheduler.assertContextFreeProjection(currentWorld);
  const stored = await repository.load();
  assert.notEqual(stored.worldKey, 'old-world-key');
  assert.notEqual(stored.programSetKey, 'old-program-set');
  assert.equal(stored.contextDependent, false);
  assert.deepEqual(stored.failures, []);

  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });
  const restored = await restarted.refresh(currentWorld, {
    isolateFailures: true,
    passive: true,
    agentOrigin: null
  });
  assert.equal(restored.cached, true);
  assert.equal(restored.locks.length, 1);
});

test('a literal path lock accepts the documented 世界之外 virtual root for an exact top-level target', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const world = [atom('test', '', [
    atom('Target', 'synthetic'),
    atom('Read Lock', 'lock({"targets":{"paths":["世界之外/test/Target"],"scope":"exact"},"actions":["explore"],"labels":["audit"]})', [], 'program')
  ])];

  await assert.doesNotReject(scheduler.validateProgramSources(world));
});

test('a ^ Agent can compile a ^ path lock for its nested Program result through the 世界之外 selector', async () => {
  const scheduler = createProgramRuntimeScheduler();
  const targetPath = '世界之外/test/🧊/POS-01/确定性核验/核验结果';
  const world = [atom('test', '', [
    atom('🧊', 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","lock","transform"]}})', [
      atom('POS-01', '', [
        atom('确定性核验', 'message({"level":"info","text":"synthetic"})', [atom('核验结果', 'synthetic')], 'program'),
        atom('结果锁定', `lock({"targets":{"paths":["${targetPath}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`, [], 'program')
      ])
    ], 'program')
  ])];

  await assert.doesNotReject(scheduler.validateProgramSources(world));
});

test('a dynamically created readable descendant resolves through live exact context when the program record index has not observed it, then enforces its ^ lock', () => {
  const target = 'test/🧊/核验程序/动态结果';
  const lockSource = 'test/🧊/结果锁定';
  const liveAtoms = [atom('test', '', [atom('🧊', '', [
    atom('核验程序', '', [atom('动态结果', 'persisted-after-program')], 'program')
  ], 'program')])];
  const compiled = validateProgramResult({
    ok: true,
    locks: [{
      targets: { paths: ['世界之外/test/🧊/核验程序/动态结果'], scope: 'exact' },
      actions: ['transform'],
      labels: ['^']
    }]
  }, [{ ref: 'lock-ref', path: lockSource, types: ['program'] }], {
    path: lockSource,
    ref: 'lock-ref'
  }, {
    resolveExactPath: (selector) => resolveExactPathFromCurrentContext(liveAtoms, selector)
  });

  assert.equal(compiled.locks[0].path, target);
  assert.equal(authorizeWindowGraphPath({
    agentPath: 'test/🧊', targetPath: target, operation: 'transform', labels: ['^'], locks: compiled.locks
  }).decision, 'allow');
});

test('cold startup publishes from computed permissions when the disposable index cannot persist', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-cold-program-base-failure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Target'),
    atom('Read Lock', 'lock({"targets":{"paths":["Root/Target"],"scope":"exact"},"actions":["explore"],"labels":["audit"]})', [], 'program')
  ])]), 'utf8');
  const storedRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  await storedRepository.save({
    version: 1,
    readSetVersion: 1,
    worldKey: 'old-world-key',
    programSetKey: 'old-program-set',
    contextDependent: false,
    contextIncomplete: false,
    scopePath: null,
    locks: [],
    choices: [],
    exploreReadPaths: [],
    failures: []
  });
  const projectionRepository = {
    load: () => storedRepository.load(),
    save: async () => {
      throw Object.assign(new Error('synthetic projection persistence failure'), {
        code: 'SYNTHETIC_PROGRAM_PROJECTION_WRITE_FAILED'
      });
    }
  };
  let graphPublications = 0;
  let spatialPublications = 0;
  const runtime = createLegacyRuntimeComposition({
    contextFile,
    graphFile,
    storeFile,
    programScheduler: createProgramRuntimeScheduler({ projectionRepository }),
    graphPublisher: { publish: async () => { graphPublications += 1; } },
    spatialPublisher: { publish: async () => { spatialPublications += 1; } }
  });

  const initialized = await runtime.initialize({ correlationId: 'cold-base-persist-failure' });
  assert.equal(initialized.projectionStatus, 'published');
  assert.equal(graphPublications, 1);
  assert.equal(spatialPublications, 1);
  assert.ok(initialized.initialization.warnings.some((warning) => (
    warning.code === 'PROGRAM_PROJECTION_PERSIST_FAILED'
  )), JSON.stringify(initialized));
  const stored = await storedRepository.load();
  assert.equal(stored.worldKey, 'old-world-key');
  assert.equal(stored.programSetKey, 'old-program-set');
});

test('a declared creator adds a child Agent Program and prepares the server projection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-maintenance-first-window-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const existingAgentSource = 'agent({"labels":[],"functions":{"groups":[],"names":["agent","explore","transform"]}})';
  const bootstrapSource = 'agent({"functions":{"groups":[],"names":["agent"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Existing', existingAgentSource, [atom('Work', '', [atom('Parent')])], 'program')
  ])]), 'utf8');

  const serverScheduler = createProgramRuntimeScheduler();
  const server = createLegacyRuntimeComposition({
    contextFile, graphFile, storeFile, programScheduler: serverScheduler
  });
  await server.initialize({ correlationId: 'server-startup' });
  const serverRead = await server.execute({
    source: 'explore {"thing":"Root/Existing","situation$full":true}',
    correlationId: 'server-self-read', agentPath: 'Root/Existing'
  });
  assert.equal(serverRead.ok, true, JSON.stringify(serverRead.errors));

  const journal = createJsonTransactionJournal({ file: journalFile });
  const receiptsBefore = (await journal.readState()).receipts.length;
  const created = await server.execute({
    source: `transform new {"thing@program":"Root/Existing/Work/Parent/Bootstrap","situation":${JSON.stringify(bootstrapSource)},"contain":[],"support":[]}`,
    correlationId: 'creator-adds-bootstrap',
    agentPath: 'Root/Existing'
  });

  assert.equal(created.ok, true, JSON.stringify(created.errors));
  const prepared = await server.execute({
    source: 'explore {"thing":"Root/Existing/Work/Parent/Bootstrap","situation$full":true}',
    correlationId: 'creator-read-bootstrap',
    agentPath: 'Root/Existing'
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  assert.equal(prepared.items[0].matches[0].path, 'Root/Existing/Work/Parent/Bootstrap');
  const receiptsAfterCreate = (await createJsonTransactionJournal({ file: journalFile }).readState()).receipts.length;
  assert.equal(receiptsAfterCreate, receiptsBefore + 1);
  let world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, 'Root/Existing/Work/Parent/Bootstrap') !== null, true);

  const registered = await server.execute({
    source: 'transform {"thing.run.":"Root/Existing/Work/Parent/Bootstrap"}',
    correlationId: 'creator-runs-bootstrap',
    agentPath: 'Root/Existing'
  });
  assert.equal(registered.ok, true, JSON.stringify(registered.errors));
  world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(Object.hasOwn(findAtom(world, 'Root/Existing/Work/Parent/Bootstrap'), 'thing@program'), true);

  const coldScheduler = createProgramRuntimeScheduler();
  await coldScheduler.rebuildAgentSecurity(world);
  assert.deepEqual(coldScheduler.agentSecurity.get('Root/Existing/Work/Parent/Bootstrap'), {
    labels: [],
    functionScopes: { groups: [], names: ['agent'] },
    functions: ['agent']
  });
});

test('Agent self-reconfiguration reaches delegation validation and maintenance cannot bypass creator authority', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-maintenance-agent-reconfigure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const agentPath = 'Root/Parent/Window';
  const originalSource = 'agent({"functions":{"groups":[],"names":["agent"]}})';
  const replacementSource = 'agent({"labels":[],"functions":{"groups":[],"names":["agent","explore","slot_body","transform","use_program"]}})';
  const replace = `transform {"thing":${JSON.stringify(agentPath)},${JSON.stringify(`situation.rep.${replacementSource}`)}}`;
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Parent', '', [atom('Window', originalSource, [], 'program')])
  ])]), 'utf8');

  const server = createLegacyRuntimeComposition({ contextFile, graphFile, storeFile });
  await server.initialize({ correlationId: 'server-startup' });
  const selfChange = await server.execute({
    source: replace,
    correlationId: 'agent-self-reconfigure',
    agentPath
  });
  assert.equal(selfChange.ok, false, JSON.stringify(selfChange));
  assert.ok(selfChange.errors.some((error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED'), JSON.stringify(selfChange));
  let world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, agentPath).situation, originalSource);

  const journal = createJsonTransactionJournal({ file: journalFile });
  const receiptsBefore = (await journal.readState()).receipts.length;
  const maintenance = createRuntimeCliExecutor({ contextFile, graphFile, storeFile });
  const reconfigured = await maintenance({
    source: replace,
    interaction: { id: 'trusted-maintenance-agent-reconfigure' }
  });
  assert.equal(reconfigured.ok, false, JSON.stringify(reconfigured));
  assert.ok(reconfigured.errors.some((error) => (
    error.code === 'AGENT_RECONFIGURATION_CREATOR_REQUIRED'
  )), JSON.stringify(reconfigured));
  const receiptsAfter = (await createJsonTransactionJournal({ file: journalFile }).readState()).receipts.length;
  assert.equal(receiptsAfter, receiptsBefore);
  world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, agentPath).situation, originalSource);
});

test('an ancestor Agent Program governs descendant reconfiguration without a maintenance bootstrap bypass', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-ancestor-agent-management-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const managerPath = 'Root/Domain/Manager';
  const siblingPath = 'Root/Domain/Worker';
  const managedPath = `${managerPath}/Worker`;
  const managerSource = 'agent({"labels":[],"functions":{"groups":[],"names":["agent","explore","slot_body","transform","use_program"]}})';
  const workerSource = 'agent({"labels":[],"functions":{"groups":[],"names":["agent"]}})';
  const replacementSource = 'agent({"labels":[],"functions":{"groups":[],"names":["agent","explore","slot_body","transform","use_program"]}})';
  const overreachSource = 'agent({"labels":[],"functions":{"groups":[],"names":["agent","explore","message","slot_body","transform","use_program"]}})';
  const replacement = (target) => (
    `transform {"thing":${JSON.stringify(target)},${JSON.stringify(`situation.rep.${replacementSource}`)}}`
  );
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Domain', '', [
      atom('Worker', workerSource, [], 'program'),
      atom('Manager', managerSource, [
        atom('Worker', workerSource, [], 'program')
      ], 'program'),
      atom('Outside', 'unchanged')
    ])
  ])]), 'utf8');

  const worker = createLegacyRuntimeComposition({ contextFile, graphFile, storeFile });
  await worker.initialize({ correlationId: 'before-bootstrap-startup' });
  const selfDeniedBeforeBootstrap = await worker.execute({
    source: replacement(siblingPath),
    correlationId: 'orphan-cannot-expand-itself',
    agentPath: siblingPath
  });
  assert.equal(selfDeniedBeforeBootstrap.ok, false, JSON.stringify(selfDeniedBeforeBootstrap));
  assert.ok(selfDeniedBeforeBootstrap.errors.some((error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED'), JSON.stringify(selfDeniedBeforeBootstrap));

  let world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(Object.hasOwn(findAtom(world, managerPath), 'thing@program'), true);

  const daily = createLegacyRuntimeComposition({
    contextFile,
    graphFile,
    storeFile,
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath })
  });
  await daily.initialize({ correlationId: 'daily-management-startup' });
  const overreach = await daily.execute({
    source: `transform {"thing":${JSON.stringify(managedPath)},${JSON.stringify(`situation.rep.${overreachSource}`)}}`,
    correlationId: 'ancestor-cannot-overgrant-child',
    agentPath: managerPath
  });
  assert.equal(overreach.ok, false, JSON.stringify(overreach));
  assert.ok(overreach.errors.some((error) => error.code === 'PROGRAM_FUNCTION_DELEGATION_DENIED'), JSON.stringify(overreach));
  world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, managedPath).situation, workerSource);

  const reconfigured = await daily.execute({
    source: replacement(managedPath),
    correlationId: 'ancestor-reconfigures-child',
    agentPath: managerPath
  });
  assert.equal(reconfigured.ok, true, JSON.stringify(reconfigured));
  world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, managedPath).situation, replacementSource);

  const selfReconfigured = await daily.execute({
    source: replacement(managerPath),
    correlationId: 'manager-reconfigures-self-within-authority',
    agentPath: managerPath
  });
  assert.equal(selfReconfigured.ok, true, JSON.stringify(selfReconfigured));
  const outsideDenied = await daily.execute({
    source: 'transform {"thing":"Root/Domain/Outside","situation.rep.changed"}',
    correlationId: 'manager-cannot-write-outside',
    agentPath: managerPath
  });
  assert.equal(outsideDenied.ok, false, JSON.stringify(outsideDenied));
  assert.ok(outsideDenied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'), JSON.stringify(outsideDenied));
  world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, 'Root/Domain/Outside').situation, 'unchanged');

  const coldScheduler = createProgramRuntimeScheduler();
  await coldScheduler.rebuildAgentSecurity(world);
  assert.deepEqual(coldScheduler.agentSecurity.get(managedPath), {
    labels: [],
    functionScopes: {
      groups: [],
      names: ['agent', 'explore', 'slot_body', 'transform', 'use_program']
    },
    functions: ['agent', 'explore', 'slot_body', 'transform', 'use_program']
  });
});

test('legacy composition binds world, Program, projection and spatial publication behind one runtime', async () => {
  const calls = [];
  const programScheduler = { id: 'scheduler' };
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler,
    projectionDelayMs: 0,
    worldService: {
      executeLegacy: async (request) => {
        calls.push(['world', { ...request, programScheduler: request.programScheduler?.id }]);
        return { ok: true, revisionAfter: 'rev-2', lockState: { active: true } };
      }
    },
    projectionOrchestrator: {
      projectCurrent: async (request) => {
        calls.push(['project', request]);
        return { sourceRevision: request.expectedRevision, graph: {}, spatial: { nodes: [] } };
      }
    },
    spatialPublisher: {
      publish: async (knowledge) => calls.push(['spatial', knowledge])
    },
    graphPublisher: {
      publish: async (graph) => calls.push(['graph', graph])
    },
    feedbackRecorder: async (request) => ({ ok: true, request }),
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath }),
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({
    source: 'transform {}',
    correlationId: 'interaction-1',
    agentPath: 'Root/Sol'
  });

  assert.equal(result.projectionStatus, 'pending');
  await waitUntil(
    () => runtime.projectionStatus().status === 'published',
    'scheduled projection was not published'
  );

  assert.deepEqual(calls, [
    ['world', {
      source: 'transform {}',
      interaction: { id: 'interaction-1', agent: { ref: 'resolved', path: 'Root/Sol' } },
      history: [],
      contextFile: 'atom.json',
      projectionFile: 'graph.json',
      programScheduler: 'scheduler'
    }],
    ['project', { expectedRevision: 'rev-2', lockState: { active: true } }],
    ['graph', {}],
    ['spatial', { nodes: [] }]
  ]);
});

test('default projection consumes the current compatibility manifest after a local commit and recover', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-current-manifest-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const source = [{
    thing: 'Root',
    situation: 'source',
    contain: [],
    support: [{ verb: 'legacy relation', object: 'Target' }]
  }];
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');

  const persistence = createTransactionalWorldPersistence({
    contextFile,
    projectionFile: graphFile,
    publishLegacyProjection: false
  });
  const sourceManifest = createCompatibilityManifest({
    sourceRevision: 'sha256:legacy-source',
    targetFacts: source
  });
  let currentFacts = structuredClone(source);
  currentFacts[0].situation = 'first commit';
  await persistence.commit({
    correlationId: 'first-local-commit',
    expectedRevision: revisionOfWorldFacts(source),
    nextRevision: revisionOfWorldFacts(currentFacts),
    facts: currentFacts,
    compatibilityManifest: advanceCompatibilityManifest(sourceManifest, source, currentFacts)
  });

  const worldService = {
    compatibilityManifest: () => persistence.compatibilityManifest(),
    async executeLegacy(request) {
      if (request.source === 'atom') {
        return {
          ok: true,
          changed: false,
          revisionAfter: revisionOfWorldFacts(currentFacts),
          lockState: {}
        };
      }
      const before = currentFacts;
      const next = structuredClone(before);
      next[0].situation = 'second commit';
      const receipt = await persistence.commit({
        correlationId: request.interaction.id,
        expectedRevision: revisionOfWorldFacts(before),
        nextRevision: revisionOfWorldFacts(next),
        facts: next
      });
      currentFacts = next;
      return {
        ok: true,
        changed: true,
        revisionAfter: receipt.afterRevision,
        lockState: {},
        affectedPaths: ['Root']
      };
    }
  };
  const runtime = createLegacyRuntimeComposition({
    contextFile,
    graphFile,
    worldService,
    projectionDelayMs: 0,
    graphPublisher: { publish: async () => {} },
    spatialPublisher: { publish: async () => {} },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async () => null,
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const initialized = await runtime.initialize({ correlationId: 'current-manifest-startup' });
  assert.equal(initialized.projectionStatus, 'published');
  const committed = await runtime.execute({
    source: 'transform {}', correlationId: 'second-local-commit', history: []
  });
  const expectedRevision = revisionOfWorldFacts(currentFacts);
  assert.equal(committed.revisionAfter, expectedRevision);
  const recovered = await runtime.recover({ expectedRevision });
  assert.equal(recovered.sourceRevision, expectedRevision);
  assert.deepEqual(runtime.projectionStatus(), { status: 'published', expectedRevision });
  assert.equal((await persistence.compatibilityManifest()).currentWorldRevision, expectedRevision);
  await runtime.close();
});

test('legacy composition primes and revision-binds Agent resolution without caching a denied Agent', async () => {
  let manifestCalls = 0;
  let resolverCalls = 0;
  let revision = 'revision-1';
  const scheduler = { agentSecurityWorldRevision: 'security-1' };
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json', graphFile: 'graph.json', storeFile: 'knowledge.json',
    programScheduler: scheduler,
    worldService: {
      async executeLegacy(request) {
        if (request.source === 'transform {"change":true}') revision = 'revision-2';
        return { ok: true, changed: request.source === 'transform {"change":true}', revisionAfter: revision };
      },
      async compatibilityManifest() {
        manifestCalls += 1;
        return { contract: 'test-manifest', currentWorldRevision: revision };
      }
    },
    projectionOrchestrator: { projectCurrent: async () => ({ sourceRevision: revision, graph: {}, spatial: {} }) },
    graphPublisher: { publish: async () => {} }, spatialPublisher: { publish: async () => {} },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async (_file, agentPath, options) => {
      resolverCalls += 1;
      if (agentPath === 'Root/Missing') throw Object.assign(new Error('missing'), { code: 'AGENT_NOT_FOUND' });
      return { ref: `${options.worldRevision}:${agentPath}`, path: agentPath };
    },
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  await runtime.initialize({ correlationId: 'prime-agent-resolution' });
  await runtime.execute({ source: 'transform {}', correlationId: 'same-1', agentPath: 'Root/Agent', history: [] });
  await runtime.execute({ source: 'transform {}', correlationId: 'same-2', agentPath: 'Root/Agent', history: [] });
  assert.equal(manifestCalls, 1, 'startup proof must be reused for the unchanged world');
  assert.equal(resolverCalls, 1, 'same Agent resolution must be O(1) after priming');

  await runtime.execute({ source: 'transform {"change":true}', correlationId: 'changed', agentPath: 'Root/Agent', history: [] });
  await runtime.execute({ source: 'transform {}', correlationId: 'changed-2', agentPath: 'Root/Agent', history: [] });
  assert.equal(resolverCalls, 2, 'a world revision change must force a fresh resolution');

  scheduler.agentSecurityWorldRevision = 'security-2';
  await runtime.execute({ source: 'transform {}', correlationId: 'security-changed', agentPath: 'Root/Agent', history: [] });
  assert.equal(resolverCalls, 3, 'an Agent-security revision change must force a fresh resolution');
  await assert.rejects(
    runtime.execute({ source: 'transform {}', correlationId: 'missing-agent', agentPath: 'Root/Missing', history: [] }),
    (error) => error.code === 'AGENT_NOT_FOUND'
  );
});

test('legacy composition identifies the disposable projection stage without exposing a file path', async () => {
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    projectionDelayMs: 0,
    worldService: {
      executeLegacy: async () => ({ ok: true, revisionAfter: 'rev-2', lockState: {} })
    },
    projectionOrchestrator: {
      projectCurrent: async () => ({ sourceRevision: 'rev-2', graph: {}, spatial: { nodes: [] } })
    },
    graphPublisher: {
      publish: async () => {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
    },
    spatialPublisher: { publish: async () => assert.fail('must stop at the failed Graph cache') },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async () => null,
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({ source: 'transform {}', correlationId: 'projection-stage' });

  assert.equal(result.ok, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.deepEqual(result.projectionFailure, {
    projection: 'publisher', cause: 'PROJECTION_PUBLICATION_SCHEDULED'
  });
  await waitUntil(
    () => runtime.projectionStatus().failure?.cause === 'EPERM',
    'scheduled projection failure was not recorded'
  );
  assert.deepEqual(runtime.projectionStatus().failure, { projection: 'graph', cause: 'EPERM' });
  assert.equal(JSON.stringify(result).includes('graph.json'), false);
});

test('legacy composition forwards a content-free closed interaction timing ledger', async () => {
  const stages = [];
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    onStage: (stage) => stages.push(stage),
    worldService: {
      executeLegacy: async () => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return { ok: true, changed: false, revisionAfter: 'rev-1' };
      }
    },
    projectionOrchestrator: { projectCurrent: async () => ({ sourceRevision: 'rev-1', graph: {}, spatial: {} }) },
    graphPublisher: { publish: async () => {} }, spatialPublisher: { publish: async () => {} },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async () => {
      await new Promise((resolve) => setTimeout(resolve, 8));
      return { ref: 'agent-ref', path: 'Root/Agent' };
    },
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const startedAt = performance.now();
  await runtime.execute({ source: 'transform {}', correlationId: 'closed-ledger', agentPath: 'Root/Agent', history: [] });
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(stages.map(({ stage }) => stage), [
    'agents.resolve', 'interactionOf', 'world.execute', 'result.serialize'
  ]);
  assert.equal(stages.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0), true);
  assert.ok(Math.abs(stages.filter(({ stage }) => stage !== 'agents.resolve')
    .reduce((total, { durationMs }) => total + durationMs, 0) - elapsedMs) < 15);
  assert.equal(stages.every((stage) => JSON.stringify(stage).includes('atom.json') === false), true);
});

test('legacy composition routes feedback through the configured recorder with world paths', async () => {
  const calls = [];
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    worldService: { executeLegacy: async () => assert.fail('feedback must not mutate world') },
    projectionOrchestrator: { projectCurrent: async () => assert.fail('feedback must not publish') },
    spatialPublisher: { publish: async () => assert.fail('feedback must not publish') },
    graphPublisher: { publish: async () => assert.fail('feedback must not publish') },
    feedbackRecorder: async (request) => {
      calls.push(request);
      return { ok: true, submission: { id: 'feedback-1' } };
    },
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath }),
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({
    source: 'submit {"type":"bug","detail":"broken"}',
    correlationId: 'interaction-2',
    agentPath: 'Root/Sol',
    history: []
  });

  assert.equal(result.submission.id, 'feedback-1');
  assert.equal(calls[0].contextFile, 'atom.json');
  assert.deepEqual(calls[0].interaction, {
    id: 'interaction-2',
    agent: { ref: 'resolved', path: 'Root/Sol' }
  });
});

test('human status translator accepts only projected 状态 nodes and returns one transform intent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-status-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const translator = createLegacyHumanStatusTranslator({
    graphFile,
    projectGraph: async () => ({ atomPathByKey: new Map([['node-key', 'Root/状态']]) })
  });

  assert.equal(
    await translator.translate({ key: 'node-key', detail: '进行中' }),
    'transform {"thing":"Root/状态","situation.rep.进行中"}'
  );
  assert.equal(
    await translator.translate({ key: 'stale-node-key', atomPath: 'Root/状态', detail: '已完成' }),
    'transform {"thing":"Root/状态","situation.rep.已完成"}'
  );
  await assert.rejects(
    translator.translate({ key: 'missing', detail: '进行中' }),
    (error) => error.code === 'INVALID_HUMAN_STATUS_REQUEST'
  );
});

test('human workspace translator treats the single synthetic root domain as the top-level Atom container', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-workspace-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const rootDomain = {
    id: 'synthetic-root', key: 'root::synthetic-root', path: 'root', atomPath: '',
    label: 'atom.json', hasChildren: true
  };
  let hash = 2166136261;
  for (const character of rootDomain.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const rootDomainPath = `root/${(hash >>> 0).toString(36)}`;
  const translator = createLegacyHumanWorkspaceTranslator({
    graphFile,
    projectGraph: async () => ({
      knowledge: { nodes: [rootDomain], edges: [] },
      atomPathByKey: new Map()
    })
  });

  assert.equal(
    await translator.translate({
      operation: {
        kind: 'node-create', path: rootDomainPath,
        draft: { label: 'Top-level from Web', description: 'saved' }
      }
    }),
    'transform new {"thing":"Top-level from Web","situation":"saved","contain":[],"support":[]}'
  );
});

test('human workspace translator emits one atomic Transform for a batch landing', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-batch-landing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const targetNode = { id: 'target', key: 'root::target', path: 'root', label: '目标域' };
  let hash = 2166136261;
  for (const character of targetNode.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const targetSpatialPath = `root/${(hash >>> 0).toString(36)}`;
  const translator = createLegacyHumanWorkspaceTranslator({
    graphFile,
    projectGraph: async () => ({
      knowledge: { nodes: [targetNode], edges: [] },
      atomPathByKey: new Map([
        ['root::a', '来源甲'],
        ['root::b', '来源乙'],
        [targetNode.key, '目标域']
      ])
    })
  });

  assert.equal(
    await translator.translate({
      operation: {
        kind: 'node-land-batch',
        landings: [
          { source: { key: 'root::a' }, target: { path: targetSpatialPath } },
          { source: { key: 'root::b' }, target: { path: targetSpatialPath } }
        ]
      }
    }),
    'transform [{"thing.mov.目标域":"来源甲"},{"thing.mov.目标域":"来源乙"}]'
  );
});
