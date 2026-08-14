import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import {
  projectAtomContext,
  readAtomContext,
  resolveAtomContextFile,
  writeAtomContext,
  writeAtomGraphProjection
} from '../work-engine/atom-language/context-store.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atomsFixture() {
  return [
    {
      'name@agent': '石器工坊',
      'detail#主观窗口': '工坊正文',
      children: [
        {
          'name@program': '锤子',
          'detail#工具': '锻造工具',
          children: [],
          partners: [
            { verb: '归属', object: '石器工坊' }
          ]
        }
      ],
      partners: [
        { verb: '连接', object: '河岸' }
      ]
    },
    {
      name: '河岸',
      detail: '河岸正文',
      children: [],
      partners: []
    }
  ];
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-context-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('resolves atom.json by default and accepts an explicit contextual JSON file', async (t) => {
  const directory = await temporaryDirectory(t);
  assert.equal(resolveAtomContextFile(directory), path.join(directory, 'atom.json'));
  assert.equal(
    resolveAtomContextFile(path.join(directory, 'contexts', 'stone-workshop.json')),
    path.join(directory, 'contexts', 'stone-workshop.json')
  );
  assert.equal(path.basename(resolveAtomContextFile()), 'atom.json');
});

test('missing contexts initialize as an empty top-level Atom array', async (t) => {
  const directory = await temporaryDirectory(t);
  const contextFile = path.join(directory, 'atom.json');
  assert.deepEqual(await readAtomContext(directory), []);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), []);

  const optionalFile = path.join(directory, 'contexts', 'optional.json');
  assert.deepEqual(await readAtomContext(optionalFile, { create: false }), []);
  await assert.rejects(fs.access(optionalFile), { code: 'ENOENT' });
});

test('projects decorated Atom keys recursively through parseAtomKey onto a virtual Graph root', () => {
  const atoms = atomsFixture();
  const projection = projectAtomContext(atoms);
  assert.equal(projection.config.schema_version, '1.0.0');
  assert.deepEqual(projection.graph, {
    name: 'atom.json',
    detail: '',
    children: [
      {
        name: '石器工坊',
        detail: '工坊正文',
        children: [
          {
            name: '锤子',
            detail: '锻造工具',
            children: [],
            partners: [
              { verb: '归属', object: '石器工坊' }
            ]
          }
        ],
        partners: [
          { verb: '连接', object: '河岸' }
        ]
      },
      {
        name: '河岸',
        detail: '河岸正文',
        children: [],
        partners: []
      }
    ],
    partners: []
  });
  assert.doesNotThrow(() => parseGraphDocument(projection));
  assert.deepEqual(atoms, atomsFixture(), 'projection must not turn the virtual root into a factual Atom');
});

test('writes the Atom context and its strict Graph projection as separate atomic files', async (t) => {
  const directory = await temporaryDirectory(t);
  const contextFile = path.join(directory, 'contexts', 'stone-workshop.json');
  const graphFile = path.join(directory, 'projection', 'stone-workshop.graph.json');
  const atoms = atomsFixture();

  assert.equal(await writeAtomContext(contextFile, atoms), contextFile);
  assert.equal(await writeAtomGraphProjection(graphFile, atoms), graphFile);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), atoms);

  const graph = JSON.parse(await fs.readFile(graphFile, 'utf8'));
  assert.deepEqual(graph, projectAtomContext(atoms));
  assert.doesNotThrow(() => parseGraphDocument(graph));

  atoms[0]['detail#主观窗口'] = '更新后的正文';
  await writeAtomContext(contextFile, atoms);
  await writeAtomGraphProjection(graphFile, atoms);
  assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0]['detail#主观窗口'], '更新后的正文');
  assert.equal(JSON.parse(await fs.readFile(graphFile, 'utf8')).graph.children[0].detail, '更新后的正文');

  const generated = await fs.readdir(directory, { recursive: true });
  assert.equal(generated.some((name) => name.endsWith('.tmp')), false);
  await assert.rejects(fs.access(path.join(directory, 'data', 'knowledge.json')), { code: 'ENOENT' });
});

test('rejects world.json and *.world.json for both context and projection files', async (t) => {
  const directory = await temporaryDirectory(t);
  const atoms = atomsFixture();
  for (const filename of ['world.json', 'legacy.world.json', 'WORLD.JSON']) {
    const target = path.join(directory, filename);
    assert.throws(
      () => resolveAtomContextFile(target),
      (error) => error.code === 'ACTIVE_WORLD_JSON_REJECTED'
    );
    await assert.rejects(
      writeAtomContext(target, atoms),
      (error) => error.code === 'ACTIVE_WORLD_JSON_REJECTED'
    );
    await assert.rejects(
      writeAtomGraphProjection(target, atoms),
      (error) => error.code === 'ACTIVE_WORLD_JSON_REJECTED'
    );
  }
});

test('validates the projected Graph before either persistent file can be written', async (t) => {
  const directory = await temporaryDirectory(t);
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const invalid = atomsFixture();
  invalid[0].partners[0].object = '不存在的 Atom';

  await assert.rejects(
    writeAtomContext(contextFile, invalid),
    (error) => error.code === 'UNKNOWN_GRAPH_OBJECT'
  );
  await assert.rejects(
    writeAtomGraphProjection(graphFile, invalid),
    (error) => error.code === 'UNKNOWN_GRAPH_OBJECT'
  );
  await assert.rejects(fs.access(contextFile), { code: 'ENOENT' });
  await assert.rejects(fs.access(graphFile), { code: 'ENOENT' });
});

test('rejects non-array context documents and malformed recursive Atom fields', async (t) => {
  const directory = await temporaryDirectory(t);
  const objectFile = path.join(directory, 'object.json');
  await fs.writeFile(objectFile, '{}\n', 'utf8');
  await assert.rejects(
    readAtomContext(objectFile),
    (error) => error.code === 'INVALID_ATOM_CONTEXT_DOCUMENT'
  );

  const malformed = atomsFixture();
  malformed[0].children[0] = {
    name: '缺字段',
    detail: '',
    children: []
  };
  assert.throws(
    () => projectAtomContext(malformed),
    (error) => error.code === 'MISSING_ATOM_FIELD'
  );
});

test('partner short names resolve inside the nearest containing flow before the global graph', () => {
  const form = (name, next) => ({
    name, detail: '', children: [],
    partners: next ? [{ verb: 'next', object: next }] : []
  });
  const flow = (name) => ({
    name, detail: '', partners: [], children: [
      { name: 'Stage A', detail: '', partners: [], children: [form('Review', 'Build')] },
      { name: 'Stage B', detail: '', partners: [], children: [form('Build')] }
    ]
  });

  assert.doesNotThrow(() => projectAtomContext([flow('Flow 1'), flow('Flow 2')]));
});

test('an Atom query reads world facts without implicitly creating a Graph projection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-query-purity-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atomsFixture(), null, 2)}\n`, 'utf8');

  const result = await executeAtomLanguage({ source: 'atom', contextFile, projectionFile });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  await assert.rejects(fs.access(projectionFile), { code: 'ENOENT' });
});
