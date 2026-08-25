import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atom(name, detail = '', children = [], partners = [], types = [], description = null) {
  return {
    [`name${types.map((type) => `@${type}`).join('')}${description == null ? '' : `#${description}`}`]: name,
    detail,
    children,
    partners
  };
}

function entry(value, baseKey) {
  return Object.entries(value).find(([key]) => (
    parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}

function field(value, baseKey) { return entry(value, baseKey)?.[1]; }
function nameOf(value) { return field(value, 'name'); }
function find(atoms, selector) {
  let current = { children: atoms };
  for (const segment of selector.split('/')) {
    current = field(current, 'children')?.find((candidate) => nameOf(candidate) === segment);
    if (!current) return null;
  }
  return current;
}
function setField(value, baseKey, next) {
  const [key] = entry(value, baseKey);
  value[key] = next;
}
function revision(atoms) {
  const records = field(find(atoms, '表单槽体/print/修订'), 'children');
  return JSON.parse(field(records.at(-1), 'detail')).revision;
}
function adopted(value) {
  return field(value, 'partners').find((item) => item.verb === '采用槽模修订')?.object;
}

function fixture() {
  return [atom('表单槽体', '', [atom('候选表单', '表单契约', [
    atom('姓名', '姓名槽契约', [], [{ verb: '驱动', object: '计算' }], ['text'], '旧说明'),
    atom('空备注', '备注槽契约'),
    atom('分组', '分组槽契约', [atom('城市', '城市槽契约')]),
    atom('计算', 'def main(arguments):\n    return arguments', [], [], ['program'])
  ])])];
}

async function seal(atoms, extra = {}, options = {}) {
  return applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '表单槽体', ...extra },
    sourceProgramPath: '注册',
    ...options
  });
}

async function print(atoms, name) {
  return applySlotBodyEffect({
    atoms,
    effect: { action: 'print', body: '表单槽体', name, revision: revision(atoms) },
    sourceProgramPath: '表单槽体/print'
  });
}

async function twoInstances() {
  let result = await seal(fixture());
  result = await print(result.atoms, '甲');
  result = await print(result.atoms, '乙');
  return result.atoms;
}

function addNestedMaterial(atoms, instanceName, text) {
  const slotPath = `表单槽体/槽例/${instanceName}/姓名`;
  const material = atom(`${instanceName}料`, text, [
    atom('料明细', `${text}\r\n\u0000尾`, [], [
      { verb: '料内support', object: `${slotPath}/${instanceName}料` }
    ], ['material-leaf'], '料节点说明')
  ], [{ verb: '料根support', object: `${slotPath}/${instanceName}料/料明细` }], ['material'], '料根说明');
  field(find(atoms, slotPath), 'children').push(material);
  return material;
}

test('re-seal updates every mapped slot while preserving two nested material subtrees byte-for-byte', async () => {
  const atoms = await twoInstances();
  const materialA = addNestedMaterial(atoms, '甲', '甲值');
  const materialB = addNestedMaterial(atoms, '乙', '乙值');
  const beforeA = JSON.stringify(materialA);
  const beforeB = JSON.stringify(materialB);

  const model = find(atoms, '表单槽体/槽模');
  const name = find(atoms, '表单槽体/槽模/姓名');
  const group = find(atoms, '表单槽体/槽模/分组');
  field(model, 'children').splice(field(model, 'children').indexOf(name), 1);
  setField(name, 'name', '联系人');
  const nameKey = entry(name, 'name')[0];
  delete name[nameKey];
  name['name@rich#新说明'] = '联系人';
  setField(name, 'detail', '联系人新契约');
  field(group, 'children').push(name);
  field(model, 'children').push(atom('新增槽', '新增槽契约', [], [{ verb: '补充', object: '计算' }], ['new']));

  const result = await seal(atoms);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.receipt.processed, ['甲', '乙']);
  assert.equal(result.receipt.complete, true);
  assert.equal(Object.hasOwn(result.receipt, 'next_cursor'), false);
  for (const instanceName of ['甲', '乙']) {
    assert.equal(find(result.atoms, `表单槽体/槽例/${instanceName}/姓名`), null);
    const moved = find(result.atoms, `表单槽体/槽例/${instanceName}/分组/联系人`);
    assert.equal(field(moved, 'detail'), '联系人新契约');
    assert.match(entry(moved, 'name')[0], /^name@rich#新说明$/u);
    assert.equal(field(find(result.atoms, `表单槽体/槽例/${instanceName}/新增槽`), 'detail'), '新增槽契约');
    assert.match(adopted(find(result.atoms, `表单槽体/槽例/${instanceName}`)), new RegExp(`${result.receipt.revision}$`, 'u'));
  }
  assert.equal(
    JSON.stringify(find(result.atoms, '表单槽体/槽例/甲/分组/联系人/甲料')),
    beforeA
  );
  assert.equal(
    JSON.stringify(find(result.atoms, '表单槽体/槽例/乙/分组/联系人/乙料')),
    beforeB
  );
});

