import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], support = []) {
  return { thing, situation, contain, support };
}

async function lockedWorld() {
  const sealed = await applySlotBodyEffect({
    atoms: [atom('槽体', '', [atom('候选', '', [atom('输入'), atom('输出')])])],
    effect: { action: 'seal', body: '槽体', lock: true },
    sourceProgramPath: '封装'
  });
  return (await applySlotBodyEffect({
    atoms: sealed.atoms,
    effect: { action: 'print', body: '槽体', name: '实例', revision: sealed.receipt.revision },
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
    situation: 'slot_body({"action":"seal","body":"\u69fd\u4f53","lock":True})',
    contain: [], support: []
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
    source: 'transform new {"thing":"槽体/槽例/实例/输入/料","situation":"值","contain":[],"support":[]}',
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
    source: 'transform new {"thing@slot-role-fake":"槽体/槽例/实例/输入/伪槽","situation":"","contain":[],"support":[]}',
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
