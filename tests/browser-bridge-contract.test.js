const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-browser-bridge.js'), 'utf8');
const workspaceModelSource = fs.readFileSync(path.join(__dirname, '..', 'spatial-workspace-model.js'), 'utf8');

function installWorkspaceModel(window) {
  window.window = window;
  vm.runInNewContext(workspaceModelSource, { window }, { filename: 'spatial-workspace-model.js' });
}

test('bridge synchronizes snapshots through the explicit lab API only', () => {
  assert.match(source, /lab\.importKnowledge\s*\(/);
  assert.match(source, /lab\.exportKnowledge|event\.detail\.knowledge/);
  assert.match(source, /lab\.exportField\s*\(/);
  assert.match(source, /\/__spatial\/api/);
  assert.doesNotMatch(source, /new\s+(?:Mouse|Pointer|Keyboard)Event/);
  assert.doesNotMatch(source, /\.click\s*\(/);
});

test('Boss bridge confirms populated Leader deletion and routes Z X to data history', () => {
  assert.match(source, /global\.confirm\s*\(/);
  assert.match(source, /confirmedRecursiveDeleteNodeIds/);
  assert.match(source, /\/boss\/\$\{direction\}/);
  assert.match(source, /\["KeyZ",\s*"KeyX"\]/);
  assert.match(source, /stopImmediatePropagation\s*\(/);
  assert.match(source, /payload\.mode === "boss"/);
});

test('file entry restores and saves knowledge through local browser storage', () => {
  const listeners = new Map();
  const savedKnowledge = { nodes: [{ id: 'saved-node', path: 'root', label: 'Saved' }] };
  const storage = new Map([
    ['spatial-kb:knowledge:v1', JSON.stringify(savedKnowledge)]
  ]);
  let imported = null;
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '', protocol: 'file:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge(knowledge) {
        imported = knowledge;
        return true;
      },
      exportField: () => ({ path: 'root' })
    },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;

  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });

  assert.deepEqual(JSON.parse(JSON.stringify(imported)), savedKnowledge);
  assert.equal(document.body.dataset.spatialBridge, 'local');
  const committed = listeners.get('spatial-workspace-committed');
  assert.equal(typeof committed, 'function');
  committed({ detail: { knowledge: { nodes: [{ id: 'new-node' }] } } });
  assert.deepEqual(
    JSON.parse(storage.get('spatial-kb:knowledge:v1')),
    { nodes: [{ id: 'new-node' }] }
  );
});

test('http bridge preserves every rapid knowledge commit instead of keeping only the latest one', async () => {
  const listeners = new Map();
  const stateBodies = [];
  let resolveFirstPut = null;
  let statePutCount = 0;
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: () => true,
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      if (url.includes('/state') && options.method === 'PUT') {
        statePutCount += 1;
        stateBodies.push(JSON.parse(options.body));
        if (statePutCount === 1) {
          return new Promise((resolve) => {
            resolveFirstPut = () => resolve(response({ result: { revision: 1 } }));
          });
        }
        return response({ result: { revision: statePutCount } });
      }
      if (url.includes('/state')) return response({ knowledge: { revision: 0, nodes: [] } });
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;

  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));

  const committed = listeners.get('spatial-workspace-committed');
  const first = committed({ detail: { knowledge: { nodes: [{ id: 'first' }] } } });
  await Promise.resolve();
  committed({ detail: { knowledge: { nodes: [{ id: 'second' }] } } });
  committed({ detail: { knowledge: { nodes: [{ id: 'third' }] } } });
  resolveFirstPut();
  await first;
  await new Promise((resolve) => setImmediate(resolve));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stateBodies.length, 3);
  assert.equal(stateBodies[0].knowledge.nodes[0].id, 'first');
  assert.equal(stateBodies[1].knowledge.nodes[0].id, 'second');
  assert.equal(stateBodies[1].expectedRevision, 1);
  assert.equal(stateBodies[2].knowledge.nodes[0].id, 'third');
  assert.equal(stateBodies[2].expectedRevision, 2);
});

