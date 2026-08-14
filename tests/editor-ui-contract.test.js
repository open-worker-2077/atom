const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'spatial.css'), 'utf8');
const tokens = fs.readFileSync(path.join(__dirname, '..', 'tokens.css'), 'utf8');

test('workspace model loads before the engine', () => {
  const modelIndex = html.indexOf('spatial-workspace-model.js');
  const engineIndex = html.indexOf('spatial-engine.js');
  assert.notEqual(modelIndex, -1);
  assert.notEqual(engineIndex, -1);
  assert.ok(modelIndex < engineIndex);
});

test('search surface presents visited-domain paths and a result list', () => {
  assert.match(html, /id=["']searchPanel["']/);
  assert.match(html, /id=["']spatialSearch["'][^>]*type=["']search["']/);
  assert.match(html, /id=["']searchResults["']/);
  assert.match(html, /域径/);
  assert.match(html, /已访问/);
});

test('node editing uses direct name, lens detail, and attachment controls', () => {
  assert.match(html, /id=["']nodeNameEditor["']/);
  assert.match(html, /id=["']nodeDetailEditor["']/);
  assert.match(html, /id=["']attachmentInput["'][^>]*type=["']file["']/);
  assert.match(html, /id=["']attachmentMeta["']/);
  assert.match(html, /id=["']editStatus["']/);
});

test('node name and Markdown body share one circular lens layout', () => {
  const lensStart = html.indexOf('id="lensEditor"');
  const lensEnd = html.indexOf('</section>', lensStart);
  const lensMarkup = html.slice(lensStart, lensEnd);
  assert.match(lensMarkup, /id=["']nodeNameEditorWrap["']/);
  assert.match(lensMarkup, /id=["']nodeDetailEditorMount["']/);
  assert.match(css, /\.lens-editor\s*>\s*\.node-name-editor\s*\{[\s\S]*position:\s*static/);
});

test('mapping panel uses nested purpose groups instead of a flat definition list', () => {
  assert.match(html, /class=["'][^"']*binding-groups/);
  assert.doesNotMatch(html, /<dl[^>]*id=["']bindingList["']/);
  assert.match(css, /\.binding-group/);
  assert.match(css, /\.binding-group__items/);
});

test('editor surfaces expose update and delete state styling with dedicated cool tokens', () => {
  assert.match(tokens, /--color-update:/);
  assert.match(tokens, /--color-delete:/);
  assert.match(css, /\[data-edit-state=["']update["']\]/);
  assert.match(css, /\[data-edit-state=["']delete["']\]/);
  assert.match(css, /var\(--color-update\)/);
  assert.match(css, /var\(--color-delete\)/);
});

test('search and editor remain edge-light rather than card surfaces', () => {
  assert.match(css, /\.spatial-search/);
  assert.match(css, /\.node-name-editor/);
  assert.match(css, /\.lens-editor/);
  assert.doesNotMatch(css, /\.spatial-search[\s\S]{0,500}backdrop-filter/);
});

test('lens editor padding scales from its own diameter instead of viewport percentage padding', () => {
  const start = css.indexOf('.lens-editor {');
  const end = css.indexOf('}', start);
  const rule = css.slice(start, end);
  assert.match(rule, /var\(--lens-padding/);
  assert.doesNotMatch(rule, /padding:\s*\d+%/);
});
