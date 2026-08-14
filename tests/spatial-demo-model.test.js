const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModel() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  const file = path.join(__dirname, '..', 'spatial-demo-model.js');
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window.SpatialDemoModel;
}

test('first visit defaults to five-second presentation and visible help', () => {
  const model = loadModel();
  assert.ok(model, 'SpatialDemoModel must exist');
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.normalizeSettings(null))),
    { idleSeconds: 5, lastIdleSeconds: 5, helpVisible: true, peripheralDepthShrinkPercent: 20, nestedCompactnessPercent: 50, nestedTunnelPercent: 0, nestedTunnelInteriorPercent: 0, zoomSpeedPercent: 160, middleLabelDepth: 3, highlightedLabelBrightnessPercent: 100, otherLabelBrightnessPercent: 35, middleDetailDepth: 3, highlightedDetailBrightnessPercent: 100, otherDetailBrightnessPercent: 0, floatingDetailBackdropOpacityPercent: 82 }
  );
});

test('blank idle seconds disables presentation while retaining the last valid delay', () => {
  const model = loadModel();
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.normalizeSettings({
      idleSeconds: null,
      lastIdleSeconds: 12,
      helpVisible: false
    }))),
    { idleSeconds: null, lastIdleSeconds: 12, helpVisible: false, peripheralDepthShrinkPercent: 20, nestedCompactnessPercent: 50, nestedTunnelPercent: 0, nestedTunnelInteriorPercent: 0, zoomSpeedPercent: 160, middleLabelDepth: 3, highlightedLabelBrightnessPercent: 100, otherLabelBrightnessPercent: 35, middleDetailDepth: 3, highlightedDetailBrightnessPercent: 100, otherDetailBrightnessPercent: 0, floatingDetailBackdropOpacityPercent: 82 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(model.withIdleInput({ idleSeconds: 8, lastIdleSeconds: 8, helpVisible: true }, ''))),
    { idleSeconds: null, lastIdleSeconds: 8, helpVisible: true, peripheralDepthShrinkPercent: 20, nestedCompactnessPercent: 50, nestedTunnelPercent: 0, nestedTunnelInteriorPercent: 0, zoomSpeedPercent: 160, middleLabelDepth: 3, highlightedLabelBrightnessPercent: 100, otherLabelBrightnessPercent: 35, middleDetailDepth: 3, highlightedDetailBrightnessPercent: 100, otherDetailBrightnessPercent: 0, floatingDetailBackdropOpacityPercent: 82 }
  );
});

test('P toggles the same enabled value used by the settings field', () => {
  const model = loadModel();
  const disabled = model.toggleDemo({ idleSeconds: 7, lastIdleSeconds: 7, helpVisible: true });
  assert.equal(disabled.idleSeconds, null);
  const enabled = model.toggleDemo(disabled);
  assert.equal(enabled.idleSeconds, 7);
});

test('S tunnel strength is persisted and clamped from zero through one hundred percent', () => {
  const model = loadModel();
  assert.equal(model.withNestedTunnelInput(null, 37).nestedTunnelPercent, 37);
  assert.equal(model.withNestedTunnelInput(null, -1).nestedTunnelPercent, 0);
  assert.equal(model.withNestedTunnelInput(null, 120).nestedTunnelPercent, 100);
  assert.equal(model.withNestedTunnelInteriorInput(null, 42).nestedTunnelInteriorPercent, 42);
  assert.equal(model.withNestedTunnelInteriorInput(null, -1).nestedTunnelInteriorPercent, 0);
  assert.equal(model.withNestedTunnelInteriorInput(null, 120).nestedTunnelInteriorPercent, 100);
});

test('S group compactness is a 0–100% automatic packing preference, never a global scale multiplier', () => {
  const model = loadModel();
  assert.equal(model.withNestedCompactnessInput(null, 68).nestedCompactnessPercent, 68);
  assert.equal(model.withNestedCompactnessInput(null, -1).nestedCompactnessPercent, 0);
  assert.equal(model.withNestedCompactnessInput(null, 120).nestedCompactnessPercent, 100);
  assert.equal(model.withNestedCompactnessInput(null, 1000).nestedCompactnessPercent, 100);
  assert.equal(model.withNestedCompactnessInput(null, 1200).nestedCompactnessPercent, 100);
  assert.equal(model.withNestedCompactnessInput(null, 'bad').nestedCompactnessPercent, 50);
});

