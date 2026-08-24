import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atom(name, detail = '', children = [], partners = [], types = []) {
  return {
    [`name${types.map((type) => `@${type}`).join('')}`]: name,
    detail,
    children,
    partners
  };
}

function fieldEntry(value, baseKey) {
  return Object.entries(value).find(([key]) => (
    parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}

function field(value, baseKey) {
  return fieldEntry(value, baseKey)?.[1];
}

function types(value) {
  return fieldEntry(value, 'name')?.[0]
    ? parseAtomKey(fieldEntry(value, 'name')[0], { descriptionSymbolWarnings: false })
      .types.map((type) => type.raw)
    : [];
}

function find(atoms, selector) {
  let current = { children: atoms };
  for (const segment of selector.split('/')) {
    current = field(current, 'children')?.find((candidate) => field(candidate, 'name') === segment);
    if (!current) return null;
  }
  return current;
}

function mappingOf(value) {
  return field(value, 'partners').find((partner) => partner.verb === '槽模映照')?.object;
}

function fixture() {
  const calculate = atom('计算', 'def main(arguments):\n    return arguments', [], [], ['program']);
  const model = atom('槽模', '定义', [
    atom('客户', '客户定义', [], [{ verb: '推支', object: '金额' }], ['text']),
    atom('金额', '金额定义', [], [{ verb: '计算', object: '计算' }], ['number']),
    calculate
  ]);
  const blank = atom('空槽例', '', [
    atom('客户', '', [], [{ verb: '推支', object: '金额' }], ['text']),
    atom('金额', '', [], [{ verb: '计算', object: '订单槽体/槽模/计算' }], ['number'])
  ]);
  return [atom('订单槽体', '', [model, atom('槽例', '', [blank])])];
}

test('seal validates the visible 槽体 layout and maps every non-Program槽例 node', async () => {
  const result = await applySlotBodyEffect({
    atoms: fixture(),
    effect: { action: 'seal', body: '订单槽体' }
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.receipt, {
    action: 'seal',
    body: '订单槽体',
    model: '订单槽体/槽模',
    blank: '订单槽体/槽例/空槽例',
    examples: ['订单槽体/槽例/空槽例']
  });
  assert.equal(mappingOf(find(result.atoms, '订单槽体/槽例/空槽例')), '订单槽体/槽模');
  assert.equal(mappingOf(find(result.atoms, '订单槽体/槽例/空槽例/客户')), '订单槽体/槽模/客户');
  assert.equal(mappingOf(find(result.atoms, '订单槽体/槽例/空槽例/金额')), '订单槽体/槽模/金额');
  assert.equal(find(result.atoms, '订单槽体/槽例/空槽例/计算'), null);
});

test('seal rejects incomplete or mixed layouts atomically', async () => {
  const atoms = [atom('错误槽体', '', [atom('槽模'), atom('槽模'), atom('槽例')])];
  const before = structuredClone(atoms);
  const result = await applySlotBodyEffect({ atoms, effect: { action: 'seal', body: '错误槽体' } });

  assert.equal(result.error?.code, 'INVALID_SLOT_BODY_LAYOUT');
  assert.deepEqual(atoms, before);
});

test('print creates one named nested槽例, redirects internal partners and retains shared Program links', async () => {
  const sealed = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '订单槽体' }
  });
  const printed = await applySlotBodyEffect({
    atoms: sealed.atoms,
    effect: { action: 'print', body: '订单槽体', name: '订单001' }
  });

  assert.equal(printed.error, undefined);
  assert.equal(printed.receipt.target, '订单槽体/槽例/订单001');
  const example = find(printed.atoms, '订单槽体/槽例/订单001');
  assert.ok(example);
  assert.equal(mappingOf(example), '订单槽体/槽模');
  assert.equal(field(find(printed.atoms, '订单槽体/槽例/订单001/客户'), 'partners')
    .find((partner) => partner.verb === '推支').object, '金额');
  assert.equal(field(find(printed.atoms, '订单槽体/槽例/订单001/金额'), 'partners')
    .find((partner) => partner.verb === '计算').object, '订单槽体/槽模/计算');
  assert.equal(find(printed.atoms, '订单槽体/槽例/订单001/计算'), null);
});

test('duplicate print rejects without changing the candidate world', async () => {
  const sealed = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '订单槽体' }
  });
  const first = await applySlotBodyEffect({
    atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' }
  });
  const before = structuredClone(first.atoms);
  const duplicate = await applySlotBodyEffect({
    atoms: first.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' }
  });

  assert.equal(duplicate.error?.code, 'SLOT_BODY_EXAMPLE_EXISTS');
  assert.deepEqual(first.atoms, before);
});

test('slot-body actions use copy-on-write and do not clone unrelated world subtrees', async () => {
  const unrelated = atom('无关世界', '保持原对象', [
    atom('无关节点', 'x'.repeat(4096), [atom('更深节点', '不应遍历')])
  ]);
  const atoms = [...fixture(), unrelated];
  const sealed = await applySlotBodyEffect({
    atoms, effect: { action: 'seal', body: '订单槽体' }
  });

  assert.equal(sealed.error, undefined);
  assert.equal(sealed.atoms[1], unrelated);
  assert.equal(atoms[0] === sealed.atoms[0], false);
});

