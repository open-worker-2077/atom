const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCodec() {
  const file = path.join(__dirname, '..', 'spatial-mermaid-codec.js');
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'spatial-mermaid-codec.js' });
  }
  return sandbox.window.SpatialMermaidCodec;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('parses nested Mermaid names details and labelled relations without importing 2d shapes', () => {
  const codec = loadCodec();
  assert.ok(codec, 'SpatialMermaidCodec must exist');

  const document = codec.parse(`
\`\`\`mermaid
flowchart LR
  subgraph SUBJECT["数学"]
    direction TB
    GEO{"几何<br/>研究空间、形状与关系"}
    ALG["代数<br/>研究数量和符号运算"]
    GEO -- "接续" --> ALG
  end
\`\`\`
  `);

  assert.equal(document.direction, 'LR');
  assert.equal(document.roots.length, 1);
  assert.equal(document.roots[0].kind, 'group');
  assert.equal(document.roots[0].label, '数学');
  assert.deepEqual(
    plain(document.roots[0].children.map((node) => ({ kind: node.kind, label: node.label, detail: node.detail }))),
    [
      { kind: 'node', label: '几何', detail: '研究空间、形状与关系' },
      { kind: 'node', label: '代数', detail: '研究数量和符号运算' }
    ]
  );
  assert.deepEqual(plain(document.edges), [{ from: 'GEO', to: 'ALG', label: '接续' }]);
  assert.equal('shape' in document.roots[0].children[0], false);
});

