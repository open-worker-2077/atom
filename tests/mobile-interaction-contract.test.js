const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');

test('coarse-pointer panel separates mouse controls from real keyboard keys', () => {
  const panel = html.slice(
    html.indexOf('<nav class="mobile-control-panel"'),
    html.indexOf('</nav>', html.indexOf('<nav class="mobile-control-panel"'))
  );
  const mouseGroup = panel.slice(
    panel.indexOf('data-mobile-control-group="mouse"'),
    panel.indexOf('</section>', panel.indexOf('data-mobile-control-group="mouse"'))
  );
  const keyboardGroup = panel.slice(
    panel.indexOf('data-mobile-control-group="keyboard"'),
    panel.indexOf('</section>', panel.indexOf('data-mobile-control-group="keyboard"'))
  );
  assert.ok(panel.length > 0);
  assert.match(mouseGroup, />鼠标</u);
  assert.match(keyboardGroup, />键盘</u);
  assert.match(mouseGroup, /data-mobile-mouse-button="1"[^>]*>中键</u);
  assert.doesNotMatch(keyboardGroup, /data-mobile-mouse-button=/u);
  assert.doesNotMatch(mouseGroup, /data-mobile-key=/u);
  for (const code of [
    'ControlLeft', 'ShiftLeft', 'AltLeft', 'KeyA', 'KeyS', 'KeyD', 'KeyF',
    'KeyZ', 'KeyX', 'Home', 'End', 'PageUp', 'PageDown', 'CapsLock',
    'KeyO', 'KeyK', 'KeyH', 'KeyP', 'Enter', 'Escape', 'Delete'
  ]) {
    assert.match(keyboardGroup, new RegExp(`data-mobile-key="${code}"`, 'u'), code);
  }
  assert.doesNotMatch(panel, /data-intent=/u);
  for (const businessLabel of ['进入', '返回', '收层', '展层', '详情', '帮助', '新增', '编辑', '关系', '确认']) {
    assert.doesNotMatch(panel, new RegExp(`>${businessLabel}<`, 'u'), businessLabel);
  }
});

test('mobile controls stay hidden on desktop, preserve touch targets, and horizontally scroll one-handed', () => {
  assert.match(css, /\.mobile-control-panel\s*\{[\s\S]*?display:\s*none/u);
  assert.match(css, /@media\s*\(max-width:\s*48rem\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.mobile-control-panel\s*\{[\s\S]*?display:\s*flex/u);
  assert.match(css, /safe-area-inset-bottom/u);
  assert.match(css, /\.mobile-control-panel button\s*\{[\s\S]*?min-block-size:\s*2\.75rem/u);
  assert.match(css, /\.mobile-control-panel__scroll\s*\{[\s\S]*?overflow-x:\s*auto/u);
  assert.match(css, /\.mobile-control-panel__scroll\s*\{[\s\S]*?touch-action:\s*pan-x/u);
  assert.match(css, /\[data-pressed="true"\]/u);
});

test('mobile modifiers merge into graph pointer input and a stationary hold becomes right click', () => {
  assert.match(engine, /mobileInput\.mergePointerEvent/u);
  assert.match(engine, /mobileInput\.classifyTouchRelease/u);
  assert.match(engine, /secondaryHit\s*=\s*findHit[\s\S]*blankSensitive:\s*true/u);
  assert.match(engine, /data-mobile-key/u);
  assert.match(engine, /setPointerCapture/u);
  assert.match(engine, /mobileInput\.pressButton/u);
});

test('input mapping exposes a dedicated route to mobile Web operation help', () => {
  assert.match(html, /data-open-help-page="mobile"/u);
  assert.match(html, /手机 Web 操作/u);
  assert.match(html, /按住.*Ctrl.*图区域/u);
  assert.match(html, /按住后释放.*右键/u);
  assert.match(html, /按住.*中键.*图区域.*点按.*拖动/u);
});
