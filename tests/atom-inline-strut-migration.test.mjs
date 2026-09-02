import assert from 'node:assert/strict';
import test from 'node:test';

import { planInlineStrutMigration } from '../work-engine/atom-language/inline-strut-migration.mjs';

function atom(key, name, situation = '', slot = [], strut = []) {
  return { [key]: name, situation, slot, strut };
}

test('moves an active external Program predicate source into its owning Strut', () => {
  const source = [atom('thing', '🧊', '', [
    atom('thing@program', '判定', 'def main(context):\n    return True'),
    atom('thing', '上游'),
    atom('thing', '下游', '', [], [{
      if: [{ and: [{ thing: '上游' }, { 'thing@program': '🧊/判定' }] }], 'then@current': true
    }])
  ])];

  const plan = planInlineStrutMigration(source);
  assert.equal(plan.summary.migratedPredicates, 1);
  assert.deepEqual(plan.facts[0].slot[2].strut[0].if[0].and[1], {
    program: 'def main(context):\n    return True'
  });
  assert.equal(plan.facts[0].slot[0]['thing@program'], '判定', 'source Program is preserved');
  assert.deepEqual(source[0].slot[2].strut[0].if[0].and[1], { 'thing@program': '🧊/判定' });
});

test('keeps typed default-backup history byte-semantically untouched', () => {
  const archived = atom('thing@backup@default', '默认备份仓', '', [
    atom('thing@program', '旧判定', 'def main(context):\n    return True', [], [{
      if: [{ 'thing@program': '旧判定' }], 'then@current': true
    }])
  ]);
  const plan = planInlineStrutMigration([archived]);
  assert.equal(plan.summary.migratedPredicates, 0);
  assert.deepEqual(plan.facts, [archived]);
});

test('refuses an ambiguous short Program selector instead of guessing', () => {
  const source = [
    atom('thing@program', '判定', 'def main(context):\n    return True'),
    atom('thing', '分支', '', [atom('thing@program', '判定', 'def main(context):\n    return False')]),
    atom('thing', '目标', '', [], [{ if: [{ 'thing@program': '判定' }], 'then@current': true }])
  ];
  assert.throws(() => planInlineStrutMigration(source), {
    code: 'INLINE_STRUT_MIGRATION_PROGRAM_UNRESOLVED'
  });
});
