import assert from 'node:assert/strict';
import test from 'node:test';

import { planGeneratedSlotPrintMigration } from '../work-engine/atom-language/generated-slot-print-migration.mjs';
import { applyPlanSlotBodyEffect, readVisibleSlotPlans } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import {
  atomName,
  childrenOf,
  fieldValue,
  replaceStoredField
} from '../work-engine/atom-language/slot-graph-semantics.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

function atom(thing, situation = '', slot = [], strut = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    slot,
    strut
  };
}

function find(atoms, selector) {
  let records = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = records.find((candidate) => atomName(candidate) === segment);
    if (!current) return null;
    records = childrenOf(current) ?? [];
  }
  return current;
}

function unsealedBody(name) {
  return atom(name, 'slot_body({"action":"seal"})', [
    atom('模型', '模型正文\r\n保持原字节', [
      atom('字段', '字段正文\n含有 body 与 print 字样')
    ])
  ], [], ['program']);
}

async function seal(facts, bodyPath) {
  const result = await applyPlanSlotBodyEffect({
    atoms: facts,
    effect: { action: 'seal', body: bodyPath }
  });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.atoms;
}

function visiblePrint(facts, bodyPath) {
  const visible = readVisibleSlotPlans(facts)
    .find(({ layout }) => layout.bodyPath === bodyPath);
  assert.ok(visible, `missing visible print plan for ${bodyPath}`);
  return visible;
}

function legacyGeneratedSource(source, planBody) {
  const lines = source.split('\n');
  assert.equal(lines.length, 3);
  lines[2] = `    return slot_body({"action":"print","body":${JSON.stringify(planBody)},"name":arguments["name"]})`;
  return lines.join('\n');
}

function withoutSituationAt(facts, path) {
  const copy = structuredClone(facts);
  replaceStoredField(find(copy, path), 'situation', '<selected-situation>');
  return copy;
}

test('migrates one exact historical generated print after an ancestor rename without changing source facts', async () => {
  let facts = await seal([
    atom('Root', '根正文\r\n逐字保留', [
      atom('邻居', '普通 Situation 保留\n第二行'),
      unsealedBody('订单槽体')
    ])
  ], 'Root/订单槽体');
  const original = visiblePrint(facts, 'Root/订单槽体');
  const historicalPlanBody = original.plan.body;
  replaceStoredField(original.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(original.layout.print, 'situation'),
    historicalPlanBody
  ));
  replaceStoredField(find(facts, 'Root'), 'thing', 'RenamedRoot');
  const current = visiblePrint(facts, 'RenamedRoot/订单槽体');
  assert.equal(current.plan.body, 'Root/订单槽体');
  const before = structuredClone(facts);

  const plan = planGeneratedSlotPrintMigration(facts);

  assert.deepEqual(facts, before);
  assert.equal(plan.expectedRevision, revisionOfWorldFacts(before));
  assert.equal(plan.nextRevision, revisionOfWorldFacts(plan.facts));
  assert.notEqual(plan.nextRevision, plan.expectedRevision);
  assert.equal(plan.summary.migratedPrograms, 1);
  assert.deepEqual(plan.changedPaths, ['RenamedRoot/订单槽体/print']);
  assert.deepEqual(plan.migrated, [{
    bodyPath: 'RenamedRoot/订单槽体',
    programPath: 'RenamedRoot/订单槽体/print',
    planRevision: current.plan.revision
  }]);
  const beforeSource = fieldValue(find(before, 'RenamedRoot/订单槽体/print'), 'situation');
  const afterSource = fieldValue(find(plan.facts, 'RenamedRoot/订单槽体/print'), 'situation');
  assert.equal(afterSource.split('\n')[0], beforeSource.split('\n')[0]);
  assert.equal(afterSource, [
    beforeSource.split('\n')[0],
    'def main(arguments):',
    '    return slot_body({"action":"print","name":arguments["name"]})'
  ].join('\n'));
  assert.deepEqual(
    withoutSituationAt(plan.facts, 'RenamedRoot/订单槽体/print'),
    withoutSituationAt(before, 'RenamedRoot/订单槽体/print')
  );
});

test('migrates a generated print whose main body alone was maintained to the renamed layout path', async () => {
  let facts = await seal([
    atom('Root', '根正文保持', [unsealedBody('订单槽体')])
  ], 'Root/订单槽体');
  const original = visiblePrint(facts, 'Root/订单槽体');
  const originalHeader = fieldValue(original.layout.print, 'situation').split('\n')[0];
  replaceStoredField(find(facts, 'Root'), 'thing', 'RenamedRoot');
  const renamed = visiblePrint(facts, 'RenamedRoot/订单槽体');
  assert.equal(renamed.plan.body, 'Root/订单槽体');
  replaceStoredField(renamed.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(renamed.layout.print, 'situation'),
    renamed.layout.bodyPath
  ));
  const before = structuredClone(facts);

  const plan = planGeneratedSlotPrintMigration(facts);

  assert.deepEqual(facts, before);
  assert.equal(plan.summary.migratedPrograms, 1);
  assert.deepEqual(plan.changedPaths, ['RenamedRoot/订单槽体/print']);
  const migratedSource = fieldValue(find(plan.facts, 'RenamedRoot/订单槽体/print'), 'situation');
  assert.equal(migratedSource.split('\n')[0], originalHeader);
  assert.equal(migratedSource.split('\n').at(-1),
    '    return slot_body({"action":"print","name":arguments["name"]})');
  assert.deepEqual(
    withoutSituationAt(plan.facts, 'RenamedRoot/订单槽体/print'),
    withoutSituationAt(before, 'RenamedRoot/订单槽体/print')
  );
});

