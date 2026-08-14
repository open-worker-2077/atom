const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadInputConfig() {
  const dispatched = [];
  const sandbox = {
    window: { dispatchEvent(event) { dispatched.push(event); } },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    }
  };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'input-config.js'), 'utf8'),
    sandbox,
    { filename: 'input-config.js' }
  );
  return { config: sandbox.window.SpatialInputConfig, dispatched };
}

test('pointer grammar assigns use and view while middle drag exclusively owns orbit', () => {
  const { config } = loadInputConfig();
  const expected = {
    nodePrimary: 'activate',
    fieldPrimary: null,
    nodeDoublePrimary: 'activate',
    fieldDoublePrimary: null,
    nodeTriplePrimary: 'activate',
    fieldTriplePrimary: null,
    nodeSecondary: 'applyViewMode',
    fieldSecondary: 'applyParentView',
    nodeMiddle: null,
    fieldMiddle: null,
    nodeMiddleDrag: 'orbit',
    fieldMiddleDrag: 'orbit',
    fieldPrimaryDrag: null,
    wheel: 'dolly'
  };
  for (const preset of Object.values(config.presets)) {
    assert.deepEqual(
      Object.fromEntries(Object.keys(expected).map((key) => [key, preset.pointer[key]])),
      expected
    );
  }
});

test('CapsLock applies its settled key state on keyup in every ASDF view mode', () => {
  const { config } = loadInputConfig();
  for (const viewMode of ['peripheral', 'nested', 'hierarchy', 'immersive']) {
    assert.equal(config.resolveKeyboard({
      type: 'keydown',
      code: 'CapsLock',
      getModifierState() { return true; }
    }, { viewMode }), null);
    assert.equal(config.resolveKeyboard({
      type: 'keyup',
      code: 'CapsLock',
      getModifierState(name) { return name === 'CapsLock'; }
    }, { viewMode }), 'setSurfaceDetails');
    assert.equal(config.resolveKeyboard({
      type: 'keyup',
      code: 'CapsLock',
      getModifierState() { return false; }
    }, { viewMode }), 'setFloatingDetails');
  }
});

test('ctrl pointer editing remains independent from visual use gestures', () => {
  const { config } = loadInputConfig();
  const cases = [
    [{ button: 0, ctrlKey: true }, { onNode: false, gesture: 'tap' }, 'createNode'],
    [{ button: 0, ctrlKey: true }, { onNode: true, gesture: 'tap' }, 'editNode'],
    [{ button: 2, ctrlKey: true }, { onNode: true, gesture: 'tap' }, 'editEdge'],
    [{ button: 2, ctrlKey: true }, { onEdge: true, gesture: 'tap' }, 'editEdge'],
    [{ button: 2, ctrlKey: true }, { edgeDraft: true, gesture: 'tap' }, 'editEdge']
  ];
  for (const [event, context, expected] of cases) {
    assert.equal(config.resolvePointer(event, context), expected);
  }
  assert.equal(
    config.resolvePointer({ button: 2 }, { onNode: false, gesture: 'tap' }),
    'applyParentView'
  );
});

test('ASDF chooses future view mode and ZX navigates view history', () => {
  const { config } = loadInputConfig();
  const expected = {
    KeyA: 'setNestedView',
    KeyS: 'setPeripheralView',
    KeyD: 'setHierarchyView',
    KeyF: 'setImmersiveView',
    KeyZ: 'backView',
    KeyX: 'forwardView',
    Home: 'returnOverview',
    End: 'expandToLeaves',
    KeyO: 'toggleWorldLens',
    KeyH: 'toggleHelp',
    KeyP: 'toggleDemo'
  };
  for (const preset of ['explorer', 'oneHand']) {
    config.setPreset(preset);
    for (const [code, intent] of Object.entries(expected)) {
      assert.equal(config.resolveKeyboard({ code }), intent, preset + ': ' + code);
    }
    assert.equal(config.resolveKeyboard({ code: 'KeyK', ctrlKey: true }), 'search');
  }
});

test('stale keyboard shortcuts and modifier undo are unbound', () => {
  const { config } = loadInputConfig();
  const removed = ['KeyM', 'KeyB', 'KeyV', 'KeyE', 'KeyR', 'KeyC', 'KeyL', 'Space'];
  for (const code of removed) {
    assert.equal(config.resolveKeyboard({ code }), null, code);
  }
  assert.equal(config.resolveKeyboard({ code: 'KeyZ', ctrlKey: true }), null);
  assert.equal(config.resolveKeyboard({ code: 'KeyY', ctrlKey: true }), null);
  assert.equal(config.resolveKeyboard({ code: 'Enter' }), null);
  assert.equal(config.resolveKeyboard({ code: 'Escape' }), 'cancel');
});

test('editing context gives enter escape and delete transaction precedence', () => {
  const { config } = loadInputConfig();
  assert.equal(config.resolveKeyboard({ code: 'Enter' }, { editing: true }), 'confirmEdit');
  assert.equal(config.resolveKeyboard({ code: 'Escape' }, { editing: true }), 'cancelEdit');
  assert.equal(config.resolveKeyboard({ code: 'Delete' }, { editing: true }), 'deleteEdit');
  assert.equal(config.resolveKeyboard({ code: 'KeyZ' }, { editing: true }), null);
});

test('mapping descriptors remain nested and expose only current muscle-memory controls', () => {
  const { config } = loadInputConfig();
  const groups = config.describeGroups();
  assert.equal(groups.every((group) => Array.isArray(group.items) && group.items.length), true);
  const flattened = groups.flatMap((group) => group.items);
  for (const intent of [
    'setPeripheralView', 'setNestedView', 'setHierarchyView', 'setImmersiveView',
    'applyViewMode', 'applyParentView', 'setSurfaceDetails', 'setFloatingDetails',
    'backView', 'forwardView',
    'toggleHelp'
  ]) {
    assert.equal(flattened.some((item) => item.intent === intent), true, intent);
  }
  for (const removed of ['summonMenu', 'cycleViewMode', 'cycleDetailMode', 'toggleFieldChildren', 'toggleFieldSurfaces']) {
    assert.equal(flattened.some((item) => item.intent === removed), false, removed);
  }
});

test('keyboard bindings remain configurable and announce changes', () => {
  const { config, dispatched } = loadInputConfig();
  assert.equal(config.setKeyboardBinding('search', 'Ctrl+KeyP'), true);
  assert.equal(config.resolveKeyboard({ code: 'KeyP', ctrlKey: true }), 'search');
  assert.equal(dispatched.at(-1).type, 'spatial-input-config-changed');
});
