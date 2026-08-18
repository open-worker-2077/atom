const test = require('node:test');
const assert = require('node:assert/strict');

const SpatialVisualModel = require('../spatial-visual-model.js');

test('derives a tunnel for seeded and empty nodes alike', () => {
  assert.equal(SpatialVisualModel.deriveCarrierMode({ hasChildren: true }), 'tunnel');
  assert.equal(SpatialVisualModel.deriveCarrierMode({ hasChildren: false }), 'tunnel');
  assert.equal(SpatialVisualModel.deriveCarrierMode({}), 'tunnel');
});

test('toggles a single node surface and returns its new state', () => {
  const node = { surfaceVisible: false };

  assert.equal(SpatialVisualModel.toggleNodeSurface(node), true);
  assert.equal(node.surfaceVisible, true);
  assert.equal(SpatialVisualModel.toggleNodeSurface(node), false);
  assert.equal(node.surfaceVisible, false);
});

test('middle-click detail presentation cycles name surface and floating modes', () => {
  const node = { detailMode: 'name', surfaceVisible: false };
  assert.equal(SpatialVisualModel.cycleNodeDetailMode(node), 'surface');
  assert.equal(node.surfaceVisible, true);
  assert.equal(SpatialVisualModel.cycleNodeDetailMode(node), 'floating');
  assert.equal(node.surfaceVisible, false);
  assert.equal(SpatialVisualModel.cycleNodeDetailMode(node), 'name');
  assert.equal(node.surfaceVisible, false);
});

test('legacy surfaceVisible state is accepted when detailMode is absent', () => {
  const node = { surfaceVisible: true };
  assert.equal(SpatialVisualModel.detailModeFor(node), 'surface');
  assert.equal(SpatialVisualModel.cycleNodeDetailMode(node), 'floating');
});

test('floating detail is the default when no presentation was persisted', () => {
  assert.equal(SpatialVisualModel.detailModeFor({}), 'floating');
  assert.equal(SpatialVisualModel.detailModeFor(null), 'floating');
  assert.equal(SpatialVisualModel.detailModeFor({ surfaceVisible: false }), 'floating');
});

test('toggles field surfaces to visible for mixed states then hidden for visible states', () => {
  const nodes = [{ surfaceVisible: true }, { surfaceVisible: false }];

  assert.equal(SpatialVisualModel.toggleFieldSurfaces(nodes), true);
  assert.deepEqual(nodes.map((node) => node.surfaceVisible), [true, true]);
  assert.equal(SpatialVisualModel.toggleFieldSurfaces(nodes), false);
  assert.deepEqual(nodes.map((node) => node.surfaceVisible), [false, false]);
});

test('caps an insertion vortex below one quarter of its carrier radius', () => {
  for (const radius of [4, 12, 40, 120]) {
    const vortexRadius = SpatialVisualModel.insertionVortexRadius(radius);
    assert.ok(vortexRadius > 0);
    assert.ok(vortexRadius <= radius * 0.25);
  }
  assert.ok(SpatialVisualModel.insertionVortexRadius(120) <= 12);
});

test('toggles only tunnels with seeded child content to one shared revealed state', () => {
  const tunnelA = { id: 'a', hasChildren: true, revealed: false };
  const tunnelB = { id: 'b', hasChildren: true, revealed: true };
  const emptyTunnel = { id: 'c', hasChildren: false, revealed: false };

  const opened = SpatialVisualModel.toggleFieldChildren([tunnelA, tunnelB, emptyTunnel]);
  assert.equal(opened.revealed, true);
  assert.deepEqual(opened.nodes, [tunnelA, tunnelB]);
  assert.deepEqual([tunnelA.revealed, tunnelB.revealed, emptyTunnel.revealed], [true, true, false]);

  const closed = SpatialVisualModel.toggleFieldChildren([tunnelA, tunnelB, emptyTunnel]);
  assert.equal(closed.revealed, false);
  assert.deepEqual([tunnelA.revealed, tunnelB.revealed, emptyTunnel.revealed], [false, false, false]);
});

