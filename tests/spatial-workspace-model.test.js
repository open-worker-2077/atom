const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModel() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'spatial-workspace-model.js'), 'utf8'),
    sandbox,
    { filename: 'spatial-workspace-model.js' }
  );
  return sandbox.window.SpatialWorkspaceModel;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('search matches node or domain path and returns highlighted segments', () => {
  const model = loadModel();
  const results = model.searchEntries([
    { path: 'root/archive', pathLabels: ['全域', '临时档案'], nodeId: 'a', label: '回声检索' },
    { path: 'root/evidence', pathLabels: ['全域', '证据球域'], nodeId: 'b', label: '并行关系' }
  ], '档案');

  assert.equal(results.length, 1);
  assert.equal(results[0].nodeId, 'a');
  assert.deepEqual(
    plain(results[0].pathSegments[1]),
    [
      { text: '临时', match: false },
      { text: '档案', match: true }
    ]
  );
  assert.deepEqual(
    plain(model.highlightSegments('回声检索', '检索')),
    [
      { text: '回声', match: false },
      { text: '检索', match: true }
    ]
  );
});

test('node edit exposes a blue draft and cancel restores the base node', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const node = { id: 'n1', label: '旧名称', description: '旧详情' };

  workspace.beginNodeEdit('root', node);
  workspace.updateNodeDraft({ label: '新名称', description: '新详情' });

  assert.equal(workspace.nodeVisualState('root', 'n1'), 'update');
  assert.equal(workspace.projectNode('root', node).label, '新名称');
  workspace.cancel();
  assert.equal(workspace.projectNode('root', node).label, '旧名称');
  assert.equal(workspace.nodeVisualState('root', 'n1'), 'idle');
});

test('created node appears in the current domain before commit and persists after commit', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const created = workspace.beginNodeCreate('root/child', {
    position: { x: 1, y: 2, z: 3 },
    label: '新节点'
  });

  assert.equal(created.detailMode, 'floating');
  assert.equal(created.surfaceVisible, false);

  assert.equal(workspace.projectDomain('root/child', []).length, 1);
  assert.equal(workspace.nodeVisualState('root/child', created.id), 'update');
  const operation = workspace.commit();
  assert.equal(operation.kind, 'node-create');
  assert.equal(workspace.projectDomain('root/child', []).length, 1);
  assert.equal(workspace.nodeVisualState('root/child', created.id), 'idle');
});

test('import without a detail presentation defaults to floating while explicit surface survives', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  assert.equal(workspace.importKnowledge({
    nodes: [
      { id: 'default-detail', path: 'root', label: 'Default' },
      { id: 'surface-detail', path: 'root', label: 'Surface', detailMode: 'surface', surfaceVisible: true }
    ],
    edges: []
  }), true);
  const nodes = workspace.projectDomain('root', []);
  assert.equal(nodes[0].detailMode, 'floating');
  assert.equal(nodes[0].surfaceVisible, false);
  assert.equal(nodes[1].detailMode, 'surface');
  assert.equal(nodes[1].surfaceVisible, true);
});

test('workspace retains Graph identity and Program source separately from the visible summary', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  workspace.importKnowledge({
    nodes: [{
      id: 'program', path: 'root', label: 'Predicate', detail: 'Program',
      graphPath: 'Root/Predicate', programSource: 'def main(arguments):\n    return True',
      atomTypes: ['program']
    }],
    edges: []
  });

  const node = workspace.projectDomain('root', [])[0];
  assert.equal(node.description, 'Program');
  assert.match(node.programSource, /return True/u);
  assert.equal(node.graphPath, 'Root/Predicate');
  const exported = workspace.exportKnowledge().nodes[0];
  assert.equal(exported.programSource, node.programSource);
  assert.equal(exported.graphPath, node.graphPath);
});

