const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadClusterField() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  const file = path.join(__dirname, '..', 'spatial-cluster-field.js');
  if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.window.SpatialClusterField;
}

function route(count) {
  return Array.from({ length: count }, (_, depth) => ({
    path: depth ? `root/${Array.from({ length: depth }, (__, index) => `d${index + 1}`).join('/')}` : 'root',
    depth,
    label: depth ? `第${depth}域` : '全域',
    active: depth === count - 1,
    nodes: Array.from({ length: depth + 2 }, (__, index) => ({
      id: `n${depth}-${index}`,
      label: `节点${depth}-${index}`,
      position: { x: index - depth / 2, y: (index % 2) - 0.5, z: index * 0.12 }
    }))
  }));
}

test('builds one stable active cluster with owned nodes and bounded translucent shell', () => {
  const field = loadClusterField();
  assert.ok(field, 'SpatialClusterField must exist');
  const first = field.buildScene(route(1));
  const second = field.buildScene(route(1));

  assert.equal(first.clusters.length, 1);
  assert.equal(first.corridors.length, 0);
  assert.equal(first.clusters[0].active, true);
  assert.ok(first.clusters[0].alpha >= 0.025 && first.clusters[0].alpha <= 0.075);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.ok(first.clusters[0].nodes.every((node) => node.ownerPath === 'root'));
});

test('authoritative id replacement keeps compact node placement through stable layout identity', () => {
  const field = loadClusterField();
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    id: `old-${index}`,
    layoutIdentity: `layout-${index}`,
    label: `节点 ${index}`,
    radius: 0.82,
    position: { x: 0, y: 0, z: 0 },
    __clusterLevel: 0
  }));
  const before = field.buildScene([
    { path: 'root', depth: 0, active: true, projectionMode: 'nested', nodes }
  ], { compact: true, compactPercent: 500 }).clusters[0].layoutNodes;
  const after = field.buildScene([
    {
      path: 'root', depth: 0, active: true, projectionMode: 'nested',
      nodes: nodes.map((node, index) => ({ ...node, id: index === 1 ? 'new-authoritative-id' : node.id }))
    }
  ], { compact: true, compactPercent: 500 }).clusters[0].layoutNodes;
  const placement = (items) => Object.fromEntries(items.map((node) => [
    node.layoutIdentity,
    { x: node.position.x, y: node.position.y, z: node.position.z }
  ]));

  assert.deepEqual(placement(after), placement(before));
});

test('dense cluster nodes repel in the visible plane instead of shrinking into a knot', () => {
  const field = loadClusterField();
  const sourceNodes = Array.from({ length: 12 }, (_, index) => ({
    id: `dense-${index}`,
    label: `Dense ${index}`,
    radius: 0.82,
    position: {
      x: (index % 3) * 0.03,
      y: Math.floor(index / 3) * 0.03,
      z: index * 0.25
    },
    __clusterLevel: 0
  }));
  const scene = field.buildScene([{ path: 'root', depth: 0, active: true, nodes: sourceNodes }]);
  const cluster = scene.clusters[0];

  for (let leftIndex = 0; leftIndex < cluster.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cluster.nodes.length; rightIndex += 1) {
      const left = cluster.nodes[leftIndex].position;
      const right = cluster.nodes[rightIndex].position;
      assert.ok(
        Math.hypot(right.x - left.x, right.y - left.y) >= 0.76,
        `${cluster.nodes[leftIndex].id} and ${cluster.nodes[rightIndex].id} do not overlap`
      );
    }
  }
  for (const node of cluster.nodes) {
    assert.ok(
      Math.hypot(node.position.x - cluster.center.x, node.position.y - cluster.center.y) <= cluster.radius - 0.3,
      `${node.id} stays inside its cluster shell`
    );
  }
  const radialDistances = cluster.nodes.map((node) => Math.hypot(
    node.position.x - cluster.center.x,
    node.position.y - cluster.center.y
  ));
  assert.ok(
    radialDistances.reduce((total, distance) => total + distance, 0) / radialDistances.length
      >= cluster.radius * 0.56,
    'repulsion uses the available shell instead of leaving a central knot'
  );
});

test('relationship chains enlarge their shell instead of being scaled down to fit it', () => {
  const field = loadClusterField();
  const sourceNodes = [-8, -4, 0, 4, 8].map((x, index) => ({
    id: `chain-${index}`,
    label: `Chain ${index}`,
    radius: 0.82,
    position: { x, y: 0, z: 0 },
    __clusterLevel: 0
  }));
  const scene = field.buildScene([{ path: 'root', depth: 0, active: true, nodes: sourceNodes }]);
  const cluster = scene.clusters[0];
  const xs = cluster.nodes.map((node) => node.position.x);

  assert.ok(cluster.radius > 9, 'shell grows beyond the former fixed cap');
  assert.equal(cluster.nodeScale, 1, 'the relationship chain keeps its world scale');
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 15.5, 'the chain remains visibly stretched');
  assert.ok(cluster.nodes.every((node) => (
    Math.hypot(node.position.x - cluster.center.x, node.position.y - cluster.center.y)
      <= cluster.radius - node.__clusterRadius
  )));
});

test('a displaced single node is centred without inflating its domain shell', () => {
  const field = loadClusterField();
  const scene = field.buildScene([{
    path: 'root',
    depth: 0,
    active: true,
    nodes: [{ id: 'solo', radius: 0.82, position: { x: 9, y: -7, z: 3 }, __clusterLevel: 0 }]
  }]);
  const cluster = scene.clusters[0];
  const node = cluster.nodes[0];

  assert.ok(cluster.radius < 3.2, 'absolute source offset does not enlarge the shell');
  assert.ok(Math.hypot(node.position.x - cluster.center.x, node.position.y - cluster.center.y) < 0.01);
});