test('resolves a descendant domain to its first visible portal', () => {
  const candidates = [
    { nodeId: 'portal-a', childPath: 'root/a' },
    { nodeId: 'portal-b', childPath: 'root/b' }
  ];

  assert.equal(
    SpatialVisualModel.descendantPortalId?.('root', 'root/a', candidates),
    'portal-a'
  );
  assert.equal(
    SpatialVisualModel.descendantPortalId?.('root', 'root/a/deeper', candidates),
    'portal-a'
  );
});

test('does not route ancestor or sibling domains through a local portal', () => {
  const candidates = [{ nodeId: 'local-child', childPath: 'root/current/child' }];

  assert.equal(
    SpatialVisualModel.descendantPortalId?.('root/current', 'root', candidates),
    null
  );
  assert.equal(
    SpatialVisualModel.descendantPortalId?.('root/current', 'root/sibling', candidates),
    null
  );
});

test('projects a descendant cross-domain relation onto its visible portal for layout tension', () => {
  const pair = SpatialVisualModel.visiblePortalRelationship(
    'root',
    {
      from: { path: 'root', nodeId: 'orbit' },
      to: { path: 'root/bench/detail', nodeId: 'remote-note' },
      label: '跨域关联'
    },
    [
      { nodeId: 'bench', childPath: 'root/bench' },
      { nodeId: 'scale', childPath: 'root/scale' }
    ]
  );

  assert.deepEqual(pair, {
    fromId: 'orbit',
    toId: 'bench',
    kind: 'association',
    label: '跨域关联'
  });
});

test('keeps a hierarchy pair when an explicit duplicate link exists', () => {
  const pairs = SpatialVisualModel.relationshipPairs([
    { id: 'parent' },
    { id: 'child', parent: 'parent', visualLinks: ['parent', 'parent'] }
  ]);

  assert.deepEqual(pairs, [{ fromId: 'parent', toId: 'child', kind: 'hierarchy', label: '子节点' }]);
});

test('returns an association for a valid explicit peer link', () => {
  const pairs = SpatialVisualModel.relationshipPairs([
    { id: 'alpha', visualLinks: ['beta'] },
    { id: 'beta' }
  ]);

  assert.deepEqual(pairs, [{ fromId: 'alpha', toId: 'beta', kind: 'association', label: '关联' }]);
});

test('labels explicit links between siblings as same-level relations', () => {
  const parent = { id: 'parent' };
  const first = { id: 'first', parent, visualLinks: ['second'] };
  const second = { id: 'second', parent };
  parent.satellites = [first, second];

  assert.deepEqual(SpatialVisualModel.relationshipPairs([parent]), [
    { fromId: 'parent', toId: 'first', kind: 'hierarchy', label: '子节点' },
    { fromId: 'parent', toId: 'second', kind: 'hierarchy', label: '子节点' },
    { fromId: 'first', toId: 'second', kind: 'association', label: '同层' }
  ]);
});

test('ignores self, missing, and malformed links', () => {
  const pairs = SpatialVisualModel.relationshipPairs([
    null,
    { id: '' },
    { id: 'alpha', parent: 'missing', visualLinks: ['alpha', 'missing', 42, null] },
    { id: 'beta', visualLinks: 'alpha' }
  ]);

  assert.deepEqual(pairs, []);
});

test('includes satellite parent relations without looping through cyclic satellites', () => {
  const root = { id: 'root' };
  const satellite = { id: 'satellite', parent: 'root', satellites: [root] };
  root.satellites = [satellite];

  assert.deepEqual(SpatialVisualModel.relationshipPairs([root]), [
    { fromId: 'root', toId: 'satellite', kind: 'hierarchy', label: '子节点' }
  ]);
});

test('returns a cycle-safe root-to-target node lineage', () => {
  const root = { id: 'root', parent: null };
  const child = { id: 'child', parent: root };
  const grandchild = { id: 'grandchild', parent: child };

  assert.deepEqual(
    SpatialVisualModel.nodeLineage(grandchild).map((node) => node.id),
    ['root', 'child', 'grandchild']
  );

  const cycle = { id: 'cycle' };
  cycle.parent = cycle;
  assert.deepEqual(
    SpatialVisualModel.nodeLineage(cycle).map((node) => node.id),
    ['cycle']
  );
});

