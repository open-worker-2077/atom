import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atomsIn(document) {
  return Array.isArray(document) ? document : [document];
}

function fieldEntry(atom, baseKey) {
  return Object.entries(atom).find(([rawKey]) => (
    parseAtomKey(rawKey, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}

function graphNode(document, name) {
  const queue = [document.graph];
  while (queue.length) {
    const node = queue.shift();
    if (node.name === name) return node;
    queue.push(...node.children);
  }
  return null;
}

async function fileText(file) {
  return fs.readFile(file, 'utf8');
}

function assertRejected(result, codePattern) {
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result), codePattern);
}

function threeLevelTernaryGraph() {
  const adjacentPartners = (names, index) => (
    [names[index - 1], names[index + 1]]
      .filter(Boolean)
      .map((object) => ({ verb: '相邻', object }))
  );
  const secondLevelNames = ['二层-1', '二层-2', '二层-3'];
  const children = secondLevelNames.map((name, secondIndex) => {
    const thirdLevelNames = [1, 2, 3].map((number) => (
      `三层-${secondIndex + 1}-${number}`
    ));
    return {
      name,
      detail: '第 2 层节点',
      children: thirdLevelNames.map((thirdName, thirdIndex) => ({
        name: thirdName,
        detail: '第 3 层叶节点',
        children: [],
        partners: adjacentPartners(thirdLevelNames, thirdIndex)
      })),
      partners: adjacentPartners(secondLevelNames, secondIndex)
    };
  });
  return {
    name: '三层三叉相邻图',
    detail: '根节点算第 1 层；每个非叶节点有 3 个子节点',
    children,
    partners: []
  };
}

function walkAtomTree(root) {
  const atoms = [];
  const queue = [root];
  while (queue.length) {
    const atom = queue.shift();
    atoms.push(atom);
    queue.push(...atom.children);
  }
  return atoms;
}

function assertAdjacentSiblings(siblings) {
  const names = siblings.map((atom) => atom.name);
  siblings.forEach((atom, index) => {
    assert.deepEqual(
      atom.partners,
      [names[index - 1], names[index + 1]]
        .filter(Boolean)
        .map((object) => ({ verb: '相邻', object }))
    );
  });
}

test('transform new creates a three-level ternary Graph with adjacent sibling partners', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-ternary-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const sourceGraph = threeLevelTernaryGraph();

  const created = await executeAtomLanguage({
    source: `transform new ${JSON.stringify(sourceGraph)}`,
    contextFile,
    projectionFile
  });
  assert.equal(created.ok, true, JSON.stringify(created.errors));

  const [persisted] = JSON.parse(await fileText(contextFile));
  assert.equal(walkAtomTree(persisted).length, 13);
  assert.equal(persisted.children.length, 3);
  assertAdjacentSiblings(persisted.children);
  for (const secondLevel of persisted.children) {
    assert.equal(secondLevel.children.length, 3);
    assertAdjacentSiblings(secondLevel.children);
  }

  const projected = parseGraphDocument(JSON.parse(await fileText(projectionFile)));
  const projectedRoot = graphNode(projected, sourceGraph.name);
  assert.ok(projectedRoot);
  assert.equal(walkAtomTree(projectedRoot).length, 13);
  assertAdjacentSiblings(projectedRoot.children);
  for (const secondLevel of projectedRoot.children) {
    assertAdjacentSiblings(secondLevel.children);
  }

  const contextBeforeExplore = await fileText(contextFile);
  const projectionBeforeExplore = await fileText(projectionFile);
  const exploreCases = [
    {
      source: 'explore {"name":"三层三叉相邻图","children$latitude-2"}',
      names: [
        '三层三叉相邻图',
        '二层-1',
        '三层-1-1',
        '三层-1-2',
        '三层-1-3',
        '二层-2',
        '三层-2-1',
        '三层-2-2',
        '三层-2-3',
        '二层-3',
        '三层-3-1',
        '三层-3-2',
        '三层-3-3'
      ]
    },
    {
      source: 'explore {"name":"三层-2-2","children$latitude2"}',
      names: ['三层三叉相邻图', '二层-2', '三层-2-2']
    },
    {
      source: 'explore {"name":"三层-2-2","children$longitude-1$longitude1"}',
      names: ['三层-2-1', '三层-2-2', '三层-2-3']
    },
    {
      source: 'explore {"name":"二层-2","children$longitude-1$longitude1"}',
      names: ['二层-1', '二层-2', '二层-3']
    }
  ];
  for (const exploreCase of exploreCases) {
    const explored = await executeAtomLanguage({
      source: exploreCase.source,
      contextFile,
      projectionFile
    });
    assert.equal(explored.ok, true, JSON.stringify(explored.errors));
    assert.deepEqual(
      explored.items[0].matches.map((match) => match.name),
      exploreCase.names
    );
    if (exploreCase.partners) {
      assert.deepEqual(
        explored.items[0].matches.map((match) => match.partners.length),
        [1, 2, 1]
      );
      assert.ok(
        explored.items[0].matches
          .flatMap((match) => match.partners)
          .every((partner) => partner.verb === '相邻')
      );
    }
  }
  assert.equal(await fileText(contextFile), contextBeforeExplore);
  assert.equal(await fileText(projectionFile), projectionBeforeExplore);

  let cliOutput = '';
  let cliErrors = '';
  const cliCode = await runAtomCli([
    '--context',
    contextFile,
    '--projection',
    projectionFile,
    'explore',
    '{"name":"二层-2","children$longitude-1$longitude1"}'
  ], {
    execute: executeAtomLanguage,
    stdin: { isTTY: false },
    stdout: {
      isTTY: false,
      write(value) {
        cliOutput += value;
      }
    },
    stderr: {
      write(value) {
        cliErrors += value;
      }
    }
  });
  assert.equal(cliCode, 0, cliErrors);
  const cliView = materializeGraphJson(parseGraphJson(cliOutput));
  assert.deepEqual(cliView.map((atom) => atom.name), [
    '二层-1',
    '二层-2',
    '二层-3'
  ]);
});