test('Atom Web reports semantic persistence confirmation and failure instead of failing silently', async () => {
  for (const succeeds of [true, false]) {
    const listeners = new Map();
    const lifecycle = [];
    const document = { body: { dataset: {} }, hidden: false };
    const response = (payload, ok = true) => ({ ok, json: async () => payload });
    const window = {
      location: { hostname: '127.0.0.1', protocol: 'http:' },
      spatialLab: {
        state: () => ({ transactionActive: false }), importKnowledge: () => true,
        exportField: () => ({ path: 'root' })
      },
      CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      dispatchEvent: (event) => { lifecycle.push(event); return true; },
      fetch: async (url, options = {}) => {
        if (url.endsWith('/health')) return response({ mode: 'single' });
        if (url.includes('/state') && !options.method) {
          return response({ knowledge: { revision: 1, nodes: [{ key: 'root::a', atomPath: 'A' }] } });
        }
        if (url.endsWith('/workspace-edit')) {
          return succeeds
            ? response({ result: { ok: true }, knowledge: { revision: 2, nodes: [] } })
            : response({ ok: false, error: { message: 'write rejected' } }, false);
        }
        return response({ result: {} });
      },
      addEventListener: (name, listener) => listeners.set(name, listener), setInterval: () => 0
    };
    window.window = window;
    vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
    await new Promise((resolve) => setImmediate(resolve));
    lifecycle.length = 0;

    const result = await listeners.get('spatial-workspace-committed')({ detail: {
      persistenceId: 17,
      operation: { kind: 'node-edit', nodeKey: 'stale', node: { atomPath: 'A' }, draft: { label: 'A' } },
      knowledge: { revision: 1, nodes: [] }
    } });

    assert.equal(result, succeeds);
    assert.equal(lifecycle.length, 1);
    assert.equal(lifecycle[0].type, succeeds ? 'spatial-workspace-persisted' : 'spatial-workspace-persist-failed');
    assert.equal(lifecycle[0].detail.persistenceId, 17);
    if (succeeds) assert.equal(lifecycle[0].detail.knowledge.revision, 2);
    if (!succeeds) assert.match(lifecycle[0].detail.message, /write rejected/);
  }
});

test('initial Atom load exposes separate service, data, and scene progress checkpoints', async () => {
  const progressElements = Object.fromEntries([
    'spatialProgressOverall',
    'spatialProgressService',
    'spatialProgressData',
    'spatialProgressScene',
    'spatialProgressOverallValue',
    'spatialProgressServiceValue',
    'spatialProgressDataValue',
    'spatialProgressSceneValue'
  ].map((id) => [id, { value: 0, textContent: '0%' }]));
  let releaseHealth;
  let releaseState;
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = {
    body: { dataset: {} },
    hidden: false,
    getElementById: (id) => progressElements[id] || null
  };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ path: 'root', transactionActive: false }),
      importKnowledge: () => true,
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url) => {
      if (url.endsWith('/health')) {
        return new Promise((resolve) => { releaseHealth = () => resolve(response({ mode: 'single', atomWorkspace: true })); });
      }
      if (url.includes('/state')) {
        return new Promise((resolve) => { releaseState = () => resolve(response({
          knowledge: { revision: 1, nodes: [{ key: 'root::actual', atomPath: 'actual' }], edges: [] },
          scope: { path: 'root' }
        })); });
      }
      return response({ ok: true });
    },
    addEventListener: () => {},
    setInterval: () => 0,
    requestAnimationFrame: (callback) => callback()
  };
  window.window = window;

  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  assert.ok(progressElements.spatialProgressService.value > 0);
  assert.equal(progressElements.spatialProgressData.value, 0);
  assert.equal(progressElements.spatialProgressScene.value, 0);

  releaseHealth();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(progressElements.spatialProgressService.value, 100);
  assert.ok(progressElements.spatialProgressData.value > 0);
  assert.equal(progressElements.spatialProgressScene.value, 0);

  releaseState();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(progressElements.spatialProgressData.value, 100);
  assert.equal(progressElements.spatialProgressScene.value, 100);
  assert.equal(progressElements.spatialProgressOverall.value, 100);
  assert.equal(progressElements.spatialProgressOverallValue.textContent, '100%');
});

