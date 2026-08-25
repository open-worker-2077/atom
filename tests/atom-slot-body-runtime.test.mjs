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

function fieldEntry(value, baseKey) {
  return Object.entries(value).find(([key]) => (
    parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey
  ));
}

function field(value, baseKey) {
  return fieldEntry(value, baseKey)?.[1];
}

function types(value) {
  return parseAtomKey(fieldEntry(value, 'name')[0], { descriptionSymbolWarnings: false })
    .types.map((type) => type.raw);
}

function description(value) {
  return parseAtomKey(fieldEntry(value, 'name')[0], { descriptionSymbolWarnings: false }).description;
}

function nameOf(value) {
  return field(value, 'name');
}

function find(atoms, selector) {
  let current = { children: atoms };
  for (const segment of selector.split('/')) {
    current = field(current, 'children')?.find((candidate) => nameOf(candidate) === segment);
    if (!current) return null;
  }
  return current;
}

function relation(value, verb) {
  return (field(value, 'partners') ?? []).find((partner) => partner.verb === verb)?.object;
}

function fixture() {
  const calculate = atom(
    '共享计算',
    'def main(arguments):\n    return arguments',
    [],
    [],
    ['program'],
    '共享源码'
  );
  const candidate = atom('订单候选流', '订单默认料', [
    atom('客户', '默认客户', [
      atom('地址', '默认地址', [
        atom('城市', '上海', [], [], ['text'], '城市说明')
      ], [], ['group'], '地址说明')
    ], [{ verb: '推支', object: '金额' }], ['text'], '客户说明'),
    atom('金额', '100', [], [{ verb: '计算', object: '共享计算' }], ['number'], '金额说明'),
    atom('业务任意槽', '任意默认料', [], [], ['custom'], '非输入输出角色'),
    calculate
  ], [], ['dataflow'], '普通候选槽模');
  return [atom('订单槽体', '', [candidate])];
}

function planOf(atoms) {
  const print = find(atoms, '订单槽体/print');
  const revisions = find(atoms, '订单槽体/print/修订');
  const current = field(revisions, 'children').at(-1);
  return { print, revisionNode: current, plan: JSON.parse(field(current, 'detail')) };
}

async function seal(atoms = fixture(), effect = { action: 'seal', body: '订单槽体' }) {
  return applySlotBodyEffect({ atoms, effect, sourceProgramPath: 'Root/槽体注册程序' });
}

async function print(atoms, name, revision = planOf(atoms).plan.revision) {
  return applySlotBodyEffect({
    atoms,
    effect: { action: 'print', body: '订单槽体', name, revision },
    sourceProgramPath: '订单槽体/print'
  });
}

test('seal keeps the candidate logic and creates one visible model, print Program, and empty example container', async () => {
  const result = await seal();

  assert.equal(result.error, undefined);
  const body = find(result.atoms, '订单槽体');
  assert.deepEqual(field(body, 'children').map(nameOf), ['槽模', 'print', '槽例']);
  assert.deepEqual(types(find(result.atoms, '订单槽体/print')), ['program']);
  assert.equal(find(result.atoms, '订单槽体/槽例').children.length, 0);
  assert.equal(find(result.atoms, '订单槽体/槽例/空槽例'), null);
  assert.match(field(find(result.atoms, '订单槽体/槽模/共享计算'), 'detail'), /def main/u);
});

test('seal rejects the retired physical blank-example layout without changing the world', async () => {
  const legacy = [atom('旧槽体', '', [
    atom('槽模', '', [atom('字段')]),
    atom('槽例', '', [atom('空槽例', '', [atom('字段')])])
  ])];
  const before = structuredClone(legacy);
  const result = await applySlotBodyEffect({
    atoms: legacy,
    effect: { action: 'seal', body: '旧槽体' },
    sourceProgramPath: 'Root/注册'
  });

  assert.equal(result.error?.code, 'INVALID_SLOT_BODY_LAYOUT');
  assert.deepEqual(legacy, before);
});

