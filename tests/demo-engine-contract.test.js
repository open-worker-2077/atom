const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');
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

test('demo model loads before the engine and the mapping panel owns persistent P H settings', () => {
  assert.ok(html.indexOf('spatial-demo-model.js') < html.indexOf('spatial-engine.js'));
  const geometryIndex = html.indexOf('spatial-demo-geometry.js');
  assert.ok(geometryIndex > -1 && geometryIndex < html.indexOf('spatial-engine.js'));
  assert.match(html, /id="demoIdleSeconds"/);
  assert.match(html, /id="helpStartupToggle"/);
  assert.match(html, /id="nestedCompactness"[^>]*min="0"[^>]*max="100"/);
  assert.match(html, /id="nestedCompactnessValue"/);
  assert.match(html, /id="nestedTunnelStrength"[^>]*min="0"[^>]*max="100"/);
  assert.match(html, /id="nestedTunnelStrengthValue"/);
  assert.match(html, /id="nestedTunnelInteriorStrength"[^>]*min="0"[^>]*max="100"/);
  assert.match(html, /id="nestedTunnelInteriorStrengthValue"/);
  assert.match(html, /id="zoomSpeed"[^>]*min="25"[^>]*max="400"/);
  assert.match(html, /id="zoomSpeedValue"/);
  assert.match(engine, /SpatialDemoModel/);
  assert.match(engine, /localStorage/);
  assert.match(engine, /helpVisible/);
  assert.match(engine, /withNestedCompactnessInput/);
  assert.match(engine, /withNestedTunnelInput/);
  assert.match(engine, /withNestedTunnelInteriorInput/);
  assert.match(engine, /withZoomSpeedInput/);
});