test('private HTTPS host loads authoritative Atom knowledge instead of standalone demo data', async () => {
  const actualKnowledge = {
    schemaVersion: 1,
    revision: 5592,
    nodes: [{ id: 'actual', key: 'root::actual', path: 'root', label: 'ESG计划' }],
    edges: []
  };
  const requested = [];
  let imported = null;
  const document = { body: { dataset: {} }, hidden: false };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const window = {
    location: { hostname: 'worker.tail33a2eb.ts.net', protocol: 'https:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge(knowledge) {
        imported = knowledge;
        return true;
      },
      exportField: () => ({ path: 'root' }),
      exportKnowledge: () => actualKnowledge
    },
    fetch: async (url) => {
      requested.push(url);
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state')) return response({ knowledge: actualKnowledge });
      return response({});
    },
    addEventListener() {},
    setInterval: () => 0
  };
  window.window = window;

  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(document.body.dataset.spatialBridge, 'connected');
  assert.deepEqual(JSON.parse(JSON.stringify(imported)), actualKnowledge);
  assert.deepEqual(requested, ['/__spatial/api/health', '/__spatial/api/state?path=root']);
});

test('network bridge retries an initial actual-data failure instead of leaving synthetic knowledge visible', async () => {
  const actualKnowledge = {
    schemaVersion: 1,
    revision: 7,
    nodes: [{ id: 'actual', key: 'root::actual', path: 'root', label: 'atom.json' }],
    edges: []
  };
  let stateAttempts = 0;
  let changes = null;
  let imported = null;
  const document = { body: { dataset: {} }, hidden: false };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const window = {
    location: { hostname: 'worker.tail33a2eb.ts.net', protocol: 'https:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge(knowledge) { imported = knowledge; return true; },
      exportField: () => ({ path: 'root' }),
      exportKnowledge: () => actualKnowledge
    },
    fetch: async (url) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      stateAttempts += 1;
      if (stateAttempts === 1) throw new Error('temporary mobile network failure');
      return response({ knowledge: actualKnowledge });
    },
    addEventListener() {},
    EventSource: class {
      constructor() { changes = this; }
    }
  };
  window.window = window;

  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.body.dataset.spatialBridge, 'offline');
  assert.equal(imported, null);

  changes.onopen();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.body.dataset.spatialBridge, 'connected');
  assert.deepEqual(JSON.parse(JSON.stringify(imported)), actualKnowledge);
});

test('network bridge progressively loads the entered Atom path without downloading the whole world', async () => {
  const listeners = new Map();
  const requested = [];
  const imports = [];
  const rootKnowledge = {
    schemaVersion: 1,
    revision: 7,
    nodes: [{ id: 'root-node', key: 'root::root-node', path: 'root', label: 'atom.json' }],
    nodePatches: [], deletedNodeKeys: [], edges: [], removedEdgeIds: [], view: null
  };
  const childKnowledge = {
    ...rootKnowledge,
    nodes: [{ id: 'child-node', key: 'root/child::child-node', path: 'root/child', label: '项目' }]
  };
  const document = { body: { dataset: {} }, hidden: false };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const window = {
    location: { hostname: 'worker.tail33a2eb.ts.net', protocol: 'https:' },
    spatialLab: {
      state: () => ({ transactionActive: false, path: 'root' }),
      importKnowledge(knowledge) { imports.push(structuredClone(knowledge)); return true; },
      exportField: () => ({ path: 'root' }),
      exportKnowledge: () => imports.at(-1) ?? rootKnowledge
    },
    fetch: async (url, options = {}) => {
      requested.push([url, options.method ?? 'GET']);
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.endsWith('/state?path=root')) return response({ knowledge: rootKnowledge, scope: { path: 'root' } });
      if (url.endsWith('/state?path=root%2Fchild')) return response({ knowledge: childKnowledge, scope: { path: 'root/child' } });
      return response({ ok: true });
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    EventSource: class {}
  };
  window.window = window;

  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await listeners.get('spatial-view-committed')({ detail: { view: { path: 'root/child' } } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requested.some(([url]) => url.endsWith('/state?path=root%2Fchild')), true);
  assert.deepEqual(imports.at(-1).nodes.map((node) => node.label), ['atom.json', '项目']);
});

test('Atom Web reports committed facts with a pending projection without claiming failure or importing stale knowledge', async () => {
  const listeners = new Map();
  const lifecycle = [];
  const imports = [];
  const document = { body: { dataset: {} }, hidden: false };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: (event) => { lifecycle.push(event); return true; },
    fetch: async (url, options = {}) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 1, nodes: [{ key: 'root::a', atomPath: 'A' }] } });
      }
      if (url.endsWith('/workspace-edit')) {
        return response({
          result: {
            ok: true,
            projectionStatus: 'pending',
            projectionRecovery: { expectedRevision: 'rev-2' },
            projectionFailure: { projection: 'spatial', cause: 'EPERM' }
          },
          knowledge: { revision: 1, nodes: [{ key: 'root::a', atomPath: 'A' }] }
        });
      }
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  lifecycle.length = 0;
  imports.length = 0;

  const result = await listeners.get('spatial-workspace-committed')({ detail: {
    persistenceId: 19,
    operation: { kind: 'node-edit', nodeKey: 'root::a', node: { atomPath: 'A' }, draft: { label: 'A2' } },
    knowledge: { revision: 1, nodes: [{ key: 'root::a', atomPath: 'A', label: 'A2' }] }
  } });

  assert.equal(result, true);
  assert.equal(document.body.dataset.spatialBridge, 'degraded');
  assert.equal(imports.length, 0, 'a stale projection must not replace the optimistic or authoritative view');
  assert.equal(lifecycle.length, 1);
  assert.equal(lifecycle[0].type, 'spatial-workspace-projection-pending');
  assert.deepEqual(JSON.parse(JSON.stringify(lifecycle[0].detail.projectionRecovery)), {
    expectedRevision: 'rev-2'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(lifecycle[0].detail.projectionFailure)), {
    projection: 'spatial', cause: 'EPERM'
  });
});

