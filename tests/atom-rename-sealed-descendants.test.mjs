import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeCliExecutor } from '../src/atom-system/adapters/runtime-cli-executor.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { applySlotBodyEffect } from '../work-engine/atom-language/slot-body-runtime.mjs';
import { createAccessController, walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { applyTransform, applyBatchRenames } from '../work-engine/atom-language/transform-executor.mjs';

const atom = (thing, slot = [], situation = '') => ({ thing, situation, slot, strut: [] });
const find = (atoms, path) => walkAtoms(atoms).find((m) => m.path.join('/') === path)?.atom;

async function fixture() {
  const sealed = await applySlotBodyEffect({
    atoms: [atom('Root', [atom('Parent', [atom('Body', [atom('Model', [atom('Input')])])]), atom('Sibling')])],
    effect: { action: 'seal', body: 'Root/Parent/Body' }, sourceProgramPath: 'Root/Parent/Body'
  });
  assert.equal(sealed.error, undefined);
  return sealed.atoms;
}

async function transform(atoms, source, agentPath = 'Root', batch = false) {
  const parsed = createAtomLanguageReceiver().receive(source);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const { authorize } = createAccessController(atoms, {
    agentPath, agentSecurity: { labels: [], functions: ['transform'] },
    graphLocks: [{ kind: 'node', path: 'Root', actions: ['transform'], labels: ['root-lock'] }]
  });
  const request = { atoms, contextFile: 'atom.json', authorize };
  return batch ? applyBatchRenames({ ...request, items: parsed.items }) : applyTransform({ ...request, item: parsed.items[0] });
}

for (const batch of [false, true]) {
  test(`${batch ? 'batch' : 'single'} ancestor rename preserves a sealed model and its lock`, async () => {
    const atoms = await fixture();
    const before = JSON.stringify(atoms);
    const model = structuredClone(find(atoms, 'Root/Parent/Body/Model'));
    const request = { 'thing.ren.Renamed': 'Root/Parent' };
    const result = await transform(atoms, `transform ${JSON.stringify(batch ? [request] : request)}`, 'Root', batch);
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(JSON.stringify(atoms), before);
    assert.equal(find(result.atoms, 'Root/Parent'), undefined);
    assert.deepEqual(find(result.atoms, 'Root/Renamed/Body/Model'), model);
    const denied = await transform(result.atoms, 'transform {"thing.ren.Broken":"Root/Renamed/Body/Model/Input"}');
    assert.equal(denied.error?.code, 'SLOT_STRUCTURE_LOCK_DENIED');
  });
}

test('atomic sibling name swaps preserve existing descendant Agent declarations', async () => {
  const worker = { 'thing@program': 'Worker', situation: 'agent({"labels":["existing-business"],"functions":{"groups":[],"names":["explore"]}})', slot: [], strut: [] };
  const root = { 'thing@program': 'Root', situation: 'agent({"labels":[],"functions":{"groups":["graph","program"],"names":[]}})', slot: [atom('A', [worker]), atom('B')], strut: [] };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-rename-swap-'));
  const contextFile = path.join(dir, 'atom.json');
  await fs.writeFile(contextFile, JSON.stringify([root]));
  const execute = createRuntimeCliExecutor({ contextFile, graphFile: path.join(dir, 'graph.json'), storeFile: path.join(dir, 'knowledge.json') });
  const result = await execute({ source: 'transform [{"thing.ren.B":"Root/A"},{"thing.ren.A":"Root/B"}]', interaction: { id: 'swap', agent: { path: 'Root' } } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const after = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(find(after, 'Root/B/Worker'), worker);
  assert.equal(find(after, 'Root/A/Worker'), undefined);
});

test('batch rename records external references in its reversible transaction', async () => {
  const external = atom('External');
  external.strut = [{ 'if@current': true, then: [{ thing: 'Root/A' }] }];
  const program = { 'thing@program': 'ReferenceProgram', situation: "TARGET = 'Root/A'", slot: [], strut: [] };
  const shortcut = { 'thing@shortcut': 'Shortcut', situation: JSON.stringify({ contract: 'atom.shortcut', version: 1, referenceId: 'rename-reference', target: { state: 'linked', path: 'Root/A' } }), slot: [], strut: [] };
  const initial = [{ 'thing@program': 'Root', situation: 'agent({"labels":[],"functions":{"groups":["graph","program"],"names":[]}})', slot: [atom('A'), external, program, shortcut], strut: [] }];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-rename-patch-'));
  const contextFile = path.join(dir, 'atom.json');
  const graphFile = path.join(dir, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(initial));
  const execute = createRuntimeCliExecutor({ contextFile, graphFile, storeFile: path.join(dir, 'knowledge.json') });
  const result = await execute({ source: 'transform [{"thing.ren.B":"Root/A"}]', interaction: { id: 'reference-batch', agent: { path: 'Root' } } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const journal = createJsonTransactionJournal({ file: path.join(dir, 'atom.transactions.json') });
  const history = (await journal.readState()).receipts.at(-1);
  for (const path of ['Root/External', 'Root/ReferenceProgram', 'Root/Shortcut']) {
    assert.ok(history.patch.changedPaths.includes(path), `Missing reversible path ${path}`);
  }
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile: graphFile });
  await persistence.rollback({ targetCommandId: history.commandId, correlationId: 'undo-reference-batch', expectedRevision: history.receipt.afterRevision });
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), initial);
});

test('rename never grants sibling or locked-root authority and compound slot writes remain denied', async () => {
  const atoms = await fixture();
  const before = JSON.stringify(atoms);
  for (const [source, agent] of [
    ['transform {"thing.ren.Other":"Root/Parent"}', 'Root/Sibling'],
    ['transform {"thing.ren.Other":"Root"}', 'Root'],
    ['transform {"thing.ren.Other":"Root/Parent","slot":[]}', 'Root']
  ]) {
    const result = await transform(atoms, source, agent);
    assert.ok(result.error, source);
    assert.equal(JSON.stringify(atoms), before);
  }
});

for (const batch of [false, true]) {
  test(`${batch ? 'batch' : 'single'} public rename rewrites Program paths without firing business triggers`, async () => {
    const atoms = await fixture();
    atoms[0]['thing@program'] = atoms[0].thing;
    delete atoms[0].thing;
    atoms[0].situation = 'agent({"labels":[],"functions":{"groups":["graph","program"],"names":[]}})';
    const parent = find(atoms, 'Root/Parent');
    parent.slot.push(atom('Result', [], 'untouched'));
    parent.slot.push(atom('Event'));
    const reactive = atom('Reactive', [], [
      'def main():',
      '    transform({"thing":"Root/Parent/Result","situation.rep.fired":"untouched"})',
      'trigger("transform", {"nodes":["Root/Parent/Event"]}, main)'
    ].join('\n'));
    reactive['thing@program'] = reactive.thing;
    delete reactive.thing;
    parent.slot.push(reactive);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-rename-trigger-test-'));
    const contextFile = path.join(directory, 'atom.json');
    await fs.writeFile(contextFile, JSON.stringify(atoms));
    const execute = createRuntimeCliExecutor({ contextFile, graphFile: path.join(directory, 'graph.json'), storeFile: path.join(directory, 'knowledge.json') });
    const rename = { 'thing.ren.Renamed': 'Root/Parent' };
    const result = await execute({ source: `transform ${JSON.stringify(batch ? [rename] : rename)}`, interaction: { id: 'rename', agent: { path: 'Root' } } });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
    assert.equal(find(stored, 'Root/Renamed/Result').situation, 'untouched');
    assert.match(find(stored, 'Root/Renamed/Reactive').situation, /Root\/Renamed\/Result/u);
    const invoked = await execute({ source: 'transform {"thing":"Root/Renamed/Event","situation.rep.changed"}', interaction: { id: 'after-rename', agent: { path: 'Root' } } });
    assert.equal(invoked.ok, true, JSON.stringify(invoked.errors));
    assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Root/Renamed/Result').situation, 'fired');
  });
}
