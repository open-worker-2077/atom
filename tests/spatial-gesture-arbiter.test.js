const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyTap,
  createPrimaryClickArbiter,
  createSecondaryClickArbiter
} = require('../spatial-gesture-arbiter.js');

test('classifies a node focus tap and ignores a stationary orbit candidate', () => {
  const node = { id: 'node-1' };

  const action = classifyTap({ intent: 'focus', node });

  assert.deepEqual(action, { intent: 'focus', visualMeta: {}, target: node });
  assert.equal(Object.isFrozen(action), true);
  assert.equal(Object.isFrozen(action.visualMeta), true);
  assert.equal(classifyTap({ intent: 'orbit', node: null }), null);
});

test('classifies a blank field surface toggle without a target', () => {
  assert.deepEqual(
    classifyTap({ intent: 'toggleFieldSurfaces', node: null }),
    { intent: 'toggleFieldSurfaces', visualMeta: {}, target: null }
  );
});

test('classifies a blank child-domain parent action without a target', () => {
  assert.deepEqual(
    classifyTap({ intent: 'applyParentView', node: null, visualMeta: { domainContext: { path: 'root/a' } } }),
    { intent: 'applyParentView', visualMeta: { domainContext: { path: 'root/a' } }, target: null }
  );
});

test('preserves a direct action ahead of a mapped action', () => {
  const node = { id: 'node-2' };
  const directTarget = { id: 'command-target' };
  const action = classifyTap({
    intent: 'focus',
    node,
    direct: {
      intent: 'exitToDepth',
      visualMeta: { targetDepth: 1 },
      target: directTarget
    }
  });

  assert.deepEqual(action, {
    intent: 'exitToDepth',
    visualMeta: { targetDepth: 1 },
    target: directTarget
  });
  assert.equal(Object.isFrozen(action.visualMeta), true);
});

test('defer schedules one commit and replaces a pending single click', () => {
  const timers = new Map();
  const cleared = [];
  const committed = [];
  let nextTimer = 1;
  const arbiter = createPrimaryClickArbiter({
    delay: 240,
    setTimer(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      timers.delete(id);
    },
    commit(action) {
      committed.push(action);
    }
  });

  arbiter.defer({ intent: 'focus', target: { id: 'first' } });
  assert.equal(arbiter.pending, true);
  assert.equal(timers.get(1).delay, 240);

  const second = { intent: 'focus', target: { id: 'second' } };
  arbiter.defer(second);
  assert.deepEqual(cleared, [1]);
  assert.equal(timers.size, 1);

  timers.get(2).callback();
  assert.deepEqual(committed, [second]);
  assert.equal(arbiter.pending, false);
});

test('defer arbitrates a non-focus primary action without inspecting its intent', () => {
  let scheduled = null;
  const committed = [];
  const action = { intent: 'peek', target: { id: 'node-peek' } };
  const arbiter = createPrimaryClickArbiter({
    setTimer(callback) {
      scheduled = callback;
      return 1;
    },
    clearTimer() {},
    commit(value) {
      committed.push(value);
    }
  });

  arbiter.defer(action);
  assert.deepEqual(committed, []);

  scheduled();
  assert.deepEqual(committed, [action]);
});