test('operational Atom Language closes one isolated transform/explore/projection loop', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-operation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const otherContextFile = path.join(directory, 'other-context.json');
  const ambiguousContextFile = path.join(directory, 'ambiguous-context.json');
  const ambiguousProjectionFile = path.join(directory, 'ambiguous-graph.json');

  const otherContext = {
    name: '河岸',
    detail: '另一个上下文不得改变',
    children: [],
    partners: []
  };
  await fs.writeFile(
    otherContextFile,
    `${JSON.stringify(otherContext, null, 2)}\n`,
    'utf8'
  );
  const otherBefore = await fileText(otherContextFile);

  const created = await executeAtomLanguage({
    source: `transform new {
      "name@agent": "石器工坊",
      "detail#保存石器与工具的工坊": "第一版完整正文",
      "children": [],
      "partners": []
    }`,
    contextFile,
    projectionFile
  });
  assert.equal(created.ok, true);

  const persistedAfterCreate = JSON.parse(await fileText(contextFile));
  const atomsAfterCreate = atomsIn(persistedAfterCreate);
  assert.equal(atomsAfterCreate.length, 1);
  const workshop = atomsAfterCreate[0];
  assert.deepEqual(
    Object.keys(workshop)
      .map((rawKey) => parseAtomKey(rawKey, {
        descriptionSymbolWarnings: false
      }).baseKey)
      .sort(),
    ['children', 'detail', 'name', 'partners']
  );
  assert.equal(fieldEntry(workshop, 'name')[0], 'name@agent');
  assert.equal(fieldEntry(workshop, 'name')[1], '石器工坊');
  assert.equal(
    fieldEntry(workshop, 'detail')[0],
    'detail#保存石器与工具的工坊'
  );

  const projectionAfterCreateText = await fileText(projectionFile);
  const projectionAfterCreate = parseGraphDocument(
    JSON.parse(projectionAfterCreateText)
  );
  assert.ok(graphNode(projectionAfterCreate, '石器工坊'));

  const duplicateContextBefore = await fileText(contextFile);
  const duplicateProjectionBefore = await fileText(projectionFile);
  const duplicate = await executeAtomLanguage({
    source: `transform new {
      "name": "石器工坊",
      "detail": "不得覆盖",
      "children": [],
      "partners": []
    }`,
    contextFile,
    projectionFile
  });
  assertRejected(duplicate, /(?:ATOM_)?(?:ALREADY_)?EXISTS|DUPLICATE/u);
  assert.equal(await fileText(contextFile), duplicateContextBefore);
  assert.equal(await fileText(projectionFile), duplicateProjectionBefore);

  const updated = await executeAtomLanguage({
    source: `transform {
      "name": "石器工坊",
      "detail.rep.第二版完整正文"
    }`,
    contextFile,
    projectionFile
  });
  assert.equal(updated.ok, true);

  const persistedAfterUpdate = atomsIn(
    JSON.parse(await fileText(contextFile))
  )[0];
  assert.equal(fieldEntry(persistedAfterUpdate, 'name')[0], 'name@agent');
  assert.equal(
    fieldEntry(persistedAfterUpdate, 'detail')[0],
    'detail#保存石器与工具的工坊'
  );
  assert.equal(
    fieldEntry(persistedAfterUpdate, 'detail')[1],
    '第二版完整正文'
  );

  const projectionAfterUpdateText = await fileText(projectionFile);
  assert.notEqual(projectionAfterUpdateText, projectionAfterCreateText);
  const projectionAfterUpdate = parseGraphDocument(
    JSON.parse(projectionAfterUpdateText)
  );
  assert.equal(
    graphNode(projectionAfterUpdate, '石器工坊').detail,
    '第二版完整正文'
  );

  const beforeExploreContext = await fileText(contextFile);
  const beforeExploreProjection = await fileText(projectionFile);
  const explored = await executeAtomLanguage({
    source: 'explore {"name":"石器工坊","detail$full"}',
    contextFile,
    projectionFile
  });
  assert.equal(explored.ok, true);
  assert.match(JSON.stringify(explored), /第二版完整正文/u);
  assert.equal(await fileText(contextFile), beforeExploreContext);
  assert.equal(await fileText(projectionFile), beforeExploreProjection);

  for (const rejectedSource of [
    'transform {"name":"不存在的 Atom","detail.rep.不得写入"}'
  ]) {
    const contextBefore = await fileText(contextFile);
    const projectionBefore = await fileText(projectionFile);
    const rejected = await executeAtomLanguage({
      source: rejectedSource,
      contextFile,
      projectionFile
    });
    assertRejected(
      rejected,
      /NOT_FOUND/u
    );
    assert.equal(await fileText(contextFile), contextBefore);
    assert.equal(await fileText(projectionFile), projectionBefore);
  }

  const repeated = (detail) => ({
    name: '重名 Atom',
    detail,
    children: [],
    partners: []
  });
  await fs.writeFile(
    ambiguousContextFile,
    `${JSON.stringify([
      repeated('第一项'),
      repeated('第二项')
    ], null, 2)}\n`,
    'utf8'
  );
  const ambiguousBefore = await fileText(ambiguousContextFile);
  const ambiguous = await executeAtomLanguage({
    source: 'transform {"name":"重名 Atom","detail.rep.不得写入"}',
    contextFile: ambiguousContextFile,
    projectionFile: ambiguousProjectionFile
  });
  assertRejected(ambiguous, /AMBIGUOUS/u);
  assert.equal(await fileText(ambiguousContextFile), ambiguousBefore);
  await assert.rejects(
    fs.access(ambiguousProjectionFile),
    (error) => error.code === 'ENOENT'
  );

  assert.equal(await fileText(otherContextFile), otherBefore);
  const generatedNames = await fs.readdir(directory);
  assert.equal(
    generatedNames.some((name) => (
      name.toLowerCase() === 'world.json'
      || name.toLowerCase().endsWith('.world.json')
    )),
    false
  );
});

