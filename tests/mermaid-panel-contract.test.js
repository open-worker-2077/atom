const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'spatial-engine.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'spatial-mermaid-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');

test('knowledge exchange keeps Mermaid and adds JSON with explicit preview confirmation and cancellation', () => {
  assert.match(html, /data-ui=["']mermaid["']/);
  assert.match(html, /id=["']mermaidPanel["']/);
  assert.match(html, /id=["']knowledgeFormat["']/);
  assert.match(html, /value=["']mermaid["']/);
  assert.match(html, /value=["']json["']/);
  assert.match(html, /id=["']mermaidSource["']/);
  assert.match(html, /id=["']mermaidFile["'][^>]*type=["']file["'][^>]*accept=["'][^"']*\.json/);
  assert.match(html, /id=["']mermaidPreview["']/);
  assert.match(html, /id=["']mermaidConfirm["']/);
  assert.match(html, /id=["']mermaidCancel["']/);
  assert.match(html, /id=["']mermaidExport["']/);
  assert.match(css, /\.mermaid-panel/);
  assert.doesNotMatch(css, /\.mermaid-panel[\s\S]{0,700}backdrop-filter/);
});

test('Mermaid and JSON codecs load before the visual engine and the shared panel loads after it', () => {
  const mermaidCodec = html.indexOf('spatial-mermaid-codec.js');
  const jsonCodec = html.indexOf('spatial-json-codec.js');
  const engineIndex = html.indexOf('spatial-engine.js');
  const panel = html.indexOf('spatial-mermaid-panel.js');
  const bridge = html.indexOf('spatial-browser-bridge.js');
  assert.ok(mermaidCodec > -1 && mermaidCodec < engineIndex);
  assert.ok(jsonCodec > -1 && jsonCodec < engineIndex);
  assert.ok(panel > engineIndex && panel < bridge);
});

test('engine exposes selected-mother targeting and persisted atomic knowledge replacement', () => {
  assert.match(engine, /function mermaidTarget\(/);
  assert.match(engine, /function replaceKnowledge\(/);
  assert.match(engine, /persistWorkspaceSnapshot\(["']mermaid-import["']\)/);
  assert.match(engine, /Mermaid 已载入当前视图，未写入 Atom 事实/);
  assert.match(engine, /mermaidTarget,/);
  assert.match(engine, /replaceKnowledge,/);
});

test('export chooses Mermaid or JSON and opens an explicit local save picker with a download fallback', () => {
  assert.match(panel, /SpatialJsonCodec/);
  assert.match(panel, /exportJson/);
  assert.match(panel, /showSaveFilePicker\s*\(/);
  assert.match(panel, /createWritable\s*\(/);
  assert.match(panel, /graph-4d-knowledge\.mmd/);
  assert.match(panel, /graph-4d-knowledge\.json/);
  assert.match(panel, /anchor\.download\s*=\s*settings\.filename/);
  assert.match(panel, /global\.confirm\s*\(/);
  assert.match(panel, /async function exportCurrent\(/);
  assert.match(panel, /await saveSourceToFile\s*\(/);
});
