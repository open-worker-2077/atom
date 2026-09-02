const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-browser-bridge.js'), 'utf8');

test('Web forwards atomic click counts through the ordinary Atom Transform command endpoint', () => {
  assert.match(source, /addEventListener\("atom-transform-action",\s*enqueueAtomTransformAction\)/);
  assert.match(source, /global\.fetch\("\/__atom\/api\/command"/);
  assert.match(source, /`thing\$\$\{detail\.action\}\$\{suffix\}`/);
  assert.match(source, /transformActionDelivery\s*=\s*transformActionDelivery\s*\.then/);
  assert.doesNotMatch(source, /__atom\/api\/click/);
});