test('a single nested branch tightly wraps its content instead of multiplying empty shell space', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      projectionMode: 'nested',
      nodes: [{ id: 'level-one', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    },
    {
      path: 'root/level-one',
      depth: 1,
      projectionMode: 'nested',
      parentPath: 'root',
      parentNodeId: 'level-one',
      nodes: [{ id: 'level-two', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    },
    {
      path: 'root/level-one/level-two',
      depth: 2,
      projectionMode: 'nested',
      parentPath: 'root/level-one',
      parentNodeId: 'level-two',
      nodes: [{ id: 'leaf', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    }
  ]);
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const middle = scene.clusters.find((cluster) => cluster.path === 'root/level-one');
  const leaf = scene.clusters.find((cluster) => cluster.path === 'root/level-one/level-two');

  assert.ok(leaf.radius < 1.6, 'a one-node leaf keeps a compact shell');
  assert.ok(middle.radius < leaf.radius + 1.1, 'one nesting level adds only a close wrapping margin');
  assert.ok(root.radius < middle.radius + 1.1, 'nested wrapping stays additive instead of multiplicative');
});

test('a child group carries its parent node detail for CapsLock floating presentation', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [{
        id: 'documented-group',
        label: 'Documented group',
        description: 'This detail belongs to the whole child group.',
        radius: 0.82,
        position: { x: 0, y: 0, z: 0 }
      }]
    },
    {
      path: 'root/documented-group',
      parentPath: 'root',
      parentNodeId: 'documented-group',
      depth: 1,
      projectionMode: 'nested',
      nodes: [{ id: 'leaf', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    }
  ], { compact: true, compactPercent: 100 });
  const child = scene.clusters.find((cluster) => cluster.path === 'root/documented-group');

  assert.equal(child.description, 'This detail belongs to the whole child group.');
});

test('compact S-mode packing fits more groups without letting carrier silhouettes overlap', () => {
  const field = loadClusterField();
  const nodes = Array.from({ length: 9 }, (_, index) => ({
    id: `s-mode-${index}`,
    radius: 0.82,
    position: {
      x: (index % 3 - 1) * 3.2,
      y: (Math.floor(index / 3) - 1) * 3.2,
      z: 0
    },
    __clusterLevel: 0
  }));
  const normal = field.buildScene([{ path: 'root', depth: 0, nodes }]).clusters[0];
  const compact = field.buildScene([{ path: 'root', depth: 0, nodes }], { compact: true }).clusters[0];

  assert.ok(compact.radius <= normal.radius * 0.8, 'S mode materially reduces each group footprint');
  for (let leftIndex = 0; leftIndex < compact.nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < compact.nodes.length; rightIndex += 1) {
      const left = compact.nodes[leftIndex];
      const right = compact.nodes[rightIndex];
      assert.ok(
        Math.hypot(right.position.x - left.position.x, right.position.y - left.position.y)
          >= left.__clusterRadius + right.__clusterRadius + 0.04,
        `${left.id} and ${right.id} retain distinct silhouettes`
      );
    }
  }
});

test('compact S plus End keeps nested groups inside their parents without inflating empty shells', () => {
  const field = loadClusterField();
  const domains = Array.from({ length: 8 }, (_, depth) => ({
    path: depth ? `root/${Array.from({ length: depth }, (__, index) => `s${index + 1}`).join('/')}` : 'root',
    parentPath: depth
      ? (depth === 1 ? 'root' : `root/${Array.from({ length: depth - 1 }, (__, index) => `s${index + 1}`).join('/')}`)
      : null,
    parentNodeId: depth ? `node-${depth - 1}` : null,
    depth,
    projectionMode: depth ? 'nested' : 'hierarchy',
    active: depth === 7,
    nodes: [{
      id: `node-${depth}`,
      radius: 0.82,
      position: { x: 0, y: 0, z: 0 },
      __clusterLevel: 0
    }]
  }));
  const scene = field.buildScene(domains, { compact: true });
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const deepest = scene.clusters.find((cluster) => cluster.depth === 7);

  assert.equal(scene.clusters.length, 8);
  assert.ok(root.radius < 3.2, 'recursive S expansion keeps the outer group bounded');
  assert.ok(deepest.nodeScale > 0, 'deep descendants retain a real rendered footprint');
  for (const cluster of scene.clusters.filter((candidate) => candidate.depth > 0)) {
    const parent = scene.clusters.find((candidate) => candidate.path === cluster.parentPath);
    assert.ok(parent, `${cluster.path} retains its visible parent`);
    assert.ok(
      Math.hypot(
        cluster.center.x - parent.center.x,
        cluster.center.y - parent.center.y,
        cluster.center.z - parent.center.z
      ) + cluster.radius <= parent.radius,
      `${cluster.path} remains fully inside its parent shell`
    );
  }
});

test('S repulsion interval leaves automatic packing intact while widening edge clearance', () => {
  const field = loadClusterField();
  const domains = Array.from({ length: 5 }, (_, depth) => ({
    path: depth ? `root/${Array.from({ length: depth }, (__, index) => `c${index + 1}`).join('/')}` : 'root',
    parentPath: depth
      ? (depth === 1 ? 'root' : `root/${Array.from({ length: depth - 1 }, (__, index) => `c${index + 1}`).join('/')}`)
      : null,
    parentNodeId: depth ? `compact-node-${depth - 1}` : null,
    depth,
    projectionMode: depth ? 'nested' : 'hierarchy',
    nodes: [{
      id: `compact-node-${depth}`,
      radius: 0.82,
      position: { x: 0, y: 0, z: 0 },
      __clusterLevel: 0
    }]
  }));
  const loose = field.buildScene(domains, { compact: true, compactPercent: 0 });
  const middle = field.buildScene(domains, { compact: true, compactPercent: 50 });
  const tight = field.buildScene(domains, { compact: true, compactPercent: 100 });
  assert.equal(loose.compressionMultiplier, 1);
  assert.equal(middle.compressionMultiplier, 1);
  assert.equal(tight.compressionMultiplier, 1);
  assert.ok(tight.clusters[0].radius >= middle.clusters[0].radius);
  assert.ok(middle.clusters[0].radius >= loose.clusters[0].radius);
});

test('adaptive shell contraction stops only at locally contacted node edges', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-cluster-field.js'), 'utf8');
  assert.match(source, /function contractShellToLocalEdges\(/);
  assert.match(source, /measuredClusterRadius\(layout, options\)/);
  assert.match(source, /minimumShellClearance\(options\)/);
});

