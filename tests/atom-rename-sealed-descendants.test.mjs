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
import { executeAtomLanguage as executeKernel } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

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

async function discardFixture() {
  const atoms = await fixture();
  atoms.push({ 'thing@backup@default': 'Backup', situation: '', slot: [], strut: [] });
  return atoms;
}

async function authorityArchive(t, extraProgram = null, workerSource = 'agent({"labels":["historical"],"functions":{"groups":[],"names":["explore"]}})') {
  const atoms = [{ 'thing@program': 'Root',
    situation: 'agent({"labels":[],"functions":{"groups":["graph","program"],"names":[]}})', strut: [], slot: [
      atom('Parent', [{ 'thing@program': 'Worker', situation: workerSource, slot: [], strut: [] }, atom('Data', [], 'old')]),
      { 'thing@backup@default': 'Backup', situation: '', slot: [], strut: [] }
    ] }];
  if (extraProgram) find(atoms, 'Root/Parent').slot.push(extraProgram);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-restore-authority-'));
  t.diagnostic(`retained fixture: ${directory}`);
  const files = { contextFile: path.join(directory, 'atom.json'), graphFile: path.join(directory, 'graph.json'), storeFile: path.join(directory, 'knowledge.json') };
  await fs.writeFile(files.contextFile, JSON.stringify(atoms));
  const execute = createRuntimeCliExecutor(files);
  const run = (id, request, create = false) => execute({ source: `transform ${create ? 'new ' : ''}${JSON.stringify(request)}`, interaction: { id, agent: { path: 'Root' } } });
  const discarded = await run('archive', { 'thing.dsc.': 'Root/Parent' });
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  return { files, run, workerSource, discarded, directory };
}

for (const change of ['labels', 'functions', 'source', 'new-agent', 'mixed']) {
  test(`trusted restore never reuses historical authority after ${change} changes`, async (t) => {
    const { files, run, workerSource, discarded } = await authorityArchive(t);
    const archivePath = discarded.archive.path;
    if (change === 'new-agent') {
      const created = await run('new-inactive-agent', { 'thing@program': `${archivePath}/Added`, situation: workerSource, slot: [], strut: [] }, true);
      assert.equal(created.ok, true, JSON.stringify(created.errors));
    } else if (change !== 'mixed') {
      const altered = change === 'labels' ? workerSource.replace('historical', 'new-label')
        : change === 'functions' ? workerSource.replace('explore', 'work_order')
          : `${workerSource}\n# changed archived source`;
      const edited = await run('edit-inactive-agent', { thing: `${archivePath}/Worker`, [`situation.rep.${altered}`]: workerSource });
      assert.equal(edited.ok, true, JSON.stringify(edited.errors));
    }
    const before = await fs.readFile(files.contextFile, 'utf8');
    const restored = await run('restore', { 'thing.rst.': discarded.archive.restoreCoordinate,
      ...(change === 'mixed' ? { 'situation.sum.changed': null } : {}) });
    assert.equal(restored.ok, false, JSON.stringify(restored));
    assert.match(restored.errors[0].code, /DELEGATION|JURISDICTION/);
    assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
  });
}

test('trusted restore preserves historical authority after ordinary archive data edits', async (t) => {
  const { files, run, discarded } = await authorityArchive(t);
  const edited = await run('edit-data', { thing: `${discarded.archive.path}/Data`, 'situation.rep.new': 'old' });
  assert.equal(edited.ok, true, JSON.stringify(edited.errors));
  const restored = await run('restore', { 'thing.rst.': discarded.archive.restoreCoordinate });
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Root/Parent/Data').situation, 'new');
});

test('trusted restore recovers historical function scope the ancestor cannot delegate', async (t) => {
  const historical = 'agent({"labels":[],"functions":{"groups":[],"names":["work_order"]}})';
  const { files, run, discarded } = await authorityArchive(t, null, historical);
  const restored = await run('restore-historical-function', { 'thing.rst.': discarded.archive.restoreCoordinate });
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Root/Parent/Worker').situation, historical);
});

