import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProjectionPipeline } from '../src/atom-system/projections/projection-pipeline.mjs';
import { createMemoryProjectionRepository } from '../src/atom-system/projections/projection-repository.mjs';
import { createLegacyProjectionProjectors } from '../src/atom-system/adapters/legacy-projection-adapter.mjs';
import { createLegacyProjectionOrchestrator } from '../src/atom-system/adapters/legacy-projection-orchestrator.mjs';
import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';
import { projectAtomGraphToKnowledge } from '../work-engine/atom-language/graph-4d-projection.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function snapshot(revision, facts = []) {
  return {
    contract: 'atom.world-snapshot',
    version: 1,
    worldId: 'primary',
    revision,
    facts
  };
}

function projectors() {
  return [
    { id: 'graph', project: ({ facts }) => ({ nodes: facts.map(({ name }) => name) }) },
    { id: 'spatial', project: ({ facts }) => ({ spheres: facts.length }) }
  ];
}

test('one immutable world snapshot produces a revision-labelled projection batch', async () => {
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({ projectors: projectors(), repository });

  const result = await pipeline.rebuild(snapshot('rev-1', [{ name: 'A' }]));

  assert.deepEqual(result, { worldId: 'primary', sourceRevision: 'rev-1', projections: ['graph', 'spatial'] });
  assert.deepEqual(await repository.readCurrent('primary', 'rev-1'), {
    current: true,
    worldId: 'primary',
    sourceRevision: 'rev-1',
    projections: {
      graph: { contract: 'atom.projection', version: 1, projection: 'graph', worldId: 'primary', sourceRevision: 'rev-1', value: { nodes: ['A'] } },
      spatial: { contract: 'atom.projection', version: 1, projection: 'spatial', worldId: 'primary', sourceRevision: 'rev-1', value: { spheres: 1 } }
    }
  });
});

test('projection failure publishes no partial batch and leaves the prior revision current', async () => {
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({ projectors: projectors(), repository });
  await pipeline.rebuild(snapshot('rev-1', [{ name: 'stable' }]));

  const broken = createProjectionPipeline({
    repository,
    projectors: [
      { id: 'graph', project: () => ({ nodes: ['partial'] }) },
      { id: 'spatial', project: () => { throw Object.assign(new Error('broken'), { code: 'BROKEN_PROJECTOR' }); } }
    ]
  });
  await assert.rejects(broken.rebuild(snapshot('rev-2', [{ name: 'new' }])), (error) => error.code === 'PROJECTION_BUILD_FAILED');

  assert.equal((await repository.readCurrent('primary', 'rev-1')).current, true);
  const stale = await repository.readCurrent('primary', 'rev-2');
  assert.deepEqual(stale, {
    current: false,
    worldId: 'primary',
    requestedRevision: 'rev-2',
    availableRevision: 'rev-1'
  });
});

test('projectors receive isolated facts and cannot mutate the world snapshot or each other', async () => {
  const repository = createMemoryProjectionRepository();
  const source = snapshot('rev-isolated', [{ name: 'original' }]);
  const pipeline = createProjectionPipeline({
    repository,
    projectors: [
      { id: 'mutator', project: ({ facts }) => { facts[0].name = 'mutated'; return facts[0]; } },
      { id: 'observer', project: ({ facts }) => facts[0] }
    ]
  });

  await pipeline.rebuild(source);
  const stored = await repository.readCurrent('primary', 'rev-isolated');
  assert.equal(source.facts[0].name, 'original');
  assert.equal(stored.projections.mutator.value.name, 'mutated');
  assert.equal(stored.projections.observer.value.name, 'original');
});

test('incremental projection publishes only projectors reached by affected paths and reuses the rest', async () => {
  const repository = createMemoryProjectionRepository();
  const calls = [];
  const pipeline = createProjectionPipeline({
    repository,
    projectors: [
      {
        id: 'domain-a',
        affectedBy: (paths) => paths.some((path) => path.startsWith('A/')),
        project: ({ facts }, context) => {
          calls.push({ id: 'domain-a', paths: context.affectedPaths });
          return { value: facts.find(({ name }) => name === 'A')?.value };
        }
      },
      {
        id: 'domain-b',
        affectedBy: (paths) => paths.some((path) => path.startsWith('B/')),
        project: ({ facts }, context) => {
          calls.push({ id: 'domain-b', paths: context.affectedPaths });
          return { value: facts.find(({ name }) => name === 'B')?.value };
        }
      }
    ]
  });
  await pipeline.rebuild(snapshot('rev-base', [
    { name: 'A', value: 1 }, { name: 'B', value: 1 }
  ]));
  calls.length = 0;

  const result = await pipeline.rebuild(snapshot('rev-next', [
    { name: 'A', value: 2 }, { name: 'B', value: 1 }
  ]), { affectedPaths: ['A/Target'] });

  assert.deepEqual(calls, [{ id: 'domain-a', paths: ['A/Target'] }]);
  assert.deepEqual(result, {
    worldId: 'primary',
    sourceRevision: 'rev-next',
    projections: ['domain-a', 'domain-b'],
    rebuiltProjections: ['domain-a'],
    reusedProjections: ['domain-b'],
    affectedPaths: ['A/Target']
  });
  const stored = await repository.readCurrent('primary', 'rev-next');
  assert.deepEqual(stored.projections['domain-a'].value, { value: 2 });
  assert.deepEqual(stored.projections['domain-b'].value, { value: 1 });
});