test('S control changes only the edge repulsion interval, never the automatic packing multiplier', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-cluster-field.js'), 'utf8');
  assert.match(source, /function repulsionGapAmount\(/);
  assert.match(source, /function repulsionGap\(/);
  assert.match(source, /return 0\.5;[\s\S]{0,260}function repulsionGapAmount/);
});

test('S repulsion interval accepts a tenfold internal upper range without scene scaling', () => {
  const field = loadClusterField();
  const domains = Array.from({ length: 5 }, (_, depth) => ({
    path: depth ? `root/${Array.from({ length: depth }, (__, index) => `x${index + 1}`).join('/')}` : 'root',
    parentPath: depth
      ? (depth === 1 ? 'root' : `root/${Array.from({ length: depth - 1 }, (__, index) => `x${index + 1}`).join('/')}`)
      : null,
    parentNodeId: depth ? `extended-node-${depth - 1}` : null,
    depth,
    projectionMode: depth ? 'nested' : 'hierarchy',
    nodes: [{
      id: `extended-node-${depth}`,
      radius: 0.82,
      position: { x: 0, y: 0, z: 0 },
      __clusterLevel: 0
    }]
  }));
  const standard = field.buildScene(domains, { compact: true, compactPercent: 100 });
  const beyondLimit = field.buildScene(domains, { compact: true, compactPercent: 1000 });

  assert.equal(standard.compressionMultiplier, 1);
  assert.equal(beyondLimit.compressionMultiplier, 1);
  assert.ok(beyondLimit.bounds.radius > standard.bounds.radius * 2);
  for (const scene of [standard, beyondLimit]) {
    for (const cluster of scene.clusters.filter((candidate) => candidate.depth > 0)) {
      const parent = scene.clusters.find((candidate) => candidate.path === cluster.parentPath);
      assert.ok(
        Math.hypot(
          cluster.center.x - parent.center.x,
          cluster.center.y - parent.center.y,
          cluster.center.z - parent.center.z
        ) + cluster.radius <= parent.radius + 0.000001,
        `${cluster.path} remains inside its parent after automatic compaction`
      );
    }
  }
});

test('tenfold internal setting expands the real nested edge interval without scaling node sizes', () => {
  const field = loadClusterField();
  const domains = Array.from({ length: 5 }, (_, depth) => ({
    path: depth
      ? `root/${Array.from({ length: depth }, (__, index) => `compact-${index + 1}`).join('/')}`
      : 'root',
    parentPath: depth
      ? (depth === 1
        ? 'root'
        : `root/${Array.from({ length: depth - 1 }, (__, index) => `compact-${index + 1}`).join('/')}`)
      : null,
    parentNodeId: depth ? `node-${depth - 1}` : null,
    depth,
    projectionMode: depth ? 'nested' : 'hierarchy',
    nodes: [{ id: `node-${depth}`, radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
  }));
  const standard = field.buildScene(domains, { compact: true, compactPercent: 100 });
  const tenfold = field.buildScene(domains, { compact: true, compactPercent: 1000 });
  const nestingSlackRatio = (scene, childPath) => {
    const child = scene.clusters.find((cluster) => cluster.path === childPath);
    const parent = scene.clusters.find((cluster) => cluster.path === child.parentPath);
    const centerDistance = Math.hypot(
      child.center.x - parent.center.x,
      child.center.y - parent.center.y,
      child.center.z - parent.center.z
    );
    return (parent.radius - centerDistance - child.radius) / parent.radius;
  };

  const standardSlack = nestingSlackRatio(standard, 'root/compact-1');
  const tenfoldSlack = nestingSlackRatio(tenfold, 'root/compact-1');
  assert.ok(
    tenfoldSlack > standardSlack,
    '10× should spend most empty parent-child ring space before shrinking readable content'
  );
  assert.ok(
    tenfold.bounds.radius > standard.bounds.radius,
    'the tighter nesting still preserves the advertised tenfold scene range'
  );
  for (const child of tenfold.clusters.filter((cluster) => cluster.parentPath)) {
    const parent = tenfold.clusters.find((cluster) => cluster.path === child.parentPath);
    assert.ok(
      Math.hypot(
        child.center.x - parent.center.x,
        child.center.y - parent.center.y,
        child.center.z - parent.center.z
      ) + child.radius <= parent.radius + 0.000001,
      `${child.path} remains contained after slack compression`
    );
  }
});

test('adaptive S packing compresses a dense child more than a sparse child without crossing siblings', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [
        { id: 'sparse-mother', radius: 0.82, position: { x: -0.02, y: 0, z: 0 } },
        { id: 'dense-mother', radius: 0.82, position: { x: 0.02, y: 0, z: 0 } },
        { id: 'plain-sibling', radius: 0.82, position: { x: 0, y: 0.02, z: 0 } }
      ]
    },
    {
      path: 'root/sparse',
      parentPath: 'root',
      parentNodeId: 'sparse-mother',
      depth: 1,
      projectionMode: 'nested',
      nodes: [{ id: 'sparse-leaf', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    },
    {
      path: 'root/dense',
      parentPath: 'root',
      parentNodeId: 'dense-mother',
      depth: 1,
      projectionMode: 'nested',
      nodes: Array.from({ length: 14 }, (_, index) => ({
        id: `dense-leaf-${index}`,
        radius: 0.82,
        position: { x: (index % 4) * 0.02, y: Math.floor(index / 4) * 0.02, z: 0 }
      }))
    }
  ], { compact: true, compactPercent: 50 });
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const sparse = scene.clusters.find((cluster) => cluster.path === 'root/sparse');
  const dense = scene.clusters.find((cluster) => cluster.path === 'root/dense');
  const plain = root.nodes.find((node) => node.id === 'plain-sibling');

  assert.ok(dense.nodeScale < sparse.nodeScale, 'content pressure determines scale instead of depth alone');
  assert.ok(
    Math.hypot(dense.center.x - sparse.center.x, dense.center.y - sparse.center.y)
      >= dense.radius + sparse.radius,
    'unequal nested groups remain mutually exclusive'
  );
  for (const child of [sparse, dense]) {
    assert.ok(
      Math.hypot(child.center.x - plain.position.x, child.center.y - plain.position.y)
        >= child.radius + plain.__clusterRadius,
      `${child.path} stays outside an ordinary sibling node`
    );
    assert.ok(
      Math.hypot(child.center.x - root.center.x, child.center.y - root.center.y)
        + child.radius < root.radius,
      `${child.path} remains contained by the root shell`
    );
  }
});

test('S repulsion interval preserves collision constraints at every preference', () => {
  const field = loadClusterField();
  const nodes = [
    { id: 'far-left', radius: 0.82, position: { x: -18, y: 0, z: 0 } },
    { id: 'centre', radius: 0.82, position: { x: 0, y: 0, z: 0 } },
    { id: 'far-right', radius: 0.82, position: { x: 18, y: 0, z: 0 } }
  ];
  const loose = field.buildScene([{ path: 'root', depth: 0, nodes }], {
    compact: true,
    compactPercent: 0
  }).clusters[0];

  for (const compactPercent of [25, 50, 75, 100]) {
    const cluster = field.buildScene([{ path: 'root', depth: 0, nodes }], {
      compact: true,
      compactPercent
    }).clusters[0];
    assert.ok(cluster.radius >= loose.radius, `${compactPercent}% widens only the edge interval`);
    for (let leftIndex = 0; leftIndex < cluster.nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < cluster.nodes.length; rightIndex += 1) {
        const left = cluster.nodes[leftIndex];
        const right = cluster.nodes[rightIndex];
        assert.ok(
          Math.hypot(right.position.x - left.position.x, right.position.y - left.position.y)
            >= left.__clusterRadius + right.__clusterRadius,
          `${compactPercent}% keeps ${left.id} and ${right.id} exclusive`
        );
      }
    }
  }
});

