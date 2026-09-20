import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserCommandMapper } from '../src/atom-system/browser-command-mapper.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { projectAtomGraphWithPaths } from '../work-engine/atom-language/graph-4d-projection.mjs';
import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';

test('creation inside the synthetic world container compiles a top-level Atom command', async () => {
  const { knowledge } = await projectAtomGraphWithPaths(projectAtomContext([
    { thing: 'Existing', situation: '', slot: [], strut: [] }
  ]));
  const root = knowledge.nodes.find(node => node.path === 'root');
  const mapper = createBrowserCommandMapper();
  mapper.replaceKnowledge(knowledge);
  assert.equal(mapper.compile({ kind: 'node-create', path: spatialChildPath(root),
    draft: { label: 'New', description: 'saved' }
  }).source, 'transform new {"thing":"New","situation":"saved","slot":[],"strut":[]}');
});

test('container mapping follows projection coordinates instead of the atom.json display name', () => {
  const mapper = createBrowserCommandMapper();
  const root = { key: 'root::carrier', id: 'carrier', path: 'root', label: 'Renamed file carrier' };
  const real = { key: 'root::real', id: 'real', path: 'root', label: 'atom.json', atomPath: 'Actual container' };
  const create = path => mapper.compile({ kind: 'node-create', path, draft: { label: 'New' } }).source;
  mapper.replaceKnowledge({ nodes: [root] });
  assert.equal(JSON.parse(create(spatialChildPath(root)).slice('transform new '.length)).thing, 'New');
  mapper.replaceKnowledge({ nodes: [real] });
  assert.equal(JSON.parse(create(spatialChildPath(real)).slice('transform new '.length)).thing, 'Actual container/New');
  mapper.replaceKnowledge({ nodes: [root, real] });
  assert.throws(() => create(spatialChildPath(root)), { code: 'WEB_COMMAND_TARGET_UNRESOLVED' });
  const nested = { ...root, path: 'root/nested', label: 'atom.json' };
  mapper.replaceKnowledge({ nodes: [real, nested] });
  assert.throws(() => create(spatialChildPath(nested)), { code: 'WEB_COMMAND_TARGET_UNRESOLVED' });
});

