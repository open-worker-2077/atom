const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-engine.js'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function numericConstant(name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)`));
  assert.ok(match, `${name} has a numeric value`);
  return Number(match[1]);
}

function ordered(sourceText, earlier, later, message) {
  const earlierIndex = sourceText.search(earlier);
  const laterIndex = sourceText.search(later);
  assert.notEqual(earlierIndex, -1, `${message}: first stage exists`);
  assert.notEqual(laterIndex, -1, `${message}: second stage exists`);
  assert.ok(earlierIndex < laterIndex, message);
}

test('engine requires and uses the gesture arbiter', () => {
  assert.match(source, /const\s+gestureArbiter\s*=\s*global\.SpatialGestureArbiter/);
  assert.match(source, /!gestureArbiter/);
  assert.match(functionSource('commitPointerCandidate'), /gestureArbiter\.classifyTap\s*\(/);
  assert.match(source, /gestureArbiter\.createPrimaryClickArbiter\s*\(/);
  assert.match(source, /gestureArbiter\.createSecondaryClickArbiter\s*\(/);
});

test('primary click series is settled by one arbiter without native dblclick dispatch', () => {
  const commit = functionSource('commitPointerCandidate');

  assert.match(commit, /gesture:\s*["']double["']/);
  assert.match(commit, /gesture:\s*["']triple["']/);
  assert.match(commit, /primaryClickArbiter\.submit\s*\(/);
  assert.match(commit, /confirmationCount:\s*1/);
  assert.match(commit, /confirmationCount:\s*2/);
  assert.match(commit, /confirmationCount:\s*3/);
  assert.doesNotMatch(source, /canvas\.addEventListener\(["']dblclick["']/);
});

test('primary taps use click-series arbitration and right taps commit immediately', () => {
  const commit = functionSource('commitPointerCandidate');
  const primaryGate = commit.indexOf('candidate.button === 0');
  const submitted = commit.indexOf('primaryClickArbiter.submit');
  const secondaryGate = commit.indexOf('candidate.button === 2');
  const immediate = commit.indexOf('dispatchIntent(contextualAction.intent');

  assert.notEqual(primaryGate, -1, 'primary-button gate exists');
  assert.ok(primaryGate < submitted, 'primary-button gate controls series commit');
  assert.ok(submitted < secondaryGate, 'secondary arbitration follows primary arbitration');
  assert.ok(secondaryGate < immediate, 'secondary-button gate controls its immediate action');
  assert.doesNotMatch(commit, /secondaryClickArbiter\.submit/);
  assert.doesNotMatch(commit, /action\.intent\s*===\s*["']focus["']/);
});

test('engine dispatches direct node and field visual intent cases', () => {
  const dispatch = functionSource('dispatchIntent');
  assert.match(dispatch, /case\s+["']clearFocus["']/);
  assert.match(dispatch, /case\s+["']toggleChildren["']/);
  assert.match(dispatch, /case\s+["']toggleFieldChildren["']/);
  assert.match(dispatch, /case\s+["']toggleSurface["']/);
  assert.match(dispatch, /case\s+["']toggleFieldSurfaces["']/);
  assert.match(dispatch, /visualModel\.toggleFieldChildren\s*\(/);
  assert.match(dispatch, /visualModel\.toggleNodeSurface\s*\(/);
  assert.match(dispatch, /visualModel\.toggleFieldSurfaces\s*\(/);
});

test('pointer candidates separate tap and drag mappings', () => {
  const start = source.indexOf('canvas.addEventListener("pointerdown"');
  const end = source.indexOf('canvas.addEventListener("pointermove"', start);
  const pointerDown = source.slice(start, end);
  const drag = functionSource('beginDragFromCandidate');

  assert.match(pointerDown, /gesture:\s*["']tap["']/);
  assert.match(pointerDown, /gesture:\s*["']drag["']/);
  assert.match(pointerDown, /dragIntent/);
  assert.match(drag, /candidate\.dragIntent/);
});

test('clear focus resets the current-domain target and distance without leaving the domain', () => {
  const clear = functionSource('clearFocus');
  assert.match(clear, /state\.selected\s*=\s*null/);
  assert.match(clear, /state\.focused\s*=\s*null/);
  assert.match(clear, /recordCurrentView\s*\(\s*\)/);
  assert.match(
    clear,
    /startCameraTween\s*\(\s*\{\s*target\s*:\s*\{\s*x\s*:\s*0\s*,\s*y\s*:\s*0\s*,\s*z\s*:\s*0\s*\}\s*,\s*distance\s*:\s*NORMAL_FIELD_DISTANCE/
  );
  assert.doesNotMatch(clear, /domainStack|currentPath\s*=|camera\.(?:yaw|pitch)\s*=/);
});

test('complete-field distance keeps the stretched relationship graph inside the viewport', () => {
  assert.match(source, /const\s+NORMAL_FIELD_DISTANCE\s*=\s*17\.2/);
});

test('activate remains an outward use hook without visual travel or expansion', () => {
  const dispatch = functionSource('dispatchIntent');
  const activateStart = dispatch.indexOf('case "activate"');
  const activateEnd = dispatch.indexOf('case "alternateActivate"', activateStart);
  const activate = dispatch.slice(activateStart, activateEnd);

  assert.notEqual(activateStart, -1, 'activate case exists');
  assert.doesNotMatch(activate, /focusNode|enterNode|revealNode|inspectNode|preferredIntent|dispatchIntent\s*\(/);
  assert.doesNotMatch(activate, /selectNode\s*\(\s*target\s*\)/);
  assert.match(activate, /commitPulseUntil|announce/);
});

test('wheel reaches a full-screen near view while applying the persisted adjustable speed', () => {
  const dispatch = functionSource('dispatchIntent');
  const dollyStart = dispatch.indexOf('case "dolly"');
  const dolly = dispatch.slice(dollyStart, dispatch.indexOf('default:', dollyStart));

  assert.match(source, /const\s+MIN_CAMERA_DISTANCE\s*=\s*0\.04/);
  assert.match(source, /const\s+MIN_PROJECTABLE_DEPTH\s*=\s*0\.01/);
  assert.match(functionSource('projectUnclipped'), /depth\s*<=\s*MIN_PROJECTABLE_DEPTH/);
  assert.match(source, /const\s+MAX_CAMERA_DISTANCE\s*=\s*25200/);
  assert.match(dolly, /Math\.exp\(\s*visualMeta\.delta\s*\*\s*0\.00115\s*\*\s*state\.demo\.settings\.zoomSpeedPercent\s*\/\s*100\s*\)/);
  assert.match(dolly, /MIN_CAMERA_DISTANCE\s*,\s*MAX_CAMERA_DISTANCE/);
});

test('scale metric reports visible world-range growth from one at the nearest view', () => {
  const metrics = functionSource('updateMetrics');

  assert.match(
    metrics,
    /camera\.distance\s*\/\s*MIN_CAMERA_DISTANCE/,
    'perspective world span grows linearly with camera distance'
  );
  assert.doesNotMatch(metrics, /18\s*\/\s*camera\.distance/);
});

test('wheel travels continuously along the pointer direction and centres that point', () => {
  const dispatch = functionSource('dispatchIntent');
  const dollyStart = dispatch.indexOf('case "dolly"');
  const dolly = dispatch.slice(dollyStart, dispatch.indexOf('default:', dollyStart));
  const start = source.indexOf('canvas.addEventListener("wheel"');
  const end = source.indexOf('canvas.addEventListener("contextmenu"', start);
  const wheel = source.slice(start, end);

  assert.match(wheel, /canvasPoint\s*\(\s*event\s*\)/);
  assert.match(wheel, /unprojectScreen\s*\(/);
  assert.match(wheel, /findHit\s*\(\s*event\.clientX\s*,\s*event\.clientY\s*\)/);
  assert.match(wheel, /\.item\.screen\.depth/);
  assert.match(wheel, /const\s+anchorDepth\s*=/);
  assert.doesNotMatch(wheel, /fullscreenDistanceForNode|minimumDistance/);
  assert.match(wheel, /state\.wheelNavigationAnchor/);
  assert.match(wheel, /state\.wheelNavigationPoint/);
  assert.match(wheel, /Math\.hypot\s*\(/);
  assert.match(wheel, /const\s+anchor\s*=\s*state\.wheelNavigationAnchor/);
  assert.match(dolly, /visualMeta\.anchor/);
  assert.match(dolly, /camera\.target\s*=\s*visualMeta\.anchor/);
  assert.doesNotMatch(dolly, /V\.lerp|minimumDistance/);
});

test('every node can enter or peek while same-layer expansion still requires seeded content', () => {
  assert.doesNotMatch(functionSource('enterNode'), /hasChildren\s*!==\s*true/);
  assert.doesNotMatch(functionSource('peekNode'), /hasChildren\s*!==\s*true/);
  assert.doesNotMatch(functionSource('prefetchChildDomain'), /hasChildren\s*!==\s*true/);
  assert.match(functionSource('prefetchChildDomain'), /createChildDomainNodes\s*\(/);
  assert.match(functionSource('revealNode'), /hasChildren\s*!==\s*true/);
  assert.match(functionSource('createSatellites'), /hasChildren\s*!==\s*true/);
});

test('secondary click arbitration leaves a reliable desktop double-click window', () => {
  const start = source.indexOf('const secondaryClickArbiter');
  const end = source.indexOf('function canvasPoint', start);
  const configuration = source.slice(start, end);

  assert.match(configuration, /delay:\s*620/);
});

test('parent-domain return finds nested entry nodes recursively', () => {
  assert.match(source, /function\s+findExistingNode\s*\(\s*nodes\s*,\s*id\s*\)/);
  assert.match(functionSource('returnToDepth'), /findExistingNode\s*\(\s*state\.nodes\s*,\s*previous\.nodeId\s*\)/);
  assert.doesNotMatch(functionSource('returnToDepth'), /state\.nodes\.find\s*\(/);
});

test('domain travel never injects a fixed yaw rotation', () => {
  assert.doesNotMatch(source, /camera\.yaw\s*\+=\s*0\.36/);
});

test('immersive child entry frames the new direct children once while preserving later camera ownership', () => {
  const enter = functionSource('enterNode');

  assert.match(enter, /state\.domainStack\.push\s*\(\s*\.\.\.route\.entries\s*\)/);
  assert.match(enter, /state\.currentPath\s*=\s*nextPath/);
  assert.match(enter, /viewModeModel\.immersiveDomainFrame/);
  assert.match(enter, /startCameraTween\s*\(/);
  assert.doesNotMatch(enter, /camera\.(?:target|yaw|pitch|distance)\s*=/);
});

test('direct satellite entry derives true semantic depth from its ancestor lineage', () => {
  const route = functionSource('buildDirectDomainRoute');
  const enter = functionSource('enterNode');

  assert.match(route, /visualModel\.nodeLineage\s*\(\s*node\s*\)/);
  assert.match(route, /lineage\.length/);
  assert.match(enter, /buildDirectDomainRoute\s*\(\s*node\s*,\s*parentCamera\s*\)/);
  assert.match(enter, /state\.domainStack\.push\s*\(\s*\.\.\.route\.entries\s*\)/);
  assert.match(enter, /state\.depth\s*=\s*route\.depth/);
  assert.doesNotMatch(enter, /state\.depth\s*\+=\s*1/);
});

test('parent return restores the domain and entry node without moving the camera', () => {
  const exit = functionSource('returnToDepth');

  assert.match(exit, /state\.currentPath\s*=\s*previous\.path/);
  assert.match(exit, /findExistingNode\s*\(\s*state\.nodes\s*,\s*previous\.nodeId\s*\)/);
  assert.match(exit, /entryNode\.peekOpen\s*=\s*false/);
  assert.doesNotMatch(exit, /camera\.(?:target|yaw|pitch|distance)\s*=/);
  assert.doesNotMatch(exit, /startCameraTween\s*\(/);
});

test('transition lock blocks dolly while allowing only ready-field edit intents', () => {
  const dispatch = functionSource('dispatchIntent');
  const lockGate = /if\s*\(\s*transitionBlocksIntent\s*\(\s*intent\s*\)\s*\)\s*\{\s*return\s+false\s*;?\s*\}/;
  const transitionGate = functionSource('transitionBlocksIntent');

  assert.match(dispatch, lockGate);
  ordered(dispatch, lockGate, /broadcastIntent\s*\(/, 'locked intents stop before broadcasting');
  ordered(dispatch, lockGate, /case\s+["']dolly["'][\s\S]*?state\.cameraTween\s*=\s*null/, 'locked dolly stops before clearing the camera tween');
  assert.match(transitionGate, /state\.transitionLocked/);
  assert.match(transitionGate, /state\.transitionFieldReady/);
  assert.match(transitionGate, /["']editEdge["']/);
  assert.doesNotMatch(transitionGate, /["']dolly["']/);

  const start = source.indexOf('canvas.addEventListener("wheel"');
  const end = source.indexOf('canvas.addEventListener("contextmenu"', start);
  assert.notEqual(start, -1, 'wheel handler exists');
  const wheel = source.slice(start, end);
  assert.match(wheel, /event\.preventDefault\s*\(\s*\)/);
  ordered(
    wheel,
    /event\.preventDefault\s*\(\s*\)/,
    /if\s*\(\s*state\.transitionLocked\s*\)\s*\{\s*return\s*;?\s*\}/,
    'wheel prevents browser scrolling before its locked early return'
  );
  ordered(
    wheel,
    /if\s*\(\s*state\.transitionLocked\s*\)\s*\{\s*return\s*;?\s*\}/,
    /dispatchIntent\s*\(/,
    'locked wheel exits before dispatching dolly'
  );
});

test('multi-depth exit restores the requested target entry without camera travel', () => {
  const exit = functionSource('returnToDepth');
  const targetMatch = exit.match(/const\s+(\w+)\s*=\s*state\.domainStack\[\s*targetDepth\s*\]/);
  assert.ok(targetMatch, 'requested target entry is resolved');
  assert.match(exit, new RegExp(`state\\.currentPath\\s*=\\s*${targetMatch[1]}\\.path`));
  assert.match(exit, new RegExp(`findExistingNode\\s*\\(\\s*state\\.nodes\\s*,\\s*${targetMatch[1]}\\.nodeId`));
  assert.doesNotMatch(exit, /startCameraTween\s*\(|camera\.(?:target|yaw|pitch|distance)\s*=/);
});

test('wheel remains the only normal browsing path that writes camera distance', () => {
  const start = source.indexOf('canvas.addEventListener("wheel"');
  const end = source.indexOf('canvas.addEventListener("contextmenu"', start);
  const wheel = source.slice(start, end);
  assert.match(wheel, /dispatchIntent\s*\(\s*intent\s*,\s*\{\s*delta/);
  assert.match(functionSource('dispatchIntent'), /case\s+["']dolly["'][\s\S]*camera\.distance\s*=/);
});