test('http bridge preserves the semantic operation when a structural commit is queued', async () => {
  const listeners = new Map();
  const requests = [];
  const imports = [];
  let releaseFirst;
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/health')) return response({ mode: 'single' });
      if (url.includes('/state') && !options.method) return response({ knowledge: { revision: 1, nodes: [] } });
      if (url.endsWith('/workspace-edit')) {
        if (!releaseFirst) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve(response({ ok: true, knowledge: { revision: 2, nodes: [{ label: 'older confirmation' }] } }));
          });
        }
        return response({ ok: true, knowledge: { revision: 3, nodes: [{ label: 'latest confirmation' }] } });
      }
      return response({ result: { revision: 2 } });
    },
    addEventListener: (name, listener) => listeners.set(name, listener), setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  imports.length = 0;

  const committed = listeners.get('spatial-workspace-committed');
  const first = committed({ detail: {
    operation: { kind: 'node-edit', nodeKey: 'root::a', draft: { label: 'A' } },
    knowledge: { revision: 1, nodes: [] }
  } });
  await Promise.resolve();
  committed({ detail: {
    operation: { kind: 'node-land', source: { key: 'root::b' }, target: { path: 'root/doubtful' } },
    knowledge: { revision: 1, nodes: [] }
  } });
  releaseFirst();
  await first;
  assert.equal(imports.length, 0, 'an older confirmation must not overwrite a newer optimistic edit');
  await new Promise((resolve) => setImmediate(resolve));

  const workspaceRequests = requests.filter(([url]) => url.endsWith('/workspace-edit'));
  assert.equal(workspaceRequests.length, 2);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].nodes[0].label, 'latest confirmation');
  assert.equal(JSON.parse(workspaceRequests[1][1].body).operation.kind, 'node-land');
  assert.equal(requests.some(([url, options]) => url.includes('/state') && options.method === 'PUT'), false);
});

test('a queued view save never prevents the latest authoritative move projection from landing', async () => {
  const listeners = new Map();
  const imports = [];
  let releaseMove;
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root', viewMode: 'nested' })
    },
    fetch: async (url, options = {}) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 1, nodes: [], edges: [] } });
      }
      if (url.endsWith('/workspace-edit')) {
        return new Promise((resolve) => {
          releaseMove = () => resolve(response({
            result: { ok: true },
            knowledge: { revision: 2, nodes: [{ id: 'new-id', path: 'root/waiting', label: '网络' }], edges: [] }
          }));
        });
      }
      if (url.endsWith('/view')) return response({ result: { revision: 1 } });
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  imports.length = 0;

  const move = listeners.get('spatial-workspace-committed')({ detail: {
    operation: {
      kind: 'node-land',
      source: { key: 'root::old-id' },
      target: { path: 'root/waiting' },
      draft: { label: '网络' }
    },
    knowledge: { revision: 1, nodes: [], edges: [] }
  } });
  await Promise.resolve();
  listeners.get('spatial-view-committed')({ detail: { view: { path: 'root', viewMode: 'nested' } } });
  releaseMove();
  await move;

  assert.equal(imports.length, 1);
  assert.equal(imports[0].nodes[0].path, 'root/waiting');
});

