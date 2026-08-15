const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = engine.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = engine.indexOf('{', start + marker.length);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = bodyStart; index < engine.length; index += 1) {
    const character = engine[index];
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
    if (character === '}' && --depth === 0) return engine.slice(start, index + 1);
  }
  assert.fail(`${name} body is bounded`);
}

test('view mode geometry loads before the engine and is a required visual dependency', () => {
  const model = html.indexOf('spatial-view-mode-model.js');
  const engineIndex = html.indexOf('spatial-engine.js');
  assert.ok(model > -1 && model < engineIndex);
  assert.match(engine, /const viewModeModel = global\.SpatialViewModeModel/);
});

test('visual snapshots retain the active mode and each existing branch projection', () => {
  const branch = functionSource('clusterBranchSnapshot');
  const snapshot = functionSource('visualSnapshot');
  const restore = functionSource('restoreVisualSnapshot');

  assert.match(branch, /projectionMode:\s*descriptor\.projectionMode/);
  assert.match(snapshot, /viewMode:\s*state\.viewMode/);
  assert.match(restore, /state\.viewMode\s*=\s*snapshot\.viewMode/);
});

test('the initial and missing-history view defaults to A nested mode with floating details', () => {
  assert.match(engine, /viewMode:\s*["']nested["']/);
  assert.match(engine, /snapshot\.viewMode\s*\|\|\s*["']nested["']/);
  assert.match(engine, /detailMode:\s*["']floating["']/);
});

test('ASDF sets only the future view mode without moving the camera', () => {
  const setMode = functionSource('setViewMode');
  assert.match(setMode, /sceneAdapter\.commitViewIntent/);
  assert.doesNotMatch(setMode, /state\.viewMode\s*=/);
  assert.doesNotMatch(setMode, /camera\.|startCameraTween|expandedClusterDomains\.clear/);
  for (const intent of ['setPeripheralView', 'setNestedView', 'setHierarchyView', 'setImmersiveView']) {
    assert.match(engine, new RegExp('case ["\\x27]' + intent + '["\\x27]'));
  }
});

test('right single click applies the selected projection and right double click has no action path', () => {
  const apply = functionSource('applyViewMode');
  const commit = functionSource('commitPointerCandidate');

  assert.match(engine, /case ["']applyViewMode["']/);
  assert.match(apply, /state\.viewMode/);
  assert.match(apply, /toggleClusterChildDomain/);
  assert.match(apply, /enterNode/);
  assert.doesNotMatch(commit, /nodeDoubleSecondary|fieldDoubleSecondary/);
});

test('a right click appends its projection without rewriting the previously formed route', () => {
  const visible = functionSource('visibleClusterDomains');
  assert.doesNotMatch(visible, /routeProjectionMode/);
  assert.match(visible, /projectionMode:\s*["']hierarchy["']/);
  assert.match(visible, /const descriptors = new Map\([\s\S]*state\.expandedClusterDomains/);
  assert.doesNotMatch(visible, /state\.domainStack\.map/);
});

test('double Shift arms one peer batch and the next right click supplies its target', () => {
  const shift = functionSource('handleShiftTap');
  const arm = functionSource('armPeerViewBatch');
  const consume = functionSource('consumePeerViewBatch');
  const apply = functionSource('applyViewMode');

  assert.match(shift, /next\.tapCount === 2[\s\S]*armPeerViewBatch/);
  assert.match(arm, /peerBatchArmed\s*=\s*true/);
  assert.match(arm, /peerBatchMode\s*=\s*state\.viewMode/);
  assert.doesNotMatch(arm, /pointerPosition|executeWandTargets|setTimeout/);
  assert.match(apply, /consumePeerViewBatch\(node\)/);
  assert.match(consume, /viewModeModel\.planPeerBatch/);
  assert.match(consume, /executeWandTargets/);
  assert.match(consume, /batchMode === ["']immersive["'][\s\S]*changed:\s*false/);
  assert.match(consume, /viewMode:\s*batchMode/);
});

test('an armed peer batch shows the existing wand at the free pointer until right click consumes it', () => {
  const arm = functionSource('armPeerViewBatch');
  const consume = functionSource('consumePeerViewBatch');
  const trail = functionSource('drawWandTrail');

  assert.match(arm, /canvas\.style\.cursor\s*=\s*["']none["']/);
  assert.match(trail, /state\.wand\.peerBatchArmed/);
  assert.match(consume, /syncCanvasCursor/);
  assert.match(engine, /state\.wand\.highEnergy\s*\|\|\s*state\.wand\.peerBatchArmed/);
});

test('immersive blank right click returns through the active domain when no cluster context exists', () => {
  const applyParent = functionSource('applyParentView');

  assert.match(
    applyParent,
    /const\s+path\s*=\s*\(domainContext\s*&&\s*domainContext\.path\)\s*\|\|\s*state\.currentPath/
  );
  assert.match(applyParent, /exitDomain/);
});

test('PageUp/PageDown collapse or expand the entire current context by one level in A S or D mode', () => {
  const expand = functionSource('expandHoveredClusterLevel');
  const collapse = functionSource('collapseHoveredClusterLevel');
  const inputConfig = fs.readFileSync(path.join(root, 'input-config.js'), 'utf8');

  assert.match(expand, /planContextLevelExpansion/);
  assert.match(expand, /visibleClusterDomains/);
  assert.match(expand, /openClusterChildDomain/);
  assert.doesNotMatch(expand, /state\.hovered|pointerPosition/);
  assert.match(collapse, /planContextLevelCollapse/);
  assert.match(collapse, /expandedClusterDomains/);
  assert.doesNotMatch(collapse, /pointerPosition/);

  assert.match(engine, /case ["']collapseHoveredCluster["']/);
  assert.match(engine, /case ["']expandHoveredCluster["']/);
  assert.match(inputConfig, /PageUp:\s*VISUAL_INTENTS\.collapseHoveredCluster/);
  assert.match(inputConfig, /PageDown:\s*VISUAL_INTENTS\.expandHoveredCluster/);
  assert.match(inputConfig, /PageUp · 当前视图全部收缩一层（A\/S\/D）/);
  assert.match(inputConfig, /PageDown · 当前视图全部展开一层（A\/S\/D）/);
});

test('Shift right-drag records a visible wand stroke and resolves hit regions at release', () => {
  const begin = functionSource('beginWandStroke');
  const extend = functionSource('extendWandStroke');
  const finish = functionSource('finishWandStroke');

  assert.match(begin, /state\.wand\.points/);
  assert.match(extend, /state\.wand\.points\.push/);
  assert.match(finish, /viewModeModel\.resolveStrokeTargets/);
  assert.match(finish, /state\.wand\.pendingKeys/);
  assert.match(engine, /function releaseWandBatch\([\s\S]*executeWandTargets/);
  assert.match(engine, /function drawWandTrail\(/);
  assert.match(engine, /drawWandTrail\(\)/);
});

test('Shift right-drag remembers the final hit node for the next middle-drag orbit', () => {
  const finish = functionSource('finishWandStroke');

  assert.match(finish, /result\.keys\.at\(\s*-1\s*\)/);
  assert.match(finish, /rememberLatestInteraction/);
});

test('closed-loop targets glow for 500ms before one recursive visual transaction', () => {
  const execute = functionSource('executeWandTargets');

  assert.match(execute, /glowDurationMs/);
  assert.match(execute, /global\.setTimeout/);
  assert.equal((execute.match(/recordCurrentView\(/g) || []).length, 1);
  assert.match(engine, /wandGlowUntil/);
});

test('triple Shift toggles jade recursion and recursive planning never calls data editing APIs', () => {
  const shift = functionSource('handleShiftTap');
  const recursive = functionSource('expandRecursively');
  const collect = functionSource('recursiveVisualEntries');
  const trail = functionSource('drawWandTrail');

  assert.match(shift, /viewModeModel\.resolveShiftTap/);
  assert.match(collect, /viewModeModel\.planRecursiveTargets/);
  assert.match(collect, /topLevelDomainNodesForPath\(childPath\)/);
  assert.doesNotMatch(recursive, /workspace\.(create|update|delete|import|replace|commit)/);
  assert.match(engine, /wand\.highEnergy/);
  assert.match(trail, /!state\.wand\.highEnergy/);
  assert.match(shift, /canvas\.style\.cursor/);
});

test('jade recursion follows imported workspace child domains in every ASDF mode and commits atomically', () => {
  const collect = functionSource('recursiveVisualEntries');
  const expand = functionSource('expandRecursively');

  assert.match(collect, /entry\.node\.isWorkspaceNode/);
  assert.match(collect, /topLevelDomainNodesForPath\(childPath\)/);
  assert.match(expand, /openClusterChildDomain/);
  assert.doesNotMatch(expand, /toggleClusterChildDomain/);
  assert.equal((expand.match(/buildClusterScene\(/g) || []).length, 1);
});

test('End expands from the top-level Boss without wand state and stays inert in F mode', () => {
  const expand = functionSource('expandToLeaves');

  assert.match(expand, /state\.viewMode\s*===\s*["']immersive["'][\s\S]*return false/);
  assert.match(expand, /projectionMode:\s*state\.viewMode/);
  assert.match(expand, /state\.currentPath\s*=\s*["']root["']/);
  assert.match(expand, /commitViewIntent\(state, \{ type: "clear-views" \}\)/);
  assert.match(expand, /recursiveVisualEntries/);
  assert.match(expand, /openClusterChildDomain/);
  assert.doesNotMatch(expand, /projectionMode:\s*["']hierarchy["']/);
  assert.doesNotMatch(expand, /state\.wand|highEnergy/);
});

test('middle drag adopts the latest interacted node as orbit center without changing zoom', () => {
  const downStart = engine.indexOf('canvas.addEventListener("pointerdown"');
  const downEnd = engine.indexOf('canvas.addEventListener("pointermove"', downStart);
  const down = engine.slice(downStart, downEnd);
  const moveStart = engine.indexOf('canvas.addEventListener("pointermove"');
  const moveEnd = engine.indexOf('canvas.addEventListener("pointerup"', moveStart);
  const move = engine.slice(moveStart, moveEnd);
  const drag = functionSource('beginDragFromCandidate');
  const adopt = functionSource('adoptLatestInteractionAnchor');

  assert.match(down, /rememberLatestInteraction\(\s*item\s*\)/);
  assert.match(drag, /candidate\.dragIntent\s*===\s*["']orbit["'][\s\S]*adoptLatestInteractionAnchor\(\)/);
  assert.match(move, /state\.drag\.type\s*===\s*["']orbit["'][\s\S]*dispatchIntent\(["']orbit["']/);
  assert.match(adopt, /camera\.target\s*=/);
  assert.doesNotMatch(adopt, /camera\.(?:distance|yaw|pitch)\s*=/);
  assert.doesNotMatch(engine, /spaceCameraActive|camera-pan|panCamera\(/);
  assert.doesNotMatch(engine, /fieldPrimaryDrag:\s*VISUAL_INTENTS\.orbit/);
});

test('stationary middle click quickly frames the pointed node or cluster', () => {
  const commit = functionSource('commitPointerCandidate');
  const quickFrame = functionSource('quickFrameMiddleTarget');
  const middleHit = functionSource('findMiddleFrameHit');
  const release = functionSource('releasePointer');
  assert.match(commit, /candidate\.button\s*===\s*1[\s\S]*quickFrameMiddleTarget\s*\(\s*candidate\s*\)/);
  assert.match(engine, /event\.button\s*===\s*1[\s\S]*findMiddleFrameHit\s*\(\s*event\.clientX\s*,\s*event\.clientY\s*\)/);
  assert.match(middleHit, /middleFrameTarget\.chooseMostSpecificTarget\s*\(\s*state\.hitRegions/);
  assert.match(release, /candidate\.button\s*===\s*1[\s\S]*releaseHit\s*=\s*findMiddleFrameHit/);
  assert.match(quickFrame, /candidate\.node/);
  assert.match(quickFrame, /candidate\.domainContext/);
  assert.match(quickFrame, /candidate\.item\.clusterShellProxy/);
  assert.match(quickFrame, /candidate\.item\.radius/);
  assert.doesNotMatch(quickFrame, /candidate\.node\.radius/);
  assert.match(quickFrame, /Math\.tan\s*\(\s*camera\.fov\s*\/\s*2\s*\)/);
  assert.match(quickFrame, /startCameraTween\s*\(/);
});

test('wand batch and recursive actions preserve the current camera snapshot', () => {
  for (const name of ['executeWandTargets', 'expandRecursively', 'applyViewMode']) {
    const source = functionSource(name);
    assert.doesNotMatch(source, /camera\.distance\s*=|startCameraTween/);
  }
});

test('rapid visual undo and redo can replace an unfinished history tween', () => {
  const gate = functionSource('transitionBlocksIntent');
  const prepare = functionSource('prepareViewHistoryNavigation');
  const back = functionSource('backView');
  const forward = functionSource('forwardView');

  assert.match(prepare, /state\.cameraTween\s*=\s*null/);
  assert.match(prepare, /state\.transitionLocked\s*=\s*false/);
  assert.match(back, /prepareViewHistoryNavigation\(\)/);
  assert.match(forward, /prepareViewHistoryNavigation\(\)/);
  assert.match(gate, /backView/);
  assert.match(gate, /forwardView/);
  assert.doesNotMatch(back, /if\s*\(state\.transitionLocked\)\s*\{\s*return/);
  assert.doesNotMatch(forward, /if\s*\(state\.transitionLocked\)\s*\{\s*return/);
});

test('right click browsing and Z X history never mutate the middle or wheel owned camera', () => {
  for (const name of [
    'applyViewMode',
    'applyParentView',
    'restoreVisualSnapshot',
    'backView',
    'forwardView'
  ]) {
    const source = functionSource(name);
    assert.doesNotMatch(source, /camera\.(?:target|yaw|pitch|distance)\s*=/, `${name} leaves camera values untouched`);
    assert.doesNotMatch(source, /startCameraTween\s*\(/, `${name} does not animate the camera`);
  }

  const enter = functionSource('enterNode');
  assert.doesNotMatch(enter, /camera\.(?:target|yaw|pitch|distance)\s*=/);
  assert.match(enter, /immersiveDomainFrame[\s\S]*startCameraTween/);
  const exit = functionSource('returnToDepth');
  assert.doesNotMatch(exit, /camera\.(?:target|yaw|pitch|distance)\s*=/);
  assert.match(exit, /immersiveDomainFrame[\s\S]*startCameraTween/);

  const restore = functionSource('restoreVisualSnapshot');
  assert.doesNotMatch(restore, /snapshot\.camera/, 'history restore ignores recorded camera state');
});

test('Z restores immersive browsing history without a camera transition', () => {
  const enter = functionSource('enterNode');
  const back = functionSource('backView');
  const restore = functionSource('restoreVisualSnapshot');

  assert.match(enter, /recordCurrentView\(\)/);
  assert.match(back, /state\.viewHistory\.back\(\)/);
  assert.match(back, /restoreVisualSnapshot\(snapshot\)/);
  assert.doesNotMatch(restore, /startCameraTween|snapshot\.camera|camera\./);
});

test('one wand batch creates one restorable history step for real knowledge nodes', () => {
  const reveal = functionSource('revealNode');
  const restore = functionSource('restoreVisualSnapshot');

  assert.match(reveal, /options\.record\s*!==\s*false/);
  assert.match(restore, /const snapshotNodes = currentDomainNodes\(\)/);
  assert.match(restore, /resetSnapshotNodeState\(snapshotNodes\)/);
  assert.match(restore, /restoreRevealedNodes\(snapshotNodes/);
  assert.match(restore, /findExistingNode\(snapshotNodes/);
});