test('deep adaptive S layout keeps dense leaf nodes inside their real rendered shell', () => {
  const field = loadClusterField();
  const domains = Array.from({ length: 6 }, (_, depth) => ({
    path: depth ? `root/${Array.from({ length: depth }, (__, index) => `deep-${index + 1}`).join('/')}` : 'root',
    parentPath: depth
      ? (depth === 1 ? 'root' : `root/${Array.from({ length: depth - 1 }, (__, index) => `deep-${index + 1}`).join('/')}`)
      : null,
    parentNodeId: depth ? `deep-node-${depth - 1}` : null,
    depth,
    projectionMode: depth ? 'nested' : 'hierarchy',
    nodes: depth === 5
      ? Array.from({ length: 6 }, (__, index) => ({
          id: `leaf-${index}`,
          radius: 0.82,
          position: { x: 0, y: 0, z: 0 }
        }))
      : [{
          id: `deep-node-${depth}`,
          radius: 0.82,
          position: { x: 0, y: 0, z: 0 }
        }]
  }));
  const scene = field.buildScene(domains, { compact: true, compactPercent: 100 });
  const leaf = scene.clusters.find((cluster) => cluster.depth === 5);

  for (let leftIndex = 0; leftIndex < leaf.nodes.length; leftIndex += 1) {
    const left = leaf.nodes[leftIndex];
    assert.ok(
      Math.hypot(
        left.position.x - leaf.center.x,
        left.position.y - leaf.center.y,
        left.position.z - leaf.center.z
      ) + left.__clusterRadius < leaf.radius,
      `${left.id} remains inside its own shell`
    );
    for (let rightIndex = leftIndex + 1; rightIndex < leaf.nodes.length; rightIndex += 1) {
      const right = leaf.nodes[rightIndex];
      assert.ok(
        Math.hypot(right.position.x - left.position.x, right.position.y - left.position.y)
          >= left.__clusterRadius + right.__clusterRadius,
        `${left.id} and ${right.id} use the same non-overlapping radius that the renderer receives`
      );
    }
  }
});

test('tenfold adaptive compactness keeps eighteen unequal nested groups mutually exclusive', () => {
  const field = loadClusterField();
  const rootNodes = Array.from({ length: 18 }, (_, index) => ({
    id: `adaptive-mother-${index}`,
    radius: 0.62 + index % 4 * 0.08,
    position: { x: (index % 6) * 0.002, y: Math.floor(index / 6) * 0.002, z: 0 }
  }));
  const scene = field.buildScene([
    { path: 'root', depth: 0, nodes: rootNodes },
    ...rootNodes.map((mother, index) => ({
      path: `root/${mother.id}`,
      parentPath: 'root',
      parentNodeId: mother.id,
      depth: 1,
      projectionMode: 'nested',
      nodes: Array.from({ length: 1 + index % 9 }, (__, childIndex) => ({
        id: `${mother.id}-leaf-${childIndex}`,
        radius: 0.52 + childIndex % 3 * 0.15,
        position: { x: 0, y: 0, z: 0 }
      }))
    }))
  ], { compact: true, compactPercent: 1000 });
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const children = scene.clusters.filter((cluster) => cluster.parentPath === 'root');

  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    const left = children[leftIndex];
    assert.ok(
      Math.hypot(left.center.x - root.center.x, left.center.y - root.center.y)
        + left.radius < root.radius,
      `${left.path} remains inside root`
    );
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      const right = children[rightIndex];
      assert.ok(
        Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y)
          >= left.radius + right.radius,
        `${left.path} and ${right.path} do not intersect`
      );
    }
  }
});

test('automatic packing preserves a feasible locked node and routes other nodes around it', () => {
  const field = loadClusterField();
  const scene = field.buildScene([{
    path: 'root',
    depth: 0,
    nodes: [
      {
        id: 'locked',
        radius: 0.82,
        position: { x: 4, y: -3, z: 0 },
        clusterLocalPositionLocked: true
      },
      { id: 'free-a', radius: 0.82, position: { x: 4, y: -3, z: 0 } },
      { id: 'free-b', radius: 0.82, position: { x: 4, y: -3, z: 0 } }
    ]
  }], { compact: true, compactPercent: 100 });
  const cluster = scene.clusters[0];
  const locked = cluster.nodes.find((node) => node.id === 'locked');

  assert.deepEqual(
    JSON.parse(JSON.stringify(locked.position)),
    { x: 4, y: -3, z: 0 }
  );
  for (const node of cluster.nodes.filter((candidate) => candidate.id !== 'locked')) {
    assert.ok(
      Math.hypot(node.position.x - locked.position.x, node.position.y - locked.position.y)
        >= node.__clusterRadius + locked.__clusterRadius,
      `${node.id} moves around the locked node`
    );
  }
});