test('zoom speed is persisted as an adjustable percentage with a faster default', () => {
  const model = loadModel();
  assert.equal(model.withZoomSpeedInput(null, 225).zoomSpeedPercent, 225);
  assert.equal(model.withZoomSpeedInput(null, 1).zoomSpeedPercent, 25);
  assert.equal(model.withZoomSpeedInput(null, 999).zoomSpeedPercent, 400);
  assert.equal(model.withZoomSpeedInput(null, 'bad').zoomSpeedPercent, 160);
});

test('middle-click label highlight depth is persisted and clamped to useful hierarchy levels', () => {
  const model = loadModel();
  assert.equal(model.withMiddleLabelDepthInput(null, 5).middleLabelDepth, 5);
  assert.equal(model.withMiddleLabelDepthInput(null, 0).middleLabelDepth, 1);
  assert.equal(model.withMiddleLabelDepthInput(null, 99).middleLabelDepth, 9);
  assert.equal(model.withMiddleLabelDepthInput(null, 'bad').middleLabelDepth, 3);
});

test('middle-click detail depth stays synchronized with the title depth while brightness remains independent', () => {
  const model = loadModel();
  const setDetailDepth = model.withMiddleDetailDepthInput(null, 5);
  assert.equal(setDetailDepth.middleDetailDepth, 5);
  assert.equal(setDetailDepth.middleLabelDepth, 5);
  const setLabelDepth = model.withMiddleLabelDepthInput(null, 4);
  assert.equal(setLabelDepth.middleDetailDepth, 4);
  assert.equal(setLabelDepth.middleLabelDepth, 4);
  assert.equal(model.withMiddleDetailDepthInput(null, 0).middleDetailDepth, 1);
  assert.equal(model.withMiddleDetailDepthInput(null, 99).middleDetailDepth, 9);
  assert.equal(model.withMiddleDetailDepthInput(null, 'bad').middleDetailDepth, 3);
  assert.equal(model.withHighlightedDetailBrightnessInput(null, 72).highlightedDetailBrightnessPercent, 72);
  assert.equal(model.withOtherDetailBrightnessInput(null, 18).otherDetailBrightnessPercent, 18);
  assert.equal(model.withOtherDetailBrightnessInput(null, 180).otherDetailBrightnessPercent, 100);
  const changed = model.withOtherDetailBrightnessInput({
    middleLabelDepth: 6,
    highlightedLabelBrightnessPercent: 85,
    otherLabelBrightnessPercent: 25
  }, 40);
  assert.equal(changed.otherDetailBrightnessPercent, 40);
  assert.equal(changed.middleLabelDepth, 6);
  assert.equal(changed.highlightedLabelBrightnessPercent, 85);
  assert.equal(changed.otherLabelBrightnessPercent, 25);
});

test('floating detail backdrop opacity is persisted as an independent 0–100% control', () => {
  const model = loadModel();
  assert.equal(model.normalizeSettings(null).floatingDetailBackdropOpacityPercent, 82);
  assert.equal(model.withFloatingDetailBackdropOpacityInput(null, 31).floatingDetailBackdropOpacityPercent, 31);
  assert.equal(model.withFloatingDetailBackdropOpacityInput(null, -1).floatingDetailBackdropOpacityPercent, 0);
  assert.equal(model.withFloatingDetailBackdropOpacityInput(null, 140).floatingDetailBackdropOpacityPercent, 100);
});

test('one hierarchy level highlights only the anchor node and never its peers or children', () => {
  const model = loadModel();
  const focus = {
    kind: 'node',
    anchorKey: 'root::anchor',
    descendantPath: 'root/anchor'
  };
  assert.equal(model.isHierarchyLabelHighlighted(focus, { key: 'root::anchor', ownerPath: 'root' }, 1), true);
  assert.equal(model.isHierarchyLabelHighlighted(focus, { key: 'root::peer', ownerPath: 'root' }, 1), false);
  assert.equal(model.isHierarchyLabelHighlighted(focus, { key: 'root/anchor::child', ownerPath: 'root/anchor' }, 1), false);
  assert.equal(model.isHierarchyLabelHighlighted(focus, { key: 'root/anchor::child', ownerPath: 'root/anchor' }, 2), true);
});

test('a domain focus counts the selected domain as level one and excludes third-level field labels and details at depth two', () => {
  const model = loadModel();
  const focus = {
    kind: 'domain',
    path: 'root/设标'
  };
  const directForm = {
    key: 'root/设标::定向',
    ownerPath: 'root/设标'
  };
  const formField = {
    key: 'root/设标/定向::状态',
    ownerPath: 'root/设标/定向'
  };

  assert.equal(model.hierarchyLabelLevel(focus, directForm), 2);
  assert.equal(model.isHierarchyLabelHighlighted(focus, directForm, 2), true);
  assert.equal(model.hierarchyLabelLevel(focus, formField), 3);
  assert.equal(model.isHierarchyLabelHighlighted(focus, formField, 2), false);
  assert.equal(model.isHierarchyDetailHighlighted(focus, formField, 2), false);
});