test('presentation cue is central non-blocking live UI', () => {
  assert.match(html, /id="demoCue"[^>]*aria-live="polite"/);
  assert.match(css, /\.demo-cue[\s\S]*position:\s*fixed/);
  assert.match(css, /\.demo-cue[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.demo-cue\.is-active/);
});

test('theme chapters are visually distinct from the giant operation key cue', () => {
  assert.match(html, /id="demoTheme"/);
  assert.match(html, /id="demoThemeIndex"/);
  assert.match(html, /id="demoThemeLabel"/);
  assert.match(css, /\.demo-theme[\s\S]*letter-spacing/);
  assert.match(css, /\.demo-theme[\s\S]*min-width/);
  const themeBlock = css.slice(css.indexOf('.demo-theme'), css.indexOf('.demo-theme') + 620);
  assert.doesNotMatch(themeBlock, /border-radius:\s*50%/);
});

test('P and the settings field share one toggle path', () => {
  assert.match(engine, /case\s+["']toggleDemo["'][\s\S]*toggleDemoMode\s*\(/);
  assert.match(engine, /demoIdleSeconds[\s\S]*toggleDemoMode/);
  assert.match(engine, /demoIdleSeconds\.addEventListener\(["']input["']/);
});

test('legacy presentation preferences migrate with automatic playback disabled', () => {
  const load = functionSource('loadDemoSettings');
  assert.match(engine, /graph-4d\.presentation-settings\.v2/);
  assert.match(engine, /LEGACY_DEMO_SETTINGS_KEY/);
  assert.match(load, /legacyRaw/);
  assert.match(load, /idleSeconds:\s*null/);
});

test('idle presentation replans unfinished work from the current graph and cues before acting', () => {
  const start = functionSource('startDemoPresentation');
  const next = functionSource('runNextDemoStep');
  const detail = functionSource('setDemoDetailMode');
  assert.doesNotMatch(engine, /demoModel\.shuffleSteps\s*\(\s*DEMO_STEPS/);
  assert.match(next, /demoModel\.nextTourTask\s*\(\s*scanDemoGraph\(\)/);
  assert.match(next, /demoCue[\s\S]*classList\.add\(["']is-active["']\)[\s\S]*setTimeout[\s\S]*executeDemoStep/);
  assert.match(detail, /visualModel\.cycleNodeDetailMode/);
  assert.match(start, /beginDemoSession/);
});

test('demo graph scanning drives capability-aware planning', () => {
  const scan = functionSource('scanDemoGraph');
  assert.match(scan, /portalCount/);
  assert.match(scan, /detailCount/);
  assert.match(scan, /maxDescent/);
  assert.match(scan, /batchCount/);
  assert.match(scan, /canCreate/);
  assert.match(scan, /canUpdate/);
  assert.match(scan, /canRelate/);
  assert.match(scan, /canLand/);
  assert.match(scan, /visibleWandRegions/);
});

test('demo sessions remove only their timestamp-owned knowledge on completion or interruption', () => {
  const cleanup = functionSource('cleanupDemoSession');
  const cleanupKnowledge = functionSource('cleanupDemoKnowledge');
  const register = functionSource('registerHumanInput');
  assert.doesNotMatch(cleanup, /importKnowledge|knowledgeBaseline/);
  assert.match(cleanup, /knowledgeDirty/);
  assert.match(cleanupKnowledge, /session\.marker/);
  assert.match(cleanupKnowledge, /workspace\.discardAddedNode/);
  assert.doesNotMatch(cleanupKnowledge, /workspace\.beginNodeEdit/);
  assert.match(cleanupKnowledge, /workspace\.beginEdgeEdit/);
  assert.match(cleanupKnowledge, /workspace\.markDelete/);
  assert.match(register, /cleanupDemoSession/);
  assert.match(engine, /formatSessionMarker/);
});

test('knowledge import removes only unmistakable orphaned timestamp demo artifacts', () => {
  const cleanup = functionSource('cleanupOrphanedDemoKnowledge');
  const importKnowledge = functionSource('importKnowledge');
  assert.match(cleanup, /【演示·\\d\{8\}-\\d\{6\}】/);
  assert.match(cleanup, /workspace\.discardAddedNode/);
  assert.match(cleanup, /workspace\.beginEdgeEdit/);
  assert.match(cleanup, /persistWorkspaceSnapshot\(["']demo-orphan-cleanup["']\)/);
  assert.match(importKnowledge, /cleanupOrphanedDemoKnowledge/);
  assert.match(functionSource('startDemoPresentation'), /cleanupOrphanedDemoKnowledge/);
});

test('Home is conditional and the domain path view remains an independent spatial task', () => {
  const execute = functionSource('executeDemoStep');
  assert.match(execute, /step\.kind\s*===\s*["']worldLens["']/);
  assert.match(execute, /step\.kind\s*===\s*["']overview["'][\s\S]*state\.depth|state\.depth[\s\S]*step\.kind\s*===\s*["']overview["']/);
});

test('presentation batch visibly animates a planned wood or jade stroke before applying targets', () => {
  const batch = functionSource('executeDemoBatch');
  const next = functionSource('runNextDemoStep');
  assert.match(batch, /demoGeometry\.planWandPath/);
  assert.match(batch, /state\.wand\.points/);
  assert.match(batch, /state\.pointerPosition/);
  assert.match(batch, /state\.demo\.wandTimer/);
  assert.match(batch, /wandGlowUntil/);
  assert.match(batch, /wandGlowUntil[\s\S]*setTimeout[\s\S]*executeWandTargets/);
  assert.match(batch, /glowDurationMs:\s*0/);
  assert.match(batch, /state\.wand\.highEnergy\s*=\s*action\s*===\s*["']recursive["']/);
  assert.match(next, /step\.kind\s*===\s*["']batch["'][\s\S]*2300[\s\S]*step\.kind\s*===\s*["']editing["'][\s\S]*2200[\s\S]*1450/);
});

test('presentation interruption clears every wand timer and visible stroke state', () => {
  const clear = functionSource('clearDemoTimers');
  const cleanup = functionSource('clearDemoWandPresentation');
  assert.match(clear, /wandTimer/);
  assert.match(cleanup, /state\.wand\.points\s*=\s*\[\]/);
  assert.match(cleanup, /state\.wand\.shiftHeld\s*=\s*false/);
  assert.match(functionSource('cleanupDemoSession'), /clearDemoWandPresentation/);
});

test('failed presentation actions cannot starve later themes in the same cycle', () => {
  const next = functionSource('runNextDemoStep');
  assert.match(next, /const\s+succeeded\s*=\s*executeDemoStep\(step\)/);
  assert.match(next, /completedIds\.add\(step\.id\)[\s\S]*if\s*\(succeeded\)/);
});

test('presentation demonstrates create relation and cross-domain landing', () => {
  const edit = functionSource('executeDemoEditing');
  assert.match(edit, /action\s*===\s*["']create["']/);
  assert.match(edit, /action\s*===\s*["']relation["']/);
  assert.match(edit, /action\s*===\s*["']relation["'][\s\S]*关联端点[\s\S]*workspace\.beginEdgeCreate/);
  assert.match(edit, /action\s*===\s*["']land["']/);
  assert.match(edit, /workspace\.setNodeLanding/);
  assert.match(edit, /session\.demoNodeKey\s*=\s*operation\.newKey/);
});

test('real user input interrupts presentation and hidden pages pause it', () => {
  const register = functionSource('registerHumanInput');
  assert.match(register, /stopDemoPresentation/);
  assert.match(engine, /visibilitychange[\s\S]*stopDemoPresentation/);
  for (const eventName of ['pointerdown', 'pointermove', 'wheel', 'keydown']) {
    assert.match(engine, new RegExp('addEventListener\\(["\\x27]' + eventName + '["\\x27][\\s\\S]*registerHumanInput'));
  }
});

test('only the demo controller may auto-fit the camera', () => {
  const fit = functionSource('fitDemoCamera');
  const bounds = functionSource('demoSceneBounds');
  const sourceRegions = functionSource('demoSourceRegions');
  assert.match(fit, /demoGeometry\.planAdaptiveFrame/);
  assert.match(fit, /demoSceneBounds/);
  assert.doesNotMatch(fit, /NORMAL_FIELD_DISTANCE/);
  assert.match(bounds, /demoSourceRegions/);
  assert.match(sourceRegions, /projectUnclipped/);
  assert.match(sourceRegions, /clusterScene\.clusters/);
  assert.match(sourceRegions, /collectNodes/);
  assert.match(fit, /startCameraTween/);
  const next = functionSource('runNextDemoStep');
  assert.match(next, /fitDemoCamera/);
  assert.match(next, /executeDemoStep\(step\)[\s\S]*frameTimer[\s\S]*fitDemoCamera\(step\)/);
});
