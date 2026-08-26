import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  legacyAtomContextMetadata,
  projectAtomContext,
  readAtomContext,
  writeAtomContext
} from '../work-engine/atom-language/context-store.mjs';
import * as graphSchema from '../work-engine/atom-language/graph-schema.mjs';
import {
  advanceCompatibilityManifest,
  compatibilityMetadata,
  createCompatibilityManifest,
  validateCompatibilityManifest
} from '../src/atom-system/world-runtime/legacy-graph-compat.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

function legacyNode(name, detail = '', children = [], partners = [], suffix = '') {
  return { [`name${suffix}`]: name, detail, children, partners };
}

function atom(thing, situation = '', contain = [], type = '') {
  return {
    [`thing${type ? `@${type}` : ''}`]: thing,
    situation,
    contain,
    support: []
  };
}

test('legacy persisted axes load losslessly without making legacy relations into support rules', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-legacy-deploy-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const legacy = [legacyNode('Root', '正文 name/detail/children/partners', [legacyNode(
    'Legacy Program',
    "message({'level':'info','text':'must-not-run'})\nexplore({'name':'Root'})",
    [], [], '@program'
  )], [{ verb: '依赖→原文', object: 'Target/对象' }])];
  await fs.writeFile(contextFile, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

  const loaded = await readAtomContext(contextFile, { create: false });
  assert.deepEqual(loaded[0], {
    thing: 'Root',
    situation: legacy[0].detail,
    contain: [{
      'thing@program': 'Legacy Program',
      situation: legacy[0].children[0].detail,
      contain: [],
    support: []
    }],
    support: [{ verb: '依赖→原文', object: 'Target/对象' }]
  });
  const metadata = legacyAtomContextMetadata(loaded);
  assert.equal(metadata.mode, 'legacy-read-only');
  assert.equal(metadata.relations[0].verb, '依赖→原文');
  assert.deepEqual(metadata.isolatedProgramPaths, ['Root/Legacy Program']);
  assert.doesNotThrow(() => projectAtomContext(loaded));
  await assert.rejects(writeAtomContext(contextFile, loaded), {
    code: 'LEGACY_GRAPH_MIGRATION_REQUIRED'
  });
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), legacy);
});

test('compatibility manifest advances across unrelated commits without losing trusted facts', () => {
  const source = [atom('Root', '', [
    { 'thing@program': 'Legacy', situation: "explore({'name':'Root'})", contain: [], support: [] },
    { thing: 'Relations', situation: '', contain: [], support: [{ verb: '原字符→', object: 'Target' }] }
  ])];
  const audit = [{
    path: 'Root/Legacy', uses: [{ function: 'explore', axes: ['name'] }],
    disposition: 'legacy-wrapper', reason: 'revision-path-source-manifest'
  }];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:source', targetFacts: source, programAudit: audit
  });
  const next = structuredClone(source);
  next[0].contain.push(atom('Unrelated'));
  const advanced = advanceCompatibilityManifest(manifest, source, next);
  assert.doesNotThrow(() => validateCompatibilityManifest(advanced, next));
  assert.deepEqual(advanced.programs.map(({ path }) => path), ['Root/Legacy']);
  assert.equal(advanced.legacySupport.length, 1);
});

test('legacy relation provenance survives node movement but Program qualification does not transfer', () => {
  const source = [atom('Root', '', [
    { 'thing@program': 'Legacy', situation: "explore({'name':'Root'})", contain: [], support: [] },
    { thing: 'Relations', situation: '', contain: [], support: [{ verb: 'v', object: 'O' }] }
  ])];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:source', targetFacts: source,
    programAudit: [{ path: 'Root/Legacy', uses: [{ axes: ['name'] }], disposition: 'legacy-wrapper' }]
  });
  const moved = structuredClone(source);
  moved[0].contain[0]['thing@program'] = 'Moved Legacy';
  moved[0].contain[1].thing = 'Moved Relations';
  const advanced = advanceCompatibilityManifest(manifest, source, moved);
  assert.deepEqual(advanced.programs, []);
  assert.equal(advanced.legacySupport[0].occurrences, 1);
  const metadata = compatibilityMetadata(advanced, moved);
  assert.deepEqual(metadata.legacySupportPaths, ['Root/Moved Relations']);
});