test('node and domain focus use the same relative depth boundary at two levels', () => {
  const model = loadModel();
  const rootFocus = {
    kind: 'node',
    anchorKey: 'root::推进流总控',
    descendantPath: 'root/推进流总控'
  };
  const groupFocus = {
    kind: 'domain',
    path: 'root/推进流总控/设标'
  };
  const rootDirectChild = {
    key: 'root/推进流总控::设标',
    ownerPath: 'root/推进流总控'
  };
  const rootGrandchild = {
    key: 'root/推进流总控/设标::定向',
    ownerPath: 'root/推进流总控/设标'
  };
  const groupDirectChild = rootGrandchild;
  const groupGrandchild = {
    key: 'root/推进流总控/设标/定向::状态',
    ownerPath: 'root/推进流总控/设标/定向'
  };

  assert.equal(model.hierarchyLabelLevel(rootFocus, rootDirectChild), 2);
  assert.equal(model.hierarchyLabelLevel(rootFocus, rootGrandchild), 3);
  assert.equal(model.isHierarchyLabelHighlighted(rootFocus, rootDirectChild, 2), true);
  assert.equal(model.isHierarchyLabelHighlighted(rootFocus, rootGrandchild, 2), false);
  assert.equal(model.isHierarchyDetailHighlighted(rootFocus, rootGrandchild, 2), false);

  assert.equal(model.hierarchyLabelLevel(groupFocus, groupDirectChild), 2);
  assert.equal(model.hierarchyLabelLevel(groupFocus, groupGrandchild), 3);
  assert.equal(model.isHierarchyLabelHighlighted(groupFocus, groupDirectChild, 2), true);
  assert.equal(model.isHierarchyLabelHighlighted(groupFocus, groupGrandchild, 2), false);
  assert.equal(model.isHierarchyDetailHighlighted(groupFocus, groupGrandchild, 2), false);
});

test('a group carrier shares its parent level with sibling leaf nodes while its contents remain one level deeper', () => {
  const model = loadModel();
  const focus = {
    kind: 'node',
    anchorKey: 'root::推进流总控',
    descendantPath: 'root/推进流总控'
  };
  const leaf = {
    key: 'root/推进流总控::导航坐标',
    ownerPath: 'root/推进流总控'
  };
  const group = model.domainHierarchyItem(
    'root/推进流总控/设标',
    'root/推进流总控'
  );
  const groupContent = {
    key: 'root/推进流总控/设标::定向',
    ownerPath: 'root/推进流总控/设标'
  };

  assert.equal(group.kind, 'domain');
  assert.equal(group.path, 'root/推进流总控/设标');
  assert.equal(group.key, '');
  assert.equal(group.ownerPath, 'root/推进流总控');
  assert.equal(model.hierarchyLabelLevel(focus, leaf), 2);
  assert.equal(model.hierarchyLabelLevel(focus, group), 2);
  assert.equal(model.isHierarchyLabelHighlighted(focus, group, 2), true);
  assert.equal(model.isHierarchyDetailHighlighted(focus, group, 2), true);
  assert.equal(model.hierarchyLabelLevel(focus, groupContent), 3);
  assert.equal(model.isHierarchyLabelHighlighted(focus, groupContent, 2), false);
  assert.equal(model.isHierarchyDetailHighlighted(focus, groupContent, 2), false);
});

test('A depth shrink is persisted and clamped to a visible nonzero child scale', () => {
  const model = loadModel();
  assert.equal(model.withPeripheralDepthShrinkInput(null, 35).peripheralDepthShrinkPercent, 35);
  assert.equal(model.withPeripheralDepthShrinkInput(null, -1).peripheralDepthShrinkPercent, 0);
  assert.equal(model.withPeripheralDepthShrinkInput(null, 100).peripheralDepthShrinkPercent, 90);
  assert.equal(model.withPeripheralDepthShrinkInput(null, 'bad').peripheralDepthShrinkPercent, 20);
});

test('a four-level middle focus gives a node title and its detail the same highlight eligibility', () => {
  const model = loadModel();
  const focus = {
    kind: 'node',
    anchorKey: 'root::anchor',
    descendantPath: 'root/anchor'
  };
  const fourthLevelNode = {
    key: 'root/anchor/one/two::node',
    ownerPath: 'root/anchor/one/two'
  };

  assert.equal(model.hierarchyLabelLevel(focus, fourthLevelNode), 4);
  assert.equal(model.isHierarchyLabelHighlighted(focus, fourthLevelNode, 4), true);
  assert.equal(
    model.isHierarchyDetailHighlighted(focus, fourthLevelNode, 4),
    true,
    'the detail belongs to the same node and must use the title\'s depth eligibility'
  );
});