test('re-seal deletes an empty mapped slot from every instance', async () => {
  const atoms = await twoInstances();
  const modelChildren = field(find(atoms, '表单槽体/槽模'), 'children');
  modelChildren.splice(modelChildren.findIndex((item) => nameOf(item) === '空备注'), 1);

  const result = await seal(atoms);

  assert.equal(result.error, undefined);
  assert.equal(find(result.atoms, '表单槽体/槽例/甲/空备注'), null);
  assert.equal(find(result.atoms, '表单槽体/槽例/乙/空备注'), null);
});

test('deleting a mapped slot containing local material reports exact paths and rolls back the whole seal', async () => {
  const atoms = await twoInstances();
  addNestedMaterial(atoms, '乙', '不得丢失');
  const modelChildren = field(find(atoms, '表单槽体/槽模'), 'children');
  modelChildren.splice(modelChildren.findIndex((item) => nameOf(item) === '姓名'), 1);
  const before = structuredClone(atoms);

  const result = await seal(atoms, {}, { mutateInput: true });

  assert.equal(result.error?.code, 'SLOT_MATERIAL_CONTAINMENT_CONFLICT');
  assert.equal(result.error?.details.instance, '表单槽体/槽例/乙');
  assert.equal(result.error?.details.slot, '表单槽体/槽例/乙/姓名');
  assert.equal(result.error?.details.material, '表单槽体/槽例/乙/姓名/乙料');
  assert.deepEqual(atoms, before);
});

test('seal rejects removed batch inputs and never returns continuation fields', async () => {
  const atoms = await twoInstances();
  const before = structuredClone(atoms);

  const limited = await seal(atoms, { limit: 1 });
  assert.equal(limited.error?.code, 'INVALID_SLOT_BODY_EFFECT');
  assert.deepEqual(atoms, before);

  const cursor = await seal(atoms, { cursor: 'retired' });
  assert.equal(cursor.error?.code, 'INVALID_SLOT_BODY_EFFECT');
  assert.deepEqual(atoms, before);

  const ordinary = await seal(atoms);
  assert.equal(ordinary.error, undefined);
  assert.equal(Object.hasOwn(ordinary.receipt, 'next_cursor'), false);
  assert.equal(Object.hasOwn(ordinary.receipt, 'remaining'), false);
});

test('one failed automatic reseal rolls back plan replacement and all instance changes', async () => {
  const atoms = await twoInstances();
  setField(find(atoms, '表单槽体/槽模/姓名'), 'detail', '不得落盘的新契约');
  const before = structuredClone(atoms);
  let calls = 0;

  const result = await seal(atoms, {}, {
    mutateInput: true,
    authorize: async () => ({ decision: ++calls === 2 ? 'deny' : 'allow' })
  });

  assert.equal(result.error?.code, 'PROGRAM_LOCK_DENIED');
  assert.deepEqual(atoms, before);
});
