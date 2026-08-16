const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'spatial.css'), 'utf8');

test('coarse-pointer dock reuses the complete Atom visual intent boundary', () => {
  assert.match(html, /class="mobile-action-dock"/u);
  [
    'setNestedView',
    'setPeripheralView',
    'setHierarchyView',
    'setImmersiveView',
    'collapseHoveredCluster',
    'expandHoveredCluster',
    'cycleVisibleDetails',
    'applyViewMode',
    'applyParentView',
    'createNode',
    'editNode',
    'editEdge',
    'confirmEdit',
    'cancelEdit'
  ].forEach((intent) => assert.match(html, new RegExp(`data-intent="${intent}"`, 'u'), intent));
});

test('mobile controls stay hidden on desktop and respect touch size and safe areas', () => {
  assert.match(css, /\.mobile-action-dock\s*\{[\s\S]*?display:\s*none/u);
  assert.match(css, /@media\s*\(max-width:\s*48rem\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.mobile-action-dock\s*\{[\s\S]*?display:\s*grid/u);
  assert.match(css, /safe-area-inset-bottom/u);
  assert.match(css, /\.mobile-action-dock button\s*\{[\s\S]*?min-block-size:\s*2\.75rem/u);
});