test('Atom Web never lets an operation-less browser snapshot overwrite the Atom projection', async () => {
  const listeners = new Map();
  const requests = [];
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: () => true,
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 4, nodes: [{ key: 'root::current', label: 'Current' }] } });
      }
      return response({ result: { revision: 5 } });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await listeners.get('spatial-workspace-committed')({
    detail: { knowledge: { revision: 2, nodes: [{ key: 'root::stale', label: 'Stale' }] } }
  }), false);

  assert.equal(
    requests.some(([url, options]) => url.includes('/state') && options.method === 'PUT'),
    false,
    'a derived Atom projection must not accept a whole stale browser snapshot'
  );
  assert.equal(document.body.dataset.spatialBridge, 'connected');
});

test('three rapid relation confirmations never redraw an older partial chain', async () => {
  const listeners = new Map();
  const imports = [];
  const releases = [];
  let responseRevision = 1;
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      if (url.endsWith('/health')) return response({ mode: 'single' });
      if (url.includes('/state') && !options.method) return response({ knowledge: { revision: 1, nodes: [], edges: [] } });
      if (url.endsWith('/workspace-edit')) {
        return new Promise((resolve) => releases.push(() => {
          responseRevision += 1;
          resolve(response({
            result: { ok: true },
            knowledge: {
              revision: responseRevision,
              nodes: [],
              edges: Array.from({ length: responseRevision - 1 }, (_, index) => ({ id: `edge-${index + 1}` }))
            }
          }));
        }));
      }
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener), setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  imports.length = 0;
  const committed = listeners.get('spatial-workspace-committed');
  const edge = (from, to) => ({ kind: 'edge-create', source: { key: from }, target: { key: to } });
  const first = committed({ detail: { operation: edge('a', 'b'), knowledge: { revision: 1, nodes: [], edges: [] } } });
  await Promise.resolve();
  committed({ detail: { operation: edge('b', 'c'), knowledge: { revision: 1, nodes: [], edges: [] } } });
  committed({ detail: { operation: edge('c', 'd'), knowledge: { revision: 1, nodes: [], edges: [] } } });

  releases.shift()();
  await first;
  assert.equal(imports.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(imports.length, 0);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(imports.length, 1);
  assert.equal(imports[0].edges.length, 3);
});

test('Atom Web keeps visual-only detail changes local instead of sending and rolling them back as workspace edits', async () => {
  const listeners = new Map();
  const requests = [];
  const imports = [];
  const response = (payload, ok = true) => ({ ok, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/health')) return response({ mode: 'single' });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 1, nodes: [{ key: 'root::a', detailMode: 'surface' }] } });
      }
      if (url.endsWith('/workspace-edit')) {
        return response({ ok: false, error: { message: 'visual operation is not an Atom edit' } }, false);
      }
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  imports.length = 0;

  const changed = { revision: 1, nodes: [{ key: 'root::a', detailMode: 'floating' }] };
  assert.equal(await listeners.get('spatial-workspace-committed')({
    detail: { operation: 'detail-mode-floating', knowledge: changed }
  }), true);

  assert.equal(requests.some(([url]) => url.endsWith('/workspace-edit')), false);
  assert.equal(imports.length, 0, 'the last server projection must not roll back a visual-only change');
  assert.equal(document.body.dataset.spatialBridge, 'connected');
});

test('Atom Web node creation enters the semantic workspace endpoint instead of overwriting the projection store', async () => {
  const listeners = new Map();
  const requests = [];
  const imports = [];
  const persisted = [];
  const document = { body: { dataset: {} }, hidden: false };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/health')) return response({ mode: 'single' });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 1, nodes: [], edges: [] } });
      }
      if (url.endsWith('/workspace-edit')) return response({
        ok: true,
        result: { ok: true },
        knowledge: {
          revision: 2,
          nodes: [{ id: 'projected-id', key: 'root::projected-id', path: 'root', label: 'New Atom', position: { x: 40, y: 40, z: 0 } }],
          edges: []
        }
      });
      return response({ result: {} });
    },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: (event) => { if (event.type === 'spatial-workspace-persisted') persisted.push(event.detail); },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));

  await listeners.get('spatial-workspace-committed')({
    detail: {
      persistenceId: 7,
      operation: { kind: 'node-create', path: 'root', draft: { label: 'New Atom', description: 'Detail', position: { x: 7, y: -3, z: 2 } } },
      knowledge: { revision: 1, nodes: [{ label: 'New Atom' }], edges: [] }
    }
  });

  const workspace = requests.find(([url]) => url.endsWith('/workspace-edit'));
  assert.ok(workspace, 'node creation reaches the Atom workspace command boundary');
  assert.deepEqual(JSON.parse(workspace[1].body), {
    operation: { kind: 'node-create', path: 'root', draft: { label: 'New Atom', description: 'Detail', position: { x: 7, y: -3, z: 2 } } }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(imports.at(-1).nodes[0].position)), { x: 7, y: -3, z: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(persisted.at(-1).persistedNode)), {
    id: 'projected-id', key: 'root::projected-id', path: 'root', label: 'New Atom', position: { x: 7, y: -3, z: 2 }, clusterLocalPositionLocked: false
  });
  assert.equal(requests.some(([url, options]) => url.includes('/state') && options.method === 'PUT'), false);
});