test('duplicate projection ids are rejected before any projector runs', async () => {
  const repository = createMemoryProjectionRepository();
  let calls = 0;
  assert.throws(
    () => createProjectionPipeline({
      repository,
      projectors: [
        { id: 'graph', project: () => { calls += 1; } },
        { id: 'graph', project: () => { calls += 1; } }
      ]
    }),
    (error) => error.code === 'DUPLICATE_PROJECTION_ID'
  );
  assert.equal(calls, 0);
});

test('legacy Graph and Spatial projectors fit the pipeline without changing their semantic output', async () => {
  const facts = [{
    thing: 'Root',
    situation: 'root detail',
    contain: [{ thing: 'Child', situation: 'child detail', contain: [], support: [] }],
    support: []
  }];
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors(),
    repository
  });
  await pipeline.rebuild(snapshot('rev-legacy', facts));
  const stored = await repository.readCurrent('primary', 'rev-legacy');
  const expectedGraph = projectAtomContext(facts);
  const expectedSpatial = await projectAtomGraphToKnowledge(expectedGraph);

  assert.equal(JSON.stringify(stored.projections.graph.value), JSON.stringify(expectedGraph));
  assert.equal(JSON.stringify(stored.projections.spatial.value), JSON.stringify(expectedSpatial));
});

test('legacy Spatial consumes the Graph built earlier in the same projection batch', async () => {
  const facts = [{ thing: 'Root', situation: '', contain: [], support: [] }];
  let graphBuilds = 0;
  const projectContext = (value, options) => {
    graphBuilds += 1;
    return projectAtomContext(value, options);
  };
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors({ projectContext }),
    repository
  });

  await pipeline.rebuild(snapshot('rev-shared-graph', facts));

  assert.equal(graphBuilds, 1);
  const stored = await repository.readCurrent('primary', 'rev-shared-graph');
  assert.equal(stored.projections.spatial.value.nodes.length, 2);
});

test('TC-PERF-WEB-DOMAIN: legacy Graph and Spatial rebuild only the affected top-level domain', async () => {
  const before = [
    { thing: 'A', situation: 'before', contain: [{ thing: 'A1', situation: '', contain: [], support: [] }], support: [] },
    { thing: 'B', situation: 'stable', contain: [{ thing: 'B1', situation: '', contain: [], support: [] }], support: [] },
    { thing: 'C', situation: 'stable', contain: [], support: [] }
  ];
  const after = structuredClone(before);
  after[0].situation = 'after';
  const graphDomainCounts = [];
  const spatialDomainCounts = [];
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors({
      projectContext(value, options) {
        graphDomainCounts.push(value.length);
        return projectAtomContext(value, options);
      },
      async projectSpatial(graph, options) {
        spatialDomainCounts.push(graph.graph.contain.length);
        return projectAtomGraphToKnowledge(graph, options);
      }
    }),
    repository
  });

  await pipeline.rebuild(snapshot('rev-domain-before', before));
  const previous = await repository.readCurrent('primary', 'rev-domain-before');
  await pipeline.rebuild(snapshot('rev-domain-after', after), { affectedPaths: ['A', 'A/A1'] });
  const current = await repository.readCurrent('primary', 'rev-domain-after');
  const expectedGraph = projectAtomContext(after);
  const expectedSpatial = await projectAtomGraphToKnowledge(expectedGraph);

  assert.deepEqual(graphDomainCounts, [3, 1]);
  assert.deepEqual(spatialDomainCounts, [3, 1]);
  assert.equal(JSON.stringify(current.projections.graph.value), JSON.stringify(expectedGraph));
  assert.equal(JSON.stringify(current.projections.spatial.value), JSON.stringify(expectedSpatial));
  assert.deepEqual(
    current.projections.spatial.value.nodes.find((node) => node.atomPath === 'B/B1').position,
    previous.projections.spatial.value.nodes.find((node) => node.atomPath === 'B/B1').position
  );
});