test('deterministic tension layout repels overlaps while linked nodes stay bounded', () => {
  const entries = [
    { id: 'a', position: { x: 0, y: 0, z: 0 }, radius: 1, fixed: false },
    { id: 'b', position: { x: 0.2, y: 0, z: 0 }, radius: 1, fixed: false },
    { id: 'fixed', position: { x: 0, y: 4, z: 0 }, radius: 0.8, fixed: true }
  ];
  const original = JSON.parse(JSON.stringify(entries));
  const relationships = [
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'b', toId: 'fixed', kind: 'hierarchy' }
  ];
  const distance = (left, right) => Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z
  );

  const first = SpatialVisualModel.relaxRelationshipLayout(entries, relationships);
  const second = SpatialVisualModel.relaxRelationshipLayout(entries, relationships);

  assert.deepEqual(first, second, 'same visible topology produces the same stable field');
  assert.ok(distance(first.a, first.b) > 0.2, 'overlapping spheres repel');
  assert.ok(distance(first.a, first.b) < 9, 'relationship constraint prevents unbounded separation');
  assert.deepEqual(first.fixed, entries[2].position, 'manual/fixed anchors do not move');
  assert.deepEqual(entries, original, 'pure layout never mutates carrier data');
});

test('crossing association lines exert a deterministic untangling force', () => {
  const entries = [
    { id: 'a', position: { x: -3, y: -3, z: 0 }, radius: 0.4 },
    { id: 'b', position: { x: 3, y: 3, z: 0 }, radius: 0.4 },
    { id: 'c', position: { x: -3, y: 3, z: 0 }, radius: 0.4 },
    { id: 'd', position: { x: 3, y: -3, z: 0 }, radius: 0.4 }
  ];
  const links = [
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'c', toId: 'd', kind: 'association' }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, links, {
    planarRepulsion: true,
    edgeRepulsionStrength: 0.7,
    iterations: 24,
    anchorStrength: 0.01
  });
  const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const crosses = orient(layout.a, layout.b, layout.c) * orient(layout.a, layout.b, layout.d) < 0
    && orient(layout.c, layout.d, layout.a) * orient(layout.c, layout.d, layout.b) < 0;
  assert.equal(crosses, false);
});

test('an unrelated node is repelled from an association corridor instead of sitting on the line', () => {
  const entries = [
    { id: 'left', position: { x: -4, y: 0, z: 0 }, radius: 0.6 },
    { id: 'right', position: { x: 4, y: 0, z: 0 }, radius: 0.6 },
    { id: 'blocker', position: { x: 0, y: 0, z: 0 }, radius: 0.8 }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, [
    { fromId: 'left', toId: 'right', kind: 'association' }
  ], {
    iterations: 18,
    baseGap: 1,
    repulsionStrength: 0,
    fieldRepulsionStrength: 0,
    linkStrength: 0,
    anchorStrength: 0,
    nodeEdgeRepulsionStrength: 0.9,
    maxStep: 0.6,
    maxFieldRadius: 20,
    planarRepulsion: true
  });

  assert.ok(Math.abs(layout.blocker.y) > 1.05, 'the relation corridor remains visibly traceable');
});

test('dense domains keep carrier silhouettes separated in the primary viewing plane', () => {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    id: `dense-${index}`,
    position: {
      x: (index % 3) * 0.08,
      y: Math.floor(index / 3) * 0.08,
      z: (index - 4) * 0.72
    },
    radius: 0.82
  }));
  const relationships = entries.slice(1).map((entry, index) => ({
    fromId: entries[index].id,
    toId: entry.id,
    kind: 'association'
  }));
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships, {
    iterations: 28,
    baseGap: 1.06,
    radiusScale: 1.52,
    repulsionRangeScale: 1.5,
    repulsionStrength: 0.56,
    linkStrength: 0.19,
    anchorStrength: 0.018,
    maxStep: 0.52,
    maxFieldRadius: 12.4,
    planarRepulsion: true
  });

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = layout[entries[leftIndex].id];
      const right = layout[entries[rightIndex].id];
      assert.ok(
        Math.hypot(right.x - left.x, right.y - left.y) >= 2.72,
        `${entries[leftIndex].id} and ${entries[rightIndex].id} remain visually distinct`
      );
    }
  }
});

