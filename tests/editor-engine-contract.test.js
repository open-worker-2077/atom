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

test('engine requires the workspace model and keeps one memory-only workspace', () => {
  assert.match(source, /const\s+workspaceModel\s*=\s*global\.SpatialWorkspaceModel/);
  assert.match(source, /!workspaceModel/);
  assert.match(source, /const\s+workspace\s*=\s*workspaceModel\.createWorkspace\s*\(\s*\)/);
});

test('visited-space search builds path-aware entries and renders highlighted segments', () => {
  const build = functionSource('buildSearchEntries');
  const render = functionSource('renderSearchResults');
  const jump = functionSource('jumpToSearchResult');

  assert.match(build, /domainCache\.entries\s*\(\s*\)/);
  assert.match(build, /pathLabels/);
  assert.match(render, /workspaceModel\.searchEntries\s*\(/);
  assert.match(render, /labelSegments/);
  assert.match(render, /pathSegments/);
  assert.match(jump, /result\.path\s*===\s*state\.currentPath/);
  assert.match(jump, /locateNodeWithoutZoom\s*\(/);
});

test('node editor starts from ctrl pointer position and updates name detail and attachment draft', () => {
  const create = functionSource('beginNodeCreateAt');
  const position = functionSource('clusterLocalPosition');
  const edit = functionSource('beginNodeEdit');
  const sync = functionSource('syncEditorOverlays');

  assert.match(create, /clusterLocalPosition\s*\(/);
  assert.match(position, /unprojectScreen\s*\(/);
  assert.match(create, /workspace\.beginNodeCreate\s*\(/);
  assert.match(create, /openNodeEditor\s*\(/);
  assert.match(edit, /workspace\.beginNodeEdit\s*\(/);
  assert.match(edit, /nodeByIdInPath\s*\(/);
  assert.match(edit, /state\.nodeEditorAnchor\s*=\s*\{[\s\S]*node,[\s\S]*path,[\s\S]*screen:/);
  assert.match(sync, /workspace\.updateNodeDraft\s*\(/);
  assert.match(sync, /dataset\.side\s*=\s*["']inside["']/);
  assert.match(sync, /--lens-x/);
  assert.match(sync, /--lens-y/);
  assert.match(sync, /clamp\(lensSize\s*\*\s*0\.16,\s*32,\s*92\)/);
  assert.match(sync, /item\.node\s*===\s*anchor\.node/);
  assert.match(sync, /nodeOwnerPath\s*\(\s*item\.node\s*\)\s*===\s*anchor\.path/);
  assert.match(source, /attachmentInput\.addEventListener\s*\(\s*["']change["']/);
});

test('node editing never moves the camera because data operations do not own the view', () => {
  const beginCreate = functionSource('beginNodeCreateAt');
  const beginEdit = functionSource('beginNodeEdit');
  const commit = functionSource('commitWorkspaceEdit');
  const cancel = functionSource('cancelWorkspaceEdit');

  for (const operation of [beginCreate, beginEdit, commit, cancel]) {
    assert.doesNotMatch(operation, /beginNodeEditCamera|scheduleCommittedNodeFrame|restoreNodeEditCamera/);
    assert.doesNotMatch(operation, /camera\.(?:target|distance|yaw|pitch)\s*=/);
    assert.doesNotMatch(operation, /startCameraTween\s*\(/);
  }
});

test('edit confirmation keys are consumed before editor and browsing shortcuts can both run', () => {
  const keyboard = functionSource('handleEditTransactionKey');
  assert.match(keyboard, /workspace\.transaction\s*\(\s*\)/);
  assert.match(keyboard, /event\.key\s*===\s*["']Enter["']/);
  assert.match(keyboard, /event\.key\s*===\s*["']Escape["']/);
  assert.match(keyboard, /event\.stopImmediatePropagation\s*\(\s*\)/);
  assert.match(keyboard, /dispatchIntent\s*\(\s*intent\s*\)/);
  assert.match(source, /addEventListener\s*\(\s*["']keydown["']\s*,\s*handleEditTransactionKey\s*,\s*\{\s*capture:\s*true\s*\}/);
});

test('Shift Enter inserts a detail line break while bare Enter remains transaction confirmation', () => {
  const insert = functionSource('insertTextareaLineBreak');
  const keyboard = functionSource('handleShiftEnterLineBreak');
  const predicate = functionSource('isShiftEnterEvent');

  assert.match(insert, /setRangeText\s*\(\s*["']\\n["']/);
  assert.match(insert, /dispatchEvent\s*\(\s*new Event\s*\(\s*["']input["']/);
  assert.match(predicate, /state\.wand\.shiftHeld/);
  assert.match(keyboard, /isShiftEnterEvent\s*\(\s*event\s*\)/);
  assert.match(keyboard, /markdownEditor\.insertLineBreak\s*\(\s*\)[\s\S]*markdownEditor\.focus\s*\(\s*\)/);
  assert.match(keyboard, /insertTextareaLineBreak\s*\(\s*ui\.nodeDetailEditor\s*\)/);
  assert.match(source, /addEventListener\s*\(\s*["']keydown["']\s*,\s*handleShiftEnterLineBreak\s*,\s*\{\s*capture:\s*true\s*\}/);
});

test('cluster creation preserves click-local placement and pending relations render dashed before Enter', () => {
  const create = functionSource('beginNodeCreateAt');
  const sync = functionSource('syncEditorOverlays');
  const render = functionSource('renderScene');
  const topology = functionSource('drawTopologyLink');
  const connections = functionSource('drawConnections');
  const clusterConnections = functionSource('drawClusterConnections');

  assert.match(create, /clusterLocalPositionLocked\s*=\s*true/);
  assert.match(create, /state\.nodeEditorFallback\s*=\s*\{[\s\S]*x:\s*point\.x[\s\S]*y:\s*point\.y/);
  assert.doesNotMatch(sync, /if\s*\(\s*!rendered\s*\)\s*\{[\s\S]*nodeNameEditorWrap\.hidden\s*=\s*true/);
  assert.match(sync, /rendered\s*\?\s*rendered\.screen\s*:\s*anchor\.screen\s*\|\|\s*state\.nodeEditorFallback/);
  assert.match(render, /editState\s*!==\s*["']idle["'][\s\S]*Math\.max\s*\(\s*renderedItem\.screen\.radius\s*,\s*36\s*\)/);
  assert.match(topology, /relationship\.pending\s*===\s*true/);
  assert.match(topology, /context\.setLineDash\s*\(\s*pending\s*\?\s*\[[^\]]+\]/);
  assert.match(connections, /drawWorkspaceEdge\s*\(\s*pendingEdge\s*,\s*true\s*\)/);
  assert.match(connections, /pending:\s*pending/);
  assert.match(clusterConnections, /transaction\.kind\s*===\s*["']edge-create["'][\s\S]*pending:\s*true/);
});

test('cluster node creation stops pending auto-fit before opening the editor', () => {
  const create = functionSource('beginNodeCreateAt');
  const pointerStart = source.indexOf('canvas.addEventListener("pointerdown"');
  const pointerEnd = source.indexOf('canvas.addEventListener("pointermove"', pointerStart);
  const pointer = source.slice(pointerStart, pointerEnd);
  const keyboardStart = source.indexOf('document.addEventListener("keydown"');
  const keyboardEnd = source.indexOf('document.querySelectorAll("[data-intent]"', keyboardStart);
  const keyboard = source.slice(keyboardStart, keyboardEnd);
  const stopIndex = create.indexOf('state.cameraTween = null');
  const createIndex = create.indexOf('workspace.beginNodeCreate');

  assert.match(create, /if \(state\.clusterFieldOpen\)/);
  assert.notEqual(stopIndex, -1);
  assert.ok(stopIndex < createIndex);
  assert.match(pointer, /state\.clusterFieldOpen && intent === ["']createNode["']/);
  assert.match(pointer, /state\.cameraTween = null/);
  assert.match(keyboard, /state\.clusterFieldOpen && event\.key === ["']Control["']/);
  assert.match(keyboard, /state\.cameraTween = null/);
});

test('inline name editor replaces the canvas label instead of duplicating it', () => {
  const label = functionSource('drawLabel');
  assert.match(label, /workspace\.nodeVisualState\s*\(/);
  assert.match(label, /editState\s*!==\s*["']idle["']/);
  assert.match(label, /return/);
});

test('canvas labels and the selection readout expose Atom registration types without changing names', () => {
  const label = functionSource('drawLabel');
  const selection = functionSource('updateSelectionUI');
  const display = functionSource('atomDisplayName');

  assert.match(display, /atomTypes/);
  assert.match(display, /`@\$\{type\}`/);
  assert.match(label, /atomDisplayName\s*\(/);
  assert.match(selection, /atomDisplayName\s*\(/);
});

test('node editor exposes Atom key type as a structured draft field', () => {
  const open = functionSource('openNodeEditor');
  const sync = functionSource('syncEditorOverlays');

  assert.match(source, /nodeTypeEditor:\s*document\.getElementById\(["']nodeTypeEditor["']\)/);
  assert.match(open, /nodeTypeEditor\.value/);
  assert.match(sync, /atomTypes/);
  assert.match(sync, /nodeTypeEditor\.value/);
  assert.match(source, /nodeTypeEditor\.addEventListener\(["']input["'][\s\S]*atomTypesChanged:\s*true/);
});

test('key editor keeps the base name field fixed and edits only its registration suffix', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /class="node-key-editor"/);
  assert.match(html, /class="node-key-editor__base">节点名称<\/span>/);
  assert.match(html, /id="nodeTypeEditor"/);
  assert.match(html, /class="node-value-editor"[\s\S]*id="nodeNameEditor"/);
  assert.doesNotMatch(html, /<input[^>]+value="节点名称"/);
});

test('knowledge refresh rebinds an existing middle-click selection instead of clearing it', () => {
  const refresh = functionSource('importKnowledge');

  assert.match(refresh, /selectedPath/);
  assert.match(refresh, /selectedId/);
  assert.match(refresh, /nodeByIdInPath\s*\(\s*selectedPath\s*,\s*selectedId\s*\)/);
  assert.match(refresh, /middleLabelFocus/);
  assert.match(refresh, /middleDetailFocus/);
  assert.doesNotMatch(refresh, /state\.selected\s*=\s*null/);
});

test('edge editing retains qualified endpoints and makes relations hittable', () => {
  const gesture = functionSource('beginEdgeGesture');
  const connections = functionSource('drawConnections');
  const hit = functionSource('findHit');

  assert.match(gesture, /workspaceModel\.qualifiedEndpoint\s*\(/);
  assert.match(gesture, /workspace\.beginEdgeCreate\s*\(/);
  assert.match(gesture, /state\.selected\s*=\s*node[\s\S]*updateSelectionUI\s*\(\s*\)/);
  assert.match(gesture, /workspace\.setEdgeTarget\s*\(/);
  assert.match(connections, /state\.relationHitRegions/);
  assert.match(connections, /workspace\.edgesForPath\s*\(/);
  assert.match(hit, /relationHitRegions/);
  assert.match(hit, /kind:\s*["']relationship["']/);
});

test('cross-domain landing selects the target immediately and refreshes the readout', () => {
  const gesture = functionSource('beginEdgeGesture');
  const targetBranch = gesture.slice(gesture.indexOf('workspace.setEdgeTarget'));

  assert.match(targetBranch, /state\.selected\s*=\s*node/);
  assert.match(targetBranch, /updateSelectionUI\s*\(\s*\)/);
});

test('blank ctrl-secondary landing unprojects a 3d point and starts a node landing preview', () => {
  const landing = functionSource('beginNodeLandingAt');
  const position = functionSource('clusterLocalPosition');
  const gesture = functionSource('beginEdgeGesture');
  const pointerStart = source.indexOf('canvas.addEventListener("pointerdown"');
  const pointerEnd = source.indexOf('canvas.addEventListener("pointermove"', pointerStart);
  const pointer = source.slice(pointerStart, pointerEnd);

  assert.match(landing, /clusterLocalPosition\s*\(/);
  assert.match(position, /unprojectScreen\s*\(/);
  assert.match(landing, /workspace\.setNodeLanding\s*\(/);
  assert.match(landing, /state\.currentPath/);
  assert.match(gesture, /beginNodeLandingAt\s*\(/);
  assert.match(pointer, /edgeDraft/);
  assert.match(pointer, /workspace\.transaction\s*\(\s*\)/);
});

test('workspace edge rendering resolves historical endpoints before drawing long tails', () => {
  const connections = functionSource('drawConnections');
  const commit = functionSource('commitWorkspaceEdit');
  const cancel = functionSource('cancelWorkspaceEdit');

  assert.match(connections, /workspace\.resolveEndpoint\s*\(\s*edge\.from\s*\)/);
  assert.match(connections, /workspace\.resolveEndpoint\s*\(\s*edge\.to\s*\)/);
  assert.match(commit, /operation\.kind\s*===\s*["']node-land["']/);
  assert.match(cancel, /transaction\.kind\s*===\s*["']node-land["']/);
});

test('descendant cross-domain edges enter the visible portal before using a boundary tail', () => {
  const connections = functionSource('drawConnections');

  assert.match(connections, /visualModel\.descendantPortalId\s*\(/);
  assert.match(
    connections,
    /if\s*\(\s*!from\s*\)\s*from\s*=\s*descendantPortalItem\s*\(\s*resolvedFrom\s*\)\s*\|\|\s*boundaryItem/
  );
  assert.match(
    connections,
    /if\s*\(\s*!to\s*\)\s*to\s*=\s*descendantPortalItem\s*\(\s*resolvedTo\s*\)\s*\|\|\s*boundaryItem/
  );
});

test('new-domain edit gestures remain available while only the camera is settling', () => {
  const pointerStart = source.indexOf('canvas.addEventListener("pointerdown"');
  const pointerEnd = source.indexOf('canvas.addEventListener("pointermove"', pointerStart);
  const pointer = source.slice(pointerStart, pointerEnd);
  const dispatchStart = source.indexOf('function dispatchIntent(');
  const dispatchEnd = source.indexOf('function moveSelection(', dispatchStart);
  const dispatch = source.slice(dispatchStart, dispatchEnd);

  assert.match(pointer, /transitionBlocksPointerEdit\s*\(\s*event\s*\)/);
  assert.match(dispatch, /transitionBlocksIntent\s*\(\s*intent\s*\)/);
  assert.match(source, /state\.transitionFieldReady\s*=\s*true/);
});

test('engine exposes explicit knowledge and field projections without pointer simulation', () => {
  assert.match(source, /function exportFieldProjection\s*\(/);
  assert.match(source, /workspace\.exportKnowledge\s*\(/);
  assert.match(source, /workspace\.importKnowledge\s*\(/);
  assert.match(source, /"spatial-workspace-committed"/);
  assert.match(source, /exportKnowledge:\s*\(\)\s*=>/);
  assert.match(source, /importKnowledge/);
  assert.doesNotMatch(source, /spatialLab[\s\S]{0,600}dispatchEvent\s*\(\s*new\s+(?:Mouse|Pointer|Keyboard)Event/);
});

test('a node created at a pointer keeps that exact visual anchor after authoritative save', () => {
  const beginCreate = functionSource('beginNodeCreateAt');
  const prepareNode = functionSource('prepareWorkspaceNode');

  assert.match(beginCreate, /clusterLocalPositionLocked:\s*true/);
  assert.match(beginCreate, /node\.clusterLocalPositionLocked\s*=\s*true/);
  assert.match(prepareNode, /manualPosition:\s*node\.clusterLocalPositionLocked\s*\?\s*\{\s*\.\.\.node\.position\s*\}\s*:\s*null/);
});

test('Atom confirmation reselects changed identities without navigating or reframing the view', () => {
  const start = source.indexOf('global.addEventListener("spatial-workspace-persisted"');
  const end = source.indexOf('global.addEventListener("spatial-workspace-persist-failed"', start);
  const persisted = source.slice(start, end);

  assert.match(persisted, /\[["']node-create["'],\s*["']node-edit["']\]\.includes\(kind\)/);
  assert.match(persisted, /event\.detail\.persistedNode/);
  assert.match(persisted, /nodeByIdInPath/);
  assert.doesNotMatch(persisted, /locateKnowledgeNode|scheduleCommittedNodeFrame|startCameraTween/);
});

test('imported workspace-node preparation is guarded and derives surface visibility from detail mode', () => {
  const current = functionSource('currentDomainNodes');
  const prepare = functionSource('prepareWorkspaceNode');
  assert.match(current, /node\.__spatialPreparing/);
  assert.match(current, /try\s*\{/);
  assert.match(current, /finally\s*\{/);
  assert.match(prepare, /const detailMode\s*=\s*visualModel\.detailModeFor\(node\)/);
  assert.match(prepare, /surfaceVisible:\s*detailMode\s*===\s*["']surface["']/);
  assert.match(prepare, /detailMode,/);
  assert.doesNotMatch(prepare, /surfaceVisible:\s*true/);
});

test('mirror visibility changes emit a knowledge snapshot for persistence', () => {
  const dispatchStart = source.indexOf('function dispatchIntent(');
  const dispatchEnd = source.indexOf('function moveSelection(', dispatchStart);
  const dispatch = source.slice(dispatchStart, dispatchEnd);

  assert.match(dispatch, /case\s+["']toggleSurface["'][\s\S]*?persistWorkspaceSnapshot\s*\(/);
  assert.match(dispatch, /case\s+["']toggleFieldSurfaces["'][\s\S]*?persistWorkspaceSnapshot\s*\(/);
  assert.match(
    dispatch,
    /case\s+["']toggleFieldSurfaces["'][\s\S]*?existingNodes\s*\(\s*currentDomainNodes\s*\(\s*\)\s*\)/
  );
});

test('descendant cross-domain links mark only their portal endpoint as an insertion', () => {
  const connections = functionSource('drawConnections');
  const topology = functionSource('drawTopologyLink');

  assert.match(connections, /insertionVortex:\s*true/);
  assert.match(connections, /fromInsertion:\s*from\.insertionVortex\s*===\s*true/);
  assert.match(connections, /toInsertion:\s*to\.insertionVortex\s*===\s*true/);
  assert.match(topology, /relationship\.fromInsertion/);
  assert.match(topology, /relationship\.toInsertion/);
  assert.match(topology, /drawInsertionVortex\s*\(/);
});

test('committing a cross-domain edge retains its target in any visible cluster domain', () => {
  const commit = functionSource('commitWorkspaceEdit');

  assert.match(commit, /operation\.kind\s*===\s*["']edge-create["']/);
  assert.match(commit, /nodeByIdInPath\s*\(\s*operation\.target\.path\s*,\s*operation\.target\.nodeId\s*\)/);
});

test('committed same-domain workspace relations participate in automatic layout', () => {
  const collect = functionSource('collectNodes');

  assert.match(collect, /workspace\.relationshipPairsForPath\s*\(\s*state\.currentPath\s*\)/);
  assert.match(collect, /baseRelationships/);
  assert.match(collect, /workspaceRelationships/);
  assert.match(collect, /relaxRelationshipLayout[\s\S]*visibleRelationships/);
  assert.match(collect, /repulsionRangeScale:\s*2\.2/);
  assert.match(collect, /repulsionStrength:\s*0\.72/);
  assert.match(collect, /fieldRepulsionStrength:\s*0\.38/);
  assert.match(collect, /planarRepulsion:\s*true/);
  assert.match(collect, /anchorStrength:\s*0\.006/);
});

test('visible descendant cross-domain relations pull their portal carriers into the layout', () => {
  const collect = functionSource('collectNodes');

  assert.match(collect, /workspace\.edgesForPath\s*\(\s*state\.currentPath\s*\)/);
  assert.match(collect, /visualModel\.visiblePortalRelationship\s*\(/);
  assert.match(collect, /visiblePortalRelationships/);
  assert.match(collect, /visibleRelationships\s*=\s*\[\.\.\.baseRelationships,\s*\.\.\.workspaceRelationships,\s*\.\.\.visiblePortalRelationships\]/);
});

test('empty tunnels enter cached empty domains that still project workspace nodes', () => {
  const childDomain = functionSource('createChildDomainNodes');
  const prefetch = functionSource('prefetchChildDomain');
  const enter = functionSource('enterNode');

  assert.match(childDomain, /node\.hasChildren\s*===\s*true\s*\?\s*createDomain/);
  assert.match(childDomain, /domainCache\.set\s*\(\s*path\s*,\s*\[\s*\]\s*\)/);
  assert.match(prefetch, /createChildDomainNodes\s*\(\s*node\s*,\s*path/);
  assert.match(enter, /createChildDomainNodes\s*\(\s*node\s*,\s*state\.currentPath/);
  assert.doesNotMatch(enter, /node\.hasChildren\s*!==\s*true/);
});

test('workspace carriers open data-only domains without generated placeholder nodes', () => {
  const childDomain = functionSource('createChildDomainNodes');

  assert.match(childDomain, /node\.isWorkspaceNode\s*===\s*true/);
  assert.match(
    childDomain,
    /node\.isWorkspaceNode\s*===\s*true[\s\S]{0,260}domainCache\.set\s*\(\s*path\s*,\s*\[\s*\]\s*\)/
  );
  assert.match(
    childDomain,
    /node\.isWorkspaceNode\s*===\s*true[\s\S]{0,320}return\s+domainCache\.get\s*\(\s*path\s*\)/
  );
});

test('pending updates draw blue and pending deletions draw red for both nodes and edges', () => {
  const sphere = functionSource('drawSphere');
  const topology = functionSource('drawTopologyLink');

  assert.match(sphere, /workspace\.nodeVisualState\s*\(/);
  assert.match(sphere, /theme\.update/);
  assert.match(sphere, /theme\.delete/);
  assert.match(topology, /workspace\.edgeVisualState\s*\(/);
  assert.match(topology, /theme\.update/);
  assert.match(topology, /theme\.delete/);
});

test('transaction keyboard controls take precedence while normal enter remains use', () => {
  const keyboardStart = source.indexOf('document.addEventListener("keydown"');
  assert.notEqual(keyboardStart, -1);
  const keyboard = source.slice(keyboardStart, source.indexOf('document.querySelectorAll("[data-intent]"', keyboardStart));

  assert.match(keyboard, /workspace\.transaction\s*\(\s*\)/);
  assert.match(keyboard, /input\.resolveKeyboard\s*\(\s*event\s*,\s*\{\s*editing/);
  assert.match(source, /function\s+commitWorkspaceEdit\s*\(/);
  assert.match(source, /function\s+cancelWorkspaceEdit\s*\(/);
  assert.match(source, /function\s+markWorkspaceDelete\s*\(/);
});

test('semantic edits wait for persistence acknowledgement before claiming success', () => {
  assert.match(source, /persistenceId\s*=\s*operation[\s\S]{0,160}\+\+workspacePersistenceSequence/);
  assert.match(source, /spatial-workspace-persisted/);
  assert.match(source, /spatial-workspace-persist-failed/);
  assert.match(source, /正在保存/);
});

test('a persisted landing reselects the moved node at its authoritative projected id', () => {
  const listenerStart = source.indexOf('global.addEventListener("spatial-workspace-persisted"');
  const listenerEnd = source.indexOf('global.addEventListener("spatial-workspace-persist-failed"', listenerStart);
  const listener = source.slice(listenerStart, listenerEnd);

  assert.match(listener, /workspaceModel\.persistedLandingNode/);
  assert.match(listener, /nodeByIdInPath/);
  assert.match(listener, /buildClusterScene/);
  assert.match(listener, /updateSelectionUI/);
});

test('CapsLock settles detail mode on keyup without escaping form or edit boundaries', () => {
  const keyupStart = source.indexOf('document.addEventListener("keyup"');
  const keyup = source.slice(keyupStart, source.indexOf('document.querySelectorAll("[data-intent]"', keyupStart));

  assert.match(keyup, /event\.code\s*===\s*["']CapsLock["']/);
  assert.match(keyup, /workspace\.transaction\s*\(\s*\)/);
  assert.match(keyup, /state\.bindingCaptureIntent/);
  assert.match(keyup, /event\.target\s+instanceof\s+HTMLInputElement/);
  assert.match(keyup, /input\.resolveKeyboard\s*\(\s*event/);
  assert.match(keyup, /dispatchIntent\s*\(\s*intent\s*\)/);
});

test('CapsLock still settles floating details while an ASDF mode button retains focus', () => {
  const keyupStart = source.indexOf('document.addEventListener("keyup"');
  const keyup = source.slice(keyupStart, source.indexOf('document.querySelectorAll("[data-intent]"', keyupStart));

  assert.doesNotMatch(keyup, /event\.target\s+instanceof\s+HTMLButtonElement/);
  assert.match(keyup, /event\.target\s+instanceof\s+HTMLInputElement/);
  assert.match(keyup, /event\.target\s+instanceof\s+HTMLTextAreaElement/);
});

test('CapsLock includes a name-only density without hiding relationship semantics', () => {
  assert.match(source, /case\s+["']cycleVisibleDetails["']/);
  assert.match(functionSource('setVisibleDetailMode'), /["']name["']/);
  assert.match(functionSource('cycleVisibleDetailMode'), /name/);
});

test('navigation does not discard an unfinished cross-domain edge draft', () => {
  for (const name of ['enterNode', 'returnToDepth', 'returnOverview']) {
    assert.doesNotMatch(functionSource(name), /workspace\.cancel\s*\(/, `${name} preserves draft`);
  }
});

test('edge drafting keeps normal view-navigation keys available away from form fields', () => {
  const keyboardStart = source.indexOf('document.addEventListener("keydown"');
  const keyboard = source.slice(keyboardStart, source.indexOf('document.querySelectorAll("[data-intent]"', keyboardStart));

  assert.match(keyboard, /transaction\.kind\.startsWith\s*\(\s*["']edge-["']\s*\)/);
  assert.match(keyboard, /input\.resolveKeyboard\s*\(\s*event\s*,\s*\{\s*editing:\s*false\s*\}\s*\)/);
  assert.match(keyboard, /EDGE_DRAFT_NAVIGATION_INTENTS/);
});

test('pointer mapping distinguishes nodes, edges, and empty field under ctrl', () => {
  const start = source.indexOf('canvas.addEventListener("pointerdown"');
  const end = source.indexOf('canvas.addEventListener("pointermove"', start);
  const pointer = source.slice(start, end);

  assert.match(pointer, /ctrlKey:\s*event\.ctrlKey/);
  assert.match(pointer, /onEdge/);
  assert.match(pointer, /item\s*&&\s*item\.kind\s*===\s*["']relationship["']/);
});

test('all ASDF modes resolve structural editing through facts instead of visual shell proxies', () => {
  const findHit = functionSource('findHit');
  const pointerDownStart = source.indexOf('canvas.addEventListener("pointerdown"');
  const pointerDownEnd = source.indexOf('canvas.addEventListener("pointermove"', pointerDownStart);
  const pointerDown = source.slice(pointerDownStart, pointerDownEnd);
  assert.match(findHit, /hitOptions\.semanticEdit/);
  assert.match(findHit, /!region\.item\.clusterShellProxy/);
  assert.match(pointerDown, /semanticEdit/);
  assert.doesNotMatch(pointerDown, /state\.viewMode\s*===/);
});