test('source change, new Program and manifest revision mismatch cannot inherit legacy ABI', () => {
  const source = [{ 'thing@program': 'Legacy', situation: "explore({'name':'Root'})", contain: [], support: [] }];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:source', targetFacts: source,
    programAudit: [{ path: 'Legacy', uses: [{ axes: ['name'] }], disposition: 'legacy-wrapper' }]
  });
  const changed = structuredClone(source);
  changed[0].situation += '\npass';
  changed.push({ 'thing@program': 'Copy', situation: source[0].situation, contain: [], support: [] });
  const advanced = advanceCompatibilityManifest(manifest, source, changed);
  assert.deepEqual(advanced.programs, []);
  assert.throws(() => validateCompatibilityManifest(manifest, changed), {
    code: 'GRAPH_COMPATIBILITY_MANIFEST_REVISION_MISMATCH'
  });
});

test('central transaction advances compatibility manifest with the same authorized commit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-compat-transaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'knowledge.json');
  const source = [{ thing: 'Root', situation: '', contain: [], support: [{ verb: 'v', object: 'O' }] }];
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:legacy', targetFacts: source
  });
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile });
  const next = structuredClone(source);
  next[0].situation = 'unrelated authorized write';
  await persistence.commit({
    correlationId: 'migration', expectedRevision: revisionOfWorldFacts(source),
    nextRevision: revisionOfWorldFacts(next), facts: next,
    compatibilityManifest: advanceCompatibilityManifest(manifest, source, next)
  });
  const later = structuredClone(next);
  later[0].contain.push(atom('Child'));
  await persistence.commit({
    correlationId: 'ordinary', expectedRevision: revisionOfWorldFacts(next),
    nextRevision: revisionOfWorldFacts(later), facts: later
  });
  const currentManifest = await persistence.compatibilityManifest();
  assert.equal(currentManifest.currentWorldRevision, revisionOfWorldFacts(later));
  assert.doesNotThrow(() => validateCompatibilityManifest(currentManifest, later));
});

test('only a manifest-matched stored Program receives the legacy Graph ABI wrapper', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-legacy-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const source = [{
    thing: 'Root', situation: '', support: [], contain: [{
      'thing@program': 'Legacy',
      situation: "nodes = explore({'name':'Root'})\nmessage({'level':'info','text':nodes[0].name})",
      contain: [], support: []
    }]
  }];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:legacy', targetFacts: source,
    programAudit: [{
      path: 'Root/Legacy', uses: [{ call: 'explore', axes: ['name'] }],
      disposition: 'legacy-wrapper'
    }]
  });
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const loaded = await readAtomContext(contextFile, { create: false, compatibilityManifest: manifest });
  assert.deepEqual(legacyAtomContextMetadata(loaded).legacyProgramPaths, ['Root/Legacy']);
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 5_000 });
  const cycle = await scheduler.refresh(loaded, { isolateFailures: false });
  assert.deepEqual(cycle.messages.map(({ text }) => text), ['Root']);

  const untrustedScheduler = createProgramRuntimeScheduler({ timeoutMs: 5_000 });
  await assert.rejects(untrustedScheduler.refresh(structuredClone(source), {
    isolateFailures: false
  }), { code: 'ATOM_PROGRAM_FAILED' });
});

test('migration planner preserves partners in place as trusted directionless support entries', () => {
  const legacy = legacyNode('世界', '', [
    legacyNode('A', '', [], [
      { verb: '', object: 'B' },
      { verb: '依赖→原文', object: 'C/对象' }
    ]),
    legacyNode('B'),
    legacyNode('C')
  ]);
  const first = graphSchema.planGraphFourAxisMigration(legacy);
  const second = graphSchema.planGraphFourAxisMigration(structuredClone(legacy));
  assert.deepEqual(second.graph, first.graph);
  assert.deepEqual(first.summary.legacyRelations, [
    { source: '世界/A', ordinal: 0, verb: '', object: 'B' },
    { source: '世界/A', ordinal: 1, verb: '依赖→原文', object: 'C/对象' }
  ]);
  assert.equal(first.summary.nodes, 4);
  assert.equal(first.graph.contain.length, 3);
  assert.deepEqual(first.graph.contain[0].support, legacy.children[0].partners);
  assert.equal(JSON.stringify(first.graph).includes('if@current'), false);
});

