const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');

test('mapping panel exposes an adjustable middle-click hierarchy depth', () => {
  assert.match(html, /id="middleLabelDepth"[^>]+min="1"[^>]+max="9"/);
  assert.match(html, /id="middleLabelDepthValue"/);
  assert.match(html, /id="highlightedLabelBrightness"[^>]+min="0"[^>]+max="100"/);
  assert.match(html, /id="otherLabelBrightness"[^>]+min="0"[^>]+max="100"/);
  assert.match(engine, /withMiddleLabelDepthInput/);
  assert.match(engine, /withOtherLabelBrightnessInput/);
  assert.match(engine, /withHighlightedLabelBrightnessInput/);
  assert.match(html, /id="middleDetailDepth"[^>]+min="1"[^>]+max="9"/);
  assert.match(html, /id="highlightedDetailBrightness"[^>]+min="0"[^>]+max="100"/);
  assert.match(html, /id="otherDetailBrightness"[^>]+min="0"[^>]+max="100"/);
  assert.match(html, /id="floatingDetailBackdropOpacity"[^>]+min="0"[^>]+max="100"/);
  assert.match(engine, /withMiddleDetailDepthInput/);
  assert.match(engine, /withHighlightedDetailBrightnessInput/);
  assert.match(engine, /withOtherDetailBrightnessInput/);
  assert.match(engine, /withFloatingDetailBackdropOpacityInput/);
});

test('stationary middle-click distinguishes a node anchor from a group anchor', () => {
  assert.match(engine, /const clickedGroupPath = isClusterShell && candidate\.domainContext/);
  assert.match(engine, /kind: "domain",\s*path: clickedGroupPath/);
  assert.match(engine, /const middleFocus = isClusterShell/);
  assert.match(engine, /path: candidate\.domainContext\.path/);
  assert.match(engine, /state\.middleDetailFocus\s*=\s*middleFocus/);
  assert.match(engine, /kind: "node",\s*anchorKey: visualNodeKey\(candidate\.node, ownerPath\)/);
  assert.match(engine, /descendantPath: childPathFor\(candidate\.node, ownerPath\)/);
});

test('label emphasis follows hierarchy paths and leaves ordinary label styling intact', () => {
  assert.match(engine, /function isMiddleLabelHighlighted\(item\)/);
  assert.match(engine, /state\.semanticScene\.byId\(id\)\?\.emphasis\.label/);
  assert.match(engine, /hierarchyHighlighted \? theme\.ink : theme\["ink-2"\]/);
  assert.match(engine, /hierarchyHighlighted \? 600/);
  assert.match(engine, /otherLabelBrightnessPercent\s*\/\s*100/);
  assert.match(engine, /highlightedLabelBrightnessPercent\s*\/\s*100/);
  assert.match(engine, /const clusterHierarchyHighlighted = Boolean\(/);
  assert.match(engine, /sceneAdapter\.sceneEntityIdForItem/);
  assert.match(engine, /const clusterLabelAlpha = state\.middleLabelFocus/);
  assert.match(engine, /function isMiddleDetailHighlighted\(/);
  assert.match(engine, /state\.semanticScene\.byId\(id\)\?\.emphasis\.detail/);
  assert.match(engine, /highlightedDetailBrightnessPercent/);
  assert.match(engine, /otherDetailBrightnessPercent/);
});

test('relationship lines share the middle-click hierarchy brightness range', () => {
  assert.match(engine, /function isMiddleRelationshipHighlighted\(from, to\)/);
  assert.match(engine, /isMiddleLabelHighlighted\(from\)\s*\|\|\s*isMiddleLabelHighlighted\(to\)/);
  assert.match(engine, /const hierarchyHighlighted = isMiddleRelationshipHighlighted\(from, to\)/);
  assert.match(engine, /const relationshipBrightness = state\.middleLabelFocus/);
  assert.match(engine, /function relationshipHierarchyBrightnessPercent\(from, to\)/);
  assert.match(engine, /state\.semanticScene\?\.byId/);
  assert.doesNotMatch(engine, /demoModel\.hierarchyRelationshipBrightnessPercent/);
  assert.match(engine, /state\.demo\.settings\.highlightedLabelBrightnessPercent/);
  assert.match(engine, /state\.demo\.settings\.otherLabelBrightnessPercent/);
});

test('floating details use a separate collision-free overlay pass and include group carriers', () => {
  assert.match(engine, /function drawFloatingDetails\(/);
  assert.match(engine, /state\.clusterScene\.clusters[\s\S]{0,180}cluster\.detailNode/);
  assert.match(engine, /state\.renderedFloatingDetailBoxes/);
  assert.match(engine, /canvas\.dataset\.floatingDetailOverlapCount/);
  assert.match(engine, /canvas\.dataset\.floatingClusterDetailCount/);
  const labels = engine.indexOf('drawLabel(item, placement)');
  const details = engine.indexOf('drawFloatingDetails(rendered, labelPlacements)', labels);
  assert.ok(labels > -1 && details > labels, 'details render above nodes and names');
  assert.match(engine, /state\.clusterDetailCandidates\s*=\s*\[\]/);
});

test('zero brightness for every name category is a master off switch for floating details', () => {
  assert.match(engine, /function areAllFocusedNamesHidden\(\)/);
  assert.match(
    engine,
    /highlightedLabelBrightnessPercent\s*<=\s*0[\s\S]{0,180}otherLabelBrightnessPercent\s*<=\s*0/
  );
  assert.match(
    engine,
    /function floatingDetailAlpha\(item\)\s*\{[\s\S]{0,120}areAllFocusedNamesHidden\(\)[\s\S]{0,80}return 0/
  );
});

test('each floating detail is hidden when its corresponding focused name category is zero', () => {
  assert.match(engine, /function focusedNameBrightnessPercent\(item\)/);
  assert.match(
    engine,
    /isMiddleItemLabelHighlighted\(item\)[\s\S]{0,180}highlightedLabelBrightnessPercent[\s\S]{0,180}otherLabelBrightnessPercent/
  );
  assert.match(
    engine,
    /function floatingDetailAlpha\(item\)\s*\{[\s\S]{0,180}focusedNameBrightnessPercent\(item\)\s*<=\s*0[\s\S]{0,80}return 0/
  );
});

test('CapsLock floating mode reveals every visible detail as one batch despite ordinary detail brightness being zero', () => {
  assert.match(engine, /batchFloatingDetails:\s*false/);
  assert.match(
    engine,
    /function setVisibleDetailMode\(mode\)[\s\S]{0,240}state\.batchFloatingDetails\s*=\s*mode\s*===\s*["']floating["']/
  );
  assert.match(
    engine,
    /function floatingDetailAlpha\(item\)[\s\S]{0,320}state\.batchFloatingDetails[\s\S]{0,180}highlightedDetailBrightnessPercent/
  );
});
