import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccessController, walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { compileSlotStructureGraphLocks } from '../work-engine/atom-language/slot-body-plan-runtime.mjs';
import { authorizeWindowGraphPath } from '../work-engine/atom-language/window-lock-v1.mjs';

function atom(thing, situation = '', contain = [], support = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support };
}

function fixture() {
  return [atom('槽体', '', [atom('候选', '', [
    atom('输入', '契约'), atom('输出', '契约')
  ])])];
}

function find(atoms, path) {
  return walkAtoms(atoms).find((entry) => entry.path.join('/') === path);
}

async function sealed() {
  const result = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '槽体' }, sourceProgramPath: '封装'
  });
  assert.equal(result.error, undefined);
  const revision = result.receipt.revision;
  const printed = await applySlotBodyEffect({
    atoms: result.atoms,
    effect: { action: 'print', body: '槽体', name: '实例', revision },
    sourceProgramPath: '槽体/print'
  });
  assert.equal(printed.error, undefined);
  return printed.atoms;
}

test('slot_body seal lock protects mapped self but permits ordinary material below it', async () => {
  const atoms = await sealed();
  const input = find(atoms, '槽体/槽例/实例/输入');
  input.atom.contain.push(atom('料', '可写'));
  const material = find(atoms, '槽体/槽例/实例/输入/料');
  const controller = createAccessController(atoms, {});

  const mapped = await controller.authorize(input, 'write', 'situation');
  assert.equal(mapped.decision, 'deny');
  assert.equal(mapped.code, 'SLOT_STRUCTURE_LOCK_DENIED');
  assert.equal((await controller.authorize(material, 'write', 'situation')).decision, 'allow');
  assert.equal((await controller.authorize(
    input, 'write', 'contain', { slotMaterialCreate: true }
  )).decision, 'allow');
  const forged = await controller.authorize({
    atom: atom('伪槽', '', [], [], 'slot-role-fake'),
    path: ['槽体', '槽例', '实例', '输入', '伪槽']
  }, 'write', undefined, {
    slotMaterialCreate: true,
    createdAtom: atom('伪槽', '', [], [], 'slot-role-fake')
  });
  assert.equal(forged.decision, 'deny');
  assert.equal(forged.code, 'SLOT_ROLE_FORGERY_DENIED');
});

test('slot_body seal always applies the fixed structure lock', async () => {
  const atoms = await sealed();
  const input = find(atoms, '槽体/槽例/实例/输入');
  assert.equal((await createAccessController(atoms, {}).authorize(
    input, 'write', 'situation'
  )).code, 'SLOT_STRUCTURE_LOCK_DENIED');
});

test('slot structure plans compile their adopted revision into the shared Graph authorizer', async () => {
  const atoms = await sealed();
  const compiled = compileSlotStructureGraphLocks(atoms);
  const inputPath = '槽体/槽例/实例/输入';
  const inputLock = compiled.locks.find((lock) => lock.path === inputPath);
  assert.ok(inputLock);
  assert.equal(typeof inputLock.revision, 'string');

  const denied = authorizeWindowGraphPath({
    agentPath: null,
    targetPath: inputPath,
    operation: 'transform',
    locks: compiled.locks,
    labels: [],
    capabilities: []
  });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.code, 'SLOT_STRUCTURE_LOCK_DENIED');

  const materialCreate = authorizeWindowGraphPath({
    agentPath: null,
    targetPath: inputPath,
    operation: 'transform',
    locks: compiled.locks,
    labels: [],
    capabilities: ['slot-material-create']
  });
  assert.equal(materialCreate.decision, 'allow');
});

test('reseal still requires the caller lock intersection and denial rolls back every projection', async () => {
  const atoms = await sealed();
  const before = structuredClone(atoms);
  const denied = await applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '\u69fd\u4f53' },
    sourceProgramPath: '\u4e0a\u65b9\u7a97\u53e3/Seal',
    authorize: async () => ({ decision: 'deny' })
  });
  assert.equal(denied.error.code, 'PROGRAM_LOCK_DENIED');
  assert.deepEqual(atoms, before);

  find(atoms, '\u69fd\u4f53/\u69fd\u4f8b/\u5b9e\u4f8b/\u8f93\u5165').atom.contain.push(atom('\u672c\u5730\u6599', '\u4fdd\u7559'));
  const allowed = await applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '\u69fd\u4f53' },
    sourceProgramPath: '\u4e0a\u65b9\u7a97\u53e3/Seal',
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(allowed.error, undefined);
  assert.notEqual(find(allowed.atoms, '\u69fd\u4f53/\u69fd\u4f8b/\u5b9e\u4f8b/\u8f93\u5165/\u672c\u5730\u6599'), undefined);
});
