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
import { programFunctionRegistry } from '../work-engine/atom-language/program-function-registry.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atomsIn(document) {
  return Array.isArray(document) ? document : [document];
}

function fieldEntry(atom, baseKey) {
  return Object.entries(atom).find(([rawKey]) => (
    parseAtomKey(rawKey, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}

function graphNode(document, thing) {
  const queue = [document.graph];
  while (queue.length) {
    const node = queue.shift();
    if (fieldEntry(node, 'thing')?.[1] === thing) return node;
    queue.push(...(fieldEntry(node, 'contain')?.[1] ?? []));
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
  const adjacentSupport = (names, index) => {
    const then = [names[index - 1], names[index + 1]]
      .filter(Boolean)
      .map((thing) => ({ thing }));
    return then.length ? [{ 'if@current': true, then }] : [];
  };
  const secondLevelNames = ['二层-1', '二层-2', '二层-3'];
  const contain = secondLevelNames.map((thing, secondIndex) => {
    const thirdLevelNames = [1, 2, 3].map((number) => (
      `三层-${secondIndex + 1}-${number}`
    ));
    return {
      thing,
      situation: '第 2 层节点',
      contain: thirdLevelNames.map((thirdName, thirdIndex) => ({
        thing: thirdName,
        situation: '第 3 层叶节点',
        contain: [],
        support: adjacentSupport(thirdLevelNames, thirdIndex)
      })),
      support: adjacentSupport(secondLevelNames, secondIndex)
    };
  });
  return {
    thing: '三层三叉相邻图',
    situation: '根节点算第 1 层；每个非叶节点有 3 个子节点',
    contain,
    support: []
  };
}

function walkAtomTree(root) {
  const atoms = [];
  const queue = [root];
  while (queue.length) {
    const atom = queue.shift();
    atoms.push(atom);
    queue.push(...atom.contain);
  }
  return atoms;
}

function assertAdjacentSiblings(siblings) {
  const names = siblings.map((atom) => atom.thing);
  siblings.forEach((atom, index) => {
    const then = [names[index - 1], names[index + 1]]
      .filter(Boolean)
      .map((thing) => ({ thing }));
    assert.deepEqual(atom.support, then.length ? [{ 'if@current': true, then }] : []);
  });
}

test('transform new creates a three-level ternary Graph with adjacent sibling support', async (t) => {
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
  assert.equal(persisted.contain.length, 3);
  assertAdjacentSiblings(persisted.contain);
  for (const secondLevel of persisted.contain) {
    assert.equal(secondLevel.contain.length, 3);
    assertAdjacentSiblings(secondLevel.contain);
  }

  const projected = parseGraphDocument(JSON.parse(await fileText(projectionFile)));
  const projectedRoot = graphNode(projected, sourceGraph.thing);
  assert.ok(projectedRoot);
  assert.equal(walkAtomTree(projectedRoot).length, 13);
  assertAdjacentSiblings(projectedRoot.contain);
  for (const secondLevel of projectedRoot.contain) {
    assertAdjacentSiblings(secondLevel.contain);
  }

  const contextBeforeExplore = await fileText(contextFile);
  const projectionBeforeExplore = await fileText(projectionFile);
  const exploreCases = [
    {
      source: 'explore {"thing":"三层三叉相邻图","contain$latitude-2"}',
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
      source: 'explore {"thing":"三层-2-2","contain$latitude2"}',
      names: ['三层三叉相邻图', '二层-2', '三层-2-2']
    },
    {
      source: 'explore {"thing":"三层-2-2","contain$longitude-1$longitude1"}',
      names: ['三层-2-1', '三层-2-2', '三层-2-3']
    },
    {
      source: 'explore {"thing":"二层-2","contain$longitude-1$longitude1"}',
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
      explored.items[0].matches.map((match) => match.thing),
      exploreCase.names
    );
    if (exploreCase.support) {
      assert.deepEqual(
        explored.items[0].matches.map((match) => match.support.length),
        [1, 2, 1]
      );
      assert.ok(
        explored.items[0].matches
          .flatMap((match) => match.support)
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
    '{"thing":"二层-2","contain$longitude-1$longitude1"}'
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
  assert.deepEqual(cliView.map((atom) => atom.thing), [
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
    thing: '河岸',
    situation: '另一个上下文不得改变',
    contain: [],
    support: []
  };
  await fs.writeFile(
    otherContextFile,
    `${JSON.stringify(otherContext, null, 2)}\n`,
    'utf8'
  );
  const otherBefore = await fileText(otherContextFile);

  const agentExample = programFunctionRegistry().functions
    .find((entry) => entry.name === 'agent').contract.argument.example;
  const scheduler = createProgramRuntimeScheduler();
  await fs.writeFile(contextFile, `${JSON.stringify([{
    'thing@agent': '创建Agent',
    situation: '',
    contain: [{
      thing: '工坊区',
      situation: '',
      contain: [{ thing: '既有工件', situation: '', contain: [], support: [] }],
      support: []
    }],
    support: []
  }], null, 2)}\n`, 'utf8');
  await scheduler.registerAgentWindow({
    sourceProgramPath: '创建Agent', labels: ['^'], functions: agentExample.functions.names
  });
  const execute = (request) => executeAtomLanguage({
    ...request, programScheduler: scheduler
  });
  const runOperationalCli = async (agent, source) => {
    let stdout = '';
    let stderr = '';
    const code = await runAtomCli(['--agent', agent, ...source], {
      requireAgent: true,
      defaultContextFile: contextFile,
      defaultProjectionFile: projectionFile,
      execute,
      stdin: { isTTY: false },
      stdout: { isTTY: false, write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } }
    });
    return { code, stdout, stderr };
  };
  const workshopPath = '创建Agent/工坊区/石器工坊';
  const registrationSource = [
    `agent(${JSON.stringify(agentExample)})`,
    'instantiate({"template":"advancement-flow","version":"latest","mode":"ensure","parameters":{"title":"石器工坊"}})'
  ].join('\n');
  const created = await runOperationalCli('创建Agent', [
    'transform', 'new', JSON.stringify({
      'thing@program#保存石器与工具的工坊': workshopPath,
      situation: registrationSource,
      contain: [{
        thing: '工坊说明',
        'situation#保存石器与工具的工坊': '第一版完整正文',
        contain: [],
        support: []
      }],
      support: []
    })
  ]);
  assert.equal(created.code, 0, created.stderr);

  const createdWorld = JSON.parse(await fileText(contextFile));
  const createdProgram = createdWorld[0].contain[0].contain
    .find((entry) => fieldEntry(entry, 'thing')?.[1] === '石器工坊');
  assert.equal(fieldEntry(createdProgram, 'thing')[0], 'thing@program#保存石器与工具的工坊');
  const duplicateContextBefore = await fileText(contextFile);
  const duplicateProjectionBefore = await fileText(projectionFile);
  const duplicate = await execute({
    source: `transform new {
      "thing": "创建Agent/工坊区/既有工件",
      "situation": "不得覆盖",
      "contain": [],
      "support": []
    }`,
    contextFile,
    projectionFile,
    interaction: { id: 'duplicate-workshop', agent: { path: '创建Agent' } }
  });
  assertRejected(duplicate, /(?:ATOM_)?(?:ALREADY_)?EXISTS|DUPLICATE/u);
  assert.equal(await fileText(contextFile), duplicateContextBefore);
  assert.equal(await fileText(projectionFile), duplicateProjectionBefore);

  const registered = await runOperationalCli('创建Agent', [
    'transform', JSON.stringify({ 'thing.run.': workshopPath })
  ]);
  assert.equal(registered.code, 0, registered.stderr);

  const persistedAfterCreate = JSON.parse(await fileText(contextFile));
  const atomsAfterCreate = atomsIn(persistedAfterCreate);
  assert.equal(atomsAfterCreate.length, 1);
  const workshop = atomsAfterCreate[0].contain[0].contain
    .find((entry) => fieldEntry(entry, 'thing')?.[1] === '石器工坊');
  assert.deepEqual(
    Object.keys(workshop)
      .map((rawKey) => parseAtomKey(rawKey, {
        descriptionSymbolWarnings: false
      }).baseKey)
      .sort(),
    ['contain', 'situation', 'support', 'thing']
  );
  assert.equal(
    fieldEntry(workshop, 'thing')[0],
    'thing@program@agent#保存石器与工具的工坊'
  );
  assert.equal(fieldEntry(workshop, 'thing')[1], '石器工坊');
  assert.equal(fieldEntry(workshop, 'situation')[1], registrationSource);
  const workshopDetail = workshop.contain[0];
  assert.equal(fieldEntry(workshopDetail, 'situation')[0], 'situation#保存石器与工具的工坊');

  const projectionAfterCreateText = await fileText(projectionFile);
  const projectionAfterCreate = parseGraphDocument(
    JSON.parse(projectionAfterCreateText)
  );
  assert.ok(graphNode(projectionAfterCreate, '石器工坊'));

  const updated = await execute({
    source: `transform {
      "thing": "${workshopPath}/工坊说明",
      "situation.rep.第二版完整正文"
    }`,
    contextFile,
    projectionFile,
    interaction: { id: 'update-workshop', agent: { path: workshopPath } }
  });
  assert.equal(updated.ok, true);

  const updatedWorkshop = atomsIn(JSON.parse(await fileText(contextFile)))[0]
    .contain[0].contain.find((entry) => fieldEntry(entry, 'thing')?.[1] === '石器工坊');
  const persistedAfterUpdate = updatedWorkshop.contain
    .find((entry) => fieldEntry(entry, 'thing')?.[1] === '工坊说明');
  assert.equal(fieldEntry(persistedAfterUpdate, 'thing')[0], 'thing');
  assert.equal(
    fieldEntry(persistedAfterUpdate, 'situation')[0],
    'situation#保存石器与工具的工坊'
  );
  assert.equal(
    fieldEntry(persistedAfterUpdate, 'situation')[1],
    '第二版完整正文'
  );

  const projectionAfterUpdateText = await fileText(projectionFile);
  assert.notEqual(projectionAfterUpdateText, projectionAfterCreateText);
  const projectionAfterUpdate = parseGraphDocument(
    JSON.parse(projectionAfterUpdateText)
  );
  assert.equal(
    fieldEntry(graphNode(projectionAfterUpdate, '工坊说明'), 'situation')[1],
    '第二版完整正文'
  );

  const beforeExploreContext = await fileText(contextFile);
  const beforeExploreProjection = await fileText(projectionFile);
  const explored = await execute({
    source: `explore {"thing":"${workshopPath}/工坊说明","situation$full"}`,
    contextFile,
    projectionFile,
    interaction: { id: 'explore-workshop', agent: { path: workshopPath } }
  });
  assert.equal(explored.ok, true);
  assert.match(JSON.stringify(explored), /第二版完整正文/u);
  assert.equal(await fileText(contextFile), beforeExploreContext);
  assert.equal(await fileText(projectionFile), beforeExploreProjection);

  for (const rejectedSource of [
    'transform {"thing":"不存在的 Atom","situation.rep.不得写入"}'
  ]) {
    const contextBefore = await fileText(contextFile);
    const projectionBefore = await fileText(projectionFile);
    const rejected = await execute({
      source: rejectedSource,
      contextFile,
      projectionFile,
      interaction: { id: 'missing-workshop', agent: { path: '创建Agent' } }
    });
    assertRejected(
      rejected,
      /NOT_FOUND/u
    );
    assert.equal(await fileText(contextFile), contextBefore);
    assert.equal(await fileText(projectionFile), projectionBefore);
  }

  const repeated = (situation) => ({
    thing: '重名 Atom',
    situation,
    contain: [],
    support: []
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
    source: 'transform {"thing":"重名 Atom","situation.rep.不得写入"}',
    contextFile: ambiguousContextFile,
    projectionFile: ambiguousProjectionFile
  });
  assertRejected(ambiguous, /DUPLICATE_GRAPH_THING/u);
  assert.equal(await fileText(ambiguousContextFile), ambiguousBefore);
  await assert.rejects(
    fs.access(ambiguousProjectionFile),
    (error) => error.code === 'ENOENT'
  );

  assert.equal(await fileText(otherContextFile), otherBefore);
  const generatedNames = await fs.readdir(directory);
  assert.equal(
    generatedNames.some((thing) => (
      thing.toLowerCase() === 'world.json'
      || thing.toLowerCase().endsWith('.world.json')
    )),
    false
  );
});

test('operational writes reject colliding files, preserve long context situation, and skip semantic no-ops', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-language-safety-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');

  const collision = await executeAtomLanguage({
    source: 'transform new {"thing":"危险目标","situation":"","contain":[],"support":[]}',
    contextFile,
    projectionFile: contextFile
  });
  assertRejected(collision, /PATH_COLLISION/u);
  await assert.rejects(fs.access(contextFile), { code: 'ENOENT' });

  const longDetail = '长'.repeat(4001);
  const created = await executeAtomLanguage({
    source: `transform new {"thing":"长正文","situation":${JSON.stringify(longDetail)},"contain":[],"support":[]}`,
    contextFile,
    projectionFile
  });
  assert.equal(created.ok, true);
  assert.equal(fieldEntry(JSON.parse(await fileText(contextFile))[0], 'situation')[1], longDetail);
  assert.equal(graphNode(JSON.parse(await fileText(projectionFile)), '长正文').situation, longDetail);

  const contextBefore = await fileText(contextFile);
  const projectionBefore = await fileText(projectionFile);
  const noOp = await executeAtomLanguage({
    source: `transform {"thing":"长正文",${JSON.stringify(`situation.rep.${longDetail}`)}}`,
    contextFile,
    projectionFile
  });
  assert.equal(noOp.ok, true);
  assert.equal(noOp.changed, false);
  assert.equal(await fileText(contextFile), contextBefore);
  assert.equal(await fileText(projectionFile), projectionBefore);
});