test('relationship brightness fades linearly across hierarchy levels instead of a flat switch', () => {
  const model = loadModel();
  const focus = { kind: 'node', anchorKey: 'root::anchor', descendantPath: 'root/anchor' };
  const levelOne = model.hierarchyRelationshipBrightnessPercent(
    focus,
    { key: 'root::anchor', ownerPath: 'root' },
    { key: 'root::anchor', ownerPath: 'root' },
    3,
    100,
    15
  );
  const levelTwo = model.hierarchyRelationshipBrightnessPercent(
    focus,
    { key: 'root/anchor::child', ownerPath: 'root/anchor' },
    { key: 'root/anchor::child', ownerPath: 'root/anchor' },
    3,
    100,
    15
  );
  const boundarySpanning = model.hierarchyRelationshipBrightnessPercent(
    focus,
    { key: 'root::anchor', ownerPath: 'root' },
    { key: 'far::node', ownerPath: 'far' },
    3,
    100,
    15
  );
  const outOfRange = model.hierarchyRelationshipBrightnessPercent(
    focus,
    { key: 'far::node', ownerPath: 'far' },
    { key: 'far::node', ownerPath: 'far' },
    3,
    100,
    15
  );
  assert.ok(levelOne > levelTwo, 'closer level should be brighter than a farther level');
  assert.ok(levelTwo > outOfRange, 'in-range levels should stay brighter than fully out-of-range');
  assert.equal(outOfRange, 15);
  assert.equal(boundarySpanning, levelOne, 'a line takes the brightness of its nearest endpoint to the focus');
});

test('clicked group depth counts the group itself before its direct members', () => {
  const model = loadModel();
  const focus = { kind: 'domain', path: 'root/selected-group' };
  assert.equal(model.isHierarchyLabelHighlighted(
    focus,
    { key: 'root/selected-group::member', ownerPath: 'root/selected-group' },
    2
  ), true);
  assert.equal(model.isHierarchyLabelHighlighted(
    focus,
    { key: 'root::root-peer', ownerPath: 'root' },
    2
  ), false);
  assert.equal(model.isHierarchyLabelHighlighted(
    focus,
    { key: 'root/other-group::peer', ownerPath: 'root/other-group' },
    2
  ), false);
  assert.equal(model.isHierarchyLabelHighlighted(
    focus,
    { key: 'root/selected-group/child::child', ownerPath: 'root/selected-group/child' },
    3
  ), true);
});

test('detail hierarchy delegates to the title hierarchy for every rendered item kind', () => {
  const model = loadModel();
  const groupFocus = { kind: 'domain', path: 'root/group' };
  const nodeFocus = {
    kind: 'node',
    anchorKey: 'root::anchor',
    descendantPath: 'root/anchor'
  };
  const cases = [
    [groupFocus, { kind: 'domain', key: '', ownerPath: 'root/group' }, 1],
    [groupFocus, { kind: 'node', key: 'root/group::member', ownerPath: 'root/group' }, 1],
    [nodeFocus, { kind: 'node', key: 'root::anchor', ownerPath: 'root' }, 1],
    [nodeFocus, { kind: 'domain', key: '', ownerPath: 'root/anchor' }, 2],
    [nodeFocus, { kind: 'node', key: 'root/anchor::child', ownerPath: 'root/anchor' }, 2]
  ];
  for (const [focus, item, levels] of cases) {
    assert.equal(
      model.isHierarchyDetailHighlighted(focus, item, levels),
      model.isHierarchyLabelHighlighted(focus, item, levels)
    );
  }
});

test('ordinary label brightness is adjustable without changing hierarchy depth', () => {
  const model = loadModel();
  assert.equal(model.withOtherLabelBrightnessInput(null, 55).otherLabelBrightnessPercent, 55);
  assert.equal(model.withOtherLabelBrightnessInput(null, 0).otherLabelBrightnessPercent, 0);
  assert.equal(model.withOtherLabelBrightnessInput(null, 200).otherLabelBrightnessPercent, 100);
  assert.equal(model.withHighlightedLabelBrightnessInput(null, 60).highlightedLabelBrightnessPercent, 60);
  assert.equal(model.withHighlightedLabelBrightnessInput(null, 0).highlightedLabelBrightnessPercent, 0);
});

