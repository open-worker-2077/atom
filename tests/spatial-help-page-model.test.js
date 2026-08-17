const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModel() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  const file = path.join(__dirname, '..', 'spatial-help-page-model.js');
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window.SpatialHelpPageModel;
}

test('mobile devices open the mobile operation help while desktop keeps desktop help', () => {
  const model = loadModel();
  assert.ok(model, 'SpatialHelpPageModel must exist');

  assert.equal(model.defaultPage({ coarsePointer: true }), 'mobile');
  assert.equal(model.defaultPage({ coarsePointer: false }), 'desktop');
});

test('help submenu accepts only known pages and preserves the current page otherwise', () => {
  const model = loadModel();
  assert.ok(model, 'SpatialHelpPageModel must exist');

  assert.equal(model.selectPage('desktop', 'mobile'), 'mobile');
  assert.equal(model.selectPage('mobile', 'desktop'), 'desktop');
  assert.equal(model.selectPage('mobile', 'unknown'), 'mobile');
});
