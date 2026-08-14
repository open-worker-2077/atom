import assert from 'node:assert/strict';
import test from 'node:test';

import { createEntityIndex } from '../src/atom-system/spatial-experience/entity-index.mjs';
import { reduceInteraction } from '../src/atom-system/spatial-experience/interaction-reducer.mjs';
import { createSceneSnapshot } from '../src/atom-system/spatial-experience/scene-snapshot.mjs';

function entities() {
  return [
    {
      id: 'cluster:set-standard', atomRef: 'atom:set-standard', kind: 'cluster',
      label: '设标', detail: '人工主导方法逻辑', hierarchyAddress: ['推进流总控', '设标'],
      detailMode: 'floating', capabilities: { read: true, write: true }
    },
    {
      id: 'node:direction', atomRef: 'atom:direction', kind: 'node',
      label: '定向', detail: '明确目标与边界', hierarchyAddress: ['推进流总控', '设标', '定向'],
      detailMode: 'floating', capabilities: { read: true, write: false }
    },
    {
      id: 'cluster:research', atomRef: 'atom:research', kind: 'cluster',
      label: '调研', detail: '从目标出发研究素材', hierarchyAddress: ['推进流总控', '设标', '调研'],
      detailMode: 'floating', capabilities: { read: true, write: true }
    },
    {
      id: 'node:channel', atomRef: 'atom:channel', kind: 'node',
      label: '渠道', detail: '优先高位素材渠道', hierarchyAddress: ['推进流总控', '设标', '调研', '渠道'],
      detailMode: 'floating', capabilities: { read: true, write: true }
    }
  ];
}

function viewState(overrides = {}) {
  return {
    mode: 'nested',
    visibleIds: entities().map(({ id }) => id),
    branchProjections: {},
    selectedId: null,
    focusedId: null,
    middleFocusId: 'cluster:set-standard',
    labelDepth: 2,
    detailDepth: 2,
    detailModeById: {},
    ...overrides
  };
}

test('one entity index gives every projection a stable identity and one hierarchy address', () => {
  const index = createEntityIndex(entities());

  assert.equal(index.byId('node:direction').atomRef, 'atom:direction');
  assert.deepEqual(index.byAtomRef('atom:research').map(({ id }) => id), ['cluster:research']);
  assert.throws(
    () => createEntityIndex([...entities(), { ...entities()[0] }]),
    (error) => error.code === 'DUPLICATE_SCENE_ENTITY_ID'
  );
});

test('cluster and node projections use one hierarchy-level calculation for labels and details', () => {
  const scene = createSceneSnapshot({ index: createEntityIndex(entities()), viewState: viewState() });

  assert.equal(scene.byId('cluster:set-standard').hierarchyLevel, 1);
  assert.equal(scene.byId('node:direction').hierarchyLevel, 2);
  assert.equal(scene.byId('cluster:research').hierarchyLevel, 2);
  assert.equal(scene.byId('node:channel').hierarchyLevel, 3);
  assert.equal(scene.byId('node:direction').emphasis.label, true);
  assert.equal(scene.byId('node:direction').emphasis.detail, true);
  assert.equal(scene.byId('node:channel').emphasis.label, false);
  assert.equal(scene.byId('node:channel').emphasis.detail, false);
});

test('scene snapshot owns visibility, detail presentation and edit capability once', () => {
  const scene = createSceneSnapshot({
    index: createEntityIndex(entities()),
    viewState: viewState({
      visibleIds: ['cluster:set-standard', 'node:direction'],
      selectedId: 'node:direction',
      detailModeById: { 'node:direction': 'surface' }
    })
  });

  assert.deepEqual(scene.byId('node:direction').detailPresentation, { mode: 'surface', text: '明确目标与边界' });
  assert.deepEqual(scene.byId('node:direction').capabilities, { read: true, write: false });
  assert.equal(scene.byId('node:direction').emphasis.selected, true);
  assert.equal(scene.byId('cluster:research').visible, false);
  assert.equal(scene.byId('cluster:research').detailPresentation, null);
});

test('branch projection intents append, remove descendants, replace and clear atomically', () => {
  const base = viewState();
  const opened = reduceInteraction(base, {
    type: 'append-view', targetId: 'root/design', mode: 'nested'
  });
  const nested = reduceInteraction(opened, {
    type: 'append-view', targetId: 'root/design/research', mode: 'hierarchy'
  });
  const collapsed = reduceInteraction(nested, {
    type: 'remove-view', targetId: 'root/design'
  });
  assert.deepEqual(collapsed.branchProjections, {});

  const replaced = reduceInteraction(collapsed, {
    type: 'replace-views',
    projections: { 'root/a': 'peripheral', 'root/b': 'nested' }
  });
  assert.deepEqual(replaced.branchProjections, { 'root/a': 'peripheral', 'root/b': 'nested' });
  assert.deepEqual(reduceInteraction(replaced, { type: 'clear-views' }).branchProjections, {});
});

test('changing A S D F mode only changes the future mode; append adds one branch without rewriting prior view', () => {
  const initial = viewState({
    branchProjections: { 'node:direction': 'nested' }
  });
  const changed = reduceInteraction(initial, { type: 'set-view-mode', mode: 'peripheral' });
  assert.equal(changed.mode, 'peripheral');
  assert.deepEqual(changed.branchProjections, { 'node:direction': 'nested' });

  const appended = reduceInteraction(changed, { type: 'append-view', targetId: 'cluster:research' });
  assert.deepEqual(appended.branchProjections, {
    'node:direction': 'nested',
    'cluster:research': 'peripheral'
  });
});

test('middle focus and detail changes are intents, never direct entity mutation', () => {
  const sourceEntities = entities();
  const initial = viewState();
  const focused = reduceInteraction(initial, { type: 'focus-hierarchy', targetId: 'cluster:research' });
  const toggled = reduceInteraction(focused, { type: 'set-detail-mode', targetId: 'cluster:research', mode: 'name' });

  assert.equal(toggled.middleFocusId, 'cluster:research');
  assert.equal(toggled.detailModeById['cluster:research'], 'name');
  assert.equal(sourceEntities[2].detailMode, 'floating');
});

test('scene construction scales across a larger visible entity set without changing the contract', () => {
  const many = Array.from({ length: 10_000 }, (_, index) => ({
    id: `node:${index}`,
    atomRef: `atom:${index}`,
    kind: 'node',
    label: `Node ${index}`,
    detail: '',
    hierarchyAddress: ['root', String(index)],
    detailMode: 'floating',
    capabilities: { read: true, write: true }
  }));
  const index = createEntityIndex(many);
  const scene = createSceneSnapshot({
    index,
    viewState: {
      ...viewState(),
      visibleIds: many.map(({ id }) => id),
      middleFocusId: 'node:0'
    }
  });

  assert.equal(scene.entities.length, 10_000);
  assert.equal(scene.visibleCount, 10_000);
  assert.equal(scene.byId('node:9999').identity.atomRef, 'atom:9999');
});