test('sync adds, renames and retypes mapped slots while preserving料 detail byte-for-byte', async () => {
  const sealed = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '订单槽体' }
  });
  const printed = await applySlotBodyEffect({
    atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' }
  });
  field(find(printed.atoms, '订单槽体/槽例/订单001/客户'), 'detail');
  find(printed.atoms, '订单槽体/槽例/订单001/客户').detail = '张三🙂';

  const modelCustomer = find(printed.atoms, '订单槽体/槽模/客户');
  delete modelCustomer['name@text'];
  modelCustomer['name@text@required'] = '客户名称';
  for (const exampleName of ['空槽例', '订单001']) {
    const customer = find(printed.atoms, `订单槽体/槽例/${exampleName}/客户`);
    mappingOf(customer);
    field(customer, 'partners').find((partner) => partner.verb === '槽模映照').object = '订单槽体/槽模/客户名称';
  }
  field(find(printed.atoms, '订单槽体/槽模'), 'children').push(atom('备注', '备注定义', [], [], ['text']));

  const synced = await applySlotBodyEffect({
    atoms: printed.atoms, effect: { action: 'sync', body: '订单槽体' }
  });

  assert.equal(synced.error, undefined);
  const customer = find(synced.atoms, '订单槽体/槽例/订单001/客户名称');
  assert.equal(field(customer, 'detail'), '张三🙂');
  assert.deepEqual(types(customer), ['text', 'required']);
  assert.equal(field(find(synced.atoms, '订单槽体/槽例/订单001/备注'), 'detail'), '');
  assert.equal(mappingOf(find(synced.atoms, '订单槽体/槽例/订单001/备注')), '订单槽体/槽模/备注');
});

test('sync moves mapped slots and replaces obsolete model relations without touching local relations', async () => {
  const sealed = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '订单槽体' }
  });
  const printed = await applySlotBodyEffect({
    atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' }
  });
  for (const exampleName of ['空槽例', '订单001']) {
    field(find(printed.atoms, `订单槽体/槽例/${exampleName}/客户`), 'partners')
      .push({ verb: '本地备注', object: '外部依据' });
    field(find(printed.atoms, `订单槽体/槽例/${exampleName}/金额`), 'partners')
      .find((partner) => partner.verb === '槽模映照').object = '订单槽体/槽模/客户/金额';
  }
  const model = find(printed.atoms, '订单槽体/槽模');
  const modelChildren = field(model, 'children');
  const amountIndex = modelChildren.findIndex((child) => field(child, 'name') === '金额');
  const [amount] = modelChildren.splice(amountIndex, 1);
  const customer = find(printed.atoms, '订单槽体/槽模/客户');
  field(customer, 'children').push(amount);
  customer.partners = [{ verb: '触发', object: '金额' }];

  const synced = await applySlotBodyEffect({
    atoms: printed.atoms, effect: { action: 'sync', body: '订单槽体' }
  });

  assert.equal(synced.error, undefined);
  assert.equal(find(synced.atoms, '订单槽体/槽例/订单001/金额'), null);
  assert.ok(find(synced.atoms, '订单槽体/槽例/订单001/客户/金额'));
  const relations = field(find(synced.atoms, '订单槽体/槽例/订单001/客户'), 'partners');
  assert.equal(relations.some((partner) => partner.verb === '推支'), false);
  assert.deepEqual(relations.find((partner) => partner.verb === '触发'), {
    verb: '触发', object: '订单槽体/槽例/订单001/客户/金额'
  });
  assert.deepEqual(relations.find((partner) => partner.verb === '本地备注'), {
    verb: '本地备注', object: '外部依据'
  });

  const repeated = await applySlotBodyEffect({
    atoms: synced.atoms, effect: { action: 'sync', body: '订单槽体' }
  });
  const repeatedRelations = field(
    find(repeated.atoms, '订单槽体/槽例/订单001/客户'), 'partners'
  );
  assert.equal(repeatedRelations.filter((partner) => partner.verb === '触发').length, 1);
  assert.deepEqual(repeatedRelations, relations);
});

test('repeated sync keeps one shared Program relation and resolves it to the槽模 Program', async () => {
  const sealed = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '订单槽体' }
  });
  const once = await applySlotBodyEffect({
    atoms: sealed.atoms, effect: { action: 'sync', body: '订单槽体' }
  });
  const twice = await applySlotBodyEffect({
    atoms: once.atoms, effect: { action: 'sync', body: '订单槽体' }
  });
  const relations = field(find(twice.atoms, '订单槽体/槽例/空槽例/金额'), 'partners');
  assert.deepEqual(relations.filter((partner) => partner.verb === '计算'), [
    { verb: '计算', object: '订单槽体/槽模/计算' }
  ]);
});

test('sync rejects removal of a mapped slot carrying料 and leaves the world untouched', async () => {
  const sealed = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '订单槽体' }
  });
  const printed = await applySlotBodyEffect({
    atoms: sealed.atoms, effect: { action: 'print', body: '订单槽体', name: '订单001' }
  });
  find(printed.atoms, '订单槽体/槽例/订单001/金额').detail = '100';
  const modelChildren = field(find(printed.atoms, '订单槽体/槽模'), 'children');
  modelChildren.splice(modelChildren.findIndex((child) => field(child, 'name') === '金额'), 1);
  const before = structuredClone(printed.atoms);

  const synced = await applySlotBodyEffect({
    atoms: printed.atoms, effect: { action: 'sync', body: '订单槽体' }
  });

  assert.equal(synced.error?.code, 'SLOT_BODY_SYNC_CONFLICT');
  assert.match(synced.error?.message ?? '', /订单001\/金额/u);
  assert.deepEqual(printed.atoms, before);
});