test('S mode repacks locked nested carriers instead of leaving a hollow parent shell', () => {
  const field = loadClusterField();
  const childNodes = Array.from({ length: 8 }, (_, index) => ({
    id: `leaf-${index}`,
    radius: 0.82,
    position: { x: (index % 4) * 0.01, y: Math.floor(index / 4) * 0.01, z: 0 }
  }));
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [
        { id: 'left', radius: 0.82, position: { x: -20, y: -20, z: 0 }, clusterLocalPositionLocked: true },
        { id: 'right', radius: 0.82, position: { x: 20, y: 20, z: 0 }, clusterLocalPositionLocked: true }
      ]
    },
    { path: 'root/left', depth: 1, parentPath: 'root', parentNodeId: 'left', projectionMode: 'nested', nodes: childNodes },
    { path: 'root/right', depth: 1, parentPath: 'root', parentNodeId: 'right', projectionMode: 'nested', nodes: childNodes }
  ], { compact: true, compactPercent: 0 });
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const children = scene.clusters.filter((cluster) => cluster.parentPath === 'root');

  assert.ok(root.radius < 8, 'S mode must ignore stale carrier coordinates when packing nested groups');
  assert.ok(Math.hypot(
    children[0].center.x - children[1].center.x,
    children[0].center.y - children[1].center.y
  ) >= children[0].radius + children[1].radius, 'repacked child shells remain mutually exclusive');
});

test('S mode removes inherited coordinate gaps between already-visible nested groups', () => {
  const field = loadClusterField();
  const childNodes = Array.from({ length: 8 }, (_, index) => ({
    id: `visible-leaf-${index}`,
    radius: 0.82,
    position: { x: (index % 4) * 0.01, y: Math.floor(index / 4) * 0.01, z: 0 }
  }));
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [
        { id: 'upper', radius: 0.82, position: { x: -20, y: -20, z: 0 } },
        { id: 'lower', radius: 0.82, position: { x: 20, y: 20, z: 0 } }
      ]
    },
    { path: 'root/upper', depth: 1, parentPath: 'root', parentNodeId: 'upper', projectionMode: 'nested', nodes: childNodes },
    { path: 'root/lower', depth: 1, parentPath: 'root', parentNodeId: 'lower', projectionMode: 'nested', nodes: childNodes }
  ], { compact: true, compactPercent: 0 });
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const children = scene.clusters.filter((cluster) => cluster.parentPath === 'root');
  const edgeGap = Math.hypot(
    children[0].center.x - children[1].center.x,
    children[0].center.y - children[1].center.y
  ) - children[0].radius - children[1].radius;

  assert.ok(edgeGap >= 0.035 && edgeGap < 0.3, 'visible nested groups settle at the repulsion interval');
  assert.ok(root.radius < 5.2, 'the parent shell contracts around the settled child edges');
});

test('S mode packs an incomplete row into a compact disk instead of a wide strip', () => {
  const field = loadClusterField();
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    id: `disk-${index}`,
    radius: 0.82,
    position: { x: index * 5, y: (index % 2) * 5, z: 0 }
  }));
  const cluster = field.buildScene([{ path: 'root', depth: 0, nodes }], {
    compact: true,
    compactPercent: 0
  }).clusters[0];

  assert.ok(cluster.radius < 3.25, 'five equal nodes should form a near-round compact field');
});

test('an explicitly placed workspace node keeps its click-local nested-field offset', () => {
  const field = loadClusterField();
  const scene = field.buildScene([{
    path: 'root/manual',
    depth: 1,
    active: true,
    projectionMode: 'nested',
    nodes: [{
      id: 'manual',
      radius: 0.82,
      position: { x: 4.2, y: -2.6, z: 0 },
      clusterLocalPositionLocked: true,
      isWorkspaceNode: true,
      __clusterLevel: 0
    }]
  }]);
  const cluster = scene.clusters[0];
  const node = cluster.nodes[0];

  assert.ok(node.position.x - cluster.center.x > 3.5);
  assert.ok(node.position.y - cluster.center.y < -2);
});

test('keeps three route domains separate and corridors visual-only', () => {
  const field = loadClusterField();
  const scene = field.buildScene(route(3));

  assert.deepEqual(JSON.parse(JSON.stringify(scene.clusters.map((cluster) => cluster.path))), ['root', 'root/d1', 'root/d1/d2']);
  assert.equal(scene.clusters.filter((cluster) => cluster.active).length, 1);
  assert.equal(scene.clusters.at(-1).alpha > scene.clusters[0].alpha, true);
  for (let index = 1; index < scene.clusters.length; index += 1) {
    const left = scene.clusters[index - 1];
    const right = scene.clusters[index];
    const distance = Math.hypot(
      right.center.x - left.center.x,
      right.center.y - left.center.y,
      right.center.z - left.center.z
    );
    assert.ok(distance > left.radius + right.radius, 'cluster shells must not overlap');
  }
  assert.equal(scene.corridors.length, 2);
  assert.ok(scene.corridors.every((corridor) => corridor.visualOnly === true && corridor.kind === 'domain-corridor'));
  assert.equal('edges' in scene, false);
});

test('peripheral projection places a child domain around its mother instead of on a hierarchy layer', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      active: true,
      nodes: [{ id: 'mother', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    },
    {
      path: 'root/child',
      parentPath: 'root',
      parentNodeId: 'mother',
      projectionMode: 'peripheral',
      depth: 1,
      nodes: [{ id: 'child', radius: 0.82, position: { x: 0, y: 0, z: 0 } }]
    }
  ]);
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const child = scene.clusters.find((cluster) => cluster.path === 'root/child');
  const mother = root.layoutNodes.find((node) => node.id === 'mother');

  assert.equal(child.projectionMode, 'peripheral');
  assert.ok(Math.hypot(
    child.center.x - mother.position.x,
    child.center.y - mother.position.y
  ) >= child.radius + mother.__clusterRadius);
});

test('repels a peripheral group shell from its large owning group shell', () => {
  const field = loadClusterField();
  const denseNodes = Array.from({ length: 16 }, (_, index) => ({
    id: `node-${index}`,
    radius: 0.82,
    position: {
      x: (index % 4 - 1.5) * 0.1,
      y: (Math.floor(index / 4) - 1.5) * 0.1,
      z: 0
    }
  }));
  const scene = field.buildScene([
    { path: 'root', depth: 0, nodes: denseNodes },
    {
      path: 'root/peripheral',
      depth: 1,
      parentPath: 'root',
      parentNodeId: 'node-0',
      projectionMode: 'peripheral',
      nodes: denseNodes
    }
  ], { compact: true, compactPercent: 50 });
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const peripheral = scene.clusters.find((cluster) => cluster.path === 'root/peripheral');
  const clearance = Math.hypot(
    peripheral.center.x - root.center.x,
    peripheral.center.y - root.center.y,
    peripheral.center.z - root.center.z
  ) - root.radius - peripheral.radius;

  assert.ok(clearance >= 0.16, 'peripheral group shell must respect the configured mutual-repulsion interval');
});

