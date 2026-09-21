import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository
} from '../src/atom-system/adapters/json-world-repository.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { rebuildThingIdWatermark } from '../work-engine/atom-language/thing-id-allocator.mjs';

const run = promisify(execFile);
const operator = path.resolve('scripts/deploy-thing-identity-world.mjs');
const legacy = Object.freeze({
  root: 'AAAAAAAAAAAAAAAAAAAAAA',
  target: 'BBBBBBBBBBBBBBBBBBBBBB',
  program: 'CCCCCCCCCCCCCCCCCCCCCC'
});
const programSource = 'explore({"thing":ref("Root/Target")})';
const sourceHash = `sha256:${createHash('sha256').update(programSource).digest('hex')}`;

function atom(id, name, { types = [], situation = '', slot = [] } = {}) {
  return {
    [`thing${types.map(type => `@${type}`).join('')}&id=${id}`]: name,
    situation,
    slot,
    strut: []
  };
}

async function fixture(t) {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-short-id-deploy-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  await fs.mkdir(worldDirectory, { recursive: true });
  const initialFacts = [atom(legacy.root, 'Root', { slot: [atom(legacy.target, 'Target')] })];
  const facts = [atom(legacy.root, 'Root', { slot: [
    atom(legacy.target, 'Target'),
    atom(legacy.program, 'Program', { types: ['program'], situation: programSource })
  ] })];
  const contextFile = path.join(worldDirectory, 'atom.json');
  const projectionFile = path.join(worldDirectory, 'graph.json');
  const journalFile = path.join(worldDirectory, 'atom.transactions.json');
  await fs.writeFile(contextFile, `${JSON.stringify(initialFacts, null, 2)}\n`);
  await fs.writeFile(projectionFile, `${JSON.stringify(initialFacts, null, 2)}\n`);
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile, journalFile, publishLegacyProjection: false
  });
  const bindings = createProgramRefBindingUpdate({ replacements: [{
    programThingId: legacy.program,
    sourceHash,
    sites: [{ fingerprint: 'ref:module.body[0]:0', role: 'ref', targetThingId: legacy.target }]
  }] });
  const initialRevision = revisionOfWorldFacts(initialFacts);
  const revision = revisionOfWorldFacts(facts);
  await persistence.commit({
    correlationId: 'seed-legacy-bindings', expectedRevision: initialRevision, nextRevision: revision,
    facts, source: 'test-seed', programRefBindings: bindings
  });
  return { localAppData, worldDirectory, persistence, facts, bindings, revision };
}

test('cold operator commits facts, binding generation and allocator watermark in one receipt', async (t) => {
  const f = await fixture(t);
  const environment = { ...process.env, LOCALAPPDATA: f.localAppData };
  const beforeAtom = await fs.readFile(path.join(f.worldDirectory, 'atom.json'));
  const beforeMetadata = await f.persistence.readInternalMetadataState();

  const dry = JSON.parse((await run(process.execPath, [operator, '--dry-run', '--attempt', 'dry'], {
    env: environment
  })).stdout);
  assert.equal(dry.summary.thingCount, 3);
  assert.deepEqual(await fs.readFile(path.join(f.worldDirectory, 'atom.json')), beforeAtom);
  assert.deepEqual(await f.persistence.readInternalMetadataState(), beforeMetadata);

  const applied = JSON.parse((await run(process.execPath, [operator, '--apply', '--attempt', 'apply'], {
    env: environment
  })).stdout);
  assert.equal(applied.summary.allocatorWatermark, '003');
  assert.equal(JSON.stringify(applied).includes(legacy.target), false);
  assert.equal(JSON.stringify(applied).includes('001'), false);

  const journalFile = path.join(f.worldDirectory, 'atom.transactions.json');
  const journal = createJsonTransactionJournal({ file: journalFile });
  const metadata = await journal.readMetadataState();
  const migration = metadata.receipts.at(-1).receipt.result;
  assert.equal(migration.thingIdentityMigration.thingCount, 3);
  assert.equal(migration.thingIdentityAllocator.nextWatermark, '003');
  assert.equal(migration.programRefBindings.replacements[0].programThingId, '003');
  assert.equal(rebuildThingIdWatermark(metadata.receipts), '003');
  assert.equal(rebuildProgramRefBindings(metadata.receipts).forProgram('003').sites[0].targetThingId, '002');
  assert.equal((await fs.stat(applied.backup.receiptFile)).isFile(), true);
  assert.equal((await fs.stat(applied.backup.identityMapFile)).isFile(), true);

  const privateMap = await fs.readFile(applied.backup.identityMapFile);
  await fs.writeFile(applied.backup.identityMapFile, '{}\n');
  await assert.rejects(run(process.execPath, [operator, '--rollback', applied.receiptFile], {
    env: environment
  }));
  const stillDeployed = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  assert.equal(rebuildThingIdWatermark(stillDeployed.receipts), '003');
  await fs.writeFile(applied.backup.identityMapFile, privateMap);

  const rolledBack = JSON.parse((await run(process.execPath, [operator, '--rollback', applied.receiptFile], {
    env: environment
  })).stdout);
  assert.equal(rolledBack.ok, true);
  const repository = createJsonWorldRepository({
    file: path.join(f.worldDirectory, 'atom.json'),
    worldId: 'primary',
    localCommitFile: path.join(`${journalFile}.d`, 'world-commits.jsonl')
  });
  assert.deepEqual((await repository.read()).facts, f.facts);
  const restoredMetadata = await createJsonTransactionJournal({ file: journalFile }).readMetadataState();
  assert.equal(rebuildThingIdWatermark(restoredMetadata.receipts), '000');
  assert.deepEqual(rebuildProgramRefBindings(restoredMetadata.receipts).forProgram(legacy.program),
    f.bindings.replacements[0]);
  assert.equal(rebuildProgramRefBindings(restoredMetadata.receipts).forProgram('003'), null);
});