test('seal stores a deterministic complete canonical plan in the visible print Program and revision record', async () => {
  const once = await seal();
  const { print: printProgram, revisionNode, plan } = planOf(once.atoms);

  assert.match(plan.revision, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(nameOf(revisionNode), plan.revision);
  assert.match(field(printProgram, 'detail'), /PRINT_PLAN = json_parse/u);
  assert.match(field(printProgram, 'detail'), new RegExp(plan.revision.replace(':', '\\:')));
  assert.deepEqual(plan.roles.filter((role) => role.kind === 'slot').map((role) => role.path), [
    '.', './客户', './客户/地址', './客户/地址/城市', './金额', './业务任意槽'
  ]);
  const city = plan.roles.find((role) => role.path === './客户/地址/城市');
  assert.deepEqual(city, {
    role_id: city.role_id,
    kind: 'slot',
    path: './客户/地址/城市',
    parent_role_id: plan.roles.find((role) => role.path === './客户/地址').role_id,
    name: '城市',
    types: ['text'],
    description: '城市说明',
    default_detail: '上海'
  });
  assert.deepEqual(plan.support.map(({ verb, source_path, target_path }) => (
    { verb, source_path, target_path }
  )), [
    { verb: '推支', source_path: './客户', target_path: './金额' },
    { verb: '计算', source_path: './金额', target_path: './共享计算' }
  ]);

  const repeated = await seal(once.atoms);
  const repeatedPlan = planOf(repeated.atoms);
  assert.equal(repeatedPlan.plan.revision, plan.revision);
  assert.equal(field(find(repeated.atoms, '订单槽体/print/修订'), 'children').length, 1);
});

test('current print plan directly creates a nested ordinary example with all slots, defaults, metadata and support', async () => {
  const sealed = await seal();
  const printed = await print(sealed.atoms, '订单001');

  assert.equal(printed.error, undefined);
  assert.equal(printed.receipt.target, '订单槽体/槽例/订单001');
  assert.equal(find(printed.atoms, '订单槽体/槽例/订单001/共享计算'), null);
  assert.equal(field(find(printed.atoms, '订单槽体/槽例/订单001/客户/地址/城市'), 'detail'), '上海');
  assert.deepEqual(types(find(printed.atoms, '订单槽体/槽例/订单001/客户')), ['text']);
  assert.equal(description(find(printed.atoms, '订单槽体/槽例/订单001/客户')), '客户说明');
  assert.equal(field(find(printed.atoms, '订单槽体/槽例/订单001/业务任意槽'), 'detail'), '任意默认料');
  assert.equal(
    relation(find(printed.atoms, '订单槽体/槽例/订单001/客户'), '推支'),
    '订单槽体/槽例/订单001/金额'
  );
  assert.equal(
    relation(find(printed.atoms, '订单槽体/槽例/订单001/金额'), '计算'),
    '订单槽体/槽模/共享计算'
  );
  assert.equal(
    relation(find(printed.atoms, '订单槽体/槽例/订单001'), '采用槽模修订'),
    `订单槽体/print/修订/${planOf(printed.atoms).plan.revision}`
  );
});

test('print authenticates the current visible plan and rejects duplicates or stale revisions atomically', async () => {
  const sealed = await seal();
  const first = await print(sealed.atoms, '订单001');
  const before = structuredClone(first.atoms);

  const duplicate = await print(first.atoms, '订单001');
  assert.equal(duplicate.error?.code, 'SLOT_BODY_EXAMPLE_EXISTS');
  assert.deepEqual(first.atoms, before);

  const stale = await print(first.atoms, '订单002', `sha256:${'0'.repeat(64)}`);
  assert.equal(stale.error?.code, 'SLOT_PRINT_PLAN_STALE');
  assert.deepEqual(first.atoms, before);

  const forged = await applySlotBodyEffect({
    atoms: first.atoms,
    effect: {
      action: 'print', body: '订单槽体', name: '订单002', revision: planOf(first.atoms).plan.revision
    },
    sourceProgramPath: 'Root/伪造程序'
  });
  assert.equal(forged.error?.code, 'INVALID_SLOT_PRINT_PLAN');
  assert.deepEqual(first.atoms, before);
});
