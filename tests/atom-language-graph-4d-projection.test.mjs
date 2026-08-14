import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectAtomGraphToKnowledge,
  projectAtomGraphWithPaths,
  toGraph4dImportDocument
} from '../work-engine/atom-language/graph-4d-projection.mjs';

function graphDocument(partners = []) {
  return {
    config: { schema_version: '1.0.0' },
    graph: {
      name: 'root',
      detail: '',
      children: [
        {
          name: '石器工坊',
          detail: '可核查的正文',
          children: [],
          partners
        },
        {
          name: '石斧',
          detail: '可核查的物件',
          children: [],
          partners: []
        }
      ],
      partners: []
    }
  };
}

test('toGraph4dImportDocument keeps the atom tree shape and turns partners into from/to relations', () => {
  const { graph } = graphDocument([{ verb: '产出', object: '石斧' }]);
  const document = toGraph4dImportDocument(graph);

  assert.equal(document.format, 'graph-4d');
  assert.equal(document.version, 1);
  assert.equal(document.nodes[0].name, 'root');
  assert.deepEqual(document.nodes[0].children.map((child) => child.name), ['石器工坊', '石斧']);
  assert.equal(document.relations.length, 1);
  assert.deepEqual(document.relations[0].from, ['root', '石器工坊']);
  assert.deepEqual(document.relations[0].to, ['root', '石斧']);
  assert.equal(document.relations[0].name, '产出');
});

test('toGraph4dImportDocument drops a partner whose object cannot be resolved instead of throwing', () => {
  const { graph } = graphDocument([{ verb: '产出', object: '不存在的节点' }]);
  const document = toGraph4dImportDocument(graph);
  assert.equal(document.relations.length, 0);
});

test('toGraph4dImportDocument fills a placeholder detail for leaf atoms with empty detail', () => {
  const document = toGraph4dImportDocument({
    name: 'root',
    detail: '',
    partners: [],
    children: [
      { name: '空详情节点', detail: '', partners: [], children: [] }
    ]
  });
  assert.match(document.nodes[0].children[0].detail, /空详情节点/);
});

test('projectAtomGraphToKnowledge produces a real spatial knowledge store from an atom graph document', async () => {
  const knowledge = await projectAtomGraphToKnowledge(graphDocument([{ verb: '产出', object: '石斧' }]));
  const labels = knowledge.nodes.map((node) => node.label);
  assert.ok(labels.includes('石器工坊'));
  assert.ok(labels.includes('石斧'));
  assert.equal(knowledge.edges.length, 1);
  assert.equal(knowledge.edges[0].label, '产出');
});

test('projection keeps a server-side key to Atom path index for human status edits', async () => {
  const { knowledge, atomPathByKey } = await projectAtomGraphWithPaths(graphDocument());
  const workshop = knowledge.nodes.find((node) => node.label === '石器工坊');
  assert.equal(atomPathByKey.get(workshop.key), '石器工坊');
});

test('projection exposes derived lock state without changing Atom detail', async () => {
  const { knowledge } = await projectAtomGraphWithPaths(graphDocument(), {
    lockState: [{ path: '石器工坊', writeFields: ['name', 'detail'], reasons: [{ code: 'FRAMEWORK_SCHEMA', message: '框架锁' }] }]
  });
  const workshop = knowledge.nodes.find((node) => node.label === '石器工坊');
  assert.deepEqual(workshop.lockState.writeFields, ['name', 'detail']);
  assert.equal(workshop.detail, '可核查的正文');
});

test('spatial projection hides every relation entering or leaving the default backup subtree', async () => {
  const document = {
    config: { schema_version: '1.0.0' },
    graph: {
      name: 'root', detail: '', partners: [], children: [
        {
          name: '活动来源', detail: '', children: [], partners: [
            { verb: '保留', object: '活动目标' },
            { verb: '隐藏入边', object: 'root/默认备份仓/已删除' }
          ]
        },
        { name: '活动目标', detail: '', children: [], partners: [] },
        {
          name: '默认备份仓', detail: '', partners: [], children: [
            {
              name: '已删除', detail: '', children: [],
              partners: [{ verb: '隐藏出边', object: 'root/活动目标' }]
            }
          ]
        }
      ]
    }
  };
  const knowledge = await projectAtomGraphToKnowledge(document, {
    atomTypesByPath: new Map([['默认备份仓', ['backup', 'default']]])
  });

  assert.deepEqual(Array.from(knowledge.edges, (edge) => edge.label), ['保留']);
});
