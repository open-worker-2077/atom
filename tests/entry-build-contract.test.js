const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');

test('file entry versions every local executable asset with one build id', () => {
  const assets = [...html.matchAll(/(?:href|src)="((?:spatial|input|tokens)[^"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(assets.length >= 8);
  const versions = assets.map((asset) => new URL(asset, 'https://local.invalid/').searchParams.get('v'));
  assert.ok(versions.every(Boolean));
  assert.equal(new Set(versions).size, 1);
  assert.match(html, /data-build="[^"]+"/);
});

test('knowledge bridge loads after the visual engine', () => {
  const build = html.match(/data-build="([^"]+)"/)[1];
  const engine = html.indexOf(`spatial-engine.js?v=${build}`);
  const bridge = html.indexOf(`spatial-browser-bridge.js?v=${build}`);
  assert.ok(engine > -1);
  assert.ok(bridge > engine);
});

test('network entry hides synthetic knowledge until authoritative Atom data connects', () => {
  assert.match(html, /<body[^>]*data-spatial-bridge="connecting"/);
  assert.match(html, /class="spatial-data-gate"[^>]*role="status"/);
  assert.match(css, /body\[data-spatial-bridge="connecting"\][\s\S]*\.spatial-shell/);
  assert.match(css, /body\[data-spatial-bridge="offline"\][^\n]*data-spatial-knowledge="authoritative"[^\n]*\.spatial-shell/);
  assert.match(css, /body\[data-spatial-bridge="connected"\][\s\S]*\.spatial-data-gate/);
});

test('loading gate distinguishes overall, service, actual-data, and scene progress', () => {
  assert.match(html, /id="spatialProgressOverall"[^>]*max="100"/);
  assert.match(html, /id="spatialProgressService"[^>]*max="100"/);
  assert.match(html, /id="spatialProgressData"[^>]*max="100"/);
  assert.match(html, /id="spatialProgressScene"[^>]*max="100"/);
  assert.match(html, />服务连接</);
  assert.match(html, />当前层实际数据</);
  assert.match(html, />场景渲染</);
});
