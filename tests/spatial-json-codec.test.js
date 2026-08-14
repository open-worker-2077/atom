const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCodec() {
  const file = path.join(__dirname, '..', 'spatial-json-codec.js');
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'spatial-json-codec.js' });
  }
  return sandbox.window.SpatialJsonCodec;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function source(value) {
  return JSON.stringify({ format: 'graph-4d', version: 1, ...value });
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    hash ^= String(text).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function childDomainPath(node) {
  return `${node.path}/${parseInt(hashText(node.id), 16).toString(36)}`;
}

test('parses nested visible knowledge and relative relation paths', () => {
  const codec = loadCodec();
  assert.ok(codec, 'SpatialJsonCodec must exist');
  const document = codec.parse(source({
    nodes: [{
      name: '数学',
      detail: '研究数量、结构与空间',
      children: [
        { name: '几何', detail: '研究空间与形状', children: [] },
        { name: '代数', detail: '研究符号与运算', children: [] }
      ]
    }],
    relations: [{
      from: ['数学', '几何'],
      to: ['数学', '代数'],
      name: '接续'
    }]
  }));

  assert.equal(document.roots[0].label, '数学');
  assert.deepEqual(
    plain(document.roots[0].children.map((node) => ({ label: node.label, detail: node.detail }))),
    [
      { label: '几何', detail: '研究空间与形状' },
      { label: '代数', detail: '研究符号与运算' }
    ]
  );
  assert.deepEqual(plain(document.edges), [{
    fromPath: ['数学', '几何'],
    toPath: ['数学', '代数'],
    label: '接续'
  }]);
});

test('plans exact-name updates and additions while preserving uninvolved knowledge and descendants', () => {
  const codec = loadCodec();
  const targetPath = 'root/selected';
  const existing = {
    id: 'geometry',
    key: `${targetPath}::geometry`,
    path: targetPath,
    label: '几何',
    detail: '旧详情',
    position: { x: 0, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: true,
    surfaceVisible: true,
    aliases: []
  };
  const uninvolved = {
    id: 'arithmetic',
    key: `${targetPath}::arithmetic`,
    path: targetPath,
    label: '算术',
    detail: '保持不变',
    position: { x: 1, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: false,
    surfaceVisible: true,
    aliases: []
  };
  const existingChild = {
    id: 'euclid',
    key: 'root/selected/child::euclid',
    path: 'root/selected/child',
    label: '欧氏几何',
    detail: '既有子节点',
    position: { x: 0, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: false,
    surfaceVisible: true,
    aliases: []
  };
  existing.aliases = [];
  const knowledge = {
    nodes: [existing, uninvolved, existingChild],
    edges: [],
    nodePatches: [],
    deletedNodeKeys: [],
    removedEdgeIds: []
  };
  const document = codec.parse(source({
    nodes: [
      { name: '几何', detail: '新详情', children: [] },
      { name: '代数', detail: '新增详情', children: [] }
    ],
    relations: [{ from: ['几何'], to: ['代数'], name: '接续' }]
  }));
  const plan = codec.planImport(knowledge, document, {
    path: targetPath,
    parentKey: 'root::math',
    parentLabel: '数学'
  });

  assert.equal(plan.knowledge.nodes.find((node) => node.key === existing.key).detail, '新详情');
  assert.equal(plan.knowledge.nodes.some((node) => node.label === '代数' && node.path === targetPath), true);
  assert.equal(plan.knowledge.nodes.some((node) => node.label === '算术'), true);
  assert.equal(plan.knowledge.nodes.some((node) => node.label === '欧氏几何'), true);
  assert.deepEqual(plain(plan.summary), {
    target: '数学',
    addedNodes: 1,
    updatedNodes: 1,
    addedOrUpdatedEdges: 1,
    removedEdges: 0,
    maxDepth: 0
  });
});

test('root import adds another tree without replacing existing global knowledge', () => {
  const codec = loadCodec();
  const knowledge = {
    nodes: [{
      id: 'language',
      key: 'root::language',
      path: 'root',
      label: '语文',
      detail: '既有学科',
      position: { x: 0, y: 0, z: 0 },
      radius: 0.82,
      hasChildren: false,
      surfaceVisible: true,
      aliases: []
    }],
    edges: []
  };
  const document = codec.parse(source({
    nodes: [{ name: '数学', detail: '新学科', children: [] }],
    relations: []
  }));
  const plan = codec.planImport(knowledge, document, {
    path: 'root',
    parentKey: null,
    parentLabel: '全局'
  });

  assert.deepEqual(
    plain(plan.knowledge.nodes.map((node) => node.label).sort()),
    ['数学', '语文']
  );
  assert.deepEqual(plain(plan.warnings), ['未选择母节点，确认后将从全局顶层导入']);
});

test('rejects missing leaf details duplicate sibling names and unknown relation paths atomically', () => {
  const codec = loadCodec();

  assert.throws(
    () => codec.parse(source({ nodes: [{ name: '空节点', detail: '', children: [] }], relations: [] })),
    (error) => error.code === 'MISSING_DETAIL'
  );
  assert.throws(
    () => codec.parse(source({
      nodes: [
        { name: '重复', detail: '一', children: [] },
        { name: '重复', detail: '二', children: [] }
      ],
      relations: []
    })),
    (error) => error.code === 'DUPLICATE_NAME'
  );
  assert.throws(
    () => codec.parse(source({
      nodes: [{ name: '存在', detail: '详情', children: [] }],
      relations: [{ from: ['存在'], to: ['不存在'], name: '关联' }]
    })),
    (error) => error.code === 'UNKNOWN_ENDPOINT'
  );
});

test('exports a selected subtree without internal ids and can import the result again', () => {
  const codec = loadCodec();
  const math = {
    id: 'math',
    key: 'root::math',
    path: 'root',
    label: '数学',
    detail: '研究数量',
    position: { x: 0, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: true,
    surfaceVisible: true,
    aliases: []
  };
  const mathPath = childDomainPath(math);
  const geometry = {
    id: 'geometry',
    key: `${mathPath}::geometry`,
    path: mathPath,
    label: '几何',
    detail: '研究空间',
    position: { x: 0, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: false,
    surfaceVisible: true,
    aliases: []
  };
  const algebra = {
    id: 'algebra',
    key: `${mathPath}::algebra`,
    path: mathPath,
    label: '代数',
    detail: '研究符号',
    position: { x: 1, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: false,
    surfaceVisible: true,
    aliases: []
  };
  const knowledge = {
    nodes: [math, geometry, algebra],
    edges: [{
      id: 'relation:geometry-algebra',
      from: { key: geometry.key, path: geometry.path, nodeId: geometry.id, label: geometry.label },
      to: { key: algebra.key, path: algebra.path, nodeId: algebra.id, label: algebra.label },
      label: '接续'
    }]
  };
  const exported = codec.exportJson(knowledge, { key: math.key });

  assert.doesNotMatch(exported, /"id"|"key"|"aliases"|"deletedNodeKeys"/);
  const parsed = codec.parse(exported);
  assert.equal(parsed.roots[0].label, '数学');
  assert.deepEqual(plain(parsed.roots[0].children.map((node) => node.label)), ['几何', '代数']);
  assert.deepEqual(plain(parsed.edges[0]), {
    fromPath: ['数学', '几何'],
    toPath: ['数学', '代数'],
    label: '接续'
  });
});