test('retains all nine real route layers while budgeting distant node detail', () => {
  const field = loadClusterField();
  const scene = field.buildScene(route(9), { maxDetailedClusters: 4 });

  assert.equal(scene.clusters.length, 9);
  assert.equal(scene.corridors.length, 8);
  assert.equal(scene.clusters.at(-1).path, 'root/d1/d2/d3/d4/d5/d6/d7/d8');
  assert.equal(scene.clusters.filter((cluster) => cluster.lightweight).length, 5);
  assert.ok(scene.clusters.slice(-4).every((cluster) => cluster.lightweight === false));
  assert.ok(scene.bounds.radius > 0);
});

test('S overview keeps real nodes in every opened domain instead of applying the distant-detail budget', () => {
  const field = loadClusterField();
  const scene = field.buildScene(route(11), { compact: true, maxDetailedClusters: 9 });

  assert.equal(scene.clusters.length, 11);
  assert.equal(scene.clusters.filter((cluster) => cluster.lightweight).length, 0);
  assert.ok(scene.clusters.every((cluster) => cluster.nodes.length > 0));
});

test('centres the complete hierarchy bounds without changing the camera', () => {
  const field = loadClusterField();
  const scene = field.buildScene(route(4));

  assert.ok(Math.abs(scene.bounds.center.x) < 1e-9);
  assert.ok(Math.abs(scene.bounds.center.y) < 1e-9);
  assert.ok(Math.abs(scene.bounds.center.z) < 1e-9);
  assert.ok(Math.abs(scene.bounds.minimum.y + scene.bounds.maximum.y) < 1e-9);
});

test('places three child domains on one explicit next-depth layer without overlap', () => {
  const field = loadClusterField();
  const rootNodes = ['a', 'b', 'c'].map((id, index) => ({
    id,
    label: id.toUpperCase(),
    radius: 0.82,
    position: { x: (index - 1) * 2.4, y: 0, z: 0 }
  }));
  const scene = field.buildScene([
    { path: 'root', depth: 0, label: '全域', active: true, nodes: rootNodes },
    ...rootNodes.map((node) => ({
      path: `root/${node.id}`,
      depth: 1,
      parentPath: 'root',
      parentNodeId: node.id,
      label: `${node.label} 子域`,
      nodes: [{ id: `${node.id}-1`, label: '子节点', position: { x: 0, y: 0, z: 0 } }]
    }))
  ]);

  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const children = scene.clusters.filter((cluster) => cluster.depth === 1);
  assert.equal(children.length, 3);
  assert.ok(children.every((cluster) => cluster.depth === root.depth + 1));
  assert.ok(children.every((cluster) => cluster.center.y === children[0].center.y));
  assert.ok(children.every((cluster) => cluster.center.z === children[0].center.z));
  assert.ok(children.every((cluster) => cluster.center.y < root.center.y));
  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      const left = children[leftIndex];
      const right = children[rightIndex];
      assert.ok(
        Math.hypot(right.center.x - left.center.x, right.center.y - left.center.y, right.center.z - left.center.z)
          > left.radius + right.radius,
        'same-depth child shells must not overlap'
      );
    }
  }
});

test('anchors every child corridor to its mother node edge instead of the parent cluster center', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [{ id: 'mother', label: '母节点', radius: 0.82, position: { x: 2.4, y: 0, z: 0 } }]
    },
    {
      path: 'root/mother',
      depth: 1,
      parentPath: 'root',
      parentNodeId: 'mother',
      nodes: [{ id: 'child', label: '子节点', position: { x: 0, y: 0, z: 0 } }]
    }
  ]);

  const parent = scene.clusters.find((cluster) => cluster.path === 'root');
  const child = scene.clusters.find((cluster) => cluster.path === 'root/mother');
  const mother = parent.nodes.find((node) => node.id === 'mother');
  const corridor = scene.corridors[0];
  assert.equal(corridor.fromNodeId, 'mother');
  assert.notDeepEqual(corridor.from, parent.center);
  assert.ok(Math.hypot(
    corridor.from.x - mother.position.x,
    corridor.from.y - mother.position.y,
    corridor.from.z - mother.position.z
  ) < 0.9, 'corridor starts at the mother sphere edge');
  assert.ok(Math.abs(Math.hypot(
    corridor.to.x - child.center.x,
    corridor.to.y - child.center.y,
    corridor.to.z - child.center.z
  ) - child.radius) < 1e-6, 'corridor ends at the child shell edge');
});

test('orders sibling child clusters by mother-node position so domain corridors do not cross', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [
        { id: 'a-right', label: 'Right', radius: 0.82, position: { x: 3, y: 0, z: 0 } },
        { id: 'z-left', label: 'Left', radius: 0.82, position: { x: -3, y: 0, z: 0 } }
      ]
    },
    {
      path: 'root/right',
      depth: 1,
      parentPath: 'root',
      parentNodeId: 'a-right',
      nodes: [{ id: 'right-child', position: { x: 0, y: 0, z: 0 } }]
    },
    {
      path: 'root/left',
      depth: 1,
      parentPath: 'root',
      parentNodeId: 'z-left',
      nodes: [{ id: 'left-child', position: { x: 0, y: 0, z: 0 } }]
    }
  ]);

  assert.equal(scene.corridors.length, 2);
  const [first, second] = scene.corridors;
  const startOrder = Math.sign(first.from.x - second.from.x);
  const endOrder = Math.sign(first.to.x - second.to.x);
  assert.ok(
    startOrder === 0 || endOrder === 0 || startOrder === endOrder,
    'child cluster order must preserve mother-node order across adjacent depth layers'
  );
});