test('cancel prevents a pending commit and clears pending state', () => {
  const timers = new Map();
  const committed = [];
  let nextTimer = 1;
  const arbiter = createPrimaryClickArbiter({
    setTimer(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commit(action) {
      committed.push(action);
    }
  });

  arbiter.defer({ intent: 'focus' });
  const callback = timers.get(1);
  arbiter.cancel();

  assert.equal(arbiter.pending, false);
  assert.equal(timers.size, 0);
  callback();
  assert.deepEqual(committed, []);
});

test('primary arbiter resolves one, two, and three clicks as one final action', () => {
  const timers = new Map();
  const committed = [];
  let nextTimer = 1;
  const arbiter = createPrimaryClickArbiter({
    delay: 280,
    setTimer(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commit(action) {
      committed.push(action);
    }
  });
  const node = { id: 'node-series' };
  const single = { intent: 'focus', visualMeta: { confirmationCount: 1 }, target: node };
  const double = { intent: 'activate', visualMeta: { confirmationCount: 2 }, target: node };
  const triple = { intent: 'activate', visualMeta: { confirmationCount: 3 }, target: node };

  assert.equal(arbiter.submit(single, double, triple, 'node:series'), 'pending:1');
  assert.equal(timers.get(1).delay, 280);
  assert.equal(arbiter.submit(single, double, triple, 'node:series'), 'pending:2');
  assert.deepEqual(committed, []);
  assert.equal(arbiter.submit(single, double, triple, 'node:series'), 'triple');
  assert.deepEqual(committed, [triple]);
  assert.equal(timers.size, 0);
  assert.equal(arbiter.pending, false);
});

test('primary arbiter commits the pending click count after its window', () => {
  const timers = new Map();
  const committed = [];
  let nextTimer = 1;
  const arbiter = createPrimaryClickArbiter({
    setTimer(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commit(action) {
      committed.push(action);
    }
  });
  const single = { intent: 'focus', visualMeta: { confirmationCount: 1 } };
  const double = { intent: 'activate', visualMeta: { confirmationCount: 2 } };

  arbiter.submit(single, double, null, 'field');
  timers.get(1)();
  assert.deepEqual(committed, [single]);

  arbiter.submit(single, double, null, 'field');
  arbiter.submit(single, double, null, 'field');
  timers.get(3)();
  assert.deepEqual(committed, [single, double]);
});

test('primary arbiter settles a different target before starting a new series', () => {
  const timers = new Map();
  const committed = [];
  let nextTimer = 1;
  const arbiter = createPrimaryClickArbiter({
    setTimer(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commit(action) {
      committed.push(action);
    }
  });
  const firstSingle = { intent: 'focus', target: { id: 'first' } };
  const secondSingle = { intent: 'focus', target: { id: 'second' } };

  arbiter.submit(firstSingle, null, null, 'node:first');
  arbiter.submit(secondSingle, null, null, 'node:second');

  assert.deepEqual(committed, [firstSingle]);
  assert.equal(arbiter.pendingCount, 1);
  timers.get(2)();
  assert.deepEqual(committed, [firstSingle, secondSingle]);
});

test('secondary arbiter turns two same-target taps into one double action', () => {
  const timers = new Map();
  const singles = [];
  const doubles = [];
  let nextTimer = 1;
  const arbiter = createSecondaryClickArbiter({
    delay: 240,
    setTimer(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commitSingle(action) {
      singles.push(action);
    },
    commitDouble(action) {
      doubles.push(action);
    }
  });
  const single = { intent: 'toggleChildren', target: { id: 'tunnel' } };
  const double = { intent: 'enter', target: single.target };

  assert.equal(arbiter.submit(single, double, 'node:tunnel'), 'pending');
  assert.equal(timers.get(1).delay, 240);
  assert.equal(arbiter.submit(single, double, 'node:tunnel'), 'double');
  assert.deepEqual(singles, []);
  assert.deepEqual(doubles, [double]);
  assert.equal(timers.size, 0);
  assert.equal(arbiter.pending, false);
});

test('secondary arbiter commits a different pending target before scheduling the next', () => {
  const timers = new Map();
  const singles = [];
  let nextTimer = 1;
  const arbiter = createSecondaryClickArbiter({
    setTimer(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commitSingle(action) {
      singles.push(action);
    },
    commitDouble() {}
  });
  const first = { intent: 'toggleChildren', target: { id: 'first' } };
  const second = { intent: 'toggleChildren', target: { id: 'second' } };

  arbiter.submit(first, { intent: 'enter', target: first.target }, 'node:first');
  arbiter.submit(second, { intent: 'enter', target: second.target }, 'node:second');
  assert.deepEqual(singles, [first]);
  assert.equal(timers.size, 1);

  timers.get(2)();
  assert.deepEqual(singles, [first, second]);
  assert.equal(arbiter.pending, false);
});

test('secondary arbiter cancel prevents the pending single action', () => {
  const timers = new Map();
  const singles = [];
  const arbiter = createSecondaryClickArbiter({
    setTimer(callback) {
      timers.set(1, callback);
      return 1;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    commitSingle(action) {
      singles.push(action);
    },
    commitDouble() {}
  });

  arbiter.submit({ intent: 'toggleFieldChildren' }, { intent: 'exit' }, 'field');
  const callback = timers.get(1);
  arbiter.cancel();
  callback();
  assert.deepEqual(singles, []);
  assert.equal(arbiter.pending, false);
});

test('ignores cancelled and malformed candidates', () => {
  assert.equal(classifyTap(null), null);
  assert.equal(classifyTap({}), null);
  assert.equal(classifyTap({ cancelled: true, intent: 'focus', node: { id: 'node-3' } }), null);
  assert.equal(classifyTap({ intent: '', node: { id: 'node-4' } }), null);
  assert.equal(classifyTap({ intent: 'focus', node: null }), null);
  assert.equal(classifyTap({ intent: 'grab', node: { id: 'node-5' } }), null);
  assert.equal(classifyTap({ intent: 'release', node: { id: 'node-6' } }), null);
  assert.equal(classifyTap({ direct: { intent: '' }, intent: 'focus', node: { id: 'node-7' } }), null);
});
