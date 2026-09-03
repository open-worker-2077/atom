import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectAtomGraphToKnowledge,
  projectAtomGraphWithPaths,
  toGraph4dImportDocument
} from '../work-engine/atom-language/graph-4d-projection.mjs';

function graphDocument(strut = []) {
  return {
    config: { schema_version: '3.0.0' },
    graph: {
      thing: 'root',
      situation: '',
      slot: [
        {
          thing: '石器工坊',
          situation: '可核查的正文',
          slot: [],
          strut
        },
        {
          thing: '石斧',
          situation: '可核查的物件',
          slot: [],
          strut: []
        }
      ],
      strut: []
    }
  };
}

test('toGraph4dImportDocument keeps slot shape and turns strut into directed relations', () => {
  const { graph } = graphDocument([{ 'if@current': true, then: [{ thing: '石斧' }] }]);
  const document = toGraph4dImportDocument(graph);

  assert.equal(document.format, 'graph-4d');
  assert.equal(document.version, 1);
  assert.equal(document.nodes[0].name, 'root');
  assert.deepEqual(document.nodes[0].children.map((child) => child.name), ['石器工坊', '石斧']);
  assert.equal(document.relations.length, 1);
  assert.deepEqual(document.relations[0].from, ['root', '石器工坊']);
  assert.deepEqual(document.relations[0].to, ['root', '石斧']);
  assert.equal(document.relations[0].name, 'strut');
});

test('toGraph4dImportDocument rejects an unresolved strut selector before projection', () => {
  const { graph } = graphDocument([{ 'if@current': true, then: [{ thing: '不存在的节点' }] }]);
  assert.throws(() => toGraph4dImportDocument(graph), {
    code: 'STRUT_SELECTOR_NOT_FOUND'
  });
});

test('toGraph4dImportDocument fills a placeholder detail for leaf atoms with empty detail', () => {
  const document = toGraph4dImportDocument({
    thing: 'root',
    situation: '',
    strut: [],
    slot: [
      { thing: '空详情节点', situation: '', strut: [], slot: [] }
    ]
  });
  assert.match(document.nodes[0].children[0].detail, /空详情节点/);
});

test('projectAtomGraphToKnowledge produces a real spatial knowledge store from an atom graph document', async () => {
  const knowledge = await projectAtomGraphToKnowledge(graphDocument([{
    'if@current': true, then: [{ thing: '石斧' }]
  }]));
  const labels = knowledge.nodes.map((node) => node.label);
  assert.ok(labels.includes('石器工坊'));
  assert.ok(labels.includes('石斧'));
  assert.equal(knowledge.edges.length, 1);
  assert.equal(knowledge.edges[0].label, 'strut');
});

test('projection keeps a server-side key to Atom path index for human status edits', async () => {
  const { knowledge, atomPathByKey } = await projectAtomGraphWithPaths(graphDocument());
  const workshop = knowledge.nodes.find((node) => node.label === '石器工坊');
  assert.equal(atomPathByKey.get(workshop.key), '石器工坊');
});

test('projection keeps Graph paths, strut clauses, and Program source for the real Web renderer', async () => {
  const document = graphDocument();
  document.graph.slot[0]['thing@program'] = document.graph.slot[0].thing;
  delete document.graph.slot[0].thing;
  document.graph.slot[0].situation = 'def main(arguments):\n    return True';
  document.graph.slot.push({
    thing: '工坊状态', situation: '', slot: [], strut: [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: '石斧' }]
    }]
  });
  const { knowledge } = await projectAtomGraphWithPaths(document);
  const workshop = knowledge.nodes.find((node) => node.label === '石器工坊');

  assert.equal(workshop.graphPath, 'root/石器工坊');
  assert.equal(workshop.programSource, 'def main(arguments):\n    return True');
  assert.equal(workshop.detail, 'Program');
  assert.equal(knowledge.strutClauses.length, 1);
  assert.equal(knowledge.strutClauses[0].currentSide, 'antecedent');
});

test('projection exposes derived lock state without changing Atom detail', async () => {
  const { knowledge } = await projectAtomGraphWithPaths(graphDocument(), {
    lockState: [{ path: '石器工坊', writeFields: ['thing', 'situation'], reasons: [{ code: 'FRAMEWORK_SCHEMA', message: '框架锁' }] }]
  });
  const workshop = knowledge.nodes.find((node) => node.label === '石器工坊');
  assert.deepEqual(workshop.lockState.writeFields, ['thing', 'situation']);
  assert.equal(workshop.detail, '可核查的正文');
});

test('projection exposes only a validated linked shortcut target to the Web knowledge node', async () => {
  const document = graphDocument();
  document.graph.slot.push({
    'thing@shortcut': '快捷入口',
    situation: JSON.stringify({
      contract: 'atom.shortcut',
      version: 1,
      referenceId: '11111111-1111-4111-8111-111111111111',
      target: { state: 'linked', path: '石器工坊' }
    }),
    slot: [],
    strut: []
  });

  const { knowledge } = await projectAtomGraphWithPaths(document, {
    atomTypesByPath: new Map([['快捷入口', ['shortcut']]])
  });
  const shortcut = knowledge.nodes.find((node) => node.label === '快捷入口');

  assert.equal(shortcut.shortcutTargetPath, '石器工坊');
  assert.equal(shortcut.detail, '快捷目标：石器工坊');
  assert.equal(shortcut.detail.includes('11111111-1111-4111-8111-111111111111'), false);
});

test('spatial projection hides every relation entering or leaving the default backup subtree', async () => {
  const document = {
    config: { schema_version: '3.0.0' },
    graph: {
      thing: 'root', situation: '', strut: [], slot: [
        {
          thing: '活动来源', situation: '', slot: [], strut: [
            { 'if@current': true, then: [
              { thing: '活动目标' }, { thing: 'root/默认备份仓/已删除' }
            ] }
          ]
        },
        { thing: '活动目标', situation: '', slot: [], strut: [] },
        {
          thing: '默认备份仓', situation: '', strut: [], slot: [
            {
              thing: '已删除', situation: '', slot: [],
              strut: [{ 'if@current': true, then: [{ thing: 'root/活动目标' }] }]
            }
          ]
        }
      ]
    }
  };
  const knowledge = await projectAtomGraphToKnowledge(document, {
    atomTypesByPath: new Map([['默认备份仓', ['backup', 'default']]])
  });

  assert.deepEqual(Array.from(knowledge.edges, (edge) => edge.label), ['strut']);
});