test('trusted restore cannot use an auxiliary log without central evidence', async (t) => {
  const { files, discarded } = await authorityArchive(t);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeKernel({ contextFile: files.contextFile, projectionFile: files.graphFile,
    source: `transform ${JSON.stringify({ 'thing.rst.': discarded.archive.restoreCoordinate })}`,
    interaction: { id: 'no-central-provider', agent: { path: 'Root' } },
    programScheduler: createProgramRuntimeScheduler({ projectionRepository: createJsonProgramProjectionRepository({
      file: path.join(path.dirname(files.contextFile), 'program-projection.json')
    }) }) });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.errors[0].code, 'AGENT_LABEL_DELEGATION_DENIED');
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

for (const history of ['ancestor-patch', 'snapshot', 'injected-at-discard']) {
  test(`trusted restore reads exact original declarations from ${history} and rejects wrong identities`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-restore-evidence-'));
    t.diagnostic(`retained fixture: ${directory}`);
    const contextFile = path.join(directory, 'atom.json');
    const projectionFile = path.join(directory, 'graph.json');
    const original = [atom('Root', [atom('Parent', [{ 'thing@program': 'Worker', situation: 'agent({"labels":["historical"],"functions":{"groups":[],"names":["explore"]}})', slot: [], strut: [] }]),
      { 'thing@backup@default': 'Backup', situation: '', slot: [], strut: [] }])];
    original[0]['thing@program'] = original[0].thing;
    delete original[0].thing;
    original[0].situation = 'agent({"labels":[],"functions":{"groups":["graph","program"],"names":[]}})';
    await fs.writeFile(contextFile, JSON.stringify(original));
    const parsed = createAtomLanguageReceiver().receive('transform {"thing.dsc.":"Root/Parent"}');
    const archived = await applyTransform({ atoms: original, item: parsed.items[0], contextFile });
    if (history === 'injected-at-discard') {
      archived.atoms = structuredClone(archived.atoms);
      find(archived.atoms, `${archived.archive.path}/Worker`).situation = 'agent({"labels":["injected"],"functions":{"groups":[],"names":["explore"]}})';
    }
    const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile, publishLegacyProjection: false });
    await persistence.commit({ correlationId: 'original-discard', expectedRevision: revisionOfWorldFacts(original),
      nextRevision: revisionOfWorldFacts(archived.atoms), facts: archived.atoms,
      transformLogRecord: archived.logRecord, ...(history !== 'snapshot' ? { changedPaths: ['Root'] } : {}) });
    const identity = { discardId: archived.archive.discardId, archivePath: archived.archive.path, originalPath: 'Root/Parent' };
    const evidence = await persistence.readDiscardEvidence(identity);
    assert.deepEqual(evidence.originalAtom, find(original, 'Root/Parent'));
    assert.deepEqual(evidence.archivedAtom, find(archived.atoms, archived.archive.path));
    for (const mismatch of [{ discardId: 'wrong-discard' }, { archivePath: 'Root/Backup/Wrong' }, { originalPath: 'Root/Wrong' }]) {
      assert.equal(await persistence.readDiscardEvidence({ ...identity, ...mismatch }), null);
    }
    const wrongWorld = createTransactionalWorldPersistence({ contextFile, projectionFile, worldId: 'another-world', publishLegacyProjection: false });
    assert.equal(await wrongWorld.readDiscardEvidence(identity), null);
    if (history === 'injected-at-discard') {
      const execute = createRuntimeCliExecutor({ contextFile, graphFile: projectionFile, storeFile: path.join(directory, 'knowledge.json') });
      const restored = await execute({ source: `transform ${JSON.stringify({ 'thing.rst.': archived.archive.restoreCoordinate })}`,
        interaction: { id: 'restore-injected-history', agent: { path: 'Root' } } });
      assert.equal(restored.ok, false, JSON.stringify(restored));
      assert.equal(restored.errors[0].code, 'AGENT_LABEL_DELEGATION_DENIED');
      assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Root/Parent'), undefined);
    }
  });
}

