import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const graphUrl = new URL('../docs/architecture/atom-capability-graph.json', import.meta.url);
const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

async function loadCapabilityGraph() {
  return JSON.parse(await fs.readFile(graphUrl, 'utf8'));
}

function uniqueIds(items, label) {
  const ids = items.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, `${label} ids must be unique`);
  assert.ok(ids.every(Boolean), `${label} ids must be non-empty`);
  return new Set(ids);
}

test('the Atom capability graph is a connected and owned system contract', async () => {
  const graph = await loadCapabilityGraph();
  assert.equal(graph.schemaVersion, 1);
  assert.equal(graph.system.id, 'atom');
  assert.match(graph.system.positioning, /高维事实世界/);

  const componentIds = uniqueIds(graph.components, 'component');
  const capabilityIds = uniqueIds(graph.capabilities, 'capability');
  const invariantIds = uniqueIds(graph.invariants, 'invariant');
  uniqueIds(graph.journeys, 'journey');

  for (const capability of graph.capabilities) {
    assert.ok(componentIds.has(capability.owner), `${capability.id} has a declared owner`);
    assert.ok(['achieved', 'partial', 'gap'].includes(capability.status), `${capability.id} has a known status`);
    assert.ok(capability.acceptance.length > 0, `${capability.id} has acceptance evidence or an explicit gap`);
  }

  const acceptance = [
    ...graph.capabilities.flatMap((capability) => capability.acceptance),
    ...graph.journeys.flatMap((journey) => journey.acceptance)
  ];
  for (const evidence of acceptance) {
    if (evidence.ref.startsWith('gap://')) continue;
    await fs.access(path.join(repositoryRoot, evidence.ref));
  }

  for (const relation of graph.relations) {
    assert.ok(capabilityIds.has(relation.from), `${relation.id} has a known source capability`);
    assert.ok(capabilityIds.has(relation.to), `${relation.id} has a known target capability`);
    assert.ok(relation.type, `${relation.id} has explicit semantics`);
  }

  for (const journey of graph.journeys) {
    assert.ok(journey.steps.length >= 3, `${journey.id} describes an end-to-end path`);
    assert.ok(journey.steps.every((id) => capabilityIds.has(id)), `${journey.id} only uses known capabilities`);
    assert.ok(journey.invariants.every((id) => invariantIds.has(id)), `${journey.id} only uses known invariants`);
    if (journey.critical && journey.status === 'achieved') {
      assert.ok(
        journey.acceptance.some(({ kind }) => kind === 'browser-e2e'),
        `${journey.id} cannot be achieved without real browser evidence`
      );
    }
  }
});

test('web editing preserves view facts across authoritative reconciliation', async () => {
  const graph = await loadCapabilityGraph();
  const invariant = graph.invariants.find(({ id }) => id === 'world-edit-preserves-view');
  assert.deepEqual(invariant?.forbiddenMutations.sort(), [
    'camera',
    'expanded-branches',
    'focus',
    'selection',
    'view-mode'
  ]);

  const journey = graph.journeys.find(({ id }) => id === 'web-edit-authoritative-reconcile');
  assert.deepEqual(journey?.steps, [
    'spatial-input',
    'workspace-edit',
    'interaction-runtime',
    'world-commit',
    'spatial-projection',
    'projection-reconcile',
    'scene-render'
  ]);
  assert.equal(journey?.status, 'partial');
  assert.ok(journey?.acceptance.some(({ kind }) => kind === 'missing-browser-e2e'));
});
