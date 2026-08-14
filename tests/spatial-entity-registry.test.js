const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBrowserScript(filename, exportName) {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'),
    sandbox,
    { filename }
  );
  return sandbox.window[exportName];
}

function loadRegistry() {
  return loadBrowserScript('spatial-entity-registry.js', 'SpatialEntityRegistry');
}

test('preserves sanitized carrier state and explicit visual links', () => {
  const registry = loadRegistry();
  const registered = registry.registerDefinition('custom', {
    label: 'Custom',
    hasChildren: false,
    visualLinks: ['orbit', ' portal ', 'custom']
  });

  assert.equal(registered.hasChildren, false);
  assert.deepEqual(Array.from(registered.visualLinks), ['orbit', 'portal']);
});

test('defaults missing hasChildren to true for legacy definitions', () => {
  const registry = loadRegistry();
  const registered = registry.registerDefinition('legacy', { label: 'Legacy' });

  assert.equal(registered.hasChildren, true);
});

test('deduplicates, validates, caps, and freezes visual links', () => {
  const registry = loadRegistry();
  const registered = registry.registerDefinition('source', {
    label: 'Source',
    visualLinks: [
      'source', 'valid-0', 'valid-0', '', 'bad key', '__proto__', 42,
      ...Array.from({ length: 20 }, (_, index) => `valid-${index + 1}`)
    ]
  });

  assert.equal(registered.visualLinks.length, 12);
  assert.equal(new Set(registered.visualLinks).size, 12);
  assert.equal(registered.visualLinks.includes('source'), false);
  assert.equal(registered.visualLinks.includes('bad key'), false);
  assert.equal(Object.isFrozen(registered.visualLinks), true);
});

test('drops unknown business fields and callbacks', () => {
  const registry = loadRegistry();
  const registered = registry.registerDefinition('safe', {
    label: 'Safe',
    approvalStatus: 'approved',
    customerId: 'customer-1',
    payload: { secret: true },
    approve() {},
    callback() {}
  });

  for (const field of ['approvalStatus', 'customerId', 'payload', 'approve', 'callback']) {
    assert.equal(Object.hasOwn(registered, field), false, field);
  }
});

test('root definitions mix carriers and link only to root definitions', () => {
  const registry = loadRegistry();
  const roots = registry.rootDefinitions();
  const rootIds = new Set(roots.map((definition) => definition.id));

  assert.equal(roots.some((definition) => definition.hasChildren), true);
  assert.equal(roots.some((definition) => !definition.hasChildren), true);
  assert.equal(roots.some((definition) => definition.visualLinks.length > 0), true);
  for (const definition of roots) {
    for (const link of definition.visualLinks) {
      assert.equal(rootIds.has(link), true, `${definition.id} -> ${link}`);
    }
  }
});

test('accepts the new visual intents while rejecting arbitrary intent strings', () => {
  const registry = loadRegistry();

  for (const intent of ['toggleChildren', 'toggleSurface', 'toggleFieldSurfaces']) {
    assert.equal(registry.visualIntents.includes(intent), true, intent);
    assert.ok(registry.registerCommand(`command-${intent}`, { label: intent, intent }));
  }
  assert.equal(registry.registerCommand('unsafe-command', {
    label: 'Unsafe',
    intent: 'approveCustomer'
  }), null);
});

test('normalizes only unique bounded surface ids without business snapshot fields', () => {
  const grammar = loadBrowserScript('spatial-view-grammar.js', 'SpatialViewGrammar');
  const surfaceIds = [
    'node-0',
    'node-0',
    '',
    null,
    ...Array.from({ length: 80 }, (_, index) => `node-${index + 1}`)
  ];
  const snapshot = grammar.normalizeVisualSnapshot({
    surfaceIds,
    approvalStatus: 'approved',
    payload: { hidden: true },
    customerId: 'customer-1'
  });

  assert.equal(grammar.visualSnapshotKeys.includes('surfaceIds'), true);
  assert.equal(snapshot.surfaceIds.length, 64);
  assert.equal(new Set(snapshot.surfaceIds).size, 64);
  assert.deepEqual(Array.from(snapshot.surfaceIds.slice(0, 3)), ['node-0', 'node-1', 'node-2']);
  for (const field of ['approvalStatus', 'payload', 'customerId']) {
    assert.equal(Object.hasOwn(snapshot, field), false, field);
  }
});