test('association links keep pulling connected nodes toward a readable rest length', () => {
  const entries = [
    { id: 'hub', position: { x: 0, y: 0, z: 0 }, radius: 0.5 },
    { id: 'east', position: { x: 4.6, y: 0, z: 0 }, radius: 0.5 },
    { id: 'north', position: { x: 0, y: 4.6, z: 0 }, radius: 0.5 },
    { id: 'west', position: { x: -4.6, y: 0, z: 0 }, radius: 0.5 }
  ];
  const relationships = ['east', 'north', 'west'].map((id) => ({
    fromId: 'hub',
    toId: id,
    kind: 'association'
  }));
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships, {
    iterations: 24,
    repulsionStrength: 0,
    anchorStrength: 0,
    linkStrength: 0.24
  });
  const distance = (left, right) => Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z
  );
  const linkedDistances = ['east', 'north', 'west'].map((id) => (
    distance(layout.hub, layout[id])
  ));

  assert.ok(
    Math.max(...linkedDistances) < 4.35,
    'connected nodes remain under active spring tension before the old maximum-length leash'
  );
});

test('long-range repulsion unfolds a branched relation instead of leaving a central knot', () => {
  const entries = [
    { id: 'hub', position: { x: 0, y: 0, z: 0 }, radius: 0.82 },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `arm-${index}`,
      position: { x: 0.12 + index * 0.03, y: (index % 2) * 0.04, z: index * 0.2 },
      radius: 0.82
    }))
  ];
  const relationships = entries.slice(1).map((entry) => ({
    fromId: 'hub', toId: entry.id, kind: 'association'
  }));
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships, {
    iterations: 32,
    baseGap: 1.08,
    radiusScale: 1.64,
    repulsionRangeScale: 2.2,
    repulsionStrength: 0.72,
    fieldRepulsionStrength: 0.38,
    linkStrength: 0.14,
    anchorStrength: 0.006,
    maxStep: 0.56,
    maxFieldRadius: 16.8,
    planarRepulsion: true
  });
  const arms = entries.slice(1).map((entry) => layout[entry.id]);
  const hub = layout.hub;
  const radialDistances = arms.map((point) => Math.hypot(point.x - hub.x, point.y - hub.y));
  let minimumArmDistance = Infinity;
  for (let left = 0; left < arms.length; left += 1) {
    for (let right = left + 1; right < arms.length; right += 1) {
      minimumArmDistance = Math.min(minimumArmDistance, Math.hypot(
        arms[left].x - arms[right].x,
        arms[left].y - arms[right].y
      ));
    }
  }

  assert.ok(Math.min(...radialDistances) > 4.2, 'every branch clears the hub');
  assert.ok(minimumArmDistance > 3.05, 'sibling branches spread into distinct directions');
});

test('long-range repulsion strength remains an explicit controllable field force', () => {
  const entries = [
    { id: 'left', position: { x: -4, y: 0, z: 0 }, radius: 0.82 },
    { id: 'right', position: { x: 4, y: 0, z: 0 }, radius: 0.82 }
  ];
  const baseOptions = {
    iterations: 32,
    repulsionRangeScale: 0,
    repulsionStrength: 0,
    linkStrength: 0,
    anchorStrength: 0,
    maxStep: 1,
    maxFieldRadius: 30,
    planarRepulsion: true
  };
  const weak = SpatialVisualModel.relaxRelationshipLayout(entries, [], {
    ...baseOptions,
    fieldRepulsionStrength: 0
  });
  const strong = SpatialVisualModel.relaxRelationshipLayout(entries, [], {
    ...baseOptions,
    fieldRepulsionStrength: 0.46
  });
  const distance = (layout) => Math.hypot(
    layout.right.x - layout.left.x,
    layout.right.y - layout.left.y
  );

  assert.ok(distance(strong) > distance(weak) + 0.55);
});