test('trusted restore permits independently authorized declaration changes without exemption', async (t) => {
  const { files, run, discarded, workerSource } = await authorityArchive(t);
  // The ordinary archived source is changed first, so its declaration cannot
  // acquire the journal-backed identity. A legitimate new Agent still follows
  // normal delegation instead of inheriting the historical Worker scope.
  const allowed = 'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})';
  const edited = await run('legitimate-reconfiguration', { thing: `${discarded.archive.path}/Worker`, [`situation.rep.${allowed}`]: workerSource });
  assert.equal(edited.ok, true, JSON.stringify(edited.errors));
  const restored = await run('restore-legitimate-change', { 'thing.rst.': discarded.archive.restoreCoordinate });
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Root/Parent/Worker').situation, allowed);
});

test('trusted restore rechecks subsequent Agent additions before effects commit', async (t) => {
  const added = { 'thing@program': 'Root/Parent/Added',
    situation: 'agent({"labels":["new-label"],"functions":{"groups":[],"names":["explore"]}})', slot: [], strut: [] };
  const reactive = { 'thing@program': 'Reactive', situation: [
    'def main():', `    transform(${JSON.stringify(added)})`,
    'trigger("transform", {"nodes":["Root/Parent"]}, main)'
  ].join('\n'), slot: [], strut: [] };
  const { files, run, discarded, workerSource } = await authorityArchive(t, reactive);
  const restored = await run('restore-triggers-new-declaration', { 'thing.rst.': discarded.archive.restoreCoordinate });
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  assert.equal(restored.subsequentExecution?.status, 'failed', JSON.stringify(restored));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(find(stored, 'Root/Parent/Added'), undefined);
  assert.equal(find(stored, 'Root/Parent/Worker').situation, workerSource);
});

test('ancestor discard preserves the sealed subtree without requiring internal slot authority', async () => {
  const atoms = await discardFixture();
  const before = structuredClone(atoms);
  const { authorize } = createAccessController(atoms, {
    agentPath: 'Root', agentSecurity: { labels: [], functions: ['transform'] }
  });
  const model = walkAtoms(atoms).find(({ path }) => path.join('/') === 'Root/Parent/Body/Model');
  assert.equal((await authorize(model, 'write', 'slot')).code, 'SLOT_STRUCTURE_LOCK_DENIED');
  const result = await transform(atoms, 'transform {"thing.dsc.":"Root/Parent"}');
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  assert.deepEqual(atoms, before);
  assert.equal(find(result.atoms, 'Root/Parent'), undefined);
  assert.deepEqual(find(result.atoms, result.archive.path), find(before, 'Root/Parent'));
  assert.equal(result.logRecord.originalPath, 'Root/Parent');
  assert.equal(result.archive.restoreCoordinate, result.archive.path);
});

test('ancestor discard retains root, window, sealed-structure and compound-edit denials', async () => {
  const atoms = await discardFixture();
  const before = structuredClone(atoms);
  for (const [request, agent, code] of [
    [{ 'thing.dsc.': 'Root/Parent' }, 'Root/Sibling', 'WINDOW_ACCESS_DENIED'],
    [{ 'thing.dsc.': 'Root' }, 'Root', 'GRAPH_LOCK_DENIED'],
    [{ 'thing.dsc.': 'Root/Parent/Body/Model/Input' }, 'Root', 'SLOT_STRUCTURE_LOCK_DENIED'],
    [{ 'thing.dsc.': 'Root/Parent', slot: [] }, 'Root', 'WINDOW_ACCESS_DENIED'],
    [{ 'thing.dsc.': 'Root/Parent', 'situation.rep.changed': null }, 'Root', 'WINDOW_ACCESS_DENIED'],
    [{ 'thing.dsc.': 'Root/Parent', 'strut.rep.': [] }, 'Root', 'WINDOW_ACCESS_DENIED']
  ]) {
    const result = await transform(atoms, `transform ${JSON.stringify(request)}`, agent);
    assert.equal(result.error?.code, code, JSON.stringify({ request, error: result.error }));
    assert.deepEqual(atoms, before);
  }
});

