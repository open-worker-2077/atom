const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');

test('coarse-pointer dock exposes real keyboard keys instead of business actions', () => {
  const dock = html.slice(
    html.indexOf('<nav class="mobile-keyboard"'),
    html.indexOf('</nav>', html.indexOf('<nav class="mobile-keyboard"'))
  );
  assert.ok(dock.length > 0);
  for (const code of [
    'ControlLeft', 'ShiftLeft', 'AltLeft', 'KeyA', 'KeyS', 'KeyD', 'KeyF',
    'KeyZ', 'KeyX', 'Home', 'End', 'PageUp', 'PageDown', 'CapsLock',
    'KeyO', 'KeyK', 'KeyH', 'KeyP', 'Enter', 'Escape', 'Delete'
  ]) {
    assert.match(dock, new RegExp(`data-mobile-key="${code}"`, 'u'), code);
  }
  assert.doesNotMatch(dock, /data-intent=/u);
  for (const businessLabel of ['进入', '返回', '收层', '展层', '详情', '帮助', '新增', '编辑', '关系', '确认']) {
    assert.doesNotMatch(dock, new RegExp(`>${businessLabel}<`, 'u'), businessLabel);
  }
});

test('mobile controls stay hidden on desktop and respect touch size and safe areas', () => {
  assert.match(css, /\.mobile-keyboard\s*\{[\s\S]*?display:\s*none/u);
  assert.match(css, /@media\s*\(max-width:\s*48rem\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.mobile-keyboard\s*\{[\s\S]*?display:\s*flex/u);
  assert.match(css, /safe-area-inset-bottom/u);
  assert.match(css, /\.mobile-keyboard button\s*\{[\s\S]*?min-block-size:\s*2\.75rem/u);
  assert.match(css, /\[data-pressed="true"\]/u);
});

test('mobile modifiers merge into graph pointer input and a stationary hold becomes right click', () => {
  assert.match(engine, /mobileInput\.mergePointerEvent/u);
  assert.match(engine, /mobileInput\.classifyTouchRelease/u);
  assert.match(engine, /secondaryHit\s*=\s*findHit[\s\S]*blankSensitive:\s*true/u);
  assert.match(engine, /data-mobile-key/u);
  assert.match(engine, /setPointerCapture/u);
});

test('input mapping exposes a dedicated route to mobile Web operation help', () => {
  assert.match(html, /data-open-help-page="mobile"/u);
  assert.match(html, /手机 Web 操作/u);
  assert.match(html, /按住.*Ctrl.*图区域/u);
  assert.match(html, /按住后释放.*右键/u);
});
