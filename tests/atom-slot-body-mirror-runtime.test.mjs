import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { compileSlotStructureGraphLocks, readVisibleSlotPlans } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import {
  shortcutMetadata
} from '../work-engine/atom-language/shortcut-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', slot = [], strut = []) {
  const normalizedStrut = strut.length && strut.every((entry) => entry.thing)
    ? [{ 'if@current': true, then: strut }]
    : strut;
  return { thing, situation, slot, strut: normalizedStrut };
}

function thingOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@&#]/u)[0] === 'thing')?.[1];
}

function idOf(value) {
  return Object.keys(value).find((key) => key.startsWith('thing'))?.match(/&id=([0-9A-Za-z]+)/u)?.[1];
}

function find(atoms, selector) {
  let current = { slot: atoms };
  for (const segment of selector.split('/')) {
    current = current.slot?.find((candidate) => thingOf(candidate) === segment);
    if (!current) return null;
  }
  return current;
}

function strutTargets(value) {
  return value.strut.flatMap((rule) => rule.then ?? []).map(thingOf);
}

test('four-axis references, slot locks, and inverse local rollback survive an unrelated commit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-body-mirror-local-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const journalFile = path.join(directory, 'atom.transactions.json');
  const shortcutSource = [
    'target = explore({"thing":"东/目标"})[0]',
    'shortcut({"placement":"slot","thing":"入口","target":target})'
  ].join('\n');
  const initial = [
    { 'thing@program': '槽体', situation: 'slot_body({"action":"seal"})',
      slot: [atom('候选', '', [atom('输入', '初始值'), atom('输出')])], strut: [] },
    atom('东', '', [atom('目标', '权威值', [atom('叶', '内部值')], [{ thing: '叶' }])]),
    atom('西'),
    atom('来源', '', [], [{ thing: '东/目标' }]),
    { 'thing@program': '引用', situation: shortcutSource, slot: [], strut: [] },
    atom('无关', '旧值'),
    atom('另一个无关', '旧值'),
    { 'thing@backup@default': '默认备份仓', situation: '', slot: [], strut: [] }
  ];
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const programScheduler = createProgramRuntimeScheduler();
  let runtimeMode = 'reconcile';
  const run = (source, id = crypto.randomUUID()) => executeAtomLanguage({
    contextFile,
    projectionFile,
    source,
    programScheduler,
    programMode: runtimeMode,
    humanAuthority: false,
    interaction: { id }
  });
  for (const entry of initial) {
    const created = await run(`transform new ${JSON.stringify(entry)}`);
    assert.equal(created.ok, true, JSON.stringify(created.errors));
  }
  const shortcutCreated = await run('transform {"thing.run.":"引用"}');
  assert.equal(shortcutCreated.ok, true, JSON.stringify(shortcutCreated.errors));
  const sealed = await run('transform {"thing.run.":"槽体"}');
  assert.equal(sealed.ok, true, JSON.stringify(sealed.errors));
  const printer = await run(`transform new ${JSON.stringify({
    'thing@program': '打印实例',
    situation: 'use_program({"name":"槽体/print","arguments":{"name":"实例"}})',
    slot: [], strut: []
  })}`);
  assert.equal(printer.ok, true, JSON.stringify(printer.errors));
  runtimeMode = 'current';
  const instanceValue = await run('transform {"thing":"槽体/槽例/实例/输入","situation.rep.旧实例值":"初始值"}');
  assert.equal(instanceValue.ok, true, JSON.stringify(instanceValue.errors));

  const renamed = await run('transform {"thing.ren.重命名目标":"东/目标"}');
  assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
  const moved = await run('transform {"thing.mov.西":"东/重命名目标"}');
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  const discarded = await run('transform {"thing.dsc.":"西/重命名目标"}');
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const restored = await run(`transform {"thing.rst.":${JSON.stringify(discarded.result.path)}}`);
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));

  const instancePath = '槽体/槽例/实例/输入';
  const instanceResult = await run(
    `transform ${JSON.stringify({ thing: instancePath, 'situation.rep.实例值': '旧实例值' })}`,
    'task-4-slot-instance-local'
  );
  assert.equal(instanceResult.ok, true, JSON.stringify(instanceResult));
  const localPaths = ['无关', '另一个无关'];
  const localIds = ['task-4-unrelated-local-a', 'task-4-unrelated-local-b'];
  const localResults = await Promise.all([
    run(`transform ${JSON.stringify({ thing: localPaths[0], 'situation.rep.新值': '旧值' })}`, localIds[0]),
    run(`transform ${JSON.stringify({ thing: localPaths[1], 'situation.rep.新值': '旧值' })}`, localIds[1])
  ]);
  assert.equal(localResults.every((result) => result.ok), true, JSON.stringify(localResults));

  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const localReceipts = journal.receipts.filter((entry) => localIds.includes(entry.correlationId));
  assert.equal(localReceipts.length, 2, JSON.stringify(journal.receipts));
  assert.equal(localReceipts.every((entry) => entry.historyMode === 'local-patch'), true);
  const target = localReceipts[0];
  const targetPath = target.patch.changedPaths.find((entry) => localPaths.includes(entry));
  const preservedPath = localPaths.find((entry) => entry !== targetPath);
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile, journalFile, publishLegacyProjection: false
  });
  const current = await persistence.readCommittedSnapshot();
  await persistence.rollback({
    targetCommandId: target.commandId,
    correlationId: 'task-4-inverse-local-rollback',
    expectedRevision: current.revision
  });

  const world = (await persistence.readCommittedSnapshot()).facts;
  const visiblePlans = readVisibleSlotPlans(world);
  assert.equal(visiblePlans.length, 1, JSON.stringify(visiblePlans));
  assert.ok(compileSlotStructureGraphLocks(world).locks.length > 0);
  assert.equal(find(world, targetPath).situation, '旧值');
  assert.equal(find(world, preservedPath).situation, '新值');
  assert.equal(find(world, instancePath).situation, '实例值');
  assert.equal(find(world, '西/重命名目标').situation, '权威值');
  assert.equal(find(world, '西/重命名目标/叶').situation, '内部值');
  assert.deepEqual(strutTargets(find(world, '西/重命名目标')), ['叶']);
  assert.deepEqual(strutTargets(find(world, '来源')), ['西/重命名目标']);
  const movedTargetId = idOf(find(world, '西/重命名目标'));
  assert.ok(movedTargetId);
  assert.deepEqual(shortcutMetadata(find(world, '引用/入口')).target, {
    state: 'linked', path: '西/重命名目标', identity: movedTargetId
  });

  const protectedTemplate = await run('transform {"thing.ren.越权":"槽体/候选/输入"}');
  assert.equal(protectedTemplate.ok, false, JSON.stringify(protectedTemplate));
  assert.equal(protectedTemplate.errors.some(({ code }) => code === 'SLOT_STRUCTURE_LOCK_DENIED'), true, JSON.stringify(protectedTemplate));
});
