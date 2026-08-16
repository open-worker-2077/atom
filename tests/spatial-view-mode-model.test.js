const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModel() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  const file = path.join(__dirname, '..', 'spatial-view-mode-model.js');
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window.SpatialViewModeModel;
}

test('cycles through immersive peripheral nested and hierarchy without rewriting prior branches', () => {
  const model = loadModel();
  assert.ok(model, 'SpatialViewModeModel must exist');
  const branches = Object.freeze([
    Object.freeze({ path: 'root/a', projectionMode: 'peripheral' }),
    Object.freeze({ path: 'root/b', projectionMode: 'nested' })
  ]);

  assert.equal(model.nextMode('immersive'), 'peripheral');
  assert.equal(model.nextMode('peripheral'), 'nested');
  assert.equal(model.nextMode('nested'), 'hierarchy');
  assert.equal(model.nextMode('hierarchy'), 'immersive');
  assert.deepEqual(JSON.parse(JSON.stringify(branches)), [
    { path: 'root/a', projectionMode: 'peripheral' },
    { path: 'root/b', projectionMode: 'nested' }
  ]);
});

test('an open wand stroke selects only nodes touched by the visible trail', () => {
  const model = loadModel();
  const regions = [
    { key: 'a', x: 20, y: 20, radius: 7 },
    { key: 'b', x: 70, y: 24, radius: 7 },
    { key: 'c', x: 70, y: 70, radius: 7 }
  ];
  const result = model.resolveStrokeTargets(
    [{ x: 8, y: 18 }, { x: 82, y: 25 }],
    regions,
    { closeDistance: 10, hitPadding: 2 }
  );

  assert.equal(result.closed, false);
  assert.deepEqual(Array.from(result.keys), ['a', 'b']);
  assert.deepEqual(regions, [
    { key: 'a', x: 20, y: 20, radius: 7 },
    { key: 'b', x: 70, y: 24, radius: 7 },
    { key: 'c', x: 70, y: 70, radius: 7 }
  ], 'selection geometry never edits source data');
});

test('a closed wand stroke selects every enclosed node plus nodes touched by the trail', () => {
  const model = loadModel();
  const result = model.resolveStrokeTargets(
    [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 90 },
      { x: 10, y: 90 },
      { x: 13, y: 12 }
    ],
    [
      { key: 'inside', x: 50, y: 50, radius: 5 },
      { key: 'edge', x: 93, y: 50, radius: 5 },
      { key: 'outside', x: 122, y: 50, radius: 5 }
    ],
    { closeDistance: 8, hitPadding: 1 }
  );

  assert.equal(result.closed, true);
  assert.deepEqual(Array.from(result.keys), ['inside', 'edge']);
  assert.equal(result.glowDurationMs, 500);
});

test('double Shift selects peers while triple Shift remains reserved and inert', () => {
  const model = loadModel();
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.resolveShiftTap({ highEnergy: false, lastTapAt: 0 }, 1000))),
    { highEnergy: false, lastTapAt: 1000, tapCount: 1, toggled: false }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.resolveShiftTap({ highEnergy: false, lastTapAt: 1000, tapCount: 1 }, 1240))),
    { highEnergy: false, lastTapAt: 1240, tapCount: 2, toggled: false }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.resolveShiftTap({ highEnergy: false, lastTapAt: 1240, tapCount: 2 }, 1460))),
    { highEnergy: false, lastTapAt: 0, tapCount: 0, toggled: false, triple: true }
  );
});

test('Shift gesture recognises physical and virtual keyboard events', () => {
  const model = loadModel();
  assert.equal(model.isShiftKeyEvent({ code: 'ShiftLeft', key: 'Shift' }), true);
  assert.equal(model.isShiftKeyEvent({ code: 'ShiftRight', key: 'Shift' }), true);
  assert.equal(model.isShiftKeyEvent({ code: '', key: 'Shift' }), true);
  assert.equal(model.isShiftKeyEvent({ code: 'KeyA', key: 'a' }), false);
});

test('ASDF maps directly to the four future view modes', () => {
  const model = loadModel();
  assert.equal(model.modeForKey('KeyA'), 'nested');
  assert.equal(model.modeForKey('KeyS'), 'peripheral');
  assert.equal(model.modeForKey('KeyD'), 'hierarchy');
  assert.equal(model.modeForKey('KeyF'), 'immersive');
  assert.equal(model.modeForKey('CapsLock'), null);
});

test('peer batch selects every node in the pointed node same layer and group', () => {
  const model = loadModel();
  const regions = [
    { key: 'g/a', ownerPath: 'g', level: 1, x: 10, y: 10, radius: 8, portal: true },
    { key: 'g/b', ownerPath: 'g', level: 1, x: 30, y: 10, radius: 8, portal: true },
    { key: 'g/c', ownerPath: 'g', level: 2, x: 50, y: 10, radius: 8, portal: true },
    { key: 'other/d', ownerPath: 'other', level: 1, x: 70, y: 10, radius: 8, portal: true },
    { key: 'g/value', ownerPath: 'g', level: 1, x: 90, y: 10, radius: 8, portal: false }
  ];
  assert.deepEqual(Array.from(model.planPeerBatch(regions, { x: 11, y: 10 })), ['g/a', 'g/b', 'g/value']);
  assert.deepEqual(Array.from(model.planPeerBatch(regions, { x: 200, y: 200 })), []);
});

