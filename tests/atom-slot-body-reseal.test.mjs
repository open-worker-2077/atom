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
  return [atom('表单槽体', '', [atom('候选表单', '', [
    atom('姓名', '旧\r\n默认', [], [{ verb: '驱动', object: '计算' }], ['text'], '旧说明'),
    atom('备注', '可删除'),
    atom('个性项', '初值'),
    atom('分组', '', [atom('城市', '上海')]),
    atom('计算', 'def main(arguments):\n    return arguments', [], [], ['program'])
  ])])];
}

async function seal(atoms, extra = {}) {
  return applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '表单槽体', ...extra },
    sourceProgramPath: '注册'
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

test('re-seal follows stable roles through add, rename, move and metadata/support changes', async () => {
  const atoms = await twoInstances();
  const model = find(atoms, '表单槽体/槽模');
  const name = find(atoms, '表单槽体/槽模/姓名');
  const group = find(atoms, '表单槽体/槽模/分组');
  field(model, 'children').splice(field(model, 'children').indexOf(name), 1);
  setField(name, 'name', '联系人');
  const nameKey = entry(name, 'name')[0];
  delete name[nameKey];
  name['name@rich#新说明'] = '联系人';
  field(group, 'children').push(name);
  field(model, 'children').push(atom('新增槽', '新增默认', [], [{ verb: '补充', object: '计算' }], ['new']));

  const result = await seal(atoms);

  assert.equal(result.error, undefined);
  for (const instanceName of ['甲', '乙']) {
    assert.equal(find(result.atoms, `表单槽体/槽例/${instanceName}/姓名`), null);
    const moved = find(result.atoms, `表单槽体/槽例/${instanceName}/分组/联系人`);
    assert.equal(field(moved, 'detail'), '旧\r\n默认');
    assert.match(entry(moved, 'name')[0], /^name@rich#新说明$/u);
    assert.equal(field(find(result.atoms, `表单槽体/槽例/${instanceName}/新增槽`), 'detail'), '新增默认');
  }
  assert.equal(result.receipt.complete, true);
  assert.deepEqual(result.receipt.processed, ['甲', '乙']);
});

test('re-seal uses byte-exact three-way defaults and reports preserved personalized material', async () => {
  const atoms = await twoInstances();
  setField(find(atoms, '表单槽体/槽例/乙/姓名'), 'detail', '用户\r\n填写');
  setField(find(atoms, '表单槽体/槽例/乙/个性项'), 'detail', '定制字符\u0000尾');
  setField(find(atoms, '表单槽体/槽模/姓名'), 'detail', '新\n默认');
  const modelChildren = field(find(atoms, '表单槽体/槽模'), 'children');
  modelChildren.splice(modelChildren.findIndex((item) => nameOf(item) === '备注'), 1);
  modelChildren.splice(modelChildren.findIndex((item) => nameOf(item) === '个性项'), 1);

  const result = await seal(atoms);

  assert.equal(field(find(result.atoms, '表单槽体/槽例/甲/姓名'), 'detail'), '新\n默认');
  assert.equal(field(find(result.atoms, '表单槽体/槽例/乙/姓名'), 'detail'), '用户\r\n填写');
  assert.equal(find(result.atoms, '表单槽体/槽例/甲/备注'), null);
  assert.equal(find(result.atoms, '表单槽体/槽例/甲/个性项'), null);
  const preserved = find(result.atoms, '表单槽体/槽例/乙/个性项');
  assert.equal(field(preserved, 'detail'), '定制字符\u0000尾');
  assert.equal(field(preserved, 'partners').some((item) => item.verb === '槽模角色'), false);
  assert.ok(result.receipt.preserved_customized.some((item) => (
    item.instance === '乙' && item.old_path === './个性项'
  )));
});

test('re-seal batches deterministically, rejects stale cursors and keeps every instance revision explicit', async () => {
  const atoms = await twoInstances();
  setField(find(atoms, '表单槽体/槽模/姓名'), 'detail', '批次新默认');

  const first = await seal(atoms, { limit: 1 });
  assert.equal(first.receipt.complete, false);
  assert.deepEqual(first.receipt.processed, ['甲']);
  assert.equal(first.receipt.remaining, 1);
  assert.equal(typeof first.receipt.next_cursor, 'string');
  assert.match(adopted(find(first.atoms, '表单槽体/槽例/甲')), new RegExp(`${first.receipt.revision}$`, 'u'));
  assert.match(adopted(find(first.atoms, '表单槽体/槽例/乙')), new RegExp(`${first.receipt.previous_revision}$`, 'u'));

  setField(find(first.atoms, '表单槽体/槽模/姓名'), 'detail', '游标之后又改');
  const stale = await seal(first.atoms, { cursor: first.receipt.next_cursor, limit: 1 });
  assert.equal(stale.error?.code, 'SLOT_SYNC_CURSOR_STALE');

  setField(find(first.atoms, '表单槽体/槽模/姓名'), 'detail', '批次新默认');
  const second = await seal(first.atoms, { cursor: first.receipt.next_cursor, limit: 1 });
  assert.equal(second.error, undefined);
  assert.deepEqual(second.receipt.processed, ['乙']);
  assert.equal(second.receipt.complete, true);
  assert.match(adopted(find(second.atoms, '表单槽体/槽例/乙')), new RegExp(`${second.receipt.revision}$`, 'u'));
});

test('one failed batch rolls back plan replacement and all instance changes', async () => {
  const atoms = await twoInstances();
  setField(find(atoms, '表单槽体/槽模/姓名'), 'detail', '不得落盘');
  const before = structuredClone(atoms);
  let calls = 0;

  const result = await applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '表单槽体' },
    sourceProgramPath: '注册',
    mutateInput: true,
    authorize: async () => ({ decision: ++calls === 2 ? 'deny' : 'allow' })
  });

  assert.equal(result.error?.code, 'PROGRAM_LOCK_DENIED');
  assert.deepEqual(atoms, before);
});
