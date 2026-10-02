const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const middleFrameTarget = require('../spatial-middle-frame-target.js');
const fieldContext = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../spatial-cluster-field.js'), 'utf8'), fieldContext);
const clusterField = fieldContext.window.SpatialClusterField;

// Execute the real engine functions with controlled rendered regions. This
// catches filtering/order/coordinate bugs without inventing a second resolver.
const source = fs.readFileSync(path.join(__dirname, '../spatial-engine.js'), 'utf8');
function engineFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
}
function region(id, radius, options = {}) {
  return {
    x: options.x ?? 100, y: options.y ?? 100, radius,
    ...(options.envelope ? { envelope: options.envelope } : {}),
    item: { kind: 'node', node: { id, description: `${id}全文`, ownerPath: 'root' },
      ownerPath: options.ownerPath ?? 'root/local',
      screen: { depth: 2 }, clusterShellProxy: options.shell === true }
  };
}
function engine(regions) {
  const context = vm.createContext({
    state: { hitRegions: regions, clusterFieldOpen: false, clusterHitRegions: [],
      relationHitRegions: [], renderedFloatingDetailBoxes: [], width: 1440, height: 960,
      detailMagnifier: { enabled: true } },
    canvas: { getBoundingClientRect: () => ({ left: 40, top: 70 }) },
    middleFrameTarget, clusterField, nodeOwnerPath: (node) => node.ownerPath,
    detailMagnifierModel: require('../spatial-detail-magnifier-model.js'),
    ui: { detailMagnifierTitle: {}, detailMagnifierContent: {}, detailMagnifier: { style: {} } },
    markdownEditor: null, visualNodeKey: (node, owner) => `${owner}::${node.id}`,
    workspaceModel: { edgeIdentity: (edge) => edge.id }, hideDetailMagnifierPanel: () => {}
  });
  vm.runInContext(['findClusterDomainContext', 'findMiddleFrameHit', 'currentMagnifierNode',
    'currentMagnifierRelation', 'updateDetailMagnifier']
    .map(engineFunction).join('\n'), context);
  return context;
}

test('fulltext reader identifies an already dissected group with its local owner', () => {
  const app = engine([region('group', 90, { shell: true })]);
  const target = app.currentMagnifierNode({ x: 100, y: 100 });
  assert.equal(target?.node.id, 'group');
  assert.equal(target?.ownerPath, 'root/local');
});

test('a relation pointed inside the group remains readable above its background shell', () => {
  const app = engine([region('group', 90, { shell: true })]);
  app.state.relationHitRegions = [{ x: 100, y: 100, radius: 15,
    item: { edge: { id: 'relation', detail: '关系全文' }, label: '关系' } }];
  app.updateDetailMagnifier({ x: 100, y: 100 });
  assert.equal(app.state.detailMagnifier.targetKind, 'relationship');
  assert.match(app.ui.detailMagnifierContent.textContent, /关系全文/);
});

test('fulltext and middle click choose the same small visible object in an overlapping group', () => {
  const app = engine([region('group', 90, { shell: true }), region('large-node', 70), region('leaf', 20, { x: 110 })]);
  assert.equal(app.findMiddleFrameHit(140, 170).item.node.id, 'leaf');
  assert.equal(app.currentMagnifierNode({ x: 100, y: 100 })?.node.id, 'leaf');
});

test('fulltext reader rejects a point inside the enclosing circle but outside the group envelope', () => {
  const app = engine([region('group', 90, { shell: true,
    envelope: { kind: 'circle', x: 100, y: 100, radius: 20 } })]);
  assert.equal(app.currentMagnifierNode({ x: 150, y: 100 }), null);
});

test('fulltext reader never selects a descendant that has no rendered hit region', () => {
  const visible = region('visible', 20);
  visible.item.node.children = [{ id: 'hidden', description: 'hidden全文' }];
  const app = engine([visible]);
  assert.equal(app.currentMagnifierNode({ x: 100, y: 100 })?.node.id, 'visible');
  assert.equal(app.currentMagnifierNode({ x: 150, y: 100 }), null);
});