test('imported knowledge replaces built-in validation nodes in the projected domain', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const validationNodes = [
    { id: 'demo-orbit', label: '轨道视域' },
    { id: 'demo-portal', label: '递归球域' }
  ];

  assert.equal(workspace.importKnowledge({
    nodes: [{ id: 'logic-fire', path: 'root', label: 'Logic Fire agent初加工' }],
    edges: []
  }), true);

  assert.deepEqual(
    plain(workspace.projectDomain('root', validationNodes).map((node) => node.label)),
    ['Logic Fire agent初加工']
  );
});

test('scoped hydration can preserve an active cross-domain transaction', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const sourceNode = { id: 'source', path: 'root', label: '待移动节点' };
  workspace.importKnowledge({ nodes: [sourceNode], edges: [] });
  workspace.beginEdgeCreate(
    model.qualifiedEndpoint('root', sourceNode, ['全域']),
    sourceNode
  );

  const hydrated = {
    nodes: [
      sourceNode,
      { id: 'landing', path: 'root/target', label: '目标占位' }
    ],
    edges: []
  };
  assert.equal(workspace.importKnowledge(hydrated), false);
  assert.equal(workspace.importKnowledge(hydrated, { preserveTransaction: true }), true);
  assert.equal(workspace.transaction().source.key, 'root::source');
  assert.deepEqual(
    plain(workspace.projectDomain('root/target', []).map((node) => node.label)),
    ['目标占位']
  );
});

test('delete warning is red, escape restores, and enter removes a node plus attached workspace edges', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const first = { id: 'first', label: '一号', description: '' };
  const second = { id: 'second', label: '二号', description: '' };

  workspace.beginEdgeCreate(model.qualifiedEndpoint('root', first, ['全域']));
  workspace.setEdgeTarget(model.qualifiedEndpoint('root', second, ['全域']));
  workspace.commit();
  assert.equal(workspace.edgesForPath('root').length, 1);

  workspace.beginNodeEdit('root', first);
  workspace.markDelete();
  assert.equal(workspace.nodeVisualState('root', 'first'), 'delete');
  workspace.cancel();
  assert.equal(workspace.projectDomain('root', [first, second]).length, 2);

  workspace.beginNodeEdit('root', first);
  workspace.markDelete();
  workspace.commit();
  assert.deepEqual(workspace.projectDomain('root', [first, second]).map((node) => node.id), ['second']);
  assert.equal(workspace.edgesForPath('root').length, 0);
});

test('edge drafts retain qualified endpoints across domains and commit as cross-domain relations', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const source = model.qualifiedEndpoint(
    'root',
    { id: 'a', label: '起点' },
    ['全域']
  );
  const target = model.qualifiedEndpoint(
    'root/child',
    { id: 'b', label: '落脚' },
    ['全域', '子域']
  );

  workspace.beginEdgeCreate(source);
  assert.equal(workspace.transaction().source.key, 'root::a');
  workspace.setEdgeTarget(target);
  assert.equal(workspace.edgeVisualState({ from: source, to: target }), 'update');
  workspace.commit();

  const edge = workspace.edgesForPath('root/child')[0];
  assert.equal(edge.crossDomain, true);
  assert.equal(edge.from.path, 'root');
  assert.equal(edge.to.path, 'root/child');
});

test('blank edge landing previews and commits the same source node in another domain', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const sourceNode = {
    id: 'source-a',
    label: '起点',
    description: '原始详情',
    position: { x: 1, y: 2, z: 3 },
    radius: 0.9,
    hasChildren: true
  };
  const source = model.qualifiedEndpoint('root', sourceNode, ['全域']);

  workspace.beginEdgeCreate(source, sourceNode);
  assert.equal(workspace.setNodeLanding({
    path: 'root/child',
    pathLabels: ['全域', '子域'],
    position: { x: 4, y: 5, z: 6 }
  }), true);

  assert.equal(workspace.projectDomain('root', [sourceNode]).length, 0);
  const preview = workspace.projectDomain('root/child', []);
  assert.equal(preview.length, 1);
  assert.equal(preview[0].id, 'source-a');
  assert.deepEqual(plain(preview[0].position), { x: 4, y: 5, z: 6 });
  assert.equal(workspace.nodeVisualState('root/child', 'source-a'), 'update');

  const operation = workspace.commit();
  assert.equal(operation.kind, 'node-land');
  assert.equal(operation.oldKey, 'root::source-a');
  assert.equal(operation.newKey, 'root/child::source-a');
  const knowledge = workspace.exportKnowledge();
  assert.equal(knowledge.nodes.length, 1);
  assert.equal(knowledge.nodes[0].key, 'root/child::source-a');
  assert.deepEqual(plain(knowledge.nodes[0].aliases), ['root::source-a']);
  assert.equal(knowledge.nodes[0].label, '起点');
  assert.equal(knowledge.nodes[0].detail, '原始详情');
});

