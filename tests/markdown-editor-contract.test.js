const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src', 'spatial-markdown-editor.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('CM6 Markdown editor is locally bundled before the spatial engine', () => {
  assert.equal(typeof packageJson.scripts['build:browser'], 'string');
  assert.match(packageJson.scripts.test, /build:browser/);
  assert.ok(packageJson.dependencies.codemirror);
  assert.ok(packageJson.dependencies['@codemirror/lang-markdown']);
  assert.ok(packageJson.dependencies['markdown-it']);
  assert.ok(packageJson.dependencies.dompurify);

  const editorIndex = html.indexOf('vendor/spatial-markdown-editor.bundle.js');
  const engineIndex = html.indexOf('spatial-engine.js');
  assert.notEqual(editorIndex, -1);
  assert.ok(editorIndex < engineIndex);
});

test('Markdown editor supports fenced code languages and preserves specialized edit keys', () => {
  assert.match(source, /markdown\s*\(\s*\{[\s\S]*codeLanguages/);
  assert.match(source, /LanguageDescription\.of/);
  assert.match(source, /javascript\s*\(\s*\{\s*typescript:\s*true/);
  assert.match(source, /python\s*\(\s*\)/);
  assert.match(source, /json\s*\(\s*\)/);
  assert.match(source, /event\.key\s*===\s*["']Enter["'][\s\S]*event\.shiftKey/);
  assert.match(source, /event\.code\s*===\s*["']Enter["']/);
  assert.match(source, /getModifierState\s*\(\s*["']Shift["']\s*\)/);
  assert.match(source, /contentDOM\.addEventListener\s*\(\s*["']keydown["'][\s\S]*captureShiftEnter[\s\S]*capture:\s*true/);
  assert.match(source, /insertLineBreak\s*\(\s*\)/);
  assert.match(source, /function\s+isShiftEnterLineBreak\s*\(/);
  assert.match(source, /key:\s*["']Enter["'][\s\S]*onSubmit/);
  assert.match(source, /key:\s*["']Escape["'][\s\S]*onCancel/);
});

test('lens editor keeps every editing surface inside the circular node boundary', () => {
  assert.match(css, /\.lens-editor\s*\{[\s\S]*clip-path:\s*circle\(/);
  assert.match(css, /\.markdown-editor-mount[\s\S]*min-width:\s*0/);
  assert.match(css, /\.markdown-editor-mount[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.markdown-editor-mount[\s\S]*\.cm-editor[\s\S]*max-width:\s*100%/);
});

test('Markdown preview disables raw HTML and sanitizes rendered output', () => {
  assert.match(source, /html:\s*false/);
  assert.match(source, /DOMPurify\.sanitize/);
  assert.match(source, /FORBID_TAGS:\s*\[[^\]]*["']script["']/);
  assert.match(source, /function\s+toPlainText\s*\(/);
});

test('node detail keeps one Markdown source for CM6 preview and Canvas summary', () => {
  assert.match(html, /id=["']nodeDetailEditorMount["']/);
  assert.match(html, /id=["']nodeDetailPreview["']/);
  assert.match(html, /id=["']nodeDetailModeToggle["']/);
  assert.match(engine, /SpatialMarkdownEditor/);
  assert.match(engine, /markdownEditor\.setValue\s*\(\s*draft\.description/);
  assert.match(engine, /markdownEditor\.getValue\s*\(\s*\)/);
  assert.match(engine, /markdownEditor\.toPlainText\s*\(\s*descriptionSource\s*\)/);
});

test('large node surfaces use a bounded Markdown overlay instead of rendering every node', () => {
  assert.match(html, /id=["']surfaceMarkdownLayer["']/);
  assert.match(css, /\.surface-markdown-layer[\s\S]*pointer-events:\s*none/);
  assert.match(css, /\.surface-markdown[\s\S]*overflow:\s*hidden/);
  assert.match(engine, /const MARKDOWN_SURFACE_RADIUS\s*=\s*90/);
  assert.match(engine, /const MAX_MARKDOWN_SURFACES\s*=\s*2/);
  assert.match(engine, /function\s+syncMarkdownSurfaceOverlays\s*\(/);
  assert.match(engine, /markdownEditor\.renderMarkdown\s*\(/);
  assert.match(engine, /\.slice\s*\(\s*0\s*,\s*MAX_MARKDOWN_SURFACES\s*\)/);
  assert.doesNotMatch(
    engine.match(/function shouldRenderMarkdownSurface[\s\S]*?\n  \}/)?.[0] || "",
    /node\.surfaceVisible/
  );
  assert.match(engine, /function\s+maximizedNodeContentProgress\s*\(/);
  assert.match(engine, /1\.42\s*\+\s*maximized\s*\*\s*0\.36/);
  assert.match(engine, /0\.146\s*-\s*maximized\s*\*\s*0\.005/);
  assert.match(engine, /boundaryScale\s*=\s*1\s*-\s*maximized\s*\*\s*0\.45/);
});

test('editor exposes a deterministic line-break control alongside Shift Enter', () => {
  assert.match(html, /id=["']nodeDetailLineBreak["']/);
  assert.match(engine, /nodeDetailLineBreak\.addEventListener\s*\(\s*["']click["']/);
  assert.match(engine, /markdownEditor\.insertLineBreak\s*\(\s*\)/);
  assert.match(engine, /editShiftLineBreakUntil/);
});

test('browser assets use the current cache-busting release id', () => {
  assert.doesNotMatch(html, /v=20260727\.74/);
  assert.match(html, /spatial-engine\.js\?v=20260816\.310/);
  assert.match(html, /spatial-markdown-editor\.bundle\.js\?v=20260816\.310/);
});