test('leaves the current generated ABI and handwritten print Programs unchanged', async () => {
  const currentFacts = await seal([atom('Root', '', [unsealedBody('当前槽体')])], 'Root/当前槽体');
  const currentBefore = structuredClone(currentFacts);

  const currentPlan = planGeneratedSlotPrintMigration(currentFacts);

  assert.deepEqual(currentFacts, currentBefore);
  assert.deepEqual(currentPlan.facts, currentBefore);
  assert.deepEqual(currentPlan.changedPaths, []);
  assert.deepEqual(currentPlan.migrated, []);
  assert.deepEqual(currentPlan.summary, { migratedPrograms: 0 });
  assert.equal(currentPlan.nextRevision, currentPlan.expectedRevision);

  const handwrittenFacts = structuredClone(currentFacts);
  replaceStoredField(
    visiblePrint(handwrittenFacts, 'Root/当前槽体').layout.print,
    'situation',
    'def main(arguments):\n    return {"handwritten": arguments["name"]}'
  );
  const handwrittenBefore = structuredClone(handwrittenFacts);

  const handwrittenPlan = planGeneratedSlotPrintMigration(handwrittenFacts);

  assert.deepEqual(handwrittenFacts, handwrittenBefore);
  assert.deepEqual(handwrittenPlan.facts, handwrittenBefore);
  assert.deepEqual(handwrittenPlan.changedPaths, []);
  assert.equal(handwrittenPlan.nextRevision, handwrittenPlan.expectedRevision);
});

test('rejects an entire candidate when a generated-looking print has extra behavior', async () => {
  let facts = [atom('Root', '', [unsealedBody('合法槽体'), unsealedBody('畸形槽体')])];
  facts = await seal(facts, 'Root/合法槽体');
  facts = await seal(facts, 'Root/畸形槽体');
  for (const bodyPath of ['Root/合法槽体', 'Root/畸形槽体']) {
    const entry = visiblePrint(facts, bodyPath);
    replaceStoredField(entry.layout.print, 'situation', legacyGeneratedSource(
      fieldValue(entry.layout.print, 'situation'),
      entry.plan.body
    ));
  }
  const malformed = visiblePrint(facts, 'Root/畸形槽体');
  replaceStoredField(malformed.layout.print, 'situation', `${fieldValue(malformed.layout.print, 'situation')}\nprint("extra")`);
  const before = structuredClone(facts);

  assert.throws(
    () => planGeneratedSlotPrintMigration(facts),
    (error) => error?.code === 'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_AMBIGUOUS'
      && error.details?.path === 'Root/畸形槽体/print'
  );
  assert.deepEqual(facts, before);
});

test('rejects a generated print whose main body names a third-party path', async () => {
  let facts = await seal([atom('Root', '', [unsealedBody('订单槽体')])], 'Root/订单槽体');
  const entry = visiblePrint(facts, 'Root/订单槽体');
  replaceStoredField(entry.layout.print, 'situation', legacyGeneratedSource(
    fieldValue(entry.layout.print, 'situation'),
    'External/Other'
  ));
  const before = structuredClone(facts);

  assert.throws(
    () => planGeneratedSlotPrintMigration(facts),
    (error) => error?.code === 'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_AMBIGUOUS'
      && error.details?.path === 'Root/订单槽体/print'
  );
  assert.deepEqual(facts, before);
});

test('skips sealed print Programs inside an explicitly typed default backup domain', async () => {
  let facts = [atom('Root', '', [
    unsealedBody('活跃槽体'),
    atom('旧版本', '普通名称不提供停用语义', [unsealedBody('仍活跃槽体')]),
    atom('Archive', '名字不是停用依据', [unsealedBody('归档槽体')], [], ['backup', 'default'])
  ])];
  facts = await seal(facts, 'Root/活跃槽体');
  facts = await seal(facts, 'Root/旧版本/仍活跃槽体');
  facts = await seal(facts, 'Root/Archive/归档槽体');
  for (const bodyPath of [
    'Root/活跃槽体',
    'Root/旧版本/仍活跃槽体',
    'Root/Archive/归档槽体'
  ]) {
    const entry = visiblePrint(facts, bodyPath);
    replaceStoredField(entry.layout.print, 'situation', legacyGeneratedSource(
      fieldValue(entry.layout.print, 'situation'),
      entry.plan.body
    ));
  }
  const archivedBefore = fieldValue(find(facts, 'Root/Archive/归档槽体/print'), 'situation');

  const plan = planGeneratedSlotPrintMigration(facts);

  assert.equal(plan.summary.migratedPrograms, 2);
  assert.deepEqual(plan.changedPaths, [
    'Root/旧版本/仍活跃槽体/print',
    'Root/活跃槽体/print'
  ]);
  assert.equal(
    fieldValue(find(plan.facts, 'Root/Archive/归档槽体/print'), 'situation'),
    archivedBefore
  );
});
