import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atom(thing, situation = '', slot = [], strut = [], types = [], description = null) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}${description == null ? '' : `#${description}`}`]: thing,
    situation,
    slot,
    strut
  };
}

test('first seal preserves exact candidate-local Program strut endpoints without renaming', async () => {
  const atoms = [atom('表单槽体', '', [atom('候选', '', [
    atom('提交', '', [], [{ 'if@current': true, then: [{ 'thing@program': '表单槽体/候选/推进' }] }]),
    atom('推进', 'def main(delivery):\n    pass\ntrigger("strut", {}, main)', [], [], ['program'])
  ])])];
  const result = await seal(atoms);
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.deepEqual(field(find(result.atoms, '表单槽体/候选/提交'), 'strut'), [
    { 'if@current': true, then: [{ 'thing@program': '表单槽体/候选/推进' }] }
  ]);
  const printed = await applySlotBodyEffect({
    atoms: result.atoms, effect: { action: 'print', body: '表单槽体', name: '试单' },
    sourceProgramPath: '表单槽体/print'
  });
  assert.equal(printed.error, undefined, JSON.stringify(printed.error));
  assert.deepEqual(field(find(printed.atoms, '表单槽体/槽例/试单/提交'), 'strut'), [
    { 'if@current': true, then: [{ 'thing@program': '表单槽体/候选/推进' }] }
  ]);
});

test('first seal does not turn an external same-prefix endpoint into a local role', async () => {
  const atoms = [atom('表单槽体', '', [atom('候选', '', [
    atom('提交', '', [], [{ 'if@current': true, then: [{ thing: '表单槽体/候选外/推进' }] }]),
    atom('推进')
  ])])];
  const before = structuredClone(atoms);
  const result = await seal(atoms, {}, { mutateInput: true });
  assert.equal(result.error?.code, 'INVALID_SLOT_PRINT_PLAN');
  assert.deepEqual(atoms, before);
});

function entry(value, baseKey) {
  return Object.entries(value).find(([key]) => (
    parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}

function field(value, baseKey) { return entry(value, baseKey)?.[1]; }
function nameOf(value) { return field(value, 'thing'); }
function find(atoms, selector) {
  let current = { slot: atoms };
  for (const segment of selector.split('/')) {
    current = field(current, 'slot')?.find((candidate) => nameOf(candidate) === segment);
    if (!current) return null;
  }
  return current;
}
function setField(value, baseKey, next) {
  const [key] = entry(value, baseKey);
  value[key] = next;
}
function revision(atoms) {
  const records = field(find(atoms, '表单槽体/print/修订'), 'slot');
  return JSON.parse(field(records.at(-1), 'situation')).revision;
}
function adopted(value) {
  const type = entry(value, 'thing')[0].split('@').find((item) => item.startsWith('slot-revision-'));
  return type?.slice('slot-revision-'.length).replace(/^sha256-/u, 'sha256:');
}

function fixture() {
  return [atom('表单槽体', '', [atom('候选表单', '表单契约', [
    atom('姓名', '姓名槽契约', [], [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: '状态' }]
    }], ['text'], '旧说明'),
    atom('空备注', '备注槽契约'),
    atom('状态', '状态事实契约'),
    atom('分组', '分组槽契约', [atom('城市', '城市槽契约')]),
    atom('计算', 'def main(arguments):\n    return True', [], [], ['program'])
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
      { 'if@current': true, then: [{ thing: `${slotPath}/${instanceName}料` }] }
    ], ['material-leaf'], '料节点说明')
  ], [{ 'if@current': true, then: [{ thing: `${slotPath}/${instanceName}料/料明细` }] }], ['material'], '料根说明');
  field(find(atoms, slotPath), 'slot').push(material);
  return material;
}

test('re-seal updates every mapped slot while preserving two nested material subtrees byte-for-byte', async () => {
  const atoms = await twoInstances();
  const materialA = addNestedMaterial(atoms, '甲', '甲值');
  const materialB = addNestedMaterial(atoms, '乙', '乙值');
  const beforeA = JSON.stringify(materialA);
  const beforeB = JSON.stringify(materialB);

  const model = find(atoms, '表单槽体/候选表单');
  const name = find(atoms, '表单槽体/候选表单/姓名');
  const group = find(atoms, '表单槽体/候选表单/分组');
  field(model, 'slot').splice(field(model, 'slot').indexOf(name), 1);
  setField(name, 'thing', '联系人');
  const nameKey = entry(name, 'thing')[0];
  const roleType = nameKey.split('@').find((item) => item.startsWith('slot-role-')).split('#')[0];
  delete name[nameKey];
  name[`thing@rich@${roleType}#新说明`] = '联系人';
  setField(name, 'situation', '联系人新契约');
  field(group, 'slot').push(name);
  field(model, 'slot').push(atom('新增槽', '新增槽契约', [], [{
    'if@current': true,
    if: [{ program: 'def main(context):\n    return True' }],
    then: [{ thing: '状态' }]
  }], ['new']));

  const result = await seal(atoms);

  assert.equal(result.error, undefined);
  assert.deepEqual(result.receipt.processed, ['甲', '乙']);
  assert.equal(result.receipt.complete, true);
  assert.equal(Object.hasOwn(result.receipt, 'next_cursor'), false);
  for (const instanceName of ['甲', '乙']) {
    assert.equal(find(result.atoms, `表单槽体/槽例/${instanceName}/姓名`), null);
    const moved = find(result.atoms, `表单槽体/槽例/${instanceName}/分组/联系人`);
    assert.equal(field(moved, 'situation'), '联系人新契约');
    assert.match(entry(moved, 'thing')[0], /^thing@rich@slot-role-[^#]+#新说明$/u);
    assert.equal(field(find(result.atoms, `表单槽体/槽例/${instanceName}/新增槽`), 'situation'), '新增槽契约');
    assert.equal(adopted(find(result.atoms, `表单槽体/槽例/${instanceName}`)), result.receipt.revision);
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
  const modelChildren = field(find(atoms, '表单槽体/候选表单'), 'slot');
  modelChildren.splice(modelChildren.findIndex((item) => nameOf(item) === '空备注'), 1);

  const result = await seal(atoms);

  assert.equal(result.error, undefined);
  assert.equal(find(result.atoms, '表单槽体/槽例/甲/空备注'), null);
  assert.equal(find(result.atoms, '表单槽体/槽例/乙/空备注'), null);
});

test('deleting a mapped slot containing local material reports exact paths and rolls back the whole seal', async () => {
  const atoms = await twoInstances();
  addNestedMaterial(atoms, '乙', '不得丢失');
  const modelChildren = field(find(atoms, '表单槽体/候选表单'), 'slot');
  modelChildren.splice(modelChildren.findIndex((item) => nameOf(item) === '姓名'), 1);
  const before = structuredClone(atoms);

  const result = await seal(atoms, {}, { mutateInput: true });

  assert.equal(result.error?.code, 'SLOT_MATERIAL_SLOTMENT_CONFLICT');
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
  setField(find(atoms, '表单槽体/候选表单/姓名'), 'situation', '不得落盘的新契约');
  const before = structuredClone(atoms);
  let calls = 0;

  const result = await seal(atoms, {}, {
    mutateInput: true,
    authorize: async () => ({ decision: ++calls === 2 ? 'deny' : 'allow' })
  });

  assert.equal(result.error?.code, 'PROGRAM_LOCK_DENIED');
  assert.deepEqual(atoms, before);
});