test('blank landing preserves mirror visibility through export and import', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const sourceNode = {
    id: 'source-mirror',
    label: 'Mirror source',
    description: 'Mirror detail',
    surfaceVisible: false,
    position: { x: 1, y: 2, z: 3 }
  };

  workspace.beginEdgeCreate(
    model.qualifiedEndpoint('root', sourceNode, ['Root']),
    sourceNode
  );
  workspace.setNodeLanding({
    path: 'root/child',
    pathLabels: ['Root', 'Child'],
    position: { x: 4, y: 5, z: 6 }
  });

  const preview = workspace.projectDomain('root/child', [])[0];
  assert.equal(preview.surfaceVisible, false);
  workspace.commit();

  const knowledge = workspace.exportKnowledge();
  assert.equal(knowledge.nodes[0].surfaceVisible, false);

  const reopened = model.createWorkspace();
  assert.equal(reopened.importKnowledge(knowledge), true);
  assert.equal(reopened.projectDomain('root/child', [])[0].surfaceVisible, false);
});

test('a landed node can change mirror state from inside its new domain', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const sourceNode = {
    id: 'source-mirror-toggle',
    label: 'Mirror source',
    surfaceVisible: false,
    position: { x: 1, y: 2, z: 3 }
  };

  workspace.beginEdgeCreate(
    model.qualifiedEndpoint('root', sourceNode, ['Root']),
    sourceNode
  );
  workspace.setNodeLanding({ path: 'root/child', position: { x: 4, y: 5, z: 6 } });
  workspace.commit();

  const landed = workspace.projectDomain('root/child', [])[0];
  landed.surfaceVisible = true;
  assert.equal(workspace.exportKnowledge().nodes[0].surfaceVisible, true);

  const reopened = model.createWorkspace();
  reopened.importKnowledge(workspace.exportKnowledge());
  assert.equal(reopened.projectDomain('root/child', [])[0].surfaceVisible, true);
});

test('node edit preserves long Program source without truncating registered controls', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const source = `${'x = 1\n'.repeat(900)}selected = choice({"id":"status","options":[{"id":"todo","label":"待办"}],"selected":[]})`;
  const node = { id: 'program-1', label: '流程', description: source, atomTypes: ['program'] };

  workspace.beginNodeEdit('root', node);
  const transaction = workspace.transaction();

  assert.equal(transaction.draft.description, source);
  assert.match(transaction.draft.description, /selected = choice/);
});

test('persisted landing resolves the moved node by target domain after its projected id changes', () => {
  const model = loadModel();
  const operation = {
    kind: 'node-land',
    source: { key: 'root::old-id' },
    target: { path: 'root/classified' },
    draft: { id: 'old-id', label: '网络' }
  };
  const knowledge = {
    nodes: [
      { id: 'same-name-elsewhere', path: 'root', label: '网络' },
      { id: 'new-id', path: 'root/classified', label: '网络' }
    ]
  };

  assert.deepEqual(
    plain(model.persistedLandingNode(operation, knowledge)),
    { id: 'new-id', path: 'root/classified', label: '网络' }
  );
});

