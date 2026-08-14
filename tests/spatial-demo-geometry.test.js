const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGeometry() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  const file = path.join(__dirname, '..', 'spatial-demo-geometry.js');
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window.SpatialDemoGeometry;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('wand path gives one node a visible entry, hit and exit movement', () => {
  const geometry = loadGeometry();
  assert.ok(geometry, 'SpatialDemoGeometry must exist');
  const plan = geometry.planWandPath([{ key: 'a', x: 400, y: 260, radius: 20 }], {
    viewport: { width: 800, height: 520 }
  });

  assert.deepEqual(plain(plan.targetKeys), ['a']);
  assert.ok(plan.points.length >= 3);
  assert.ok(plan.points.some((point) => Math.hypot(point.x - 400, point.y - 260) <= 1));
  assert.notDeepEqual(plain(plan.points[0]), plain(plan.points.at(-1)));
});

test('sparse wand route visibly traverses every node without mutating the input', () => {
  const regions = [
    { key: 'c', x: 620, y: 410, radius: 16 },
    { key: 'a', x: 120, y: 110, radius: 16 },
    { key: 'b', x: 350, y: 210, radius: 16 }
  ];
  const before = JSON.stringify(regions);
  const geometry = loadGeometry();
  const plan = geometry.planWandPath(regions, { viewport: { width: 800, height: 520 } });

  assert.deepEqual([...plan.targetKeys].sort(), ['a', 'b', 'c']);
  for (const region of regions) {
    assert.ok(plan.points.some((point) => Math.hypot(point.x - region.x, point.y - region.y) <= 1));
  }
  assert.equal(JSON.stringify(regions), before);
});

test('dense wand route samples the full scene while retaining every execution target', () => {
  const regions = Array.from({ length: 40 }, (_, index) => ({
    key: `n${index}`,
    x: 60 + (index % 10) * 70,
    y: 50 + Math.floor(index / 10) * 130,
    radius: 8
  }));
  const geometry = loadGeometry();
  const plan = geometry.planWandPath(regions, {
    viewport: { width: 800, height: 520 },
    maxWaypoints: 12
  });

  assert.equal(plan.targetKeys.length, 40);
  assert.ok(plan.waypointKeys.length <= 12);
  const waypointRegions = regions.filter((region) => plan.waypointKeys.includes(region.key));
  assert.ok(Math.min(...waypointRegions.map((region) => region.x)) <= 130);
  assert.ok(Math.max(...waypointRegions.map((region) => region.x)) >= 620);
  assert.ok(Math.min(...waypointRegions.map((region) => region.y)) <= 80);
  assert.ok(Math.max(...waypointRegions.map((region) => region.y)) >= 400);
});

test('adaptive frame keeps measured content padded and enlarges sparse scenes', () => {
  const geometry = loadGeometry();
  const viewport = { width: 1200, height: 800 };
  const plan = geometry.planAdaptiveFrame(
    { minX: 510, maxX: 690, minY: 330, maxY: 470 },
    viewport,
    { currentDistance: 16, minDistance: 1, maxDistance: 160 }
  );

  assert.ok(plan.paddingRatio >= 0.12 && plan.paddingRatio <= 0.18);
  assert.ok(plan.distance < 16);
  assert.ok(plan.occupancy >= 0.52);
  assert.deepEqual(plain(plan.screenOffset), { x: 0, y: 0 });
});

test('adaptive frame zooms out only enough to keep wide content inside the viewport', () => {
  const geometry = loadGeometry();
  const plan = geometry.planAdaptiveFrame(
    { minX: -180, maxX: 1380, minY: -90, maxY: 890 },
    { width: 1200, height: 800 },
    { currentDistance: 16, minDistance: 1, maxDistance: 160 }
  );

  assert.ok(plan.distance > 16);
  assert.ok(plan.scaleFactor < 1);
  assert.ok(plan.occupancy <= 0.76);
});

test('adaptive frame has no arbitrary zoom cap for a tiny graph left by prior camera demonstrations', () => {
  const geometry = loadGeometry();
  const plan = geometry.planAdaptiveFrame(
    { minX: 594, maxX: 606, minY: 394, maxY: 406 },
    { width: 1200, height: 800 },
    { currentDistance: 40, minDistance: 0.2, maxDistance: 160 }
  );

  assert.ok(plan.distance < 2);
  assert.ok(plan.occupancy >= 0.65);
});
