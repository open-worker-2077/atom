import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atom(thing, situation = '', slot = [], strut = [], types = [], description = null) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}${description == null ? '' : `#${description}`}`]: thing,
    situation, slot, strut
  };
}
function entry(value, baseKey) {
  return Object.entries(value ?? {}).find(([key]) => (
    parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}
const field = (value, baseKey) => entry(value, baseKey)?.[1];
const thingOf = (value) => field(value, 'thing');
const typesOf = (value) => entry(value, 'thing')[0].split('@').slice(1).map((value) => value.split('#')[0]);
function find(atoms, selector) {
  let slot = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = slot.find((candidate) => thingOf(candidate) === segment);
    if (!current) return null;
    slot = field(current, 'slot') ?? [];
  }
  return current;
}
function fixture() {
  return [atom('订单槽体', '', [atom('订单候选流', '订单槽模契约', [
    atom('客户', '客户槽契约', [
      atom('地址', '地址槽契约', [atom('城市', '城市槽契约', [], [], ['text'], '城市说明')])
    ], [{ 'if@current': true, then: [{ thing: '金额' }] }], ['text'], '客户说明'),
    atom('金额', '金额槽契约', [], [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: '结果' }]
    }], ['number']),
    atom('结果', '结果槽契约'),
    atom('备选客户', '备选槽契约'),
    atom('审核枢纽', '审核契约', [], [{
      if: [{ and: [{ thing: '客户' }, { thing: '备选客户' }] }],
      'then@current': true
    }])
  ], [], ['dataflow'], '普通候选槽模')])];
}
function planOf(atoms) {
  const records = field(find(atoms, '订单槽体/print/修订'), 'slot');
  return JSON.parse(field(records.at(-1), 'situation'));
}
const seal = (atoms = fixture(), effect = { action: 'seal', body: '订单槽体' }) => (
  applySlotBodyEffect({ atoms, effect, sourceProgramPath: 'Root/槽体注册程序' })
);
const print = (atoms, thing, revision = planOf(atoms).revision) => applySlotBodyEffect({
  atoms,
  effect: { action: 'print', body: '订单槽体', name: thing, revision },
  sourceProgramPath: '订单槽体/print'
});

test('seal creates model, visible print plan and empty example container without a physical blank', async () => {
  const result = await seal();
  assert.equal(result.error, undefined);
  assert.deepEqual(field(find(result.atoms, '订单槽体'), 'slot').map(thingOf), ['槽模', 'print', '槽例']);
  assert.ok(typesOf(find(result.atoms, '订单槽体/print')).includes('program'));
  assert.deepEqual(field(find(result.atoms, '订单槽体/槽例'), 'slot'), []);
  assert.equal(find(result.atoms, '订单槽体/槽例/空槽例'), null);
  assert.equal(find(result.atoms, '订单槽体/槽模/共享计算'), null);
});

test('seal stores a deterministic complete owner-local strut AST and no default material', async () => {
  const once = await seal();
  const plan = planOf(once.atoms);
  assert.match(plan.revision, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(plan).includes('default_detail'), false);
  assert.equal(JSON.stringify(plan).includes('source_role_id'), false);
  assert.equal(JSON.stringify(plan).includes('target_role_id'), false);
  const customer = plan.roles.find((role) => role.path === './客户');
  const amount = plan.roles.find((role) => role.path === './金额');
  const alternate = plan.roles.find((role) => role.path === './备选客户');
  const hub = plan.roles.find((role) => role.path === './审核枢纽');
  const result = plan.roles.find((role) => role.path === './结果');
  assert.deepEqual(plan.strut.find((item) => item.owner_role_id === customer.role_id).rule, {
    'if@current': true, then: [{ thing: amount.role_id }]
  });
  assert.deepEqual(plan.strut.find((item) => item.owner_role_id === hub.role_id).rule, {
    if: [{ and: [{ thing: customer.role_id }, { thing: alternate.role_id }] }], 'then@current': true
  });
  assert.deepEqual(plan.strut.find((item) => item.owner_role_id === amount.role_id).rule, {
    'if@current': true,
    if: [{ program: 'def main(context):\n    return True' }],
    then: [{ thing: result.role_id }]
  });
  const repeated = await seal(once.atoms);
  assert.equal(planOf(repeated.atoms).revision, plan.revision);
  assert.equal(field(find(repeated.atoms, '订单槽体/print/修订'), 'slot').length, 1);
});

test('print rewrites complete strut AST to the current instance and preserves inline Program', async () => {
  const sealed = await seal();
  const printed = await print(sealed.atoms, '订单001');
  assert.equal(printed.error, undefined);
  assert.equal(find(printed.atoms, '订单槽体/槽例/订单001/共享计算'), null);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/客户'), 'strut'), [{
    'if@current': true, then: [{ thing: '订单槽体/槽例/订单001/金额' }]
  }]);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/审核枢纽'), 'strut'), [{
    if: [{ and: [
      { thing: '订单槽体/槽例/订单001/客户' },
      { thing: '订单槽体/槽例/订单001/备选客户' }
    ] }],
    'then@current': true
  }]);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/金额'), 'strut'), [{
    'if@current': true,
    if: [{ program: 'def main(context):\n    return True' }],
    then: [{ thing: '订单槽体/槽例/订单001/结果' }]
  }]);
});

test('current print Program binds its visible revision when the internal effect carries only the instance name', async () => {
  const sealed = await seal();
  const currentRevision = planOf(sealed.atoms).revision;

  const printed = await applySlotBodyEffect({
    atoms: sealed.atoms,
    effect: { action: 'print', body: '订单槽体', name: '订单001' },
    sourceProgramPath: '订单槽体/print'
  });

  assert.equal(printed.error, undefined, JSON.stringify(printed.error));
  assert.equal(printed.receipt.revision, currentRevision);
  assert.ok(find(printed.atoms, '订单槽体/槽例/订单001'));
});

test('print rejects duplicate, stale revision and forged caller atomically', async () => {
  const sealed = await seal();
  const first = await print(sealed.atoms, '订单001');
  const before = structuredClone(first.atoms);
  assert.equal((await print(first.atoms, '订单001')).error?.code, 'SLOT_BODY_EXAMPLE_EXISTS');
  assert.equal((await print(first.atoms, '订单002', `sha256:${'0'.repeat(64)}`)).error?.code, 'SLOT_PRINT_PLAN_STALE');
  const forged = await applySlotBodyEffect({
    atoms: first.atoms,
    effect: { action: 'print', body: '订单槽体', name: '订单002', revision: planOf(first.atoms).revision },
    sourceProgramPath: 'Root/伪造程序'
  });
  assert.equal(forged.error?.code, 'INVALID_SLOT_PRINT_PLAN');
  assert.deepEqual(first.atoms, before);
});

test('seal rejects the retired physical blank-example layout', async () => {
  const legacy = [atom('旧槽体', '', [
    atom('槽模', '', [atom('字段')]), atom('槽例', '', [atom('空槽例', '', [atom('字段')])])
  ])];
  const before = structuredClone(legacy);
  const result = await applySlotBodyEffect({ atoms: legacy, effect: { action: 'seal', body: '旧槽体' } });
  assert.equal(result.error?.code, 'INVALID_SLOT_BODY_LAYOUT');
  assert.deepEqual(legacy, before);
});

test('seal and print preserve one shared Program as the strut receiver', async () => {
  const candidate = [atom('接收槽体', '', [atom('候选流', '', [
    atom('事实', '', [], [{ 'if@current': true, then: [{ 'thing@program': '判定' }] }]),
    atom('判定', 'trigger("strut", {}, main)\ndef main(delivery):\n    pass', [], [], ['program'])
  ])])];

  const sealed = await applySlotBodyEffect({
    atoms: candidate,
    effect: { action: 'seal', body: '接收槽体' },
    sourceProgramPath: '注册'
  });
  assert.equal(sealed.error, undefined, JSON.stringify(sealed.error));
  const revisionRecords = field(find(sealed.atoms, '接收槽体/print/修订'), 'slot');
  const plan = JSON.parse(field(revisionRecords.at(-1), 'situation'));
  const receiver = plan.roles.find((role) => role.path === './判定');
  const source = plan.roles.find((role) => role.path === './事实');
  assert.equal(receiver.kind, 'program');
  assert.deepEqual(plan.strut.find((entry) => entry.owner_role_id === source.role_id).rule, {
    'if@current': true,
    then: [{ 'thing@program': receiver.role_id }]
  });

  const printed = await applySlotBodyEffect({
    atoms: sealed.atoms,
    effect: { action: 'print', body: '接收槽体', name: '实例001', revision: plan.revision },
    sourceProgramPath: '接收槽体/print'
  });
  assert.equal(printed.error, undefined, JSON.stringify(printed.error));
  assert.equal(find(printed.atoms, '接收槽体/槽例/实例001/判定'), null);
  assert.ok(typesOf(find(printed.atoms, '接收槽体/槽模/判定')).includes('program'));
  assert.deepEqual(field(find(printed.atoms, '接收槽体/槽例/实例001/事实'), 'strut'), [{
    'if@current': true,
    then: [{ 'thing@program': '接收槽体/槽模/判定' }]
  }]);
});