test('Atom node rename keeps the prior visual placement and reports the new projected identity', async () => {
  const listeners = new Map();
  const imports = [];
  const importOptions = [];
  const persisted = [];
  const response = (payload) => ({ ok: true, json: async () => payload });
  const oldNode = {
    id: 'old-id', key: 'root/domain::old-id', path: 'root/domain', atomPath: 'Old',
    label: 'Old', position: { x: 7, y: -3, z: 2 }, clusterLocalPositionLocked: true
  };
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge, options) => { imports.push(knowledge); importOptions.push(options); return true; },
      exportField: () => ({ path: 'root/domain' })
    },
    fetch: async (url, options = {}) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 1, nodes: [oldNode], edges: [] } });
      }
      if (url.endsWith('/workspace-edit')) return response({
        ok: true,
        result: { ok: true },
        knowledge: {
          revision: 2,
          nodes: [{
            id: 'new-id', key: 'root/domain::new-id', path: 'root/domain', atomPath: 'Renamed',
            label: 'Renamed', position: { x: 40, y: 40, z: 0 }
          }],
          edges: []
        }
      });
      return response({ result: {} });
    },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: (event) => { if (event.type === 'spatial-workspace-persisted') persisted.push(event.detail); },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  installWorkspaceModel(window);
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  imports.length = 0;

  await listeners.get('spatial-workspace-committed')({ detail: {
    persistenceId: 9,
    operation: {
      kind: 'node-edit', path: 'root/domain', nodeKey: oldNode.key, node: oldNode,
      draft: { label: 'Renamed', description: 'Edited' }
    },
    knowledge: { revision: 1, nodes: [{ ...oldNode, label: 'Renamed' }], edges: [] }
  } });

  assert.deepEqual(JSON.parse(JSON.stringify(imports.at(-1).nodes[0].position)), { x: 7, y: -3, z: 2 });
  assert.equal(imports.at(-1).nodes[0].clusterLocalPositionLocked, true);
  assert.deepEqual(JSON.parse(JSON.stringify(importOptions.at(-1).identityTransitions)), [{
    from: { key: 'root/domain::old-id', path: 'root/domain', id: 'old-id' },
    to: { key: 'root/domain::new-id', path: 'root/domain', id: 'new-id' }
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(persisted.at(-1).persistedNode)), {
    id: 'new-id', key: 'root/domain::new-id', path: 'root/domain', atomPath: 'Renamed',
    label: 'Renamed', position: { x: 7, y: -3, z: 2 }, clusterLocalPositionLocked: true
  });
});