test('revealed satellite detail does not resize or reposition its owning domain shell', () => {
  const field = loadClusterField();
  const primaryNodes = [
    { id: 'a', position: { x: -2, y: 0, z: 0 }, __clusterLevel: 0 },
    { id: 'b', position: { x: 0, y: 1, z: 0 }, __clusterLevel: 0 },
    { id: 'c', position: { x: 2, y: 0, z: 0 }, __clusterLevel: 0 }
  ];
  const base = field.buildScene([{ path: 'root', depth: 0, active: true, nodes: primaryNodes }]);
  const detailed = field.buildScene([{
    path: 'root',
    depth: 0,
    active: true,
    nodes: [
      ...primaryNodes,
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `sat-${index}`,
        position: { x: -2 + (index % 4) * 0.25, y: (index % 3) * 0.18, z: 0 },
        __clusterLevel: 1
      }))
    ]
  }]);

  assert.equal(detailed.clusters[0].radius, base.clusters[0].radius);
  assert.deepEqual(
    JSON.parse(JSON.stringify(detailed.clusters[0].center)),
    JSON.parse(JSON.stringify(base.clusters[0].center))
  );
});

test('dense primary nodes keep their readable scale and expand the shell around repulsion', () => {
  const field = loadClusterField();
  const nodes = Array.from({ length: 18 }, (_, index) => ({
    id: `readable-${index}`,
    radius: 0.82,
    __clusterLevel: 0,
    position: { x: (index % 3) * 0.02, y: Math.floor(index / 3) * 0.02, z: 0 }
  }));
  const cluster = field.buildScene([{ path: 'root', depth: 0, nodes }]).clusters[0];

  assert.equal(cluster.nodeScale, 1);
  assert.ok(cluster.radius >= 6.4, 'the shell grows instead of miniaturising eighteen carriers');
  assert.ok(cluster.nodes.every((node) => node.__clusterRadius >= 0.8));
});

test('nested projection grows the parent shell and keeps the child domain inside its mother node', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      projectionMode: 'nested',
      nodes: [
        { id: 'mother', radius: 0.82, position: { x: 0, y: 0, z: 0 } },
        { id: 'sibling', radius: 0.82, position: { x: 3, y: 0, z: 0 } }
      ]
    },
    {
      path: 'root/mother',
      depth: 1,
      projectionMode: 'nested',
      parentPath: 'root',
      parentNodeId: 'mother',
      nodes: Array.from({ length: 8 }, (_, index) => ({
        id: `child-${index}`,
        radius: 0.82,
        position: { x: (index % 4) * 0.04, y: Math.floor(index / 4) * 0.04, z: 0 }
      }))
    }
  ]);
  const parent = scene.clusters.find((cluster) => cluster.path === 'root');
  const child = scene.clusters.find((cluster) => cluster.path === 'root/mother');

  assert.equal(child.projectionMode, 'nested');
  assert.ok(Math.hypot(
    child.center.x - parent.center.x,
    child.center.y - parent.center.y,
    child.center.z - parent.center.z
  ) + child.radius < parent.radius, 'the nested child shell is fully contained');
  assert.equal(scene.corridors.some((corridor) => corridor.toPath === child.path), false);
});

test('nested child shell replaces its mother as a peer-sized carrier and contains only child-domain nodes', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [
        { id: 'mother', radius: 0.82, position: { x: 0, y: 0, z: 0 } },
        { id: 'sibling-a', radius: 0.82, position: { x: 0.1, y: 0, z: 0 } },
        { id: 'sibling-b', radius: 0.82, position: { x: -0.1, y: 0, z: 0 } }
      ]
    },
    {
      path: 'root/mother',
      depth: 1,
      projectionMode: 'nested',
      parentPath: 'root',
      parentNodeId: 'mother',
      nodes: Array.from({ length: 7 }, (_, index) => ({
        id: `direct-child-${index}`,
        radius: 0.82,
        position: { x: (index % 3) * 0.04, y: Math.floor(index / 3) * 0.04, z: 0 }
      }))
    }
  ]);
  const parent = scene.clusters.find((cluster) => cluster.path === 'root');
  const child = scene.clusters.find((cluster) => cluster.path === 'root/mother');
  const carrier = parent.layoutNodes.find((node) => node.id === 'mother');

  assert.equal(parent.nodes.some((node) => node.id === 'mother'), false, 'mother is represented by the shell');
  assert.equal(child.parentCarrierNode.id, 'mother');
  assert.equal(carrier.__nestedCarrierPath, child.path);
  assert.ok(carrier.__clusterRadius >= child.radius, 'parent relaxation uses the real child-shell radius');
  assert.deepEqual(
    child.nodes.map((node) => node.id).sort(),
    Array.from({ length: 7 }, (_, index) => `direct-child-${index}`).sort()
  );
  assert.equal(child.nodes.every((node) => node.ownerPath === child.path), true);
  for (const sibling of parent.nodes) {
    assert.ok(
      Math.hypot(
        sibling.position.x - child.center.x,
        sibling.position.y - child.center.y
      ) >= child.radius + sibling.__clusterRadius - 0.08,
      `${sibling.id} stays outside the nested child shell`
    );
  }
});

test('a dense real-scale nested field guarantees sibling exclusion and parent containment', () => {
  const field = loadClusterField();
  const rootNodes = Array.from({ length: 18 }, (_, index) => ({
    id: `mother-${index}`,
    radius: 0.82,
    position: { x: (index % 6) * 0.002, y: Math.floor(index / 6) * 0.002, z: 0 }
  }));
  const scene = field.buildScene([
    { path: 'root', depth: 0, projectionMode: 'nested', nodes: rootNodes },
    ...rootNodes.map((mother, index) => ({
      path: `root/${mother.id}`,
      depth: 1,
      projectionMode: 'nested',
      parentPath: 'root',
      parentNodeId: mother.id,
      nodes: Array.from({ length: 2 + index % 11 }, (_, childIndex) => ({
        id: `${mother.id}-child-${childIndex}`,
        radius: 0.82,
        position: {
          x: (childIndex % 3) * 0.03,
          y: Math.floor(childIndex / 3) * 0.03,
          z: 0
        }
      }))
    }))
  ]);
  const children = scene.clusters.filter((cluster) => cluster.parentPath === 'root');
  const parent = scene.clusters.find((cluster) => cluster.path === 'root');

  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    const left = children[leftIndex];
    assert.ok(
      Math.hypot(left.center.x - parent.center.x, left.center.y - parent.center.y)
        + left.radius + 0.24 <= parent.radius,
      `${left.path} must remain fully contained by its parent shell`
    );
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      const right = children[rightIndex];
      assert.ok(
        Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y)
          >= left.radius + right.radius + 0.16,
        `${left.path} and ${right.path} nested shells must remain mutually exclusive`
      );
    }
  }
});

