const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-engine.js'), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = source.indexOf('{', start + marker.length);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} body is bounded`);
}

test('render collection and lens drawing never instantiate hierarchy state', () => {
  assert.doesNotMatch(functionSource('collectNodes'), /createSatellites|createDomain|prefetchChildDomain/);
  assert.doesNotMatch(functionSource('drawLensInterior'), /createSatellites|createDomain|prefetchChildDomain/);
  assert.doesNotMatch(functionSource('drawDomainPathMap'), /createSatellites|createDomain|prefetchChildDomain/);
});

test('visual snapshots retain bounded expansion ids for cache-safe restore', () => {
  const snapshot = functionSource('visualSnapshot');
  const restore = functionSource('restoreVisualSnapshot');

  assert.match(snapshot, /existingNodes\s*\(\s*currentDomainNodes\s*\(\s*\)\s*\)/);
  assert.match(snapshot, /revealedIds/);
  const resetIndex = restore.indexOf('resetSnapshotNodeState');
  const replayIndex = restore.indexOf('restoreRevealedNodes');
  assert.notEqual(resetIndex, -1, 'cached snapshot flags are reset');
  assert.notEqual(replayIndex, -1, 'snapshot flags are replayed');
  assert.ok(resetIndex < replayIndex, 'cached state is reset before exact replay');
  assert.match(restore, /restoreRevealedNodes/);
  assert.match(restore, /hydrateNodePath/);
});

test('visible collection applies a deterministic tension layout without live physics state', () => {
  const collect = functionSource('collectNodes');

  assert.match(collect, /visualModel\.relaxRelationshipLayout\s*\(/);
  assert.match(collect, /fixed\s*:\s*Boolean\s*\(\s*node\.manualPosition\s*\)/);
  assert.match(collect, /parentId\s*:\s*node\.parent\s*\?\s*node\.parent\.id\s*:\s*null/);
  assert.match(collect, /containerRadius\s*:\s*node\.parent\s*\?\s*node\.parent\.radius\s*:\s*null/);
  assert.doesNotMatch(collect, /velocity|acceleration|momentum/i);
});

test('orbit dragging freezes local animation time and resolves a stable screen axis', () => {
  const beginDrag = functionSource('beginDragFromCandidate');
  const scene = functionSource('renderScene');

  assert.match(beginDrag, /sceneTime\s*:\s*state\.time/);
  assert.match(beginDrag, /totalDx\s*:\s*0/);
  assert.match(beginDrag, /totalDy\s*:\s*0/);
  assert.match(beginDrag, /axisLock\s*:\s*null/);
  assert.match(scene, /state\.drag[\s\S]*?type\s*===\s*["']orbit["'][\s\S]*?sceneTime/);
  assert.match(source, /grammar\.resolveOrbitDragDelta\s*\(/);
});

test('parent return rehydrates a satellite entry before resolving it', () => {
  const exit = functionSource('returnToDepth');
  const hydrateIndex = exit.indexOf('hydrateNodePath(state.nodes, previous.nodeId, true)');
  const findIndex = exit.indexOf('findExistingNode(state.nodes, previous.nodeId)');

  assert.notEqual(hydrateIndex, -1, 'satellite lineage is rehydrated');
  assert.notEqual(findIndex, -1, 'entry is resolved from rebuilt domain');
  assert.ok(hydrateIndex < findIndex, 'rehydration happens before entry resolution');
});

test('registry refresh only mutates a stable visual field and rebuilds root first', () => {
  const refresh = functionSource('refreshVisualRegistry');

  for (const guard of [
    'state.transitionLocked',
    'state.pointerCandidate',
    'state.drag',
    'state.cameraTween',
    'state.wheelGestureActive',
    'state.wheelHistoryTimer',
    'primaryClickArbiter.pending',
    'secondaryClickArbiter.pending'
  ]) {
    assert.match(refresh, new RegExp(guard.replace('.', '\\.')));
  }
  assert.match(refresh, /createDomain\("root",\s*0\)/);
  assert.match(refresh, /resetSnapshotNodeState/);
  assert.match(refresh, /restoreRevealedNodes/);
  assert.match(refresh, /hydrateNodePath/);
});

test('generated carrier copy distinguishes seeded and empty tunnels without terminal entities', () => {
  assert.match(functionSource('generatedCarrierDescription'), /hasChildren/);
  assert.match(functionSource('generatedCarrierDescription'), /隧洞/);
  assert.match(functionSource('generatedCarrierDescription'), /空隧洞/);
  assert.doesNotMatch(functionSource('generatedCarrierDescription'), /末级实体/);
  assert.match(functionSource('createDomain'), /generatedCarrierDescription\(/);
  assert.match(functionSource('createSatellites'), /generatedCarrierDescription\(/);
});

test('unselected readout describes seeded and empty tunnels as one carrier family', () => {
  const selection = functionSource('updateSelectionUI');

  assert.match(selection, /所有球体都是隧洞/);
  assert.match(selection, /空隧洞也可进入/);
  assert.doesNotMatch(selection, /末级实体/);
});
