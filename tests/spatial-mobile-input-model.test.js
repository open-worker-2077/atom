const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModel() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'spatial-mobile-input-model.js'), 'utf8'),
    sandbox,
    { filename: 'spatial-mobile-input-model.js' }
  );
  return sandbox.window.SpatialMobileInputModel;
}

test('held virtual modifiers merge with a simultaneous graph pointer', () => {
  const model = loadModel();
  const state = model.createState();
  model.pressModifier(state, 'ControlLeft', 11);
  model.pressModifier(state, 'ShiftLeft', 12);

  const event = model.mergePointerEvent({
    button: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false
  }, state);

  assert.equal(event.ctrlKey, true);
  assert.equal(event.shiftKey, true);
  assert.equal(event.altKey, false);
  model.releasePointer(state, 11);
  assert.equal(model.mergePointerEvent({}, state).ctrlKey, false);
  assert.equal(model.mergePointerEvent({}, state).shiftKey, true);
});

test('a stationary touch hold maps to secondary click while tap stays primary', () => {
  const model = loadModel();
  assert.equal(model.classifyTouchRelease({ durationMs: 180, movementPx: 2 }), 0);
  assert.equal(model.classifyTouchRelease({ durationMs: 520, movementPx: 2 }), 2);
  assert.equal(model.classifyTouchRelease({ durationMs: 520, movementPx: 18 }), 0);
  assert.equal(model.classifyTouchRelease({ durationMs: 520, movementPx: 2, cancelled: true }), null);
});

test('releasing an unknown pointer leaves other held modifiers intact', () => {
  const model = loadModel();
  const state = model.createState();
  model.pressModifier(state, 'AltLeft', 7);
  model.releasePointer(state, 99);
  assert.equal(model.mergePointerEvent({}, state).altKey, true);
  model.clear(state);
  assert.equal(model.mergePointerEvent({}, state).altKey, false);
});

test('a held virtual middle button turns a simultaneous graph touch into mouse button one', () => {
  const model = loadModel();
  const state = model.createState();
  assert.equal(model.pressButton(state, 1, 21), true);
  assert.equal(model.mergePointerEvent({ button: 0 }, state).button, 1);
  model.releasePointer(state, 21);
  assert.equal(model.mergePointerEvent({ button: 0 }, state).button, 0);
});

test('clearing mobile input releases both modifiers and virtual mouse buttons', () => {
  const model = loadModel();
  const state = model.createState();
  model.pressModifier(state, 'ControlLeft', 31);
  model.pressButton(state, 1, 32);
  model.clear(state);
  const event = model.mergePointerEvent({ button: 0 }, state);
  assert.equal(event.ctrlKey, false);
  assert.equal(event.button, 0);
});
