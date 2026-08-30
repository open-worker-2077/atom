const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');

function expectedContentBuildId(entryHtml) {
  const assets = [...new Set(
    [...entryHtml.matchAll(/(?:href|src)="((?:spatial|input|tokens|vendor\/)[^"]+)"/g)]
      .map((match) => new URL(match[1], 'https://local.invalid/').pathname.slice(1))
  )].sort();
  const digest = crypto.createHash('sha256');
  for (const asset of assets) {
    digest.update(`${asset}\0`);
    digest.update(fs.readFileSync(path.join(root, asset)));
    digest.update('\0');
  }
  return `sha256-${digest.digest('hex').slice(0, 16)}`;
}

test('file entry versions every local executable asset with one build id', () => {
  const assets = [...html.matchAll(/(?:href|src)="((?:spatial|input|tokens)[^"]+)"/g)]
    .map((match) => match[1]);
  assert.ok(assets.length >= 8);
  const versions = assets.map((asset) => new URL(asset, 'https://local.invalid/').searchParams.get('v'));
  assert.ok(versions.every(Boolean));
  assert.equal(new Set(versions).size, 1);
  assert.match(html, /data-build="[^"]+"/);
});

test('browser build id is derived from the executable asset contents', () => {
  const actual = html.match(/data-build="([^"]+)"/)[1];

  assert.equal(actual, expectedContentBuildId(html));
});

test('consecutive browser builds keep the stamped revision equal to final asset contents', () => {
  const revisions = [];
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath, ['scripts/build-browser.mjs'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const builtHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const revision = builtHtml.match(/data-build="([^"]+)"/)[1];
    assert.equal(revision, expectedContentBuildId(builtHtml));
    revisions.push(revision);
  }
  assert.equal(revisions[1], revisions[0]);
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