test('double Shift selects the current domain peer layer without a prior pointer anchor', () => {
  const model = loadModel();
  const regions = [
    { key: 'current/a', ownerPath: 'current', level: 2, x: 10, y: 10, radius: 8 },
    { key: 'current/b', ownerPath: 'current', level: 2, x: 30, y: 10, radius: 8 },
    { key: 'current/deeper', ownerPath: 'current', level: 3, x: 50, y: 10, radius: 8 },
    { key: 'other/c', ownerPath: 'other', level: 2, x: 70, y: 10, radius: 8 }
  ];

  assert.deepEqual(
    Array.from(model.planPeerBatch(regions, null, 'current')),
    ['current/a', 'current/b']
  );
});

test('recognises a continuous five-point star without mistaking loops or zigzags', () => {
  const model = loadModel();
  const star = [];
  const order = [0, 2, 4, 1, 3, 0];
  for (const index of order) {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / 5;
    star.push({ x: 100 + Math.cos(angle) * 70, y: 100 + Math.sin(angle) * 70 });
  }
  assert.equal(model.classifyStrokeGesture(star).kind, 'star');
  assert.equal(model.classifyStrokeGesture([
    { x: 20, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 120 },
    { x: 20, y: 120 }, { x: 20, y: 20 }
  ]).kind, 'loop');
  assert.equal(model.classifyStrokeGesture([
    { x: 10, y: 10 }, { x: 60, y: 60 }, { x: 100, y: 20 }
  ]).kind, 'stroke');
});

test('recursive visual planning reaches every descendant without mutating the knowledge graph', () => {
  const model = loadModel();
  const graph = Object.freeze({
    a: Object.freeze(['a1', 'a2']),
    a1: Object.freeze(['a11']),
    a2: Object.freeze([]),
    a11: Object.freeze([])
  });
  const before = JSON.stringify(graph);
  const plan = model.planRecursiveTargets(['a'], (key) => graph[key] || []);

  assert.deepEqual(Array.from(plan), ['a', 'a1', 'a11', 'a2']);
  assert.equal(JSON.stringify(graph), before);
});

test('Shift brushing toggles each crossed peer repeatedly', () => {
  const model = loadModel();
  assert.deepEqual(Array.from(model.toggleSelectionKey(['a', 'b'], 'b')), ['a']);
  assert.deepEqual(Array.from(model.toggleSelectionKey(['a'], 'b')), ['a', 'b']);
});

test('immersive view always enters the explicitly clicked node while structural modes may use the batch', () => {
  const model = loadModel();
  assert.deepEqual(
    Array.from(model.planViewTargets('immersive', 'g/explore', ['g/other', 'g/explore'])),
    ['g/explore']
  );
  assert.deepEqual(
    Array.from(model.planViewTargets('nested', 'g/explore', ['g/other', 'g/explore'])),
    ['g/other', 'g/explore']
  );
  assert.deepEqual(Array.from(model.planViewTargets('nested', 'g/explore', [])), ['g/explore']);
});

test('cluster framing centres the opened domain and fits its radius into the safe viewport', () => {
  const model = loadModel();
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.clusterDomainFrame(
      { center: { x: 8, y: -3, z: 2 }, radius: 4 },
      { fov: Math.PI / 3, aspect: 16 / 9, minimumDistance: 0.1, maximumDistance: 100 }
    ))),
    { target: { x: 8, y: -3, z: 2 }, distance: 8.44902832960428 }
  );
});

test('PageDown plans every currently visible unopened portal once in A S or D mode', () => {
  const model = loadModel();
  const entries = [
    { key: 'root::a', childPath: 'root/a', portal: true },
    { key: 'root::b', childPath: 'root/b', portal: true },
    { key: 'root::value', childPath: 'root/value', portal: false }
  ];

  for (const mode of ['nested', 'peripheral', 'hierarchy']) {
    assert.deepEqual(
      Array.from(model.planContextLevelExpansion(entries, ['root/a'], mode)),
      ['root::b']
    );
  }
  assert.deepEqual(Array.from(model.planContextLevelExpansion(entries, [], 'immersive')), []);
});

test('PageUp closes only the deepest open layer inside the current context', () => {
  const model = loadModel();
  const paths = ['root/a', 'root/b', 'root/a/a1', 'elsewhere/x'];

  assert.deepEqual(
    Array.from(model.planContextLevelCollapse(paths, 'root', 'nested')),
    ['root/b', 'root/a/a1']
  );
  assert.deepEqual(Array.from(model.planContextLevelCollapse(paths, 'root', 'immersive')), []);
});

test('immersive entry frames every direct child inside the viewport with breathing room', () => {
  const model = loadModel();
  const frame = model.immersiveDomainFrame([
    { position: { x: -8, y: -2, z: 0 }, radius: 1 },
    { position: { x: 10, y: 4, z: 2 }, radius: 2 }
  ], { fov: Math.PI / 3, aspect: 16 / 9, minimumDistance: 0.04, fallbackDistance: 17.2 });

  assert.deepEqual(JSON.parse(JSON.stringify(frame.target)), { x: 1.5, y: 1.5, z: 1.5 });
  assert.ok(frame.distance > 17.2, 'wide children require a wider default frame');
});

test('an empty immersive domain receives the stable full-field fallback', () => {
  const model = loadModel();
  assert.deepEqual(JSON.parse(JSON.stringify(model.immersiveDomainFrame([], {
    fov: Math.PI / 3,
    aspect: 16 / 9,
    minimumDistance: 0.04,
    fallbackDistance: 17.2
  }))), {
    target: { x: 0, y: 0, z: 0 },
    distance: 17.2
  });
});