test('idle start and deterministic shuffle are pure and bounded', () => {
  const model = loadModel();
  assert.equal(model.shouldStart({ idleSeconds: 5, lastInputAt: 1000, now: 5999 }), false);
  assert.equal(model.shouldStart({ idleSeconds: 5, lastInputAt: 1000, now: 6000 }), true);
  assert.equal(model.shouldStart({ idleSeconds: null, lastInputAt: 0, now: 999999 }), false);
  assert.deepEqual(
    Array.from(model.shuffleSteps(['A', 'S', 'D', 'F'], () => 0)),
    ['S', 'D', 'F', 'A']
  );
});

test('invalid persisted settings recover without leaking unknown fields', () => {
  const model = loadModel();
  const settings = model.normalizeSettings({
    idleSeconds: -20,
    lastIdleSeconds: 'bad',
    helpVisible: 'yes',
    knowledge: { nodes: ['forbidden'] }
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(settings)),
    { idleSeconds: 5, lastIdleSeconds: 5, helpVisible: true, peripheralDepthShrinkPercent: 20, nestedCompactnessPercent: 50, nestedTunnelPercent: 0, nestedTunnelInteriorPercent: 0, zoomSpeedPercent: 160, middleLabelDepth: 3, highlightedLabelBrightnessPercent: 100, otherLabelBrightnessPercent: 35, middleDetailDepth: 3, highlightedDetailBrightnessPercent: 100, otherDetailBrightnessPercent: 0, floatingDetailBackdropOpacityPercent: 82 }
  );
});

test('formats one unmistakable timestamp marker for each presentation session', () => {
  const model = loadModel();
  assert.equal(
    model.formatSessionMarker(new Date(2026, 6, 23, 14, 32, 5)),
    '【演示·20260723-143205】'
  );
});

test('builds a themed root agenda from current graph capabilities instead of a shuffled shortcut list', () => {
  const model = loadModel();
  const agenda = model.buildTourAgenda({
    depth: 0,
    atRoot: true,
    portalCount: 3,
    detailCount: 2,
    maxDescent: 3,
    canBack: false,
    canForward: false,
    clusterOpen: false,
    batchCount: 4,
    canCreate: true,
    canUpdate: true,
    canRelate: true,
    canLand: true,
    worldLensOpen: false
  }, []);

  assert.equal(agenda.some((task) => task.id === 'navigation.home'), false);
  assert.equal(agenda.some((task) => task.id === 'spatial.world-lens' && task.kind === 'worldLens'), true);
  assert.equal(agenda.filter((task) => task.kind === 'descend').length, 3);
  assert.equal(agenda.some((task) => task.id === 'editing.land'), true);
  assert.deepEqual(
    [...new Set(agenda.map((task) => task.theme))],
    ['spatial', 'tunnel', 'observation', 'camera', 'batch', 'editing']
  );
});

test('replans from the graph by removing completed and impossible tasks', () => {
  const model = loadModel();
  const summary = {
    depth: 2,
    atRoot: false,
    portalCount: 0,
    detailCount: 0,
    maxDescent: 0,
    canBack: true,
    canForward: false,
    clusterOpen: false,
    batchCount: 0,
    canCreate: false,
    canUpdate: false,
    canRelate: false,
    canLand: false,
    worldLensOpen: false
  };
  const agenda = model.buildTourAgenda(summary, ['tunnel.retreat']);

  assert.equal(agenda.some((task) => task.kind === 'descend'), false);
  assert.equal(agenda.some((task) => task.theme === 'observation'), false);
  assert.equal(agenda.some((task) => task.theme === 'batch'), false);
  assert.equal(agenda.some((task) => task.theme === 'editing'), false);
  assert.equal(agenda.some((task) => task.id === 'tunnel.retreat'), false);
  assert.equal(model.nextTourTask(summary, ['tunnel.retreat']).id, 'spatial.world-lens');
});

test('open path view and current-domain edit capabilities suppress only their own actions', () => {
  const model = loadModel();
  const agenda = model.buildTourAgenda({
    depth: 0,
    atRoot: true,
    portalCount: 0,
    detailCount: 0,
    maxDescent: 0,
    clusterOpen: false,
    batchCount: 0,
    canCreate: true,
    canUpdate: false,
    canRelate: false,
    canLand: false,
    worldLensOpen: true
  }, []);

  assert.equal(agenda.some((task) => task.id === 'spatial.world-lens'), false);
  assert.equal(agenda.some((task) => task.id === 'editing.create'), true);
  assert.equal(agenda.some((task) => task.id === 'editing.update'), false);
  assert.equal(agenda.some((task) => task.id === 'editing.relation'), false);
  assert.equal(agenda.some((task) => task.id === 'editing.land'), false);
});