test('batch landing keeps every selected source in one atomic move operation', () => {
  const operation = loadModel().batchLandingOperation({
    kind: 'node-land',
    source: { key: 'root::a', nodeId: 'a' },
    sourceNode: { id: 'a', label: 'A' },
    target: { path: 'root/target', position: { x: 1, y: 2, z: 0 } },
    draft: { id: 'a', label: 'A' }
  }, [
    { source: { key: 'root::a', nodeId: 'a' }, sourceNode: { id: 'a', label: 'A' } },
    { source: { key: 'root::b', nodeId: 'b' }, sourceNode: { id: 'b', label: 'B' } }
  ]);

  assert.equal(operation.kind, 'node-land-batch');
  assert.deepEqual(plain(operation.landings.map((landing) => landing.source.key)), ['root::a', 'root::b']);
  assert.deepEqual(plain(operation.landings.map((landing) => landing.target.path)), ['root/target', 'root/target']);
});

test('batch landing resolves every selected identity from authoritative knowledge instead of stale render entries', () => {
  const model = loadModel();
  const knowledge = { nodes: [
    { id: 'a', key: 'work::a', path: 'work', atomPath: 'work/来源甲', label: '来源甲', aliases: ['stale::a'] },
    { id: 'b', key: 'work::b', path: 'work', atomPath: 'work/来源乙', label: '来源乙', aliases: ['stale::b'] }
  ] };

  const entries = model.batchLandingEntries(
    ['stale::a', 'stale::b'],
    knowledge,
    new Map([['stale::a', { ownerPath: 'old', node: { id: 'old-a' } }]])
  );

  assert.deepEqual(plain(entries.map((entry) => ({
    key: entry.source.key,
    path: entry.source.path,
    atomPath: entry.sourceNode.atomPath
  }))), [
    { key: 'work::a', path: 'work', atomPath: 'work/来源甲' },
    { key: 'work::b', path: 'work', atomPath: 'work/来源乙' }
  ]);
});

test('batch landing remaps every moved node after authoritative persistence', () => {
  const model = loadModel();
  const previousKnowledge = { nodes: [
    { id: 'a', key: 'root::a', path: 'root', atomPath: '来源甲', label: '来源甲' },
    { id: 'b', key: 'root::b', path: 'root', atomPath: '来源乙', label: '来源乙' }
  ] };
  const knowledge = { nodes: [
    { id: 'a2', key: 'target::a2', path: 'target', atomPath: '目标域/来源甲', label: '来源甲' },
    { id: 'b2', key: 'target::b2', path: 'target', atomPath: '目标域/来源乙', label: '来源乙' }
  ] };
  const transitions = model.operationIdentityTransitions({
    kind: 'node-land-batch',
    landings: [
      { kind: 'node-land', source: { key: 'root::a' }, sourceNode: previousKnowledge.nodes[0], target: { path: 'target' } },
      { kind: 'node-land', source: { key: 'root::b' }, sourceNode: previousKnowledge.nodes[1], target: { path: 'target' } }
    ]
  }, knowledge, previousKnowledge);

  assert.deepEqual(plain(transitions.map((entry) => [entry.from.key, entry.to.key])), [
    ['root::a', 'target::a2'],
    ['root::b', 'target::b2']
  ]);
});

test('manual cluster placement survives knowledge export and import', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const created = workspace.beginNodeCreate('root/child', {
    position: { x: 7, y: -3, z: 2 },
    clusterLocalPositionLocked: true
  });

  workspace.updateNodeDraft({ label: '人工落点' });
  workspace.commit();

  const knowledge = workspace.exportKnowledge();
  assert.equal(knowledge.nodes[0].clusterLocalPositionLocked, true);

  const reopened = model.createWorkspace();
  assert.equal(reopened.importKnowledge(knowledge), true);
  const restored = reopened.projectDomain('root/child', [])[0];
  assert.deepEqual(restored.position, created.position);
  assert.equal(restored.clusterLocalPositionLocked, true);
});

test('cancelling a blank landing restores the source domain without persistence', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const sourceNode = { id: 'source-a', label: '起点', position: { x: 1, y: 2, z: 3 } };
  const source = model.qualifiedEndpoint('root', sourceNode, ['全域']);

  workspace.beginEdgeCreate(source, sourceNode);
  workspace.setNodeLanding({ path: 'root/child', position: { x: 7, y: 8, z: 9 } });
  workspace.cancel();

  assert.equal(workspace.projectDomain('root', [sourceNode]).length, 1);
  assert.equal(workspace.projectDomain('root/child', []).length, 0);
  assert.equal(workspace.exportKnowledge().nodes.length, 0);
});

