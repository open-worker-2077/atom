import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccessController, walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';

function atom(name, detail = '', children = [], partners = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners };
}

function fixture() {
  return [atom('槽体', '', [atom('候选', '', [
    atom('输入', '契约'), atom('输出', '契约')
  ])])];
}

function find(atoms, path) {
  return walkAtoms(atoms).find((entry) => entry.path.join('/') === path);
}

async function sealed(lock) {
  const result = await applySlotBodyEffect({
    atoms: fixture(), effect: { action: 'seal', body: '槽体', lock }, sourceProgramPath: '封装'
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
  const atoms = await sealed(true);
  const input = find(atoms, '槽体/槽例/实例/输入');
  input.atom.children.push(atom('料', '可写'));
  const material = find(atoms, '槽体/槽例/实例/输入/料');
  const controller = createAccessController(atoms, {});

  const mapped = await controller.authorize(input, 'write', 'detail');
  assert.equal(mapped.decision, 'deny');
  assert.equal(mapped.code, 'SLOT_STRUCTURE_LOCK_DENIED');
  assert.equal((await controller.authorize(material, 'write', 'detail')).decision, 'allow');
  assert.equal((await controller.authorize(
    input, 'write', 'children', { slotMaterialCreate: true }
  )).decision, 'allow');
  const forged = await controller.authorize({
    atom: atom('伪槽', '', [], [{ verb: '槽模角色', object: 'fake' }]),
    path: ['槽体', '槽例', '实例', '输入', '伪槽']
  }, 'write', undefined, {
    slotMaterialCreate: true,
    createdAtom: atom('伪槽', '', [], [{ verb: '槽模角色', object: 'fake' }])
  });
  assert.equal(forged.decision, 'deny');
  assert.equal(forged.code, 'SLOT_ROLE_FORGERY_DENIED');
});

test('slot_body seal lock defaults off', async () => {
  const atoms = await sealed(false);
  const input = find(atoms, '槽体/槽例/实例/输入');
  assert.equal((await createAccessController(atoms, {}).authorize(
    input, 'write', 'detail'
  )).decision, 'allow');
});

test('reseal still requires the caller lock intersection and denial rolls back every projection', async () => {
  const atoms = await sealed(true);
  const before = structuredClone(atoms);
  const denied = await applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '\u69fd\u4f53', lock: true },
    sourceProgramPath: '\u4e0a\u65b9\u7a97\u53e3/Seal',
    authorize: async () => ({ decision: 'deny' })
  });
  assert.equal(denied.error.code, 'PROGRAM_LOCK_DENIED');
  assert.deepEqual(atoms, before);

  find(atoms, '\u69fd\u4f53/\u69fd\u4f8b/\u5b9e\u4f8b/\u8f93\u5165').atom.children.push(atom('\u672c\u5730\u6599', '\u4fdd\u7559'));
  const allowed = await applySlotBodyEffect({
    atoms,
    effect: { action: 'seal', body: '\u69fd\u4f53', lock: true },
    sourceProgramPath: '\u4e0a\u65b9\u7a97\u53e3/Seal',
    authorize: async () => ({ decision: 'allow' })
  });
  assert.equal(allowed.error, undefined);
  assert.notEqual(find(allowed.atoms, '\u69fd\u4f53/\u69fd\u4f8b/\u5b9e\u4f8b/\u8f93\u5165/\u672c\u5730\u6599'), undefined);
});