test('every Atom Web structural edit uses the semantic workspace boundary instead of the projection store', async () => {
  for (const operation of [
    { kind: 'node-edit', path: 'root', nodeKey: 'root::a', node: { id: 'a' }, draft: { label: 'Renamed', description: 'Edited' } },
    { kind: 'node-edit', status: 'delete', path: 'root', nodeKey: 'root::a', node: { id: 'a' }, draft: {} },
    { kind: 'edge-create', source: { key: 'root::a' }, target: { key: 'root::b' } },
    { kind: 'edge-edit', status: 'update', edge: { from: { key: 'root::a' }, to: { key: 'root::b' }, label: 'Changed' } },
    { kind: 'edge-edit', status: 'delete', edge: { from: { key: 'root::a' }, to: { key: 'root::b' }, label: 'Changed' } },
    { kind: 'node-land', source: { key: 'root::a' }, target: { path: 'root/domain' }, draft: { id: 'a' } }
  ]) {
    const listeners = new Map();
    const requests = [];
    const document = { body: { dataset: {} }, hidden: false };
    const response = (payload) => ({ ok: true, json: async () => payload });
    const window = {
      location: { hostname: '127.0.0.1', protocol: 'http:' },
      spatialLab: {
        state: () => ({ transactionActive: false }), importKnowledge: () => true,
        exportField: () => ({ path: 'root' })
      },
      fetch: async (url, options = {}) => {
        requests.push([url, options]);
        if (url.endsWith('/health')) return response({ mode: 'single' });
        if (url.includes('/state') && !options.method) return response({ knowledge: { revision: 1, nodes: [], edges: [] } });
        if (url.endsWith('/workspace-edit')) return response({ result: { ok: true }, knowledge: { revision: 2, nodes: [], edges: [] } });
        return response({ result: {} });
      },
      addEventListener: (name, listener) => listeners.set(name, listener), setInterval: () => 0
    };
    window.window = window;
    vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
    await new Promise((resolve) => setImmediate(resolve));
    await listeners.get('spatial-workspace-committed')({
      detail: { operation, knowledge: { revision: 1, nodes: [], edges: [] } }
    });
    assert.equal(requests.some(([url]) => url.endsWith('/workspace-edit')), true, operation.kind);
    assert.equal(requests.some(([url, options]) => url.includes('/state') && options.method === 'PUT'), false, operation.kind);
  }
});

test('Atom Web persists view operations exactly and installs no periodic save or pull timers', async () => {
  const listeners = new Map();
  const requests = [];
  const timers = [];
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: () => true,
      exportField: () => ({ path: 'root', viewMode: 'nested' })
    },
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state')) return response({ knowledge: { revision: 1, nodes: [], edges: [] } });
      return response({ result: { revision: 1 } });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: (...args) => { timers.push(args); return timers.length; }
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(timers.length, 0, 'persistence and synchronization must not depend on periodic timers');
  assert.equal(typeof listeners.get('spatial-view-committed'), 'function');
  await listeners.get('spatial-view-committed')({ detail: { view: { path: 'root/child', viewMode: 'hierarchy' } } });

  const viewWrites = requests.filter(([url, options]) => url.endsWith('/view') && options.method === 'PUT');
  assert.equal(viewWrites.length, 1);
  assert.deepEqual(JSON.parse(viewWrites[0][1].body), {
    view: { path: 'root/child', viewMode: 'hierarchy' }, bossId: null
  });
});

test('Atom Web refreshes from a committed remote operation instead of polling', async () => {
  const listeners = new Map();
  const imports = [];
  const requests = [];
  let serverRevision = 1;
  let eventSource = null;
  class FakeEventSource {
    constructor(url) { this.url = url; eventSource = this; }
  }
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    EventSource: FakeEventSource,
    fetch: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state')) {
        return response({ knowledge: { revision: serverRevision, nodes: [{ label: `r${serverRevision}` }], edges: [] } });
      }
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => { throw new Error('polling is forbidden'); }
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(eventSource.url, '/__spatial/api/events');
  assert.equal(imports.at(-1).nodes[0].label, 'r1');

  serverRevision = 2;
  eventSource.onmessage({ data: '{"revision":2}' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(imports.at(-1).nodes[0].label, 'r2');
  assert.equal(requests.filter(([url]) => url.includes('/state')).length, 2);
});

test('a remote commit received during a local save is refreshed after the save queue settles', async () => {
  const listeners = new Map();
  const imports = [];
  let eventSource = null;
  let serverRevision = 1;
  let finishViewSave;
  const viewSaved = new Promise((resolve) => { finishViewSave = resolve; });
  class FakeEventSource {
    constructor() { eventSource = this; }
  }
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    EventSource: FakeEventSource,
    fetch: async (url, options = {}) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state')) return response({ knowledge: { revision: serverRevision, nodes: [], edges: [] } });
      if (url.endsWith('/view') && options.method === 'PUT') {
        await viewSaved;
        return response({ ok: true });
      }
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => { throw new Error('polling is forbidden'); }
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));

  const localSave = listeners.get('spatial-view-committed')({ detail: { view: { path: 'root/child' } } });
  serverRevision = 2;
  eventSource.onmessage({ data: '{"revision":2}' });
  finishViewSave();
  await localSave;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(imports.at(-1).revision, 2);
});