test('landing preserves historical edge endpoints and resolves them as visible long tails', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const first = workspace.beginNodeCreate('root', { label: 'A' });
  workspace.commit();
  const second = workspace.beginNodeCreate('root', { label: 'B' });
  workspace.commit();
  const firstEndpoint = model.qualifiedEndpoint('root', first, ['全域']);
  const secondEndpoint = model.qualifiedEndpoint('root', second, ['全域']);

  workspace.beginEdgeCreate(firstEndpoint, first);
  workspace.setEdgeTarget(secondEndpoint);
  workspace.commit();
  workspace.beginEdgeCreate(firstEndpoint, first);
  workspace.setNodeLanding({ path: 'root/child', pathLabels: ['全域', '子域'], position: { x: 7, y: 0, z: 0 } });
  workspace.commit();

  const edge = workspace.edgesForPath('root/child')[0];
  assert.equal(edge.from.key, 'root::workspace-node-1');
  assert.equal(edge.to.key, 'root::workspace-node-2');
  assert.equal(edge.crossDomain, false);
  assert.equal(workspace.resolveEndpoint(edge.from).path, 'root/child');
  assert.equal(workspace.resolveEndpoint(edge.from).key, 'root/child::workspace-node-1');
  assert.equal(workspace.resolveEndpoint(edge.to).path, 'root');
  assert.deepEqual(plain(workspace.relationshipPairsForPath('root/child')), []);
});

test('relationship projection remains interactive when a large world references late nodes', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const nodeCount = 10000;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    path: 'root',
    label: `Node ${index}`
  }));
  const edges = Array.from({ length: 349 }, (_, index) => {
    const fromIndex = nodeCount - 1 - index * 2;
    const toIndex = fromIndex - 1;
    return {
      from: { key: `root::node-${fromIndex}`, path: 'root', nodeId: `node-${fromIndex}` },
      to: { key: `root::node-${toIndex}`, path: 'root', nodeId: `node-${toIndex}` }
    };
  });
  workspace.importKnowledge({ nodes, edges });

  const startedAt = performance.now();
  const relationships = workspace.relationshipPairsForPath('root');
  const elapsed = performance.now() - startedAt;

  assert.equal(relationships.length, edges.length);
  assert.ok(elapsed < 500, `relationship projection took ${elapsed.toFixed(1)}ms`);
});

test('a preserved long tail remains after cancel and is removed only after delete commit', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const first = workspace.beginNodeCreate('root', { label: 'A' });
  workspace.commit();
  const second = workspace.beginNodeCreate('root', { label: 'B' });
  workspace.commit();
  const firstEndpoint = model.qualifiedEndpoint('root', first, ['全域']);
  const secondEndpoint = model.qualifiedEndpoint('root', second, ['全域']);
  workspace.beginEdgeCreate(firstEndpoint, first);
  workspace.setEdgeTarget(secondEndpoint);
  workspace.commit();
  workspace.beginEdgeCreate(firstEndpoint, first);
  workspace.setNodeLanding({ path: 'root/child', position: { x: 1, y: 2, z: 3 } });
  workspace.commit();

  const tail = workspace.edgesForPath('root/child')[0];
  workspace.beginEdgeEdit(tail);
  workspace.markDelete();
  workspace.cancel();
  assert.equal(workspace.edgesForPath('root/child').length, 1);

  workspace.beginEdgeEdit(tail);
  workspace.markDelete();
  workspace.commit();
  assert.equal(workspace.edgesForPath('root/child').length, 0);
});