test('one preflight collects all Program and relation clusters without first-error exit', () => {
  const program = (name, source) => legacyNode(name, source, [], [], '@program');
  const world = legacyNode('World', '', [
    legacyNode('Default Backup', '', [program('Archived', "explore({'name':'A'})")], [], '@backup@default'),
    legacyNode('test', '', [program('Fixture', "transform({'detail':'x'})")]),
    program('Active Safe', "note = 'name stays text'\nexplore({'children':[]})"),
    program('Active Unsafe', "axis='name'\nexplore({axis:'A'})\ntransform({'partners':[]})"),
    legacyNode('A', '', [], [{ verb: 'v', object: 'B' }])
  ]);
  const { graph, summary } = graphSchema.planGraphFourAxisMigration(world, {
    isolatedRoots: ['World/test']
  });
  assert.deepEqual(summary.counts, {
    nodes: 8,
    legacyPartnerNodes: 1,
    legacyPartners: 1,
    programs: 4,
    legacyAbiPrograms: 4,
    defaultBackupPrograms: 1,
    testIsolatedPrograms: 1,
    activeLegacyPrograms: 2,
    activeIsolatedPrograms: 0
  });
  assert.equal(summary.readyToCommit, true);
  assert.deepEqual(summary.programs.map(({ path, disposition, reason }) => ({
    path, disposition, reason
  })), [
    { path: 'World/Default Backup/Archived', disposition: 'isolated', reason: 'default-backup' },
    { path: 'World/test/Fixture', disposition: 'isolated', reason: 'configured-isolation-root' },
    { path: 'World/Active Safe', disposition: 'legacy-wrapper', reason: 'revision-path-source-manifest' },
    { path: 'World/Active Unsafe', disposition: 'legacy-wrapper', reason: 'revision-path-source-manifest' }
  ]);
  assert.equal(graph.contain[2].situation.includes("note = 'name stays text'"), true);
  assert.equal(graph.contain[2].situation.includes("explore({'children':[]})"), true);
  assert.equal(graph.contain[3]['thing@program'], 'Active Unsafe');
  assert.equal(graph.contain[3].situation, world.children[3].detail);
});

test('one large synthetic preflight reports arbitrary relation and Program scale in one pass', () => {
  const relationNodes = Array.from({ length: 1_500 }, (_, index) => legacyNode(
    `Relation ${index}`,
    '',
    [],
    [
      { verb: `verb-${index}-a`, object: `Target/${index}/A` },
      { verb: `verb-${index}-b`, object: `Target/${index}/B` }
    ]
  ));
  const programs = Array.from({ length: 120 }, (_, index) => legacyNode(
    `Program ${index}`,
    `explore({'name':'Relation ${index}'})`,
    [],
    [],
    '@program'
  ));
  const startedAt = performance.now();
  const { summary } = graphSchema.planGraphFourAxisMigration(legacyNode(
    'Synthetic World', '', [...relationNodes, ...programs]
  ));
  const elapsedMs = performance.now() - startedAt;

  assert.equal(summary.counts.nodes, 1_621);
  assert.equal(summary.counts.legacyPartnerNodes, 1_500);
  assert.equal(summary.counts.legacyPartners, 3_000);
  assert.equal(summary.counts.programs, 120);
  assert.equal(summary.counts.legacyAbiPrograms, 120);
  assert.equal(summary.legacyRelations.length, 3_000);
  assert.equal(summary.programs.length, 120);
  assert.equal(summary.readyToCommit, true);
  assert.ok(elapsedMs < 10_000, `synthetic preflight took ${Math.round(elapsedMs)}ms`);
});

test('migration-isolated Programs never enter refresh or explicit execution sets', async () => {
  const executed = [];
  const scheduler = createProgramRuntimeScheduler({
    timeoutMs: 500,
    async runProgram({ program }) {
      executed.push(program.path);
      return {
        locks: [], transforms: [], choices: [], trigger: null,
        messages: [{ level: 'info', text: program.name === 'Active Program' ? 'active' : 'must-not-run' }]
      };
    }
  });
  const cycle = await scheduler.refresh([
    atom('Unsafe Legacy', "message({'level':'info','text':'must-not-run'})", [], 'program@migration-isolated'),
    atom('Active Program', "message({'level':'info','text':'active'})", [], 'program')
  ], { isolateFailures: true });

  assert.deepEqual(cycle.failures, []);
  assert.deepEqual(cycle.messages.map(({ text }) => text), ['active']);
  assert.deepEqual(executed, ['Active Program']);
  await assert.rejects(scheduler.refresh([
    atom('Unsafe Legacy', 'pass', [], 'program@migration-isolated')
  ], { programSelector: 'Unsafe Legacy', force: true }), { code: 'PROGRAM_NOT_FOUND' });
});