test('a committed two-node association seeds a visibly stretched constrained pair', () => {
  const entries = [
    { id: 'a', position: { x: -0.2, y: 0.1, z: 0 }, radius: 0.7 },
    { id: 'b', position: { x: 0.2, y: -0.1, z: 0 }, radius: 0.7 }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, [
    { fromId: 'a', toId: 'b', kind: 'association' }
  ]);
  const distance = Math.hypot(
    layout.a.x - layout.b.x,
    layout.a.y - layout.b.y,
    layout.a.z - layout.b.z
  );
  const midpoint = {
    x: (layout.a.x + layout.b.x) / 2,
    y: (layout.a.y + layout.b.y) / 2,
    z: (layout.a.z + layout.b.z) / 2
  };

  assert.ok(distance > 4, 'the relation becomes a readable stretched pair');
  assert.ok(Math.hypot(midpoint.x, midpoint.y, midpoint.z) < 0.15, 'pair remains centred');
});

test('open association chains relax toward a stretched line', () => {
  const entries = [
    { id: 'a', position: { x: -1, y: 1, z: 0 }, radius: 0.4 },
    { id: 'b', position: { x: 0, y: -1, z: 0.3 }, radius: 0.4 },
    { id: 'c', position: { x: 1, y: 1, z: -0.2 }, radius: 0.4 },
    { id: 'd', position: { x: 0.2, y: 0, z: 0 }, radius: 0.4 }
  ];
  const relationships = [
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'b', toId: 'c', kind: 'association' },
    { fromId: 'c', toId: 'd', kind: 'association' }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships);
  const vector = (from, to) => ({
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z
  });
  const crossLength = (left, right) => Math.hypot(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x
  );
  const axis = vector(layout.a, layout.d);
  const axisLength = Math.hypot(axis.x, axis.y, axis.z);
  const offsetB = crossLength(axis, vector(layout.a, layout.b)) / axisLength;
  const offsetC = crossLength(axis, vector(layout.a, layout.c)) / axisLength;

  assert.ok(axisLength > 5, 'repulsion stretches the open chain');
  assert.ok(offsetB < 0.75 && offsetC < 0.75, 'intermediate nodes stay near the open-chain axis');
});

test('long labels enlarge the same exclusion field so a readable chain does not collapse into text overlap', () => {
  const entries = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    position: { x: index * 0.1, y: 0, z: 0 },
    radius: 0.45,
    labelSpan: 4.2
  }));
  const relationships = [
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'b', toId: 'c', kind: 'association' },
    { fromId: 'c', toId: 'd', kind: 'association' }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships, {
    planarRepulsion: true,
    maxFieldRadius: 24
  });
  const adjacentDistance = (fromId, toId) => Math.hypot(
    layout[toId].x - layout[fromId].x,
    layout[toId].y - layout[fromId].y
  );

  assert.ok(adjacentDistance('a', 'b') > 4.2);
  assert.ok(adjacentDistance('b', 'c') > 4.2);
  assert.ok(adjacentDistance('c', 'd') > 4.2);
});

test('closed association chains relax into a balanced ring', () => {
  const entries = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    position: { x: index * 0.15, y: index % 2 ? 0.1 : -0.1, z: 0 },
    radius: 0.35
  }));
  const relationships = [
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'b', toId: 'c', kind: 'association' },
    { fromId: 'c', toId: 'd', kind: 'association' },
    { fromId: 'd', toId: 'a', kind: 'association' }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships);
  const points = Object.values(layout);
  const centre = points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
    z: sum.z + point.z / points.length
  }), { x: 0, y: 0, z: 0 });
  const radii = points.map((point) => Math.hypot(
    point.x - centre.x,
    point.y - centre.y,
    point.z - centre.z
  ));

  assert.ok(Math.min(...radii) > 1.2, 'closed loop is pushed outward');
  assert.ok(Math.max(...radii) - Math.min(...radii) < 0.65, 'closed loop keeps a balanced ring radius');
});

test('local child tension fields never exceed the parent radius', () => {
  const entries = [
    { id: 'parent', position: { x: 0, y: 0, z: 0 }, radius: 1, fixed: true },
    { id: 'a', position: { x: 3, y: 0, z: 0 }, radius: 0.2, parentId: 'parent', containerRadius: 1 },
    { id: 'b', position: { x: -3, y: 0, z: 0 }, radius: 0.2, parentId: 'parent', containerRadius: 1 },
    { id: 'c', position: { x: 0, y: 3, z: 0 }, radius: 0.2, parentId: 'parent', containerRadius: 1 }
  ];
  const relationships = [
    { fromId: 'parent', toId: 'a', kind: 'hierarchy' },
    { fromId: 'parent', toId: 'b', kind: 'hierarchy' },
    { fromId: 'parent', toId: 'c', kind: 'hierarchy' },
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'b', toId: 'c', kind: 'association' }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships);

  for (const id of ['a', 'b', 'c']) {
    assert.ok(Math.hypot(layout[id].x, layout[id].y, layout[id].z) <= 1.0001, `${id} stays inside parent radius`);
  }
});