test('plans exact-name detail replacement and additions while preserving children and uninvolved knowledge', () => {
  const codec = loadCodec();
  const targetPath = 'root/selected-domain';
  const existingGeo = {
    id: 'geo-existing',
    key: `${targetPath}::geo-existing`,
    path: targetPath,
    label: '几何',
    detail: '旧详情',
    position: { x: 0, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: true,
    surfaceVisible: true,
    aliases: []
  };
  const childPath = `${targetPath}/1w1w50h`;
  const arithmetic = {
    id: 'arithmetic',
    key: `${targetPath}::arithmetic`,
    path: targetPath,
    label: '算术',
    detail: '原有知识',
    position: { x: 1, y: 0, z: 0 },
    radius: 0.82,
    hasChildren: false,
    surfaceVisible: true,
    aliases: []
  };
  const knowledge = {
    nodes: [
      existingGeo,
      arithmetic,
      {
        id: 'geo-child',
        key: `${childPath}::geo-child`,
        path: childPath,
        label: '欧氏几何',
        detail: '既有子节点',
        position: { x: 0, y: 0, z: 0 },
        radius: 0.82,
        hasChildren: false,
        surfaceVisible: true,
        aliases: []
      }
    ],
    edges: [{
      id: `relation:${existingGeo.key}<->${arithmetic.key}`,
      from: { key: existingGeo.key, path: targetPath, nodeId: existingGeo.id, label: existingGeo.label },
      to: { key: arithmetic.key, path: targetPath, nodeId: arithmetic.id, label: arithmetic.label },
      label: '旧有外部关系'
    }],
    nodePatches: [],
    deletedNodeKeys: [],
    removedEdgeIds: []
  };
  const document = codec.parse(`
flowchart LR
  GEO["几何<br/>新详情"]
  ALG["代数<br/>新增详情"]
  GEO -- "接续" --> ALG
  `);

  const plan = codec.planImport(knowledge, document, {
    path: targetPath,
    parentKey: 'root::selected',
    parentLabel: '数学'
  });
  const nodes = plain(plan.knowledge.nodes);
  const geo = nodes.find((node) => node.key === existingGeo.key);
  const algebra = nodes.find((node) => node.label === '代数');

  assert.equal(geo.detail, '新详情');
  assert.equal(nodes.some((node) => node.label === '欧氏几何' && node.path === childPath), true);
  assert.equal(nodes.some((node) => node.label === '算术'), true);
  assert.ok(algebra);
  assert.deepEqual(plain(plan.summary), {
    target: '数学',
    addedNodes: 1,
    updatedNodes: 1,
    addedOrUpdatedEdges: 1,
    removedEdges: 0,
    maxDepth: 0
  });
  assert.equal(plan.knowledge.edges.some((edge) => edge.label === '旧有外部关系'), true);
  assert.equal(plan.knowledge.edges.some((edge) => edge.label === '接续'), true);
});

test('uses exact visible names so a punctuation change creates a new node', () => {
  const codec = loadCodec();
  const knowledge = {
    nodes: [{
      id: 'geo', key: 'root::geo', path: 'root', label: '几何', detail: '原详情',
      position: { x: 0, y: 0, z: 0 }, radius: 0.82, hasChildren: false, surfaceVisible: true, aliases: []
    }],
    edges: []
  };
  const document = codec.parse('flowchart LR\nGEO["几何学<br/>新节点详情"]');
  const plan = codec.planImport(knowledge, document, { path: 'root', parentKey: null, parentLabel: '全局' });

  assert.equal(plan.knowledge.nodes.length, 2);
  assert.equal(plan.knowledge.nodes.find((node) => node.label === '几何').detail, '原详情');
  assert.equal(plan.knowledge.nodes.find((node) => node.label === '几何学').detail, '新节点详情');
});

test('rejects missing details duplicate names and unknown relation endpoints atomically', () => {
  const codec = loadCodec();

  assert.throws(
    () => codec.parse('flowchart LR\nA["只有名称"]'),
    (error) => error.code === 'MISSING_DETAIL'
  );
  assert.throws(
    () => codec.parse('flowchart LR\nA["同名<br/>详情一"]\nB["同名<br/>详情二"]'),
    (error) => error.code === 'DUPLICATE_NAME'
  );
  assert.throws(
    () => codec.parse('flowchart LR\nA["节点A<br/>详情"]\nA --> B'),
    (error) => error.code === 'UNKNOWN_ENDPOINT'
  );
});

test('exports a selected subtree as parseable Mermaid with details nesting and relations', () => {
  const codec = loadCodec();
  const math = {
    id: 'math', key: 'root::math', path: 'root', label: '数学', detail: '研究数量、结构与空间',
    position: { x: 0, y: 0, z: 0 }, radius: 0.82, hasChildren: true, surfaceVisible: true, aliases: []
  };
  const mathPath = 'root/1u6n8nj';
  const geometry = {
    id: 'geometry', key: `${mathPath}::geometry`, path: mathPath, label: '几何', detail: '研究空间与形状',
    position: { x: -1, y: 0, z: 0 }, radius: 0.82, hasChildren: false, surfaceVisible: true, aliases: []
  };
  const algebra = {
    id: 'algebra', key: `${mathPath}::algebra`, path: mathPath, label: '代数', detail: '研究符号与运算',
    position: { x: 1, y: 0, z: 0 }, radius: 0.82, hasChildren: false, surfaceVisible: true, aliases: []
  };
  const knowledge = {
    nodes: [math, geometry, algebra],
    edges: [{
      id: `relation:${geometry.key}<->${algebra.key}`,
      from: { key: geometry.key, path: mathPath, nodeId: geometry.id, label: geometry.label },
      to: { key: algebra.key, path: mathPath, nodeId: algebra.id, label: algebra.label },
      label: '接续'
    }]
  };

  const source = codec.exportMermaid(knowledge, { key: math.key });
  assert.match(source, /^flowchart LR/m);
  assert.match(source, /subgraph\s+M\w+\["数学<br\/>研究数量、结构与空间"\]/);
  assert.match(source, /\["几何<br\/>研究空间与形状"\]/);
  assert.match(source, /-- "接续" -->/);
  assert.doesNotMatch(source, /\{/);

  const document = codec.parse(source);
  assert.equal(document.roots[0].label, '数学');
  assert.equal(document.roots[0].detail, '研究数量、结构与空间');
  assert.deepEqual(plain(document.roots[0].children.map((node) => node.label)), ['几何', '代数']);
});

test('exports empty-detail leaves without blocking the user', () => {
  const codec = loadCodec();
  const knowledge = {
    nodes: [{
      id: 'empty', key: 'root::empty', path: 'root', label: '未命名节点', detail: '',
      position: { x: 0, y: 0, z: 0 }, radius: 0.82, hasChildren: false, surfaceVisible: false, aliases: []
    }],
    edges: []
  };

  const source = codec.exportMermaid(knowledge);
  assert.match(source, /未命名节点/);
  assert.doesNotThrow(() => codec.exportMermaid(knowledge));
});
