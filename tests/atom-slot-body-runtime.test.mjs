import assert from 'node:assert/strict';
import test from 'node:test';
import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

const atom = (thing, situation = '', contain = [], support = [], types = []) => ({
  [`thing${types.map((type) => `@${type}`).join('')}`]: thing, situation, contain, support
});
const field = (value, baseKey) => Object.entries(value ?? {}).find(([key]) => (
  parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey
))?.[1];
function find(atoms, selector) {
  let children = atoms; let current = null;
  for (const segment of selector.split('/')) {
    current = children.find((candidate) => field(candidate, 'thing') === segment);
    if (!current) return null;
    children = field(current, 'contain') ?? [];
  }
  return current;
}
function fixture() {
  return [atom('订单槽体', '', [
    atom('槽模', '定义', [
      atom('客户', '客户定义', [], [{ thing: '金额' }], ['text']),
      atom('金额', '金额定义', [], [{ thing: '订单槽体/槽模/计算' }], ['number']),
      atom('计算', 'def main(arguments):\n    return arguments', [], [], ['program'])
    ]),
    atom('槽例', '', [atom('空槽例', '', [
      atom('客户', '', [], [{ thing: '金额' }], ['text']),
      atom('金额', '', [], [{ thing: '订单槽体/槽模/计算' }], ['number'])
    ])])
  ])];
}

test('seal validates relative contain paths without hidden mapping relations', async () => {
  const result = await applySlotBodyEffect({ atoms: fixture(), effect: { action: 'seal', body: '订单槽体' } });
  assert.equal(result.error, undefined);
  assert.equal(JSON.stringify(result.atoms).includes('槽模映照'), false);
});

test('seal rejects incomplete layouts atomically', async () => {
  const atoms = [atom('错误槽体', '', [atom('槽模'), atom('槽模'), atom('槽例')])];
  const before = structuredClone(atoms);
  const result = await applySlotBodyEffect({ atoms, effect: { action: 'seal', body: '错误槽体' } });
  assert.equal(result.error?.code, 'INVALID_SLOT_BODY_LAYOUT');
  assert.deepEqual(atoms, before);
});

test('print preserves ordered object-array support and omits Program nodes', async () => {
  const sealed = await applySlotBodyEffect({ atoms: fixture(), effect: { action: 'seal', body: '订单槽体' } });
  const printed = await applySlotBodyEffect({ atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' } });
  assert.equal(printed.error, undefined);
  assert.equal(find(printed.atoms, '订单槽体/槽例/订单001/计算'), null);
  assert.deepEqual(field(find(printed.atoms, '订单槽体/槽例/订单001/客户'), 'support'), [{ thing: '金额' }]);
});

test('duplicate print rejects without changing the candidate world', async () => {
  const sealed = await applySlotBodyEffect({ atoms: fixture(), effect: { action: 'seal', body: '订单槽体' } });
  const first = await applySlotBodyEffect({ atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' } });
  const before = structuredClone(first.atoms);
  const duplicate = await applySlotBodyEffect({ atoms: first.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' } });
  assert.equal(duplicate.error?.code, 'SLOT_BODY_EXAMPLE_EXISTS');
  assert.deepEqual(first.atoms, before);
});

test('sync adds and retypes relative slots while preserving material situation bytes', async () => {
  const sealed = await applySlotBodyEffect({ atoms: fixture(), effect: { action: 'seal', body: '订单槽体' } });
  const printed = await applySlotBodyEffect({ atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' } });
  find(printed.atoms, '订单槽体/槽例/订单001/客户').situation = '张三🙂';
  const modelCustomer = find(printed.atoms, '订单槽体/槽模/客户');
  delete modelCustomer['thing@text']; modelCustomer['thing@text@required'] = '客户';
  field(find(printed.atoms, '订单槽体/槽模'), 'contain').push(atom('备注', '定义'));
  const synced = await applySlotBodyEffect({ atoms: printed.atoms, effect: { action: 'sync', body: '订单槽体' } });
  assert.equal(synced.error, undefined);
  assert.equal(find(synced.atoms, '订单槽体/槽例/订单001/客户').situation, '张三🙂');
  assert.ok(find(synced.atoms, '订单槽体/槽例/订单001/备注'));
});

test('sync translates model support to example paths and remains idempotent', async () => {
  const sealed = await applySlotBodyEffect({ atoms: fixture(), effect: { action: 'seal', body: '订单槽体' } });
  const printed = await applySlotBodyEffect({ atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' } });
  const once = await applySlotBodyEffect({ atoms: printed.atoms, effect: { action: 'sync', body: '订单槽体' } });
  const twice = await applySlotBodyEffect({ atoms: once.atoms, effect: { action: 'sync', body: '订单槽体' } });
  assert.deepEqual(field(find(twice.atoms, '订单槽体/槽例/订单001/客户'), 'support'), [
    { thing: '订单槽体/槽例/订单001/金额' }
  ]);
});

test('sync rejects removal of a relative material slot and leaves the world untouched', async () => {
  const sealed = await applySlotBodyEffect({ atoms: fixture(), effect: { action: 'seal', body: '订单槽体' } });
  const printed = await applySlotBodyEffect({ atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' } });
  find(printed.atoms, '订单槽体/槽例/订单001/金额').situation = '100';
  const model = field(find(printed.atoms, '订单槽体/槽模'), 'contain');
  model.splice(model.findIndex((child) => field(child, 'thing') === '金额'), 1);
  const before = structuredClone(printed.atoms);
  const synced = await applySlotBodyEffect({ atoms: printed.atoms, effect: { action: 'sync', body: '订单槽体' } });
  assert.equal(synced.error?.code, 'SLOT_BODY_SYNC_CONFLICT');
  assert.deepEqual(printed.atoms, before);
});
