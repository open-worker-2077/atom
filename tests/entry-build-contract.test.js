const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

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

test('consecutive revision stamps are idempotent in an isolated browser-entry copy', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-browser-revision-'));
  try {
    fs.writeFileSync(path.join(temporaryRoot, 'index.html'), html);
    const assets = [...new Set(
      [...html.matchAll(/(?:href|src)="((?:spatial|input|tokens|vendor\/)[^"]+)"/g)]
        .map((match) => new URL(match[1], 'https://local.invalid/').pathname.slice(1))
    )];
    for (const asset of assets) {
      const destination = path.join(temporaryRoot, asset);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, asset), destination);
    }
    const moduleUrl = pathToFileURL(path.join(root, 'scripts', 'browser-build-revision.mjs')).href;
    const { stampBrowserEntryRevision } = await import(moduleUrl);
    const first = await stampBrowserEntryRevision({ root: temporaryRoot });
    const firstHtml = fs.readFileSync(path.join(temporaryRoot, 'index.html'), 'utf8');
    const second = await stampBrowserEntryRevision({ root: temporaryRoot });
    const secondHtml = fs.readFileSync(path.join(temporaryRoot, 'index.html'), 'utf8');

    assert.equal(first.revision, expectedContentBuildId(firstHtml));
    assert.equal(second.revision, first.revision);
    assert.equal(second.changed, false);
    assert.equal(secondHtml, firstHtml);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
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