test('knowledge export and import preserve empty tunnel nodes and qualified cross-domain edges', () => {
  const model = loadModel();
  const sourceWorkspace = model.createWorkspace();
  const first = sourceWorkspace.beginNodeCreate('root', { label: '起点' });
  sourceWorkspace.commit();
  const second = sourceWorkspace.beginNodeCreate('root/child', { label: '落脚' });
  sourceWorkspace.commit();
  const source = model.qualifiedEndpoint('root', first, ['全域']);
  const target = model.qualifiedEndpoint('root/child', second, ['全域', '子域']);
  sourceWorkspace.beginEdgeCreate(source);
  sourceWorkspace.setEdgeTarget(target);
  sourceWorkspace.commit();

  const knowledge = sourceWorkspace.exportKnowledge();
  assert.equal(knowledge.nodes[0].carrier, 'tunnel');
  assert.equal(knowledge.nodes[0].hasChildren, false);
  delete knowledge.nodes[0].short;

  const importedWorkspace = model.createWorkspace();
  assert.equal(importedWorkspace.importKnowledge(knowledge), true);
  const importedRoot = importedWorkspace.projectDomain('root', []);
  assert.equal(importedRoot.length, 1);
  assert.ok(importedRoot[0].short.length <= 8);
  assert.match(importedRoot[0].short, /^K/);
  assert.equal(importedWorkspace.projectDomain('root/child', []).length, 1);
  assert.equal(importedWorkspace.edgesForPath('root/child')[0].crossDomain, true);
});

test('knowledge import and export preserve Boss and Leader routing metadata', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  assert.equal(workspace.importKnowledge({
    nodes: [{
      id: 'child',
      nodeId: 'child',
      bossId: 'individual-management',
      leaderId: 'individual-management',
      path: 'root/example',
      label: 'Synthetic child'
    }],
    edges: []
  }), true);
  const exported = workspace.exportKnowledge();
  assert.equal(exported.nodes[0].nodeId, 'child');
  assert.equal(exported.nodes[0].bossId, 'individual-management');
  assert.equal(exported.nodes[0].leaderId, 'individual-management');
});

test('knowledge import and export preserve projected program lock state', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const lockState = {
    path: '推进流总控/设标',
    writeFields: ['name', 'detail'],
    readFields: [],
    reasons: [{ code: 'FRAMEWORK_SCHEMA', message: '预定义内容已锁定' }],
    sources: ['推进流总控/推进流路由']
  };

  assert.equal(workspace.importKnowledge({
    nodes: [{ id: 'set-standard', path: 'root', label: '设标', lockState }],
    edges: []
  }), true);

  assert.deepEqual(plain(workspace.projectDomain('root', [])[0].lockState), lockState);
  assert.deepEqual(plain(workspace.exportKnowledge().nodes[0].lockState), lockState);
});

test('knowledge import and export preserve projected Atom registration types', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  assert.equal(workspace.importKnowledge({
    nodes: [{ id: 'agent', path: 'root', label: 'Work Agent', atomTypes: ['agent'] }],
    edges: []
  }), true);

  assert.deepEqual(plain(workspace.projectDomain('root', [])[0].atomTypes), ['agent']);
  assert.deepEqual(plain(workspace.exportKnowledge().nodes[0].atomTypes), ['agent']);
});

test('node edit draft carries one structured Atom type into the committed operation', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  workspace.importKnowledge({
    nodes: [{ id: 'node', path: 'root', label: 'Node', atomTypes: ['agent'] }], edges: []
  });
  const node = workspace.projectDomain('root', [])[0];
  workspace.beginNodeEdit('root', node);
  workspace.updateNodeDraft({ atomTypes: ['program'], atomTypesChanged: true });
  const operation = workspace.commit();

  assert.deepEqual(plain(operation.draft.atomTypes), ['program']);
  assert.equal(operation.atomTypesChanged, true);
});

test('node name edit does not imply an Atom registration type change', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  workspace.importKnowledge({
    nodes: [{ id: 'agent', path: 'root', label: 'Manage', atomTypes: ['agent'] }], edges: []
  });
  const node = workspace.projectDomain('root', [])[0];
  workspace.beginNodeEdit('root', node);
  workspace.updateNodeDraft({ label: 'Manage renamed', atomTypes: [] });
  const operation = workspace.commit();

  assert.equal(operation.atomTypesChanged, false);
});