test('ancestor discard never grants restore into a locked original destination', async () => {
  const discarded = await transform(await discardFixture(), 'transform {"thing.dsc.":"Root/Parent"}');
  assert.equal(discarded.error, undefined, JSON.stringify(discarded.error));
  const before = structuredClone(discarded.atoms);
  const { authorize } = createAccessController(discarded.atoms, {
    agentPath: 'Root', agentSecurity: { labels: [], functions: ['transform'] },
    graphLocks: [{ kind: 'node', path: 'Root', actions: ['transform'], labels: ['root-lock'] }]
  });
  const parsed = createAtomLanguageReceiver().receive(`transform ${JSON.stringify({ 'thing.rst.': discarded.archive.restoreCoordinate })}`);
  const restored = await applyTransform({ atoms: discarded.atoms, item: parsed.items[0], contextFile: 'atom.json',
    authorize, transactionTransformLog: [discarded.logRecord] });
  assert.equal(restored.error?.code, 'WINDOW_ACCESS_DENIED');
  assert.deepEqual(discarded.atoms, before);
});

for (const rootLabels of [[], ['existing-business']]) {
test(`public ancestor discard persists one reversible sealed archive and cold-restores its Programs with ${rootLabels.length ? 'matching declaration scope' : 'preexisting child-only label'}`, async (t) => {
  const atoms = await discardFixture();
  atoms[0]['thing@program'] = atoms[0].thing;
  delete atoms[0].thing;
  atoms[0].situation = `agent(${JSON.stringify({ labels: rootLabels, functions: { groups: ['graph', 'program'], names: [] } })})`;
  const parent = find(atoms, 'Root/Parent');
  parent.slot.push(atom('Event'), atom('Result', [], 'untouched'));
  parent.slot.push({
    'thing@program': 'Worker',
    situation: 'agent({"labels":["existing-business"],"functions":{"groups":[],"names":["explore"]}})',
    slot: [], strut: []
  });
  parent.slot.push({
    'thing@program': 'Reactive',
    situation: [
      'def main():',
      '    transform({"thing":"Root/Parent/Result","situation.rep.fired":"untouched"})',
      'trigger("transform", {"nodes":["Root/Parent/Event"]}, main)'
    ].join('\n'), slot: [], strut: []
  });
  find(atoms, 'Root/Parent/Event').strut = [{ 'if@current': true, then: [{ thing: 'Root/Parent/Result' }] }];
  find(atoms, 'Root/Sibling').strut = [{ 'if@current': true, then: [{ thing: 'Root/Parent/Event' }] }];
  const shortcut = {
    'thing@shortcut': 'Link', situation: JSON.stringify({
      contract: 'atom.shortcut', version: 1, referenceId: 'ancestor-discard-link',
      target: { state: 'linked', path: 'Root/Parent/Result' }
    }), slot: [], strut: []
  };
  atoms[0].slot.push(shortcut);
  const oldArchive = atom('Parent', [], 'historical archive');
  find(atoms, 'Backup').slot.push(oldArchive);
  const historicalOwner = atom('Owner');
  historicalOwner.strut = [{ 'if@current': true, then: [
    { thing: 'Backup/History/Anchor' }, { thing: 'Root/Parent/Event' }
  ] }];
  find(atoms, 'Backup').slot.push(atom('History', [historicalOwner, atom('Anchor')]));
  const initialParent = structuredClone(parent);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-ancestor-discard-'));
  t.diagnostic(`retained fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json');
  const files = { contextFile, graphFile: path.join(directory, 'graph.json'), storeFile: path.join(directory, 'knowledge.json') };
  await fs.writeFile(contextFile, JSON.stringify(atoms));
  const execute = createRuntimeCliExecutor(files);
  const forbiddenOwnerEdit = await execute({ source: 'transform {"thing":"Backup/History/Owner","strut.rep.":[]}', interaction: { id: 'foreign-owner-denied', agent: { path: 'Root' } } });
  assert.equal(forbiddenOwnerEdit.ok, false);
  assert.equal(forbiddenOwnerEdit.errors[0].code, 'WINDOW_ACCESS_DENIED');
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), atoms);
  const discarded = await execute({ source: 'transform {"thing.dsc.":"Root/Parent"}', interaction: { id: 'ancestor-discard', agent: { path: 'Root' } } });
  assert.equal(discarded.ok, true, JSON.stringify(discarded.errors));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, 'Root/Parent'), undefined);
  assert.deepEqual(find(stored, 'Backup/Parent'), oldArchive);
  const archived = find(stored, discarded.archive.path);
  assert.ok(archived);
  assert.notEqual(discarded.archive.path, 'Backup/Parent');
  assert.equal(archived.situation, initialParent.situation);
  assert.deepEqual(find(stored, `${discarded.archive.path}/Body`), initialParent.slot[0]);
  assert.deepEqual(find(stored, `${discarded.archive.path}/Worker`), initialParent.slot[3]);
  assert.equal(find(stored, `${discarded.archive.path}/Result`).situation, 'untouched');
  assert.equal(find(stored, `${discarded.archive.path}/Event`).strut[0].then[0].thing, `${discarded.archive.path}/Result`);
  assert.equal(find(stored, 'Root/Sibling').strut[0].then[0].thing, `${discarded.archive.path}/Event`);
  assert.deepEqual(JSON.parse(find(stored, 'Root/Link').situation).target, { state: 'broken', path: null });
  assert.deepEqual(find(stored, 'Backup/History/Owner').strut, [{ 'if@current': true, then: [
    { thing: 'Backup/History/Anchor' }, { thing: `${discarded.archive.path}/Event` }
  ] }]);
  const journal = createJsonTransactionJournal({ file: path.join(directory, 'atom.transactions.json') });
  const history = await journal.readState();
  assert.equal(history.receipts.length, 1, JSON.stringify(history.receipts));
  assert.equal(history.receipts[0].receipt.result.transformLogRecord.originalPath, 'Root/Parent');
  for (const referencePath of ['Root/Sibling', 'Root/Link', 'Backup/History/Owner']) {
    assert.ok(history.receipts[0].patch.changedPaths.includes(referencePath), `Missing reversible reference ${referencePath}`);
  }
  const coldExecute = createRuntimeCliExecutor(files);
  const coldRead = await coldExecute({ source: 'explore {"thing":"Root/Sibling","situation$full":true}', interaction: { id: 'cold-read', agent: { path: 'Root' } } });
  assert.equal(coldRead.ok, true, JSON.stringify(coldRead.errors));
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), stored);
  const mixedRestore = await coldExecute({ source: `transform ${JSON.stringify({ 'thing.rst.': discarded.archive.restoreCoordinate, 'strut.rep.': [] })}`, interaction: { id: 'mixed-restore-denied', agent: { path: 'Root' } } });
  assert.equal(mixedRestore.ok, false);
  assert.equal(mixedRestore.errors[0].code, 'WINDOW_ACCESS_DENIED');
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), stored);
  const restored = await coldExecute({ source: `transform ${JSON.stringify({ 'thing.rst.': discarded.archive.restoreCoordinate })}`, interaction: { id: 'ancestor-restore', agent: { path: 'Root' } } });
  assert.equal(restored.ok, true, JSON.stringify(restored.errors));
  const afterRestore = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(find(afterRestore, 'Root/Parent'), initialParent);
  assert.deepEqual(find(afterRestore, 'Backup/Parent'), oldArchive);
  assert.deepEqual(find(afterRestore, 'Root/Sibling'), find(atoms, 'Root/Sibling'));
  assert.deepEqual(find(afterRestore, 'Root/Link'), shortcut);
  assert.deepEqual(find(afterRestore, 'Backup/History/Owner'), historicalOwner);
  const restoredHistory = await journal.readState();
  assert.ok(restoredHistory.receipts.at(-1).patch.changedPaths.includes('Backup/History/Owner'));
  const denied = await coldExecute({ source: 'transform {"thing.ren.Broken":"Root/Parent/Body/Model/Input"}', interaction: { id: 'sealed-denied', agent: { path: 'Root' } } });
  assert.equal(denied.ok, false);
  assert.equal(denied.errors[0].code, 'SLOT_STRUCTURE_LOCK_DENIED');
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), afterRestore);
  const invoked = await coldExecute({ source: 'transform {"thing":"Root/Parent/Event","situation.rep.changed"}', interaction: { id: 'restored-trigger', agent: { path: 'Root' } } });
  assert.equal(invoked.ok, true, JSON.stringify(invoked.errors));
  assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Root/Parent/Result').situation, 'fired');
});
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