test('recursive nested shells keep each depth isolated to its own direct domain', () => {
  const field = loadClusterField();
  const scene = field.buildScene([
    {
      path: 'root',
      depth: 0,
      nodes: [
        { id: 'level-one', radius: 0.82, position: { x: 0, y: 0, z: 0 } },
        { id: 'root-peer', radius: 0.82, position: { x: 2, y: 0, z: 0 } }
      ]
    },
    {
      path: 'root/level-one',
      depth: 1,
      projectionMode: 'nested',
      parentPath: 'root',
      parentNodeId: 'level-one',
      nodes: [
        { id: 'level-two', radius: 0.82, position: { x: 0, y: 0, z: 0 } },
        { id: 'level-one-peer', radius: 0.82, position: { x: 2, y: 0, z: 0 } }
      ]
    },
    {
      path: 'root/level-one/level-two',
      depth: 2,
      projectionMode: 'nested',
      parentPath: 'root/level-one',
      parentNodeId: 'level-two',
      nodes: [
        { id: 'leaf-a', radius: 0.82, position: { x: -1, y: 0, z: 0 } },
        { id: 'leaf-b', radius: 0.82, position: { x: 1, y: 0, z: 0 } }
      ]
    }
  ]);
  const root = scene.clusters.find((cluster) => cluster.path === 'root');
  const middle = scene.clusters.find((cluster) => cluster.path === 'root/level-one');
  const leaf = scene.clusters.find((cluster) => cluster.path === 'root/level-one/level-two');

  assert.deepEqual(root.nodes.map((node) => node.id), ['root-peer']);
  assert.deepEqual(middle.nodes.map((node) => node.id), ['level-one-peer']);
  assert.deepEqual(leaf.nodes.map((node) => node.id).sort(), ['leaf-a', 'leaf-b']);
});

test('hierarchy allocates non-overlapping horizontal subtree bands through every depth', () => {
  const field = loadClusterField();
  const nodes = (prefix, count) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    radius: 0.82,
    position: { x: (index - (count - 1) / 2) * 1.8, y: 0, z: 0 }
  }));
  const scene = field.buildScene([
    { path: 'root', depth: 0, nodes: [
      { id: 'left', radius: 0.82, position: { x: -2.4, y: 0, z: 0 } },
      { id: 'right', radius: 0.82, position: { x: 2.4, y: 0, z: 0 } }
    ] },
    { path: 'root/left', depth: 1, parentPath: 'root', parentNodeId: 'left', nodes: nodes('l', 9) },
    { path: 'root/right', depth: 1, parentPath: 'root', parentNodeId: 'right', nodes: nodes('r', 2) },
    { path: 'root/left/deep', depth: 2, parentPath: 'root/left', parentNodeId: 'l-0', nodes: nodes('ld', 8) },
    { path: 'root/right/deep', depth: 2, parentPath: 'root/right', parentNodeId: 'r-1', nodes: nodes('rd', 7) }
  ]);
  const leftBranch = scene.clusters.filter((cluster) => cluster.path.startsWith('root/left'));
  const rightBranch = scene.clusters.filter((cluster) => cluster.path.startsWith('root/right'));
  const leftMaximum = Math.max(...leftBranch.map((cluster) => cluster.center.x + cluster.radius));
  const rightMinimum = Math.min(...rightBranch.map((cluster) => cluster.center.x - cluster.radius));

  assert.ok(leftMaximum + 1.2 <= rightMinimum, 'whole subtrees retain separate safety bands');
});

test('A peripheral expansion shrinks each child layer cumulatively while preserving planar shell repulsion', () => {
  const field = loadClusterField();
  const node = (id) => ({ id, radius: 1, position: { x: 0, y: 0, z: 0 } });
  const scene = field.buildScene([
    { path: 'root', depth: 0, nodes: [node('root-node')] },
    { path: 'root/child', depth: 1, projectionMode: 'peripheral', parentPath: 'root', parentNodeId: 'root-node', nodes: [node('child-node')] },
    { path: 'root/child/leaf', depth: 2, projectionMode: 'peripheral', parentPath: 'root/child', parentNodeId: 'child-node', nodes: [node('leaf-node')] }
  ], { peripheralDepthShrinkPercent: 20 });
  const [root, child, leaf] = scene.clusters;

  assert.equal(root.nodeScale, 1);
  assert.ok(Math.abs(child.nodeScale - 0.8) < 0.000001);
  assert.ok(Math.abs(leaf.nodeScale - 0.64) < 0.000001);
  for (let leftIndex = 0; leftIndex < scene.clusters.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < scene.clusters.length; rightIndex += 1) {
      const left = scene.clusters[leftIndex];
      const right = scene.clusters[rightIndex];
      assert.ok(
        Math.hypot(right.center.x - left.center.x, right.center.y - left.center.y)
          >= left.radius + right.radius,
        'scaled A shells remain mutually exclusive in the primary viewing plane'
      );
    }
  }
});

test('A child shrink also scales nested child layers in the visible inner view', () => {
  const field = loadClusterField();
  const node = (id) => ({ id, radius: 1, position: { x: 0, y: 0, z: 0 } });
  const domains = [
    { path: 'root', depth: 0, nodes: [node('root-node')] },
    { path: 'root/child', depth: 1, projectionMode: 'nested', parentPath: 'root', parentNodeId: 'root-node', nodes: [node('child-node')] }
  ];
  const unscaled = field.buildScene(domains, { compact: true, peripheralDepthShrinkPercent: 0 });
  const scaled = field.buildScene(domains, { compact: true, peripheralDepthShrinkPercent: 80 });
  const unscaledChild = unscaled.clusters.find((cluster) => cluster.path === 'root/child');
  const scaledChild = scaled.clusters.find((cluster) => cluster.path === 'root/child');
  assert.ok(scaledChild.nodeScale < unscaledChild.nodeScale);
});