function spatialChildPath(node) {
  let hash = 2166136261;
  for (const character of String(node.id || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${node.path || 'root'}/${(hash >>> 0).toString(36)}`;
}

function knowledgeFixture() {
  const domain = { key: 'root::domain', id: 'domain', path: 'root', atomPath: '域', label: '域' };
  const nodePath = spatialChildPath(domain);
  const node = { key: `${nodePath}::node`, id: 'node', path: nodePath, atomPath: '域/节点', label: '节点' };
  const target = { key: `${nodePath}::target`, id: 'target', path: nodePath, atomPath: '域/目标', label: '目标' };
  return { nodes: [domain, node, target], edges: [] };
}

function parse(source) {
  const parsed = createAtomLanguageReceiver().receive(source);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  return parsed;
}

test('compiles a node edit into deterministic Atom text and parser semantics', () => {
  const mapper = createBrowserCommandMapper();
  mapper.replaceKnowledge(knowledgeFixture());

  const command = mapper.compile({
    kind: 'node-edit',
    node: { atomPath: '域/节点' },
    draft: { label: '新名', description: '正文', atomTypes: [] }
  });

  assert.equal(command.source, 'transform {"thing.ren.新名":"域/节点","situation.rep.正文"}');
  assert.equal(command.operationKind, 'node-edit');
  assert.deepEqual(command.affectedAtomPaths, ['域/节点']);
  const fields = parse(command.source).items[0].fields;
  assert.deepEqual(fields.map(({ baseKey, commands, value }) => ({ baseKey, commands, value })), [
    { baseKey: 'thing', commands: [{ name: 'ren', parameter: '新名' }], value: '域/节点' },
    { baseKey: 'situation', commands: [{ name: 'rep', parameter: '正文' }], value: undefined }
  ]);
});

test('compiles creation and a single-node move from the projection container index', () => {
  const mapper = createBrowserCommandMapper();
  const knowledge = knowledgeFixture();
  mapper.replaceKnowledge(knowledge);

  const created = mapper.compile({
    kind: 'node-create',
    path: knowledge.nodes[1].path,
    draft: { label: '新节点', description: '创建正文', atomTypes: ['program'] }
  });
  assert.equal(created.source, 'transform new {"thing@program":"域/新节点","situation":"创建正文","slot":[],"strut":[]}');
  assert.deepEqual(created.affectedAtomPaths, ['域/新节点']);
  const createdFields = parse(created.source);
  assert.equal(createdFields.createNew, true);
  assert.deepEqual(createdFields.items[0].fields.map(({ baseKey, types, value }) => ({
    baseKey,
    types: types.map(({ name }) => name),
    value
  })), [
    { baseKey: 'thing', types: ['program'], value: '域/新节点' },
    { baseKey: 'situation', types: [], value: '创建正文' },
    { baseKey: 'slot', types: [], value: [] },
    { baseKey: 'strut', types: [], value: [] }
  ]);

  const moved = mapper.compile({
    kind: 'node-land',
    source: { key: knowledge.nodes[1].key },
    sourceNode: { atomPath: '域/节点' },
    target: { path: knowledge.nodes[1].path }
  });
  assert.equal(moved.source, 'transform {"thing.mov.域":"域/节点"}');
  assert.deepEqual(moved.affectedAtomPaths, ['域/节点', '域']);
  assert.equal(parse(moved.source).items[0].fields[0].commands[0].name, 'mov');
});

test('compiles batch moves, atomic relation changes, and deletion without rebuilding strut', () => {
  const mapper = createBrowserCommandMapper();
  const knowledge = knowledgeFixture();
  mapper.replaceKnowledge(knowledge);

  const batch = mapper.compile({
    kind: 'node-land-batch',
    landings: [
      { source: { key: knowledge.nodes[1].key }, target: { path: knowledge.nodes[1].path } },
      { source: { key: knowledge.nodes[2].key }, target: { path: knowledge.nodes[1].path } }
    ]
  });
  assert.equal(batch.source, 'transform [{"thing.mov.域":"域/节点"},{"thing.mov.域":"域/目标"}]');
  assert.equal(parse(batch.source).batch, true);

  const added = mapper.compile({
    kind: 'edge-create',
    source: { key: knowledge.nodes[1].key },
    target: { key: knowledge.nodes[2].key }
  });
  assert.equal(added.source, 'transform {"thing":"域/节点","strut.add.":{"thing":"域/目标"}}');
  assert.equal(parse(added.source).items[0].fields[1].commands[0].name, 'add');

  const removed = mapper.compile({
    kind: 'edge-edit', status: 'delete',
    edge: { from: { key: knowledge.nodes[1].key }, to: { key: knowledge.nodes[2].key } }
  });
  assert.equal(removed.source, 'transform {"thing":"域/节点","strut.dsc.":{"thing":"域/目标"}}');
  assert.equal(parse(removed.source).items[0].fields[1].commands[0].name, 'dsc');

  const deleted = mapper.compile({ kind: 'node-edit', status: 'delete', node: { key: knowledge.nodes[1].key } });
  assert.equal(deleted.source, 'transform {"thing.dsc.":"域/节点"}');
});

test('uses JSON escaping for special characters while preserving command-marker body text', () => {
  const mapper = createBrowserCommandMapper();
  mapper.replaceKnowledge({ nodes: [{ key: 'n', atomPath: '域/旧名', path: 'root', id: 'n' }], edges: [] });
  const command = mapper.compile({
    kind: 'node-edit', node: { key: 'n' },
    draft: { label: '新"名\\', description: '正文 .dsc.\n"\\', atomTypes: [] }
  });

  assert.equal(command.source, 'transform {"thing.ren.新\\"名\\\\":"域/旧名","situation.rep.正文 .dsc.\\n\\"\\\\"}');
  const fields = parse(command.source).items[0].fields;
  assert.equal(fields[0].commands[0].parameter, '新"名\\');
  assert.equal(fields[1].commands[0].parameter, '正文 .dsc.\n"\\');
});

test('does not mutate frozen UI input and rejects an unresolved projection target', () => {
  const mapper = createBrowserCommandMapper();
  const knowledge = Object.freeze({
    nodes: Object.freeze([Object.freeze({ key: 'n', atomPath: '域/节点', path: 'root', id: 'n' })]),
    edges: Object.freeze([])
  });
  const operation = Object.freeze({
    kind: 'node-edit', node: Object.freeze({ key: 'n' }),
    draft: Object.freeze({ label: '节点', description: '原样正文', atomTypes: Object.freeze([]) })
  });
  mapper.replaceKnowledge(knowledge);

  const command = mapper.compile(operation);
  assert.ok(Object.isFrozen(command));
  assert.ok(Object.isFrozen(command.affectedAtomPaths));
  assert.equal(operation.draft.description, '原样正文');
  assert.throws(
    () => mapper.compile({ kind: 'node-edit', node: { key: 'missing' }, draft: { label: '无', description: '', atomTypes: [] } }),
    (error) => error && error.code === 'WEB_COMMAND_TARGET_UNRESOLVED'
  );
  assert.throws(
    () => mapper.compile({ kind: 'node-edit', node: { key: 'n', atomPath: '域/过期坐标' }, draft: { label: '无', description: '', atomTypes: [] } }),
    (error) => error && error.code === 'WEB_COMMAND_TARGET_UNRESOLVED'
  );
});

test('resolves shortcut targets from the authoritative projection before compiling', () => {
  const mapper = createBrowserCommandMapper();
  const knowledge = knowledgeFixture();
  mapper.replaceKnowledge(knowledge);

  const allowed = mapper.compile({
    kind: 'node-edit', node: { key: knowledge.nodes[1].key, atomTypes: ['shortcut'] },
    draft: { label: '节点', shortcutTargetPath: '域/目标', atomTypes: ['shortcut'] }
  });
  assert.equal(parse(allowed.source).items[0].fields[0].commands[0].name, 'lnk');
  assert.throws(
    () => mapper.compile({
      kind: 'node-edit', node: { key: knowledge.nodes[1].key, atomTypes: ['shortcut'] },
      draft: { label: '节点', shortcutTargetPath: '域/未加载目标', atomTypes: ['shortcut'] }
    }),
    (error) => error && error.code === 'WEB_COMMAND_TARGET_UNRESOLVED'
  );
});

test('rejects command-marker parameters that Atom CLI grammar cannot represent safely', () => {
  const marker = '.dsc.';
  const mapper = createBrowserCommandMapper();
  const knowledge = knowledgeFixture();
  mapper.replaceKnowledge(knowledge);
  const rejects = (operation) => assert.throws(
    () => mapper.compile(operation),
    (error) => error && error.code === 'WEB_COMMAND_PARAMETER_UNREPRESENTABLE'
  );

  rejects({
    kind: 'node-edit', node: { key: knowledge.nodes[1].key },
    draft: { label: `新名${marker}`, description: '', atomTypes: [] }
  });
  rejects({
    kind: 'node-edit', atomTypesChanged: true, node: { key: knowledge.nodes[1].key },
    draft: { label: '节点', description: '', atomTypes: [`program${marker}`] }
  });
  rejects({
    kind: 'node-create', path: knowledge.nodes[1].path,
    draft: { label: '新节点', description: '', atomTypes: [`program${marker}`] }
  });

  const domain = { key: 'root::marker-domain', id: 'marker-domain', path: 'root', atomPath: `域${marker}` };
  const sourcePath = spatialChildPath(domain);
  const source = { key: `${sourcePath}::source`, id: 'source', path: sourcePath, atomPath: `域${marker}/节点` };
  const shortcut = { key: `${sourcePath}::shortcut`, id: 'shortcut', path: sourcePath, atomPath: `域${marker}/快捷` };
  const target = { key: `${sourcePath}::target`, id: 'target', path: sourcePath, atomPath: `域${marker}/目标${marker}` };
  mapper.replaceKnowledge({ nodes: [domain, source, shortcut, target], edges: [] });
  rejects({ kind: 'node-land', source: { key: source.key }, target: { path: sourcePath } });
  rejects({
    kind: 'node-edit', node: { key: shortcut.key, atomTypes: ['shortcut'] },
    draft: { label: '快捷', shortcutTargetPath: target.atomPath, atomTypes: ['shortcut'] }
  });
});