test('knowledge export strips circular visual projection state from persisted nodes', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const node = workspace.beginNodeCreate('root', {
    label: '可序列化节点',
    description: '只导出知识字段'
  });
  workspace.commit();
  const projected = workspace.projectDomain('root', [])[0];
  const satellite = { id: 'visual-child', parent: projected };
  projected.satellites = [satellite];
  projected.parent = projected;

  const knowledge = workspace.exportKnowledge();
  assert.doesNotThrow(() => JSON.stringify(knowledge));
  assert.equal('parent' in knowledge.nodes[0], false);
  assert.equal('satellites' in knowledge.nodes[0], false);
  assert.equal(knowledge.nodes[0].label, node.label);
  assert.equal(knowledge.nodes[0].detail, node.description);
});

test('layout relationship projection includes only committed same-domain workspace edges', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const endpoint = (path, id) => model.qualifiedEndpoint(path, { id, label: id }, [path]);

  workspace.beginEdgeCreate(endpoint('root', 'a'));
  workspace.setEdgeTarget(endpoint('root', 'b'));
  workspace.commit();
  workspace.beginEdgeCreate(endpoint('root', 'a'));
  workspace.setEdgeTarget(endpoint('root/child', 'c'));
  workspace.commit();

  assert.deepEqual(
    plain(workspace.relationshipPairsForPath('root')),
    [{ fromId: 'a', toId: 'b', kind: 'association', label: '关联' }]
  );
  assert.deepEqual(plain(workspace.relationshipPairsForPath('root/child')), []);
});

test('existing edge delete has warning and is only suppressed after commit', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const edge = {
    id: 'root::a->root::b',
    from: { key: 'root::a', path: 'root', nodeId: 'a', label: 'A', pathLabels: ['全域'] },
    to: { key: 'root::b', path: 'root', nodeId: 'b', label: 'B', pathLabels: ['全域'] },
    crossDomain: false
  };

  workspace.beginEdgeEdit(edge);
  workspace.markDelete();
  assert.equal(workspace.edgeVisualState(edge), 'delete');
  assert.equal(workspace.isEdgeSuppressed(edge), false);
  workspace.commit();
  assert.equal(workspace.isEdgeSuppressed(edge), true);
});

test('existing relation label can be edited before commit', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const endpoint = (path, id, label) => model.qualifiedEndpoint(path, { id, label }, [path]);
  const left = endpoint('root', 'left', '左');
  const right = endpoint('root', 'right', '右');
  workspace.beginEdgeCreate(left);
  workspace.setEdgeTarget(right);
  workspace.commit();
  const edge = workspace.exportKnowledge().edges[0];
  workspace.beginEdgeEdit(edge);
  assert.equal(workspace.updateEdgeDraft({ label: '因果约束' }), true);
  workspace.commit();
  assert.equal(workspace.exportKnowledge().edges[0].label, '因果约束');
});

test('discarding a transient added node leaves no tombstone or future id collision', () => {
  const model = loadModel();
  const workspace = model.createWorkspace();
  const demoNode = workspace.beginNodeCreate('root', { label: '【演示·20260723-120000】临时节点' });
  workspace.commit();

  assert.equal(workspace.discardAddedNode(`root::${demoNode.id}`), true);
  const cleaned = workspace.exportKnowledge();
  assert.equal(cleaned.nodes.length, 0);
  assert.equal(cleaned.deletedNodeKeys.length, 0);

  const reopened = model.createWorkspace();
  assert.equal(reopened.importKnowledge(cleaned), true);
  const replacement = reopened.beginNodeCreate('root', { label: '正式节点' });
  reopened.commit();

  assert.equal(reopened.projectDomain('root', []).some((node) => node.id === replacement.id), true);
  assert.equal(reopened.exportKnowledge().deletedNodeKeys.length, 0);
});

