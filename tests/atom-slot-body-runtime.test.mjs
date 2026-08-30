import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atom(thing, situation = '', contain = [], support = [], types = [], description = null) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}${description == null ? '' : `#${description}`}`]: thing,
    situation, contain, support
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
  let contain = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = contain.find((candidate) => thingOf(candidate) === segment);
    if (!current) return null;
    contain = field(current, 'contain') ?? [];
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
      if: [{ 'thing@program': '共享计算' }],
      then: [{ thing: '结果' }]
    }], ['number']),
    atom('结果', '结果槽契约'),
    atom('备选客户', '备选槽契约'),
    atom('审核枢纽', '审核契约', [], [{
      if: [{ and: [{ thing: '客户' }, { thing: '备选客户' }] }],
      'then@current': true
    }]),
    atom('共享计算', 'def main(arguments):\n    return True', [], [], ['program'], '共享源码')
  ], [], ['dataflow'], '普通候选槽模')])];
}
function planOf(atoms) {
  const records = field(find(atoms, '订单槽体/print/修订'), 'contain');
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
  assert.deepEqual(field(find(result.atoms, '订单槽体'), 'contain').map(thingOf), ['槽模', 'print', '槽例']);
  assert.ok(typesOf(find(result.atoms, '订单槽体/print')).includes('program'));
  assert.deepEqual(field(find(result.atoms, '订单槽体/槽例'), 'contain'), []);
  assert.equal(find(result.atoms, '订单槽体/槽例/空槽例'), null);
  assert.match(field(find(result.atoms, '订单槽体/槽模/共享计算'), 'situation'), /def main/u);
});

test('seal stores a deterministic complete owner-local support AST and no default material', async () => {
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
  const decision = plan.roles.find((role) => role.path === './共享计算');
  assert.deepEqual(plan.support.find((item) => item.owner_role_id === customer.role_id).rule, {
    'if@current': true, then: [{ thing: amount.role_id }]
  });
  assert.deepEqual(plan.support.find((item) => item.owner_role_id === hub.role_id).rule, {
    if: [{ and: [{ thing: customer.role_id }, { thing: alternate.role_id }] }], 'then@current': true
  });
  assert.deepEqual(plan.support.find((item) => item.owner_role_id === amount.role_id).rule, {
    'if@current': true,
    if: [{ 'thing@program': decision.role_id }],
    then: [{ thing: result.role_id }]
  });
  const repeated = await seal(once.atoms);
  assert.equal(planOf(repeated.atoms).revision, plan.revision);
  assert.equal(field(find(repeated.atoms, '订单槽体/print/修订'), 'contain').length, 1);
});

test('print rewrites complete support AST to the current instance and shares model Program', async () => {
  const sealed = await seal();
  const printed = await print(sealed.atoms, '订单001');
  assert.equal(printed.error, undefined);
  assert.equal(find(printed.atoms, '订单槽体/槽例/订单001/共享计算'), null);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/客户'), 'support'), [{
    'if@current': true, then: [{ thing: '订单槽体/槽例/订单001/金额' }]
  }]);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/审核枢纽'), 'support'), [{
    if: [{ and: [
      { thing: '订单槽体/槽例/订单001/客户' },
      { thing: '订单槽体/槽例/订单001/备选客户' }
    ] }],
    'then@current': true
  }]);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/金额'), 'support'), [{
    'if@current': true,
    if: [{ 'thing@program': '订单槽体/槽模/共享计算' }],
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

test('seal rejects a Program used as a support consequent fact', async () => {
  const invalid = [atom('非法槽体', '', [atom('候选流', '', [
    atom('事实', '', [], [{ 'if@current': true, then: [{ 'thing@program': '判定' }] }]),
    atom('判定', 'def main(arguments):\n    return True', [], [], ['program'])
  ])])];
  const before = structuredClone(invalid);

  const result = await applySlotBodyEffect({
    atoms: invalid,
    effect: { action: 'seal', body: '非法槽体' },
    sourceProgramPath: '注册'
  });

  assert.equal(result.error?.code, 'INVALID_SLOT_PRINT_PLAN');
  assert.equal(result.error?.details?.causeCode, 'SUPPORT_FACT_CONSEQUENT_REQUIRED');
  assert.deepEqual(invalid, before);
});
