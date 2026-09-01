import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { readVisibleSlotPlans } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import {
  inheritPreparedSlotStructureWorld,
  prepareSlotStructureWorld
} from '../work-engine/atom-language/query-capability.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], strut = []) {
  return { thing, situation, slot, strut };
}

function thingOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@#]/u)[0] === 'thing')?.[1];
}

async function lockedWorld() {
  const sealed = await applySlotBodyEffect({
    atoms: [atom('槽体', '', [atom('候选', '', [atom('输入'), atom('输出')])])],
    effect: { action: 'seal', body: '槽体' },
    sourceProgramPath: '封装'
  });
  assert.equal(sealed.error, undefined);
  const visiblePlans = readVisibleSlotPlans(sealed.atoms);
  assert.equal(visiblePlans.length, 1);
  assert.equal(visiblePlans[0].plan.revision, sealed.receipt.revision);
  return (await applySlotBodyEffect({
    atoms: sealed.atoms,
    effect: {
      action: 'print', body: '槽体', name: '实例', revision: visiblePlans[0].plan.revision
    },
    sourceProgramPath: '槽体/print'
  })).atoms;
}

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-structure-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const atoms = await lockedWorld();
  atoms.push({
    'thing@program': 'Seal',
    situation: 'slot_body({"action":"seal","body":"\u69fd\u4f53"})',
    slot: [], strut: []
  });
  atoms.push({
    'thing@program': 'ModifyAndSeal',
    situation: [
      'transform({"thing":"\u69fd\u4f53/\u69fd\u6a21/\u8f93\u5165","situation.rep.v2":None})',
      'slot_body({"action":"seal","body":"\u69fd\u4f53"})'
    ].join('\n'),
    slot: [], strut: []
  });
  atoms.push(atom('OtherBody', '', [atom('Candidate', '', [atom('Field')])]));
  atoms.push({
    'thing@program': 'CrossBodySeal',
    situation: [
      'transform({"thing":"\u69fd\u4f53/\u69fd\u6a21/\u8f93\u5165","situation.rep.v3":None})',
      'slot_body({"action":"seal","body":"OtherBody"})'
    ].join('\n'),
    slot: [], strut: []
  });
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

test('central Transform denies mapped self, permits material fill, and rejects forged roles', async (t) => {
  const files = await setup(t);
  const mapped = await executeAtomLanguage({
    source: 'transform {"thing":"槽体/槽例/实例/输入","situation.rep.篡改"}', ...files
  });
  assert.equal(mapped.ok, false);
  assert.ok(mapped.errors.some((error) => error.code === 'SLOT_STRUCTURE_LOCK_DENIED'));

  const material = await executeAtomLanguage({
    source: 'transform new {"thing":"槽体/槽例/实例/输入/料","situation":"值","slot":[],"strut":[]}',
    ...files
  });
  assert.equal(material.ok, true, JSON.stringify(material.errors));

  const movedMaterial = await executeAtomLanguage({
    source: 'transform {"thing.mov.槽体/槽例/实例/输出":"槽体/槽例/实例/输入/料"}',
    ...files
  });
  assert.equal(movedMaterial.ok, true, JSON.stringify(movedMaterial.errors));

  const movedRole = await executeAtomLanguage({
    source: 'transform {"thing.mov.槽体/槽例/实例/输出":"槽体/槽例/实例/输入"}',
    ...files
  });
  assert.equal(movedRole.ok, false);
  assert.ok(movedRole.errors.some((error) => error.code === 'SLOT_STRUCTURE_LOCK_DENIED'));

  const forged = await executeAtomLanguage({
    source: 'transform new {"thing@slot-role-fake":"槽体/槽例/实例/输入/伪槽","situation":"","slot":[],"strut":[]}',
    ...files
  });
  assert.equal(forged.ok, false);
  assert.ok(forged.errors.some((error) => error.code === 'SLOT_ROLE_FORGERY_DENIED'));
});

test('authorized reseal replaces its own mapped projections without a structural-lock bypass for callers', async (t) => {
  const files = await setup(t);
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Seal"}',
    programScheduler: createProgramRuntimeScheduler(),
    ...files
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('one Program may edit its model and reseal the same slot body atomically', async (t) => {
  const files = await setup(t);
  const material = await executeAtomLanguage({
    source: 'transform new {"thing":"\u69fd\u4f53/\u69fd\u4f8b/\u5b9e\u4f8b/\u8f93\u5165/\u672c\u5730\u6599","situation":"\u4fdd\u7559","slot":[],"strut":[]}',
    ...files
  });
  assert.equal(material.ok, true, JSON.stringify(material.errors));
  const materialWorld = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const before = JSON.stringify(materialWorld
    .find((entry) => thingOf(entry) === '\u69fd\u4f53').slot
    .find((entry) => thingOf(entry) === '\u69fd\u4f8b').slot
    .find((entry) => thingOf(entry) === '\u5b9e\u4f8b').slot
    .find((entry) => thingOf(entry) === '\u8f93\u5165').slot);

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"ModifyAndSeal"}',
    programScheduler: createProgramRuntimeScheduler(),
    ...files
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const committed = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const body = committed.find((entry) => thingOf(entry) === '\u69fd\u4f53');
  const modelInput = body.slot.find((entry) => thingOf(entry) === '\u69fd\u6a21')
    .slot.find((entry) => thingOf(entry) === '\u8f93\u5165');
  const instanceInput = body.slot.find((entry) => thingOf(entry) === '\u69fd\u4f8b')
    .slot.find((entry) => thingOf(entry) === '\u5b9e\u4f8b').slot
    .find((entry) => thingOf(entry) === '\u8f93\u5165');
  assert.equal(modelInput.situation, 'v2');
  assert.equal(instanceInput.situation, 'v2');
  assert.equal(JSON.stringify(instanceInput.slot), before);
});

test('a Program cannot borrow reseal capability from another slot body', async (t) => {
  const files = await setup(t);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"CrossBodySeal"}',
    programScheduler: createProgramRuntimeScheduler(),
    ...files
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'SLOT_STRUCTURE_LOCK_DENIED'));
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

test('structure-preserving edits reuse slot locks only when changed paths stay outside slot domains', async () => {
  const previous = await lockedWorld();
  previous.push(atom('普通区', '', [atom('待移动')]));
  Object.freeze(previous);
  const prepared = prepareSlotStructureWorld(previous);

  const unrelatedNext = structuredClone(previous);
  Object.freeze(unrelatedNext);
  assert.equal(inheritPreparedSlotStructureWorld(
    previous,
    unrelatedNext,
    ['普通区/待移动', '普通区/目标/待移动']
  ), true);
  assert.equal(prepareSlotStructureWorld(unrelatedNext), prepared);

  const protectedNext = structuredClone(previous);
  Object.freeze(protectedNext);
  assert.equal(inheritPreparedSlotStructureWorld(
    previous,
    protectedNext,
    ['槽体/槽模/输入']
  ), false);
  assert.notEqual(prepareSlotStructureWorld(protectedNext), prepared);
});