test('operational writes reject colliding files, preserve long context detail, and skip semantic no-ops', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-safety-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');

  const collision = await executeAtomLanguage({
    source: 'transform new {"name":"危险目标","detail":"","children":[],"partners":[]}',
    contextFile,
    projectionFile: contextFile
  });
  assertRejected(collision, /PATH_COLLISION/u);
  await assert.rejects(fs.access(contextFile), { code: 'ENOENT' });

  const longDetail = '长'.repeat(4001);
  const created = await executeAtomLanguage({
    source: `transform new {"name":"长正文","detail":${JSON.stringify(longDetail)},"children":[],"partners":[]}`,
    contextFile,
    projectionFile
  });
  assert.equal(created.ok, true);
  assert.equal(fieldEntry(JSON.parse(await fileText(contextFile))[0], 'detail')[1], longDetail);
  assert.equal(graphNode(JSON.parse(await fileText(projectionFile)), '长正文').detail, longDetail);

  const contextBefore = await fileText(contextFile);
  const projectionBefore = await fileText(projectionFile);
  const noOp = await executeAtomLanguage({
    source: `transform {"name":"长正文",${JSON.stringify(`detail.rep.${longDetail}`)}}`,
    contextFile,
    projectionFile
  });
  assert.equal(noOp.ok, true);
  assert.equal(noOp.changed, false);
  assert.equal(await fileText(contextFile), contextBefore);
  assert.equal(await fileText(projectionFile), projectionBefore);
});