test('incremental Web projection includes a cross-domain support endpoint without rebuilding an unrelated domain', async () => {
  const support = [{ 'if@current': true, then: [{ thing: 'B/Target' }] }];
  const before = [
    { thing: 'A', situation: '', contain: [{ thing: 'Source', situation: 'before', contain: [], support }], support: [] },
    { thing: 'B', situation: '', contain: [{ thing: 'Target', situation: '', contain: [], support: [] }], support: [] },
    { thing: 'C', situation: 'unrelated', contain: [], support: [] }
  ];
  const after = structuredClone(before);
  after[0].contain[0].situation = 'after';
  const graphDomainCounts = [];
  const spatialDomainCounts = [];
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors({
      projectContext(value, options) {
        graphDomainCounts.push(value.length);
        return projectAtomContext(value, options);
      },
      async projectSpatial(graph, options) {
        spatialDomainCounts.push(graph.graph.contain.length);
        return projectAtomGraphToKnowledge(graph, options);
      }
    }),
    repository
  });

  await pipeline.rebuild(snapshot('rev-support-before', before));
  await pipeline.rebuild(snapshot('rev-support-after', after), { affectedPaths: ['A', 'A/Source'] });
  const current = await repository.readCurrent('primary', 'rev-support-after');
  const fullRepository = createMemoryProjectionRepository();
  const fullPipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors(),
    repository: fullRepository
  });
  await fullPipeline.rebuild(snapshot('rev-support-after', after));
  const expected = await fullRepository.readCurrent('primary', 'rev-support-after');

  assert.deepEqual(graphDomainCounts, [3, 2]);
  assert.deepEqual(spatialDomainCounts, [3, 2]);
  assert.equal(JSON.stringify(current.projections.graph.value), JSON.stringify(expected.projections.graph.value));
  assert.equal(JSON.stringify(current.projections.spatial.value), JSON.stringify(expected.projections.spatial.value));
  assert.equal(current.projections.spatial.value.supportRelations.length, 1);
});

test('spatial projection represents an Agent capability by its Program type only', async () => {
  const facts = [{
    'thing@program': 'Work Agent',
    situation: 'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})',
    contain: [{ 'thing@program': 'Router', situation: 'pass', contain: [], support: [] }],
    support: []
  }];
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors(),
    repository
  });

  await pipeline.rebuild(snapshot('rev-types', facts));
  const spatial = (await repository.readCurrent('primary', 'rev-types')).projections.spatial.value;
  const agent = spatial.nodes.find((node) => node.label === 'Work Agent');
  const program = spatial.nodes.find((node) => node.label === 'Router');

  assert.deepEqual(agent.atomTypes, ['program']);
  assert.deepEqual(program.atomTypes, ['program']);
});

test('spatial support resolves Program endpoints by Atom identity across the synthetic graph root', async () => {
  const program = (thing, support = []) => ({
    [`thing@program`]: thing,
    situation: 'def main(arguments):\n    return True',
    contain: [],
    support
  });
  const ordinary = (thing, support = []) => ({ thing, situation: '', contain: [], support });
  const facts = [{
    thing: 'Flow', situation: '', support: [], contain: [
      program('Forward'),
      program('Gate A'),
      program('Gate B'),
      ordinary('Forward condition', [{
        'if@current': true,
        if: [{ 'thing@program': 'Forward' }],
        then: [{ thing: 'Forward result' }]
      }]),
      ordinary('Input A'),
      ordinary('Input B'),
      ordinary('Hub', [
        {
          if: [{ and: [
            { thing: 'Input A' },
            { thing: 'Input B' },
            { 'thing@program': 'Gate A' },
            { 'thing@program': 'Gate B' }
          ] }],
          'then@current': true
        },
        { 'if@current': true, then: [{ thing: 'Result A' }, { thing: 'Result B' }] }
      ]),
      ordinary('Forward result'),
      ordinary('Result A'),
      ordinary('Result B')
    ]
  }];
  const repository = createMemoryProjectionRepository();
  const pipeline = createProjectionPipeline({
    projectors: createLegacyProjectionProjectors({
      programScheduler: createProgramRuntimeScheduler()
    }),
    repository
  });

  await pipeline.rebuild(snapshot('rev-support-program-path-domain', facts));

  const spatial = (await repository.readCurrent(
    'primary', 'rev-support-program-path-domain'
  )).projections.spatial.value;
  assert.deepEqual(
    spatial.supportClauses.map((clause) => clause.evaluation.status),
    ['true', 'true', 'true']
  );
  assert.equal(spatial.supportRelations.length, 5);
  assert.equal(spatial.edges.filter((edge) => edge.label === 'support').length, 5);
});

test('legacy projection orchestration rejects a stale command revision before publishing Spatial state', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-projection-orchestrator-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const facts = [{ thing: 'Root', situation: '', contain: [], support: [] }];
  await fs.writeFile(contextFile, JSON.stringify(facts), 'utf8');
  const orchestrator = createLegacyProjectionOrchestrator({ contextFile });

  await assert.rejects(
    orchestrator.projectCurrent({ expectedRevision: 'not-current' }),
    (error) => error.code === 'STALE_WORLD_PROJECTION'
  );
  const current = await orchestrator.projectCurrent();
  assert.match(current.sourceRevision, /^sha256:/u);
  assert.equal(current.graph.config.schema_version, '2.0.0');
  assert.ok(Array.isArray(current.spatial.nodes));
});
