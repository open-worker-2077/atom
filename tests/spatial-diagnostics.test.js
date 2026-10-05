const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiagnostics } = require('../spatial-diagnostics.js');

test('bursts remain bounded and persist in one scheduled batch without private fields', () => {
  const scheduled = [], writes = [];
  const logger = createDiagnostics({ capacity: 8, schedule: fn => scheduled.push(fn), storage: { getItem: () => null, setItem: (k,v) => writes.push(v) } });
  for (let i=0;i<100;i++) logger.record('navigation', { depth:i, path:'root/opaque', detail:'private body', token:'secret', camera:{ distance:i, target:{x:1,y:2,z:3} } });
  assert.equal(logger.snapshot().events.length,8);
  assert.equal(logger.snapshot().dropped,92);
  assert.equal(scheduled.length,1);
  assert.equal(writes.length,0);
  scheduled.shift()();
  assert.equal(writes.length,1);
  assert.doesNotMatch(logger.export(), /private body|secret|detail|token/);
  assert.equal(logger.snapshot().events.at(-1).depth,99);
});
test('bad storage and quota failure never escape into interaction and memory remains exportable', () => {
  const logger = createDiagnostics({ schedule: fn => fn(), storage:{ getItem:()=>'{broken', setItem:()=>{throw Error('quota');} } });
  assert.doesNotThrow(()=>logger.record('camera-settled',{distance:3}));
  assert.equal(JSON.parse(logger.export()).events.length,1);
});
test('restored events are bounded and sanitized rather than trusting old browser storage', () => {
  const logger = createDiagnostics({ capacity:2, storage:{getItem:()=>JSON.stringify({events:Array.from({length:10},()=>({event:'scope',detail:'body',path:'root/opaque'}))})} });
  assert.equal(logger.snapshot().events.length,2);
  assert.doesNotMatch(logger.export(), /body|detail/);
});

test('large geometry records have a byte limit as well as an event limit', () => {
  const logger=createDiagnostics({capacity:256,schedule:()=>{}});
  for(let i=0;i<300;i++) logger.record('scene-built',{clusters:Array.from({length:16},()=>({path:'x'.repeat(160),target:{x:1,y:2,z:3},radius:3}))});
  assert.ok(logger.export().length < 160000);
  assert.ok(logger.snapshot().dropped > 0);
});
