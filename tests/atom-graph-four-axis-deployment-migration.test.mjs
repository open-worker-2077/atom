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

test('relation-only compatibility manifest advances across unrelated commits', () => {
  const source = [atom('Root', '', [
    { 'thing@program': 'Legacy', situation: "explore({'name':'Root'})", contain: [], support: [] },
    { thing: 'Relations', situation: '', contain: [], support: [{ verb: '原字符→', object: 'Target' }] }
  ])];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:source', targetFacts: source
  });
  const next = structuredClone(source);
  next[0].contain.push(atom('Unrelated'));
  const advanced = advanceCompatibilityManifest(manifest, source, next);
  assert.doesNotThrow(() => validateCompatibilityManifest(advanced, next));
  assert.equal(Object.hasOwn(advanced, 'programs'), false);
  assert.equal(advanced.legacySupport.length, 1);
});

test('legacy relation provenance survives node movement without any Program qualification', () => {
  const source = [atom('Root', '', [
    { 'thing@program': 'Legacy', situation: "explore({'name':'Root'})", contain: [], support: [] },
    { thing: 'Relations', situation: '', contain: [], support: [{ verb: 'v', object: 'O' }] }
  ])];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:source', targetFacts: source
  });
  const moved = structuredClone(source);
  moved[0].contain[0]['thing@program'] = 'Moved Legacy';
  moved[0].contain[1].thing = 'Moved Relations';
  const advanced = advanceCompatibilityManifest(manifest, source, moved);
  assert.equal(Object.hasOwn(advanced, 'programs'), false);
  assert.equal(advanced.legacySupport[0].occurrences, 1);
  const metadata = compatibilityMetadata(advanced, moved);
  assert.deepEqual(metadata.legacySupportPaths, ['Root/Moved Relations']);
});

test('Program source changes never create manifest ABI authorization', () => {
  const source = [{ 'thing@program': 'Legacy', situation: "explore({'name':'Root'})", contain: [], support: [] }];
  const manifest = createCompatibilityManifest({
    sourceRevision: 'sha256:source', targetFacts: source
  });
  const changed = structuredClone(source);
  changed[0].situation += '\npass';
  changed.push({ 'thing@program': 'Copy', situation: source[0].situation, contain: [], support: [] });
  const advanced = advanceCompatibilityManifest(manifest, source, changed);
  assert.equal(Object.hasOwn(advanced, 'programs'), false);
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

test('compatibility manifest never authorizes a legacy Program ABI', async (t) => {
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
    sourceRevision: 'sha256:legacy', targetFacts: source
  });
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const loaded = await readAtomContext(contextFile, { create: false, compatibilityManifest: manifest });
  assert.equal(Object.hasOwn(manifest, 'programs'), false);
  assert.equal(Object.hasOwn(legacyAtomContextMetadata(loaded), 'legacyProgramPaths'), false);
  assert.throws(() => validateCompatibilityManifest({
    ...manifest,
    programs: [{ path: 'Root/Legacy', sourceHash: 'sha256:forged' }]
  }, source), { code: 'INVALID_GRAPH_COMPATIBILITY_MANIFEST' });
  const scheduler = createProgramRuntimeScheduler({ timeoutMs: 5_000 });
  await assert.rejects(scheduler.refresh(loaded, {
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
    testRoots: ['World/test']
  });
  assert.deepEqual(summary.counts, {
    nodes: 8,
    legacyPartnerNodes: 1,
    legacyPartners: 1,
    programs: 4,
    legacyAbiPrograms: 4,
    defaultBackupPrograms: 1,
    testLegacyPrograms: 1,
    activeLegacyPrograms: 2,
    upgradedPrograms: 2,
    blockedPrograms: 1
  });
  assert.deepEqual(summary.programs.map(({ path, disposition, reason }) => ({
    path, disposition, reason
  })), [
    { path: 'World/Default Backup/Archived', disposition: 'historical-non-executable', reason: 'default-backup' },
    { path: 'World/test/Fixture', disposition: 'upgraded-test', reason: 'ast-proven-graph-structure-edits' },
    { path: 'World/Active Safe', disposition: 'upgraded', reason: 'ast-proven-graph-structure-edits' },
    { path: 'World/Active Unsafe', disposition: 'blocked', reason: 'program-source-upgrade-ambiguous' }
  ]);
  assert.equal(graph.contain[2].situation.includes("note = 'name stays text'"), true);
  assert.equal(graph.contain[2].situation.includes("explore({'contain':[]})"), true);
  assert.equal(graph.contain[3]['thing@program'], 'Active Unsafe');
  assert.equal(graph.contain[3].situation, world.children[3].detail);
  assert.equal(summary.readyToCommit, false);
  assert.deepEqual(summary.blockedPrograms.map(({ path }) => path), ['World/Active Unsafe']);
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
  assert.ok(elapsedMs < 10_000, `synthetic preflight took ${Math.round(elapsedMs)}ms`);
});
