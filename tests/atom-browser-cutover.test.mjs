import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  applyViewIntent,
  createLegacySceneSnapshot,
  sceneEntityIdForItem
} from '../src/atom-system/adapters/browser-scene-adapter.mjs';

test('browser adapter translates legacy view state through the canonical interaction reducer', () => {
  const legacy = {
    viewMode: 'nested',
    expandedClusterDomains: new Map([
      ['root/a', { projectionMode: 'nested' }]
    ])
  };
  const next = applyViewIntent(legacy, { type: 'set-view-mode', mode: 'peripheral' });

  assert.equal(next.mode, 'peripheral');
  assert.deepEqual(next.branchProjections, { 'root/a': 'nested' });
  assert.equal(legacy.viewMode, 'nested');
});

test('browser build exposes one scene adapter before the legacy renderer starts', async () => {
  const [build, html, engine] = await Promise.all([
    fs.readFile(new URL('../scripts/build-browser.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../spatial-engine.js', import.meta.url), 'utf8')
  ]);

  assert.match(build, /atom-spatial-scene\.bundle\.js/u);
  const sceneBundle = html.indexOf('atom-spatial-scene.bundle.js');
  const engineScript = html.indexOf('spatial-engine.js');
  assert.ok(sceneBundle > -1 && sceneBundle < engineScript);
  assert.match(engine, /global\.AtomSpatialScene/u);
  const setModeStart = engine.indexOf('function setViewMode(');
  const setModeEnd = engine.indexOf('\n  }', setModeStart) + 4;
  const setMode = engine.slice(setModeStart, setModeEnd);
  assert.match(setMode, /commitViewIntent/u);
  assert.doesNotMatch(setMode, /state\.viewMode\s*=/u);
});

test('legacy nodes and clusters receive one canonical hierarchy snapshot', () => {
  const node = { id: 'direction', label: '定向', description: '明确目标', capabilities: {} };
  const child = { id: 'goal', label: '目标', description: '目标字段', capabilities: {} };
  const cluster = { path: '推进流总控/设标/调研', parentPath: '推进流总控/设标', label: '调研', description: '研究素材' };
  const rendered = [
    { kind: 'node', node, ownerPath: '推进流总控/设标' },
    { kind: 'node', node: child, ownerPath: '推进流总控/设标/定向' }
  ];
  const scene = createLegacySceneSnapshot({
    rendered,
    clusters: [cluster],
    focus: { kind: 'domain', path: '推进流总控/设标' },
    settings: { middleLabelDepth: 2, middleDetailDepth: 2 },
    selected: node,
    focused: null,
    viewMode: 'nested'
  });

  const direction = scene.byId(sceneEntityIdForItem(rendered[0]));
  const research = scene.byId(sceneEntityIdForItem({ kind: 'domain', path: cluster.path }));
  const goal = scene.byId(sceneEntityIdForItem(rendered[1]));
  assert.equal(direction.hierarchyLevel, 2);
  assert.equal(research.hierarchyLevel, 2);
  assert.equal(goal.hierarchyLevel, 3);
  assert.equal(direction.emphasis.label, true);
  assert.equal(research.emphasis.detail, true);
  assert.equal(goal.emphasis.label, false);
});

test('renderer reads hierarchy emphasis from SceneSnapshot rather than demo-model rules', async () => {
  const engine = await fs.readFile(new URL('../spatial-engine.js', import.meta.url), 'utf8');
  assert.match(engine, /createLegacySceneSnapshot/u);

  const labelFunction = engine.slice(
    engine.indexOf('function isMiddleItemLabelHighlighted('),
    engine.indexOf('function isMiddleRelationshipHighlighted(')
  );
  assert.match(labelFunction, /semanticScene/u);
  assert.doesNotMatch(labelFunction, /demoModel/u);

  const detailFunction = engine.slice(
    engine.indexOf('function middleDetailLevel('),
    engine.indexOf('function areAllFocusedNamesHidden(')
  );
  assert.match(detailFunction, /semanticScene/u);
  assert.doesNotMatch(detailFunction, /demoModel/u);
});

test('branch expansion and collapse use the same canonical view-intent boundary', async () => {
  const engine = await fs.readFile(new URL('../spatial-engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(engine, /expandedClusterDomains\.(?:set|delete|clear)\s*\(/u);
  assert.match(engine, /commitViewIntent\s*\(\s*state\s*,\s*\{\s*type:\s*"append-view"/u);
  assert.match(engine, /commitViewIntent\s*\(\s*state\s*,\s*\{\s*type:\s*"remove-view"/u);
  assert.match(engine, /commitViewIntent\s*\(\s*state\s*,\s*\{\s*type:\s*"clear-views"/u);
});
