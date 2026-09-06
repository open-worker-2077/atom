const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');
const projectorSource = fs.readFileSync(path.join(root, 'spatial-cluster-field.js'), 'utf8');
const sceneAdapterSource = fs.readFileSync(path.join(root, 'src', 'atom-system', 'adapters', 'browser-scene-adapter.mjs'), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = engine.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = engine.indexOf('{', start + marker.length);
  let depth = 0;
  for (let index = bodyStart; index < engine.length; index += 1) {
    if (engine[index] === '{') depth += 1;
    if (engine[index] === '}' && --depth === 0) return engine.slice(start, index + 1);
  }
  assert.fail(`${name} body is bounded`);
}

test('cluster projector loads before the engine and remains a visual dependency', () => {
  const projector = html.indexOf('spatial-cluster-field.js');
  const engineIndex = html.indexOf('spatial-engine.js');
  assert.ok(projector > -1 && projector < engineIndex);
  assert.match(engine, /const clusterField = global\.SpatialClusterField/);
  assert.match(engine, /clusterField\.buildScene\(/);
});

test('cluster state is toggled by a visual intent and exposed for verification', () => {
  assert.match(engine, /case ["']toggleClusterField["']/);
  assert.match(engine, /function toggleClusterField\(/);
  assert.match(engine, /clusterFieldOpen: state\.clusterFieldOpen/);
  assert.match(engine, /clusterCount:/);
  assert.match(engine, /activeClusterPath: state\.currentPath/);
  assert.match(engine, /clusterPaths:/);
});

test('multi-domain rendering draws soft shells and visual corridors before owned nodes', () => {
  assert.match(engine, /function drawClusterField\(/);
  assert.match(engine, /createRadialGradient/);
  assert.match(engine, /rgb\(112 192 255/);
  assert.match(projectorSource, /domain-corridor/);
  assert.match(engine, /ownerPath: cluster\.path/);
  const shellDraw = engine.indexOf('drawClusterField(state.clusterScene, basis)');
  const sphereDraw = engine.indexOf('drawSphere(item)', shellDraw);
  assert.ok(shellDraw > -1 && sphereDraw > shellDraw);
});

test('A inward view toggles nested child branches without changing the active domain', () => {
  assert.match(engine, /expandedClusterDomains:\s*new Map\(\)/);
  assert.match(engine, /function visibleClusterDomains\(/);
  assert.match(engine, /function toggleClusterChildDomain\(node, ownerPath/);
  assert.match(engine, /parentPath:\s*ownerPath/);
  assert.match(engine, /parentNodeId:\s*node\.id/);

  const clusterBranch = functionSource('applyInwardView');
  assert.match(clusterBranch, /toggleClusterChildDomain\(node, ownerPath, ["']nested["']\)/);
  assert.doesNotMatch(clusterBranch, /state\.currentPath\s*=/);
  assert.doesNotMatch(clusterBranch, /state\.domainStack\.push/);
});

test('selecting a future ASDF mode cannot restyle an already rendered cluster scene', () => {
  const visible = functionSource('visibleClusterDomains');
  const build = functionSource('buildClusterScene');
  const tunnel = functionSource('drawClusterTunnelInterior');
  const field = functionSource('drawClusterField');
  const layout = functionSource('resolveClusterScreenLayout');

  assert.doesNotMatch(visible, /state\.viewMode/);
  assert.match(visible, /descriptor\.projectionMode/);
  assert.doesNotMatch(build, /state\.viewMode/);
  assert.match(build, /routeDomains[\s\S]*projectionMode/);
  assert.doesNotMatch(tunnel, /state\.viewMode/);
  assert.match(tunnel, /cluster\.projectionMode/);
  assert.doesNotMatch(field, /state\.viewMode/);
  assert.match(field, /cluster\.projectionMode/);
  assert.doesNotMatch(layout, /state\.viewMode/);
  assert.match(layout, /clusterScene\.clusters[\s\S]*projectionMode/);
});

test('PageDown applies nested A projection to the current field before expanding its next layer', () => {
  const visible = functionSource('visibleClusterDomains');
  const expand = functionSource('expandHoveredClusterLevel');
  const setMode = functionSource('setViewMode');

  assert.match(engine, /appliedViewMode:\s*["']nested["']/);
  assert.match(visible, /projectionMode:\s*state\.appliedViewMode/);
  assert.match(expand, /state\.appliedViewMode\s*=\s*["']nested["']/);
  assert.doesNotMatch(setMode, /appliedViewMode/);
  assert.match(expand, /recenterLatestInteraction/);
  assert.match(functionSource('collapseHoveredClusterLevel'), /recenterLatestInteraction/);
});

test('double Shift owns a persistent peer selection instead of arming the next right click', () => {
  const tap = functionSource('handleShiftTap');
  const apply = functionSource('applyInwardView');
  assert.match(engine, /batchSelectionKeys:\s*new Set\(\)/);
  assert.match(tap, /establishPeerSelection/);
  assert.doesNotMatch(tap, /armPeerViewBatch/);
  assert.match(apply, /applyBatchViewMode\(targetKeys\)/);
});

test('immersive blank right click remains blank-sensitive and exits to the parent domain', () => {
  const start = engine.indexOf('canvas.addEventListener("pointerdown"');
  const end = engine.indexOf('canvas.addEventListener("pointermove"', start);
  const pointer = engine.slice(start, end);
  assert.match(pointer, /pointerInput\.button\s*===\s*2[\s\S]{0,220}blankSensitive/);
  assert.match(functionSource('applyParentView'), /exitDomain/);
});

test('A navigation dispatch has one inward path plus immersive scope and parent return', () => {
  assert.match(engine, /case ["']applyInwardView["']/);
  assert.match(engine, /case ["']applyImmersiveInwardView["']/);
  assert.match(engine, /case ["']applyParentView["']/);
  assert.match(functionSource('applyImmersiveInwardView'), /enterNode\(node, true\)/);
  assert.doesNotMatch(engine, /case ["']setPeripheralView["']|case ["']setHierarchyView["']|case ["']setImmersiveView["']/);
});

test('immersive navigation history is not rendered as hierarchy when a local view is appended', () => {
  const visible = functionSource('visibleClusterDomains');

  assert.match(visible, /const descriptors = new Map\([\s\S]*state\.expandedClusterDomains/);
  assert.match(visible, /path\.startsWith\(`\$\{state\.currentPath\}\/`\)/);
  assert.doesNotMatch(visible, /state\.domainStack\.map/);
  assert.match(visible, /path:\s*state\.currentPath/);
  assert.match(visible, /parentPath:\s*null/);
});

test('cluster shell targeting routes Ctrl edits to the domain under the pointer', () => {
  assert.match(engine, /clusterHitRegions:\s*\[\]/);
  assert.match(engine, /function findClusterDomainContext\(/);
  assert.match(engine, /const domainContext = findClusterDomainContext/);
  assert.match(engine, /candidate\.domainContext/);
  assert.match(engine, /function clusterLocalPosition\(point, domainContext/);
  assert.match(engine, /beginNodeCreateAt\([^)]*domainContext/);
  assert.match(engine, /beginNodeLandingAt\([^)]*domainContext/);
  assert.match(engine, /node\.__clusterOwnerPath \|\| node\.workspacePath \|\| state\.currentPath/);
  assert.match(engine, /hit && hit\.item && hit\.item\.node/);
  assert.match(engine, /state\.clusterScene\.clusters\.length[^`]*域 · \$\{viewLabel\}视角/);
});

test('middle framing uses the actual compressed group radius instead of a fixed floor', () => {
  const middleFrame = functionSource('quickFrameMiddleTarget');

  assert.match(middleFrame, /domainContext\.worldRadius/);
  assert.doesNotMatch(middleFrame, /Math\.max\(0\.25/);
  assert.match(middleFrame, /focusMinimumDistance/);
});

test('blank field gestures operate on the cluster under the pointer instead of the active domain', () => {
  const commit = functionSource('commitPointerCandidate');
  assert.match(engine, /function domainNodesForPath\(path\)/);
  assert.match(engine, /function topLevelDomainNodesForPath\(path\)/);
  assert.match(engine, /case "toggleFieldChildren":[\s\S]{0,420}visualMeta\.domainContext/);
  assert.match(engine, /case "toggleFieldChildren":[\s\S]{0,520}topLevelDomainNodesForPath/);
  assert.match(engine, /case "toggleFieldSurfaces":[\s\S]{0,520}visualMeta\.domainContext/);
  assert.match(engine, /case "toggleFieldSurfaces":[\s\S]{0,620}domainNodesForPath/);
  assert.match(engine, /function contextualizeAction\(action, candidate/);
  assert.match(engine, /function candidateArbiterKey\(candidate\)/);
  assert.match(engine, /field:\$\{candidate\.domainContext\.path\}/);
  assert.match(commit, /candidate\.button === 2[\s\S]*contextualizeAction\(action, candidate\)[\s\S]*dispatchIntent\(contextualAction\.intent/);
});

test('secondary cluster tools derive paths from their visible node owner', () => {
  assert.match(engine, /function nodeOwnerPath\(node/);
  assert.match(engine, /function prefetchChildDomain\(node, ownerPath/);
  assert.match(engine, /childPathFor\(node, ownerPath\)/);
  assert.match(engine, /function mermaidTarget\([\s\S]{0,520}nodeOwnerPath\(state\.selected/);
});

test('branch and mode changes cannot strand an active editor or hidden selection', () => {
  assert.match(engine, /function transactionBlocksViewChange\(/);
  assert.match(engine, /const transactionGuardedIntents = new Set/);
  assert.match(engine, /transactionGuardedIntents\.has\(intent\)/);
  assert.match(engine, /function toggleClusterChildDomain[\s\S]{0,1200}transactionBlocksViewChange\(\)/);
  assert.match(engine, /pathSlots\(targetPath, selectedPath\)/);
  assert.match(engine, /state\.selected = null/);
  assert.match(engine, /function nodeByIdInPath\(path, id\)/);
  assert.match(engine, /operation\.target\.path[\s\S]{0,240}nodeByIdInPath/);
  assert.match(engine, /cancelWorkspaceEdit[\s\S]{0,900}nodeByIdInPath/);
});

test('cluster announcements report the rendered cluster and target domain', () => {
  assert.match(engine, /多球团视野已开启，当前显示 \$\{state\.clusterScene\.clusters\.length\} 个域/);
  assert.match(engine, /function toggleFieldChildren\(result, path/);
  assert.match(engine, /pathLabelsForPath\(path\)\.at\(-1\)/);
  assert.doesNotMatch(engine, /多球团视野已开启，当前显示 \$\{state\.depth \+ 1\}/);
});

test('nested satellite labels and edit states retain their cluster-local semantics', () => {
  assert.match(engine, /const projected = projectDomainNodes\(descriptor\.path, baseNodes\);/);
  assert.doesNotMatch(engine, /const projected = existingNodes\(projectDomainNodes\(descriptor\.path, baseNodes\)\);/);
  assert.match(engine, /node\.__clusterLevel = level/);
  assert.match(engine, /level:\s*Number\(node\.__clusterLevel\) \|\| 0/);
  const scopedVisualStates = engine.match(/workspace\.nodeVisualState\(item\.ownerPath \|\| nodeOwnerPath\(node\), node\.id\)/g) || [];
  assert.equal(scopedVisualStates.length, 2);
});

test('nested shells expose invisible mother-node proxies for relations, left-click hits and view toggles', () => {
  const collection = functionSource('collectClusterNodes');
  const sphere = functionSource('drawSphere');
  const labels = functionSource('placeReadableLabels');

  assert.match(collection, /clusterShellProxy:\s*true/);
  assert.match(collection, /clusterNode\.__clusterRadius/);
  assert.match(collection, /minimumClusterNodeRadius\s*=\s*0\.001\s*\/\s*compressionMultiplier/);
  assert.match(collection, /Number\(scene\.compressionMultiplier\)/);
  assert.match(collection, /parentCarrierNode/);
  assert.match(collection, /ownerPath:\s*cluster\.parentPath/);
  assert.match(sphere, /if\s*\(item\.clusterShellProxy\)\s*return/);
  assert.match(labels, /!item\.clusterShellProxy/);
  assert.match(engine, /state\.hitRegions = rendered[\s\S]{0,180}\.filter\(\(item\) => !item\.clusterShellProxy \|\| Boolean\(item\.node\)\)/);
  assert.match(functionSource('drawClusterField'), /drawConfirmationRipples\s*\(\s*screen\s*,\s*cluster\.parentCarrierNode\s*\)/);
});

test('nested domains project direct children only instead of mixing revealed deeper nodes', () => {
  const start = engine.indexOf('function visibleClusterDomains()');
  const end = engine.indexOf('function buildClusterScene()', start);
  const visible = engine.slice(start, end);

  assert.match(visible, /const directOnly = descriptor\.projectionMode === ["']nested["']/);
  assert.match(visible, /if\s*\(!directOnly && node\.revealed/);
});

test('each cluster domain applies relationship repulsion before its shell is measured', () => {
  const start = engine.indexOf('function visibleClusterDomains()');
  const end = engine.indexOf('function buildClusterScene()', start);
  const visible = engine.slice(start, end);

  assert.match(visible, /workspace\.relationshipPairsForPath\(descriptor\.path\)/);
  assert.match(visible, /visualModel\.relaxRelationshipLayout\s*\(/);
  assert.match(visible, /planarRepulsion:\s*true/);
});

test('steady cluster frames reuse the committed layout and visible edge projection', () => {
  const collect = functionSource('collectClusterNodes');
  const connections = functionSource('drawClusterConnections');
  const build = functionSource('buildClusterScene');

  assert.doesNotMatch(collect, /buildClusterScene\s*\(/);
  assert.match(collect, /state\.clusterScene/);
  assert.doesNotMatch(connections, /visibleClusterDomains\s*\(/);
  assert.doesNotMatch(connections, /workspace\.exportKnowledge\s*\(/);
  assert.match(connections, /state\.clusterConnectionEdges/);
  assert.match(build, /state\.clusterConnectionEdges\s*=/);
});

test('cluster-local lenses and command rings anchor to the transformed rendered node', () => {
  assert.match(engine, /const detailItems = items[\s\S]{0,260}item\.node\.lensOpen/);
  assert.match(engine, /detailItems\.forEach\(\(sourceItem, index\)/);
  assert.match(engine, /const sourcePosition = sourceItem\.position/);
  assert.match(engine, /const sourceRadius = sourceItem\.radius/);
  assert.match(engine, /ownerPath: sourceItem\.ownerPath/);
  assert.match(engine, /const menuSource = state\.menuFor[\s\S]{0,220}items\.find\([\s\S]{0,220}sameNode\(item\.node, state\.menuFor\)/);
  assert.match(engine, /const centre = menuSource\.position/);
  assert.match(engine, /const menuRadius = menuSource\.radius/);
  assert.doesNotMatch(engine, /const centre = resolveNodePosition\(menuNode, time\)/);
});

test('view history restores the expanded multi-cluster branch topology', () => {
  assert.match(engine, /function clusterBranchSnapshot\(\)/);
  assert.match(engine, /expandedClusters:\s*clusterBranchSnapshot\(\)/);
  assert.match(engine, /function restoreClusterBranches\(entries\)/);
  assert.match(engine, /restoreClusterBranches\(snapshot\.expandedClusters \|\| \[\]\)/);
  assert.match(engine, /restoreClusterBranches\(snapshot\.expandedClusters \|\| \[\]\);[\s\S]{0,180}if \(state\.clusterFieldOpen\) buildClusterScene\(\);[\s\S]{0,80}updateSelectionUI\(\);[\s\S]{0,80}updateMetrics\(\)/);
  assert.match(engine, /commitViewIntent\(state, \{ type: "clear-views" \}\)/);
  assert.match(engine, /parentNodeId:\s*descriptor\.parentNodeId/);
  assert.match(engine, /const visibleNodeCount = state\.clusterFieldOpen[\s\S]{0,240}state\.clusterScene\.clusters\.reduce/);
});

test('secondary double-click on cluster blank exits the cluster under the pointer', () => {
  assert.match(engine, /function collapseClusterDomain\(path\)/);
  assert.match(engine, /function exitDomain\(domainContext = null\)/);
  assert.match(engine, /state\.clusterFieldOpen[\s\S]{0,220}domainContext\.path !== state\.currentPath[\s\S]{0,180}collapseClusterDomain\(domainContext\.path\)/);
  assert.match(engine, /case "exit":[\s\S]{0,120}exitDomain\(visualMeta\.domainContext \|\| null\)/);
  assert.match(sceneAdapterSource, /path === intent\.targetId \|\| path\.startsWith\(`\$\{intent\.targetId\}\/`\)/);
});

test('cluster blank edit and exit gestures use the visible sphere instead of its enlarged hit target', () => {
  assert.match(engine, /function findHit\(clientX, clientY, options\)/);
  assert.match(engine, /const hitOptions = options \|\| \{\}/);
  assert.match(engine, /const domainContext = findClusterDomainContext\(x, y\)/);
  assert.match(engine, /const blankSensitive = Boolean\(hitOptions\.blankSensitive && domainContext\)/);
  assert.match(engine, /blankSensitive && region\.item\.kind === ["']node["']/);
  assert.match(engine, /region\.item\.screen\.radius \+ 3/);
  assert.match(engine, /nodeOwnerPath\(region\.item\.node\) === domainContext\.path/);
  assert.match(engine, /const blankSensitive = pointerInput\.button === 2[\s\S]{0,180}state\.clusterFieldOpen[\s\S]{0,180}pointerInput\.ctrlKey/);
  assert.match(engine, /findHit\(event\.clientX, event\.clientY, \{ blankSensitive, semanticEdit \}\)/);
});

test('cluster branch toggles preserve the user camera instead of forcing a closer fit', () => {
  const toggle = functionSource('toggleClusterChildDomain');
  const collapse = functionSource('collapseClusterDomain');
  const modeToggle = functionSource('toggleClusterField');

  assert.match(toggle, /buildClusterScene\(\)/);
  assert.match(collapse, /buildClusterScene\(\)/);
  assert.doesNotMatch(toggle, /fitClusterFieldCamera|startCameraTween|camera\.distance\s*=/);
  assert.doesNotMatch(collapse, /fitClusterFieldCamera|startCameraTween|camera\.distance\s*=/);
  assert.match(modeToggle, /buildClusterScene\(\)/);
  assert.doesNotMatch(modeToggle, /fitClusterFieldCamera|startCameraTween|camera\.distance\s*=/);
});

test('cluster navigation and selection clearing never rewrite the user zoom', () => {
  const clear = functionSource('clearFocus');
  const returnDepth = functionSource('returnClusterToDepth');
  const overview = functionSource('returnOverview');
  const locate = functionSource('locateKnowledgeNode');

  assert.match(clear, /if \(state\.clusterFieldOpen\) \{\s*buildClusterScene\(\);/);
  assert.doesNotMatch(returnDepth, /fitClusterFieldCamera|startCameraTween|camera\.distance\s*=/);
  assert.match(overview, /commitViewIntent\(state, \{ type: "clear-views" \}\)/);
  assert.match(locate, /if \(state\.clusterFieldOpen\) buildClusterScene\(\);/);
});

test('rendered cluster verification exposes real screen-space node and sibling overlap counts', () => {
  const metrics = functionSource('updateMetrics');
  assert.match(metrics, /renderedNodeOverlapCount/);
  assert.match(metrics, /siblingClusterOverlapCount/);
  assert.match(metrics, /canvas\.dataset\.clusterNodeOverlapCount/);
  assert.match(metrics, /canvas\.dataset\.clusterSiblingOverlapCount/);
  assert.match(metrics, /canvas\.dataset\.clusterShellOverlapCount/);
  assert.match(metrics, /canvas\.dataset\.clusterCompressionMultiplier/);
  assert.match(metrics, /canvas\.dataset\.clusterSceneRadius/);
  assert.match(metrics, /canvas\.dataset\.middleDetailFocusKind/);
  assert.match(metrics, /canvas\.dataset\.middleDetailFocusPath/);
  assert.match(metrics, /canvas\.dataset\.middleDetailDepth/);
  assert.match(metrics, /item\.screen/);
  const screenLayout = functionSource('resolveClusterScreenLayout');
  const exactRadius = functionSource('exactProjectedRadius');
  assert.match(screenLayout, /projectionModes\.has\(["']peripheral["']\)/);
  assert.match(screenLayout, /!projectionModes\.has\(["']nested["']\)/);
  assert.match(screenLayout, /0\.65 \/ compressionMultiplier/);
  assert.match(screenLayout, /left\.screen\.radius \+ right\.screen\.radius \+ safetyGap/);
  assert.match(screenLayout, /clusterScreens\.get\(item\.ownerPath\)/);
  assert.match(screenLayout, /state\.clusterScreenOffsets\.set\(entry\.cluster\.path/);
  assert.match(screenLayout, /state\.clusterScreenOffsets\.get\(item\.ownerPath\)/);
  assert.match(screenLayout, /screen\.radius\s*=\s*exactProjectedRadius\(cluster\.radius,\s*screen\.depth\)/);
  assert.match(exactRadius, /0\.18\s*\/\s*compressionMultiplier/);
  assert.match(metrics, /screenPenetration\s*>\s*0\.01/);
  assert.match(engine, /resolveClusterScreenLayout\(rendered, basis\)/);
  assert.match(engine, /screen\.radius = exactProjectedRadius\(item\.radius, screen\.depth\)/);
});

test('mapping keeps a 100 percent display while sending a tenfold S interval to geometry', () => {
  const build = functionSource('buildClusterScene');
  assert.match(build, /nestedCompactnessPercent\s*\*\s*10/);
});

test('S interval and A child shrink controls rebuild the currently visible cluster scene', () => {
  const refresh = functionSource('refreshClusterSceneAfterLayoutSetting');
  assert.match(refresh, /state\.clusterFieldOpen/);
  assert.match(refresh, /buildClusterScene\(\)/);
  assert.match(refresh, /updateSelectionUI\(\)/);

  const compactStart = engine.indexOf('ui.nestedCompactness.addEventListener');
  const shrinkStart = engine.indexOf('ui.peripheralDepthShrink.addEventListener');
  const nextStart = engine.indexOf('ui.nestedTunnelStrength.addEventListener');
  assert.ok(compactStart > -1 && shrinkStart > compactStart && nextStart > shrinkStart);
  assert.match(engine.slice(compactStart, shrinkStart), /refreshClusterSceneAfterLayoutSetting\(\)/);
  assert.match(engine.slice(shrinkStart, nextStart), /refreshClusterSceneAfterLayoutSetting\(\)/);
});

test('Home closes every expanded branch and returns to the top-level Boss field', () => {
  const overview = functionSource('returnOverview');

  assert.match(overview, /commitViewIntent\(state, \{ type: "clear-views" \}\)/);
  assert.match(overview, /state\.clusterFieldOpen\s*=\s*false/);
  assert.match(overview, /state\.currentPath\s*=\s*["']root["']/);
  assert.match(overview, /state\.nodes\s*=\s*createDomain\(\s*["']root["']/);
});