test('fixed manual nodes remain inside the readable field envelope', () => {
  const layout = SpatialVisualModel.relaxRelationshipLayout([
    { id: 'clustered', position: { x: 0, y: 0, z: 0 }, radius: 0.4 },
    { id: 'escaped', position: { x: -100, y: 0, z: 0 }, radius: 0.4, fixed: true }
  ], [], {
    iterations: 1,
    maxFieldRadius: 12
  });

  assert.ok(
    Math.hypot(layout.escaped.x, layout.escaped.y, layout.escaped.z) <= 12.0001,
    'manual placement cannot make a node disappear outside its domain'
  );
});

test('child nodes never alter their parent-level topology', () => {
  const roots = [
    { id: 'root-a', position: { x: -1.2, y: 0.3, z: 0 }, radius: 0.6 },
    { id: 'root-b', position: { x: 0.1, y: -0.4, z: 0.2 }, radius: 0.55 },
    { id: 'root-c', position: { x: 1.1, y: 0.2, z: -0.1 }, radius: 0.5 }
  ];
  const rootRelationships = [
    { fromId: 'root-a', toId: 'root-b', kind: 'association' },
    { fromId: 'root-b', toId: 'root-c', kind: 'association' }
  ];
  const children = [
    {
      id: 'child-a',
      position: { x: -0.9, y: 0.4, z: 0 },
      radius: 0.22,
      parentId: 'root-b',
      containerRadius: 0.55
    },
    {
      id: 'child-b',
      position: { x: 0.25, y: -0.15, z: 0.1 },
      radius: 0.2,
      parentId: 'root-b',
      containerRadius: 0.55
    },
    {
      id: 'child-c',
      position: { x: 0.5, y: 0.15, z: -0.1 },
      radius: 0.18,
      parentId: 'root-b',
      containerRadius: 0.55
    }
  ];
  const expandedRelationships = rootRelationships.concat([
    { fromId: 'root-b', toId: 'child-a', kind: 'hierarchy' },
    { fromId: 'root-b', toId: 'child-b', kind: 'hierarchy' },
    { fromId: 'root-b', toId: 'child-c', kind: 'hierarchy' },
    { fromId: 'child-a', toId: 'child-b', kind: 'association' },
    { fromId: 'child-b', toId: 'child-c', kind: 'association' }
  ]);

  const rootOnly = SpatialVisualModel.relaxRelationshipLayout(roots, rootRelationships);
  const expanded = SpatialVisualModel.relaxRelationshipLayout(
    roots.concat(children),
    expandedRelationships
  );

  for (const root of roots) {
    assert.deepEqual(
      expanded[root.id],
      rootOnly[root.id],
      `${root.id} is unchanged when its children become visible`
    );
  }
});

test('a cycle with an attached chain keeps the loop open and sends the tail outward', () => {
  const entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({
    id,
    position: { x: (index % 3) - 1, y: Math.floor(index / 3) - 0.5, z: 0 },
    radius: 0.35
  }));
  const relationships = [
    { fromId: 'a', toId: 'b', kind: 'association' },
    { fromId: 'b', toId: 'c', kind: 'association' },
    { fromId: 'c', toId: 'd', kind: 'association' },
    { fromId: 'd', toId: 'a', kind: 'association' },
    { fromId: 'b', toId: 'e', kind: 'association' },
    { fromId: 'e', toId: 'f', kind: 'association' }
  ];
  const layout = SpatialVisualModel.relaxRelationshipLayout(entries, relationships);
  const cycle = ['a', 'b', 'c', 'd'].map((id) => layout[id]);
  const centre = cycle.reduce((sum, point) => ({
    x: sum.x + point.x / cycle.length,
    y: sum.y + point.y / cycle.length,
    z: sum.z + point.z / cycle.length
  }), { x: 0, y: 0, z: 0 });
  const radialDistance = (point) => Math.hypot(
    point.x - centre.x,
    point.y - centre.y,
    point.z - centre.z
  );

  assert.ok(Math.min(...cycle.map(radialDistance)) > 1.4, 'cycle remains visibly open');
  assert.ok(radialDistance(layout.e) > radialDistance(layout.b), 'first tail node extends outside its cycle anchor');
  assert.ok(radialDistance(layout.f) > radialDistance(layout.e), 'tail continues outward instead of folding back');
});