test('an older pull already in flight cannot overwrite a newer optimistic workspace operation', async () => {
  const listeners = new Map();
  const imports = [];
  let releaseInitialPull;
  let releaseWorkspaceSave;
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state')) {
        return new Promise((resolve) => {
          releaseInitialPull = () => resolve(response({
            knowledge: { revision: 1, nodes: [], edges: [] }
          }));
        });
      }
      if (url.endsWith('/workspace-edit')) {
        return new Promise((resolve) => {
          releaseWorkspaceSave = () => resolve(response({
            result: { ok: true },
            knowledge: { revision: 2, nodes: [{ key: 'root::edited', label: '编辑后' }], edges: [] }
          }));
        });
      }
      return response({ result: {} });
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => { throw new Error('polling is forbidden'); }
  };
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));

  const save = listeners.get('spatial-workspace-committed')({ detail: {
    persistenceId: 31,
    operation: {
      kind: 'node-edit', nodeKey: 'root::edited', node: { atomPath: '编辑后' },
      draft: { label: '编辑后', description: '' }
    },
    knowledge: { revision: 1, nodes: [{ key: 'root::edited', label: '编辑后' }], edges: [] }
  } });
  releaseInitialPull();
  await new Promise((resolve) => setImmediate(resolve));
  releaseWorkspaceSave();
  await save;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(imports.some((knowledge) => knowledge.revision === 1), false,
    'an in-flight stale pull must never redraw the page after a local operation begins');
  assert.equal(imports.at(-1).revision, 2);
  assert.equal(imports.at(-1).nodes[0].label, '编辑后');
});

test('batch landing is acknowledged only when every selected Atom exists in the authoritative destination', async () => {
  const listeners = new Map();
  const imports = [];
  const persisted = [];
  const failed = [];
  const sourceA = { id: 'a', key: 'root::a', path: 'root', atomPath: 'A', label: 'A' };
  const sourceB = { id: 'b', key: 'root::b', path: 'root', atomPath: 'B', label: 'B' };
  const response = (payload) => ({ ok: true, json: async () => payload });
  const document = { body: { dataset: {} }, hidden: false };
  const window = {
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    spatialLab: {
      state: () => ({ transactionActive: false }),
      importKnowledge: (knowledge) => { imports.push(knowledge); return true; },
      exportField: () => ({ path: 'root' })
    },
    fetch: async (url, options = {}) => {
      if (url.endsWith('/health')) return response({ mode: 'single', atomWorkspace: true });
      if (url.includes('/state') && !options.method) {
        return response({ knowledge: { revision: 1, nodes: [sourceA, sourceB], edges: [] } });
      }
      if (url.endsWith('/workspace-edit')) {
        return response({
          ok: true,
          result: { ok: true },
          knowledge: {
            revision: 2,
            nodes: [{ ...sourceA, id: 'a2', key: 'target::a2', path: 'target', atomPath: 'Target/A' }, sourceB],
            edges: []
          }
        });
      }
      return response({ result: {} });
    },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    dispatchEvent: (event) => {
      if (event.type === 'spatial-workspace-persisted') persisted.push(event.detail);
      if (event.type === 'spatial-workspace-persist-failed') failed.push(event.detail);
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    setInterval: () => 0
  };
  installWorkspaceModel(window);
  window.window = window;
  vm.runInNewContext(source, { window, document }, { filename: 'spatial-browser-bridge.js' });
  await new Promise((resolve) => setImmediate(resolve));
  imports.length = 0;

  const target = { path: 'target' };
  await listeners.get('spatial-workspace-committed')({ detail: {
    persistenceId: 41,
    operation: {
      kind: 'node-land-batch', target,
      landings: [
        { kind: 'node-land', source: { key: sourceA.key }, sourceNode: sourceA, target, draft: sourceA },
        { kind: 'node-land', source: { key: sourceB.key }, sourceNode: sourceB, target, draft: sourceB }
      ]
    },
    knowledge: { revision: 1, nodes: [sourceA, sourceB], edges: [] }
  } });

  assert.equal(persisted.length, 0, 'partial authoritative results must not be reported as saved');
  assert.equal(failed.length, 1);
  assert.match(failed[0].message, /整批|2|1/);
  assert.equal(imports.at(-1).revision, 1, 'the optimistic preview rolls back to the last authoritative world');
});