test('authoritative rename remaps the visible subtree without an empty projection frame', () => {
  const model = loadModel();
  const previousKnowledge = {
    nodes: [
      {
        id: 'old-parent', key: 'root/domain::old-parent', path: 'root/domain',
        atomPath: '旧父级', label: '旧父级'
      },
      {
        id: 'old-child', key: 'root/domain/old-branch::old-child', path: 'root/domain/old-branch',
        atomPath: '旧父级/子节点', label: '子节点'
      }
    ]
  };
  const nextKnowledge = {
    nodes: [
      {
        id: 'new-parent', key: 'root/domain::new-parent', path: 'root/domain',
        atomPath: '新父级', label: '新父级'
      },
      {
        id: 'new-child', key: 'root/domain/new-branch::new-child', path: 'root/domain/new-branch',
        atomPath: '新父级/子节点', label: '子节点'
      }
    ]
  };
  const transitions = model.operationIdentityTransitions({
    kind: 'node-edit',
    path: 'root/domain',
    nodeKey: 'root/domain::old-parent',
    node: previousKnowledge.nodes[0],
    draft: { label: '新父级' }
  }, nextKnowledge, previousKnowledge, nextKnowledge.nodes[0]);

  assert.deepEqual(plain(transitions), [
    {
      from: { key: 'root/domain::old-parent', path: 'root/domain', id: 'old-parent' },
      to: { key: 'root/domain::new-parent', path: 'root/domain', id: 'new-parent' }
    },
    {
      from: { key: 'root/domain/old-branch::old-child', path: 'root/domain/old-branch', id: 'old-child' },
      to: { key: 'root/domain/new-branch::new-child', path: 'root/domain/new-branch', id: 'new-child' }
    }
  ]);
  assert.deepEqual(
    plain(model.remapIdentity({ path: 'root/domain', id: 'old-parent' }, transitions)),
    { path: 'root/domain', id: 'new-parent' }
  );

  const authoritative = new Map(nextKnowledge.nodes.map((node) => [node.key, node]));
  const screen = { x: 420, y: 240, radius: 36 };
  const reconciled = model.reconcileVisualItems([
    {
      kind: 'node', ownerPath: 'root/domain',
      node: {
        ...previousKnowledge.nodes[0],
        isWorkspaceNode: true,
        semanticStage: 'interior',
        revealed: true,
        layoutIdentity: 'stable-layout-root'
      },
      screen
    },
    { kind: 'node', ownerPath: 'root/domain/old-branch', node: { ...previousKnowledge.nodes[1], isWorkspaceNode: true }, screen: { x: 510, y: 270, radius: 20 } }
  ], transitions, ({ path, id }) => authoritative.get(`${path}::${id}`) || null);

  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].node.id, 'new-parent');
  assert.equal(reconciled[0].ownerPath, 'root/domain');
  assert.deepEqual(plain(reconciled[0].screen), screen);
  assert.equal(reconciled[0].node.semanticStage, 'interior');
  assert.equal(reconciled[0].node.revealed, true);
  assert.equal(reconciled[0].node.layoutIdentity, 'stable-layout-root');
  assert.equal(reconciled[1].node.id, 'new-child');
  assert.equal(reconciled[1].ownerPath, 'root/domain/new-branch');
});

test('authoritative create replaces the temporary identity without dropping the visible node', () => {
  const model = loadModel();
  const draft = {
    id: 'workspace-node-1',
    key: 'root::workspace-node-1',
    workspacePath: 'root',
    label: '新节点'
  };
  const persisted = {
    id: 'json-authoritative',
    key: 'root::json-authoritative',
    path: 'root',
    atomPath: '新节点',
    label: '新节点'
  };
  const transitions = model.operationIdentityTransitions(
    { kind: 'node-create', path: 'root', draft },
    { nodes: [persisted] },
    { nodes: [] },
    persisted
  );

  assert.deepEqual(plain(transitions), [{
    from: { key: 'root::workspace-node-1', path: 'root', id: 'workspace-node-1' },
    to: { key: 'root::json-authoritative', path: 'root', id: 'json-authoritative' }
  }]);
  assert.deepEqual(
    plain(model.remapIdentity({ path: 'root', id: 'workspace-node-1' }, transitions)),
    { path: 'root', id: 'json-authoritative' }
  );
});
