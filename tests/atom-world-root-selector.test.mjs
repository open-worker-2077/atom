import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-root-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify([
    { name: '推进流', detail: '顶层程序', children: [], partners: [] },
    {
      name: '项目', detail: '', partners: [], children: [
        { name: '推进流', detail: '项目程序', children: [], partners: [] }
      ]
    },
    { name: '备份', detail: '', children: [], partners: [] }
  ], null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

test('世界之外虚拟父级可见，并把当前世界顶层 Atom 暴露为直接子级', async (t) => {
  const files = await fixture(t);
  const result = await executeAtomLanguage({
    source: 'explore {"name":"世界之外","detail$full":true,"children$latitude-1":true}',
    ...files
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(
    result.items[0].matches.map(({ path, name, types }) => ({ path, name, types })),
    [
      { path: '世界之外', name: '世界之外', types: ['universe'] },
      { path: '推进流', name: '推进流', types: [] },
      { path: '项目', name: '项目', types: [] },
      { path: '备份', name: '备份', types: [] }
    ]
  );
});

test('世界之外前缀唯一选择顶层同名 Atom，并保持既有子树路径兼容', async (t) => {
  const files = await fixture(t);

  const ambiguous = await executeAtomLanguage({
    source: 'explore {"name":"推进流","detail$full":true}', ...files
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.errors[0].code, 'AMBIGUOUS_ATOM_NAME');

  const top = await executeAtomLanguage({
    source: 'explore {"name":"世界之外/推进流","detail$full":true}', ...files
  });
  assert.equal(top.ok, true, JSON.stringify(top.errors));
  assert.equal(top.items[0].matches[0].path, '推进流');
  assert.equal(top.items[0].matches[0].detail, '顶层程序');

  const nested = await executeAtomLanguage({
    source: 'explore {"name":"项目/推进流","detail$full":true}', ...files
  });
  assert.equal(nested.ok, true, JSON.stringify(nested.errors));
  assert.equal(nested.items[0].matches[0].detail, '项目程序');
});

test('transform 使用世界之外前缀只移动指定顶层同名 Atom', async (t) => {
  const files = await fixture(t);
  const transformed = await executeAtomLanguage({
    source: 'transform {"name.mov.备份":"世界之外/推进流"}', ...files
  });
  assert.equal(transformed.ok, true, JSON.stringify(transformed.errors));

  const world = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(world.map(({ name }) => name), ['项目', '备份']);
  assert.equal(world[1].children[0].name, '推进流');
  assert.equal(world[1].children[0].detail, '顶层程序');
  assert.equal(world[0].children[0].detail, '项目程序');
});
