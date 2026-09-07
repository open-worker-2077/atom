const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');
const inputConfig = fs.readFileSync(path.join(root, 'input-config.js'), 'utf8');

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

test('visual snapshots retain A branch structure and restore the single A projection', () => {
  const branch = functionSource('clusterBranchSnapshot');
  const snapshot = functionSource('visualSnapshot');
  const restore = functionSource('restoreVisualSnapshot');

  assert.match(branch, /projectionMode:\s*["']nested["']/);
  assert.match(snapshot, /expandedClusters:\s*clusterBranchSnapshot\(\)/);
  assert.match(restore, /state\.viewMode\s*=\s*["']nested["']/);
  assert.match(restore, /state\.appliedViewMode\s*=\s*["']nested["']/);
  assert.match(restore, /restoreClusterBranches\(snapshot\.expandedClusters\s*\|\|\s*\[\]\)/);
});

test('the initial and restored view uses A nested mode with floating details', () => {
  const restore = functionSource('restoreVisualSnapshot');
  assert.match(engine, /viewMode:\s*["']nested["']/);
  assert.match(engine, /appliedViewMode:\s*["']nested["']/);
  assert.match(restore, /state\.viewMode\s*=\s*["']nested["']/);
  assert.match(engine, /detailMode:\s*["']floating["']/);
});

test('A selects the single nested projection without moving the camera', () => {
  const setMode = functionSource('setViewMode');
  assert.match(setMode, /sceneAdapter\.commitViewIntent\(state,\s*\{\s*type:\s*["']set-view-mode["'],\s*mode:\s*["']nested["']\s*\}\)/);
  assert.doesNotMatch(setMode, /state\.viewMode\s*=/);
  assert.doesNotMatch(setMode, /camera\.|startCameraTween|expandedClusterDomains\.clear/);
  assert.match(engine, /case ["']setNestedView["']/);
  for (const retired of ['setPeripheralView', 'setHierarchyView', 'setImmersiveView']) {
    assert.doesNotMatch(engine, new RegExp('case ["\\x27]' + retired + '["\\x27]'));
  }
});

test('right short press applies A, right hold immerses, and right double click has no action path', () => {
  const ordinary = functionSource('applyInwardView');
  const immersive = functionSource('applyImmersiveInwardView');
  const begin = functionSource('beginSecondaryNavigation');
  const commit = functionSource('commitPointerCandidate');

  assert.match(inputConfig, /nodeSecondary:\s*VISUAL_INTENTS\.applyInwardView/);
  assert.match(inputConfig, /nodeHoldSecondary:\s*VISUAL_INTENTS\.applyImmersiveInwardView/);
  assert.match(ordinary, /planViewTargets\(["']nested["']/);
  assert.match(ordinary, /toggleClusterChildDomain\(node, ownerPath, ["']nested["']\)/);
  assert.match(immersive, /enterNode\(node, true\)/);
  assert.match(begin, /gesture:\s*["']hold["'][\s\S]*secondaryClickArbiter\.begin/);
  assert.match(commit, /secondaryClickArbiter\.release/);
  assert.doesNotMatch(inputConfig, /nodeDoubleSecondary|fieldDoubleSecondary/);
  assert.match(inputConfig, /gesture\s*===\s*["']double["']\s*&&\s*event\.button\s*===\s*2[\s\S]{0,80}return null/);
});

test('a right click appends its projection without rewriting the previously formed route', () => {
  const visible = functionSource('visibleClusterDomains');
  assert.doesNotMatch(visible, /routeProjectionMode/);
  assert.match(visible, /projectionMode:\s*state\.appliedViewMode/);
  assert.match(visible, /const descriptors = new Map\([\s\S]*state\.expandedClusterDomains/);
  assert.doesNotMatch(visible, /state\.domainStack\.map/);
});

test('double Shift immediately selects peers and view actions apply to the persistent selection', () => {
  const shift = functionSource('handleShiftTap');
  const apply = functionSource('applyInwardView');
  const establish = functionSource('establishPeerSelection');
  const batch = functionSource('applyBatchViewMode');

  assert.match(shift, /next\.tapCount === 2[\s\S]*establishPeerSelection/);
  assert.doesNotMatch(shift, /armPeerViewBatch/);
  assert.match(establish, /batchSelectionKeys/);
  assert.match(establish, /viewModeModel\.planPeerBatch/);
  assert.match(apply, /applyBatchViewMode/);
  assert.match(batch, /executeWandTargets/);
});

test('right hold immerses only the clicked node while Escape clears the ordinary A batch', () => {
  const apply = functionSource('applyImmersiveInwardView');
  const cancel = functionSource('cancelTemporaryState');
  assert.match(apply, /enterNode\(node, true\)/);
  assert.doesNotMatch(apply, /planViewTargets|applyBatchViewMode/);
  assert.match(cancel, /batchSelectionKeys\.clear\(\)/);
});

test('immersive entry commits the real owner route as one active-domain transition', () => {
  const enter = functionSource('enterNode');
  const route = functionSource('buildImmersiveDomainRoute');
  const commit = functionSource('commitDomainRoute');

  assert.match(route, /resolveImmersiveOwnerContext/);
  assert.match(route, /ownerSegmentForNode:\s*\(nodeId\)\s*=>\s*hashText\(nodeId\)\.toString\(36\)/);
  assert.match(enter, /buildImmersiveDomainRoute\(node, parentCamera\)/);
  assert.match(enter, /commitDomainRoute\(route, enteredNode/);
  assert.match(commit, /state\.domainStack\s*=/);
  assert.match(commit, /state\.currentPath\s*=/);
  assert.match(commit, /state\.depth\s*=/);
  assert.match(commit, /state\.crumbs\s*=/);
  assert.match(commit, /state\.nodes\s*=/);
  assert.match(commit, /publishCurrentView\(\)/);
});

test('successful A expansion appends the child domain without immersive framing', () => {
  const toggle = functionSource('toggleClusterChildDomain');
  const open = functionSource('openClusterChildDomain');
  assert.match(toggle, /openClusterChildDomain\(node, ownerPath, projectionMode\)/);
  assert.match(toggle, /buildClusterScene\(\)/);
  assert.match(open, /projectionMode:\s*["']nested["']/);
  assert.match(open, /type:\s*["']append-view["']/);
  assert.doesNotMatch(toggle, /frameClusterDomain|startCameraTween/);
});

test('immersive A frames the entered domain shell instead of only its inner nodes', () => {
  const enter = functionSource('enterNode');
  const refit = functionSource('refitCurrentDomain');
  const shellFrame = functionSource('currentDomainClusterFrame');

  assert.match(shellFrame, /state\.clusterScene\.clusters\.find/);
  assert.match(shellFrame, /candidate\.path\s*===\s*state\.currentPath/);
  assert.match(shellFrame, /viewModeModel\.clusterDomainFrame/);
  assert.match(enter, /forceImmersive\s*\?\s*currentDomainClusterFrame\(\)\s*:\s*currentDomainSceneFrame\(\)/);
  assert.match(refit, /state\.clusterFieldOpen\s*&&\s*state\.depth\s*>\s*0/);
  assert.match(refit, /currentDomainClusterFrame\(\)/);
});

test('newly loaded active Atom scope can refit every current node into the viewport', () => {
  const refit = functionSource('refitCurrentDomain');

  assert.match(refit, /currentDomainSceneFrame\(\)/);
  assert.match(refit, /startCameraTween\s*\(/);
  assert.match(engine, /refitCurrentDomain,/);
});

test('legacy peer-batch atoms remain available without owning the active double-Shift path', () => {
  const arm = functionSource('armPeerViewBatch');
  const consume = functionSource('consumePeerViewBatch');

  assert.match(arm, /syncCanvasCursor\(\)/);
  assert.match(consume, /syncCanvasCursor/);
  assert.doesNotMatch(functionSource('handleShiftTap'), /armPeerViewBatch/);
});

test('immersive blank right click returns through the active domain when no cluster context exists', () => {
  const applyParent = functionSource('applyParentView');

  assert.match(
    applyParent,
    /const\s+path\s*=\s*\(domainContext\s*&&\s*domainContext\.path\)\s*\|\|\s*state\.currentPath/
  );
  assert.match(applyParent, /exitDomain/);
});

test('all vertical shortcuts share the crosshair domain anchor and preserve outside branches', () => {
  const anchor = functionSource('verticalScopeAnchor');
  const expand = functionSource('expandHoveredClusterLevel');
  const collapse = functionSource('collapseHoveredClusterLevel');
  const overview = functionSource('collapseVerticalScope');
  const leaves = functionSource('expandVerticalScopeToLeaves');

  assert.match(anchor, /viewModeModel\.resolveVerticalScopeAnchor\(\s*state\.clusterHitRegions,\s*state\.pointerPosition\s*\)/);
  assert.match(anchor, /clusterSceneRevision/);
  assert.match(expand, /planContextLevelExpansion/);
  assert.match(expand, /verticalScopeAnchor\(\)/);
  assert.match(expand, /frontierPaths/);
  assert.match(expand, /pathSlots\(anchor\.path/);
  assert.match(expand, /topLevelDomainNodesForPath\(ownerPath\)/);
  assert.match(expand, /openClusterChildDomain/);
  assert.match(expand, /frameClusterDomain\(anchor\.path\)/);
  assert.doesNotMatch(expand, /visibleClusterDomains\(\)/);
  assert.match(collapse, /planContextLevelCollapse/);
  assert.match(collapse, /verticalScopeAnchor\(\)/);
  assert.match(collapse, /expandedClusterDomains/);
  assert.match(collapse, /anchor\.path/);
  assert.match(overview, /verticalScopeAnchor\(\)/);
  assert.match(overview, /pathSlots\(anchor\.path/);
  assert.doesNotMatch(overview, /state\.currentPath\s*=\s*["']root["']/);
  assert.match(leaves, /verticalScopeAnchor\(\)/);
  assert.match(leaves, /topLevelDomainNodesForPath\(anchor\.path\)/);
  assert.doesNotMatch(leaves, /state\.currentPath\s*=\s*["']root["']/);

  assert.match(engine, /case ["']collapseHoveredCluster["']/);
  assert.match(engine, /case ["']expandHoveredCluster["']/);
  assert.match(inputConfig, /PageUp:\s*VISUAL_INTENTS\.collapseHoveredCluster/);
  assert.match(inputConfig, /PageDown:\s*VISUAL_INTENTS\.expandHoveredCluster/);
  assert.match(inputConfig, /Home:\s*VISUAL_INTENTS\.collapseVerticalScope/);
  assert.match(inputConfig, /End:\s*VISUAL_INTENTS\.expandVerticalScopeToLeaves/);
  assert.match(expand, /planContextLevelExpansion\([\s\S]*["']nested["']/);
  assert.match(collapse, /planContextLevelCollapse\([\s\S]*["']nested["']/);
  assert.match(inputConfig, /PageUp · 十字所在团收缩一层（A）/);
  assert.match(inputConfig, /PageDown · 十字所在团剖开一层（A）/);
});

test('real pointer movement releases the remembered vertical scope anchor', () => {
  const start = engine.indexOf('canvas.addEventListener("pointermove"');
  const end = engine.indexOf('canvas.addEventListener("pointerup"', start);
  const pointerMove = engine.slice(start, end);

  assert.match(pointerMove, /state\.verticalScopeAnchor\s*=\s*null/);
});

test('the visible system pointer and crosshair share the same hit point', () => {
  const cursor = functionSource('drawViewModeCursor');
  const sync = functionSource('syncCanvasCursor');

  assert.match(cursor, /context\.translate\(point\.x, point\.y\)/);
  assert.doesNotMatch(cursor, /point\.[xy]\s*\+\s*18/);
  assert.match(sync, /canvas\.style\.cursor\s*=\s*["']default["']/);
  assert.doesNotMatch(sync, /["']none["']/);
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

test('holding Shift can start and revise a batch by brushing nodes without prior peer selection', () => {
  const toggle = functionSource('toggleBatchSelectionAtHit');
  const pointerMoveStart = engine.indexOf('canvas.addEventListener("pointermove"');
  const pointerMoveEnd = engine.indexOf('function releasePointer', pointerMoveStart);
  const pointerMove = engine.slice(pointerMoveStart, pointerMoveEnd);

  assert.match(toggle, /!state\.wand\.shiftHeld/);
  assert.doesNotMatch(toggle, /!state\.batchSelectionKeys\.size/);
  assert.match(toggle, /toggleSelectionKey/);
  assert.match(toggle, /batchSelectionEntries\.set/);
  assert.match(toggle, /batchSelectionEntries\.delete/);
  assert.match(toggle, /state\.wand\.tapCount\s*=\s*0/);
  assert.match(toggle, /state\.wand\.lastTapAt\s*=\s*0/);
  assert.match(pointerMove, /toggleBatchSelectionAtHit/);
});

test('Home clears the contextual batch so Shift brushing starts cleanly in the overview', () => {
  const overview = functionSource('returnOverview');

  assert.match(overview, /batchSelectionKeys\.clear/);
  assert.match(overview, /batchSelectionEntries\.clear/);
  assert.match(overview, /batchToggleKey\s*=\s*null/);
  assert.match(overview, /wand\.tapCount\s*=\s*0/);
  assert.match(overview, /wand\.lastTapAt\s*=\s*0/);
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

test('triple Shift is reserved while the preserved recursive atom remains data-read-only', () => {
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
  assert.doesNotMatch(shift, /next\.triple[\s\S]*expandRecursively/);
});

test('jade recursion follows A child domains and commits the visual result atomically', () => {
  const collect = functionSource('recursiveVisualEntries');
  const expand = functionSource('expandRecursively');

  assert.match(collect, /entry\.node\.hasChildren\s*!==\s*true/);
  assert.match(collect, /createChildDomainNodes\(entry\.node, childPath, childDepth\)/);
  assert.match(collect, /topLevelDomainNodesForPath\(childPath\)/);
  assert.match(collect, /viewModeModel\.planRecursiveTargets/);
  assert.match(expand, /openClusterChildDomain/);
  assert.doesNotMatch(expand, /toggleClusterChildDomain/);
  assert.equal((expand.match(/buildClusterScene\(/g) || []).length, 1);
});

test('End expands A recursively from the top-level Boss without wand state', () => {
  const expand = functionSource('expandToLeaves');

  assert.match(expand, /transactionBlocksViewChange\(\)/);
  assert.match(expand, /state\.currentPath\s*=\s*["']root["']/);
  assert.match(expand, /commitViewIntent\(state, \{ type: "clear-views" \}\)/);
  assert.match(expand, /recursiveVisualEntries\(roots,\s*\{\s*forceDomainTraversal:\s*true\s*\}\)/);
  assert.match(expand, /openClusterChildDomain\(entry\.node, entry\.ownerPath, ["']nested["']\)/);
  assert.match(expand, /recordCurrentView\(\)[\s\S]*recordCurrentView\(\)/);
  assert.doesNotMatch(expand, /state\.viewMode|immersive|hierarchy/);
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
  assert.match(engine, /pointerInput\.button\s*===\s*1[\s\S]*findMiddleFrameHit\s*\(\s*event\.clientX\s*,\s*event\.clientY\s*\)/);
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

test('wand batch and recursive actions preserve the camera except the explicit completed view transition', () => {
  for (const name of ['executeWandTargets', 'expandRecursively']) {
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

test('history preserves camera ownership while a completed right-click transition may frame its result', () => {
  for (const name of [
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
  assert.match(enter, /currentDomainSceneFrame[\s\S]*startCameraTween/);
  const exit = functionSource('returnToDepth');
  assert.doesNotMatch(exit, /camera\.(?:target|yaw|pitch|distance)\s*=/);
  assert.match(exit, /currentDomainSceneFrame[\s\S]*startCameraTween/);

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