test('rehydrates a nested satellite entry from its deterministic id', () => {
  const root = { id: 'root:sphere-0', hasChildren: true, revealed: false, satellites: [] };
  const created = [];
  const ensureChildren = (parent) => {
    if (!parent.satellites.length) {
      const first = {
        id: `${parent.id}:sat-0`,
        hasChildren: true,
        revealed: false,
        satellites: [],
        parent
      };
      parent.satellites.push(first);
      created.push(first.id);
    }
    return parent.satellites;
  };

  const target = SpatialVisualModel.hydrateNodePath(
    [root],
    'root:sphere-0:sat-0:sat-0',
    ensureChildren,
    { revealAncestors: true }
  );

  assert.equal(target.id, 'root:sphere-0:sat-0:sat-0');
  assert.equal(root.revealed, true);
  assert.equal(root.satellites[0].revealed, true);
  assert.deepEqual(created, ['root:sphere-0:sat-0', 'root:sphere-0:sat-0:sat-0']);
});

test('restores bounded revealed ids after a domain has been rebuilt', () => {
  const root = { id: 'root:sphere-1', hasChildren: true, revealed: false, satellites: [] };
  const ensureChildren = (parent) => {
    if (!parent.satellites.length) {
      parent.satellites.push({
        id: `${parent.id}:sat-0`,
        hasChildren: true,
        revealed: false,
        satellites: [],
        parent
      });
    }
    return parent.satellites;
  };

  const restored = SpatialVisualModel.restoreRevealedNodes(
    [root],
    ['root:sphere-1', 'root:sphere-1:sat-0'],
    ensureChildren,
    32
  );

  assert.deepEqual(restored.map((node) => node.id), ['root:sphere-1', 'root:sphere-1:sat-0']);
  assert.equal(root.revealed, true);
  assert.equal(root.satellites[0].revealed, true);
  assert.equal(root.satellites[0].satellites.length, 1);
});

test('materializes hidden descendants without leaking ancestor expansion', () => {
  const root = { id: 'root:sphere-2', hasChildren: true, revealed: false, satellites: [] };
  const ensureChildren = (parent) => {
    if (!parent.satellites.length) {
      parent.satellites.push({
        id: `${parent.id}:sat-0`,
        hasChildren: true,
        revealed: false,
        satellites: [],
        parent
      });
    }
    return parent.satellites;
  };

  const child = SpatialVisualModel.hydrateNodePath(
    [root],
    'root:sphere-2:sat-0',
    ensureChildren,
    { revealAncestors: false }
  );

  child.revealed = true;
  assert.equal(root.revealed, false);
  assert.equal(child.revealed, true);
});

test('clears all snapshot-controlled flags before exact replay', () => {
  const child = {
    id: 'child', revealed: true, peekOpen: true, lensOpen: true, lensOpenedAt: 8,
    surfaceVisible: true, surfaceOpenedAt: 9, satellites: []
  };
  const root = {
    id: 'root', revealed: true, peekOpen: true, lensOpen: true, lensOpenedAt: 4,
    surfaceVisible: true, surfaceOpenedAt: 5, satellites: [child]
  };

  assert.equal(SpatialVisualModel.resetSnapshotNodeState([root]), 2);
  for (const node of [root, child]) {
    assert.equal(node.revealed, false);
    assert.equal(node.peekOpen, false);
    assert.equal(node.lensOpen, false);
    assert.equal(node.lensOpenedAt, 0);
    assert.equal(node.surfaceVisible, false);
    assert.equal(node.surfaceOpenedAt, 0);
  }
});
