import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createThingIdAllocationSession,
  rebuildThingIdWatermark,
  thingIdentityAllocatorUpdate
} from '../work-engine/atom-language/thing-id-allocator.mjs';
import { createAtom, renewThingIdentities, storedField } from '../work-engine/atom-language/slot-graph-semantics.mjs';
import { createShortcutAtom } from '../work-engine/atom-language/shortcut-runtime.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

const metadataEntry = (commandId, update) => ({ commandId, receipt: { commandId, result: { thingIdentityAllocator: update } } });

test('allocator receipt replay advances monotonically and ignores no-op receipts', () => {
  const first = thingIdentityAllocatorUpdate({ previousWatermark: '000', ids: ['001', '002'] });
  const second = thingIdentityAllocatorUpdate({ previousWatermark: '002', ids: ['003'] });
  assert.deepEqual(first, { version: 1, previousWatermark: '000', nextWatermark: '002', issued: ['001', '002'] });
  assert.equal(rebuildThingIdWatermark([
    metadataEntry('a', first),
    { commandId: 'noop', receipt: { commandId: 'noop', result: {} } },
    metadataEntry('b', second)
  ]), '003');
});

test('one transaction allocation session advances only after commit confirmation', () => {
  const session = createThingIdAllocationSession('000');
  assert.deepEqual(session.reserve(2), ['001', '002']);
  const first = session.pendingUpdate();
  assert.deepEqual(first, {
    version: 1, previousWatermark: '000', nextWatermark: '002', issued: ['001', '002']
  });
  assert.deepEqual(session.pendingUpdate(), first);
  session.confirm(first);
  assert.equal(session.pendingUpdate(), null);
  assert.deepEqual(session.reserve(1), ['003']);
  const checkpoint = session.checkpoint();
  assert.deepEqual(session.reserve(2), ['004', '005']);
  session.restore(checkpoint);
  session.discard();
  assert.equal(session.pendingUpdate(), null);
  assert.deepEqual(session.reserve(1), ['003']);
  assert.deepEqual(session.pendingUpdate(), {
    version: 1, previousWatermark: '002', nextWatermark: '003', issued: ['003']
  });
});

test('allocator replay rejects gaps, overlap, duplicate issuance and malformed receipts', () => {
  const cases = [
    [metadataEntry('gap', { version: 1, previousWatermark: '000', nextWatermark: '002', issued: ['002'] })],
    [metadataEntry('first', thingIdentityAllocatorUpdate({ previousWatermark: '000', ids: ['001'] })), metadataEntry('overlap', { version: 1, previousWatermark: '000', nextWatermark: '001', issued: ['001'] })],
    [metadataEntry('duplicate', { version: 1, previousWatermark: '000', nextWatermark: '001', issued: ['001', '001'] })],
    [metadataEntry('bad-version', { version: 2, previousWatermark: '000', nextWatermark: '001', issued: ['001'] })]
  ];
  for (const receipts of cases) assert.throws(() => rebuildThingIdWatermark(receipts));
});

test('all Thing constructors require transaction-reserved identities', () => {
  assert.throws(() => createAtom({ thing: '缺门牌' }), { code: 'THING_IDENTITY_REQUIRED' });
  assert.throws(() => createShortcutAtom({ thing: '入口', targetPath: '目标' }), { code: 'THING_IDENTITY_REQUIRED' });
  const created = createAtom({ thing: '已签发', identity: '001' });
  assert.equal(storedField(created, 'thing').parsed.identity, '001');
  const shortcut = createShortcutAtom({ thing: '入口', targetPath: '目标', identity: '002' });
  assert.equal(storedField(shortcut, 'thing').parsed.identity, '002');
});

test('copy renewal consumes an explicit stable sequence and never invents identities', () => {
  const copy = createAtom({ thing: '根', identity: '001', slot: [createAtom({ thing: '子', identity: '002' })] });
  renewThingIdentities([copy], { identities: ['003', '004'] });
  assert.equal(storedField(copy, 'thing').parsed.identity, '003');
  assert.equal(storedField(storedField(copy, 'slot').value[0], 'thing').parsed.identity, '004');
  assert.throws(() => renewThingIdentities([copy], { identities: ['005'] }), { code: 'THING_IDENTITY_ALLOCATION_MISMATCH' });
});

test('successful creates persist one allocator generation while rejected creates consume nothing', async () => {
  let facts = [];
  const receipts = [];
  let sequence = 0;
  const create = thing => executeAtomLanguage({
    contextFile: 'short-id-memory.json',
    projectionFile: 'short-id-memory.graph.json',
    source: `transform new ${JSON.stringify({ thing, situation: '', slot: [], strut: [] })}`,
    interaction: { id: `create-${sequence += 1}` },
    thingIdentityWatermark: rebuildThingIdWatermark(receipts),
    committedSnapshot: { facts, revision: revisionOfWorldFacts(facts) },
    commitWorld: async transition => {
      const beforeRevision = revisionOfWorldFacts(facts);
      facts = transition.facts;
      const receipt = {
        commandId: `command-${sequence}`,
        correlationId: `create-${sequence}`,
        beforeRevision,
        afterRevision: revisionOfWorldFacts(facts),
        result: { thingIdentityAllocator: transition.thingIdentityAllocator }
      };
      receipts.push({ commandId: receipt.commandId, receipt });
      return { ...receipt, result: {} };
    }
  });

  const first = await create('Root');
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.doesNotMatch(JSON.stringify(first), /thingIdentityAllocator|issued/u);
  const duplicate = await create('Root');
  assert.equal(duplicate.ok, false);
  const second = await create('Next');
  assert.equal(second.ok, true, JSON.stringify(second.errors));

  assert.deepEqual(facts.map(entry => storedField(entry, 'thing').parsed.identity), ['001', '002']);
  const allocations = receipts.flatMap(entry => (
    entry.receipt.result.thingIdentityAllocator ? [entry.receipt.result.thingIdentityAllocator] : []
  ));
  assert.deepEqual(allocations.map(update => update.issued), [['001'], ['002']]);
  assert.equal(rebuildThingIdWatermark(receipts), '002');
});

test('copy reserves fresh identities for the complete subtree in the same central receipt', async () => {
  let facts = [
    createAtom({ thing: 'Source', identity: '001', slot: [createAtom({ thing: 'Child', identity: '002' })] }),
    createAtom({ thing: 'Destination', identity: '003' })
  ];
  const receipts = [metadataEntry('seed', thingIdentityAllocatorUpdate({
    previousWatermark: '000', ids: ['001', '002', '003']
  }))];
  const result = await executeAtomLanguage({
    contextFile: 'short-id-copy-memory.json',
    projectionFile: 'short-id-copy-memory.graph.json',
    source: 'transform {"thing.cpy.Destination":"Source"}',
    interaction: { id: 'copy-subtree' },
    thingIdentityWatermark: rebuildThingIdWatermark(receipts),
    committedSnapshot: { facts, revision: revisionOfWorldFacts(facts) },
    commitWorld: async transition => {
      const beforeRevision = revisionOfWorldFacts(facts);
      facts = transition.facts;
      const receipt = {
        commandId: 'copy-command', correlationId: 'copy-subtree', beforeRevision,
        afterRevision: revisionOfWorldFacts(facts),
        result: { thingIdentityAllocator: transition.thingIdentityAllocator }
      };
      receipts.push({ commandId: receipt.commandId, receipt });
      return { ...receipt, result: {} };
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const copied = storedField(facts[1], 'slot').value[0];
  assert.equal(storedField(copied, 'thing').parsed.identity, '004');
  assert.equal(storedField(storedField(copied, 'slot').value[0], 'thing').parsed.identity, '005');
  assert.deepEqual(receipts.at(-1).receipt.result.thingIdentityAllocator.issued, ['004', '005']);
});

test('legacy adapter reconstructs the allocator watermark before every engine execution', async () => {
  const allocation = thingIdentityAllocatorUpdate({ previousWatermark: '000', ids: ['001', '002'] });
  const observed = [];
  const service = createLegacyWorldService({
    transactionProvider: () => ({
      async recover() {},
      async readInternalMetadataState() { return { receipts: [metadataEntry('seed', allocation)] }; }
    }),
    execute: async request => {
      observed.push(request.thingIdentityWatermark);
      return { ok: true, changed: false };
    }
  });
  const request = {
    contextFile: 'adapter-watermark.json', projectionFile: 'adapter-watermark.graph.json',
    source: 'explore Root', interaction: { id: 'watermark-read' }
  };
  await service.executeLegacy(request);
  assert.deepEqual(observed, ['002']);
});

test('legacy adapter retries one stale allocator candidate from fresh central metadata', async () => {
  const receipts = [metadataEntry('first', thingIdentityAllocatorUpdate({
    previousWatermark: '000', ids: ['001']
  }))];
  const observed = [];
  let commits = 0;
  const persistence = {
    async recover() {},
    async readInternalMetadataState() { return { receipts }; },
    async commit() {
      commits += 1;
      if (commits === 1) {
        receipts.push(metadataEntry('concurrent', thingIdentityAllocatorUpdate({
          previousWatermark: '001', ids: ['002']
        })));
        throw Object.assign(new Error('stale allocation'), { code: 'THING_IDENTITY_WATERMARK_CONFLICT' });
      }
      return { afterRevision: 'sha256:accepted', result: {} };
    }
  };
  const service = createLegacyWorldService({
    transactionProvider: () => persistence,
    execute: async request => {
      observed.push(request.thingIdentityWatermark);
      await request.commitWorld({ expectedRevision: 'before', nextRevision: 'after', facts: [] });
      return { ok: true, changed: true };
    }
  });
  const result = await service.executeLegacy({
    contextFile: 'adapter-retry.json', projectionFile: 'adapter-retry.graph.json',
    source: 'transform {}', interaction: { id: 'allocator-retry' }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(observed, ['001', '002']);
});

test('journal failure and ordinary fact rollback never advance or rewind the allocator', async () => {
  let facts = [];
  const receipts = [];
  let failCommit = true;
  let sequence = 0;
  const create = thing => executeAtomLanguage({
    contextFile: 'short-id-failure-memory.json',
    projectionFile: 'short-id-failure-memory.graph.json',
    source: `transform new ${JSON.stringify({ thing, situation: '', slot: [], strut: [] })}`,
    interaction: { id: `failure-${sequence += 1}` },
    thingIdentityWatermark: rebuildThingIdWatermark(receipts),
    committedSnapshot: { facts, revision: revisionOfWorldFacts(facts) },
    commitWorld: async transition => {
      if (failCommit) {
        failCommit = false;
        throw Object.assign(new Error('journal unavailable'), { code: 'SYNTHETIC_JOURNAL_FAILURE' });
      }
      const beforeRevision = revisionOfWorldFacts(facts);
      facts = transition.facts;
      const receipt = {
        commandId: `accepted-${sequence}`,
        correlationId: `failure-${sequence}`,
        beforeRevision,
        afterRevision: revisionOfWorldFacts(facts),
        result: { thingIdentityAllocator: transition.thingIdentityAllocator }
      };
      receipts.push({ commandId: receipt.commandId, receipt });
      return { ...receipt, result: {} };
    }
  });
  await assert.rejects(() => create('Failed'), { code: 'SYNTHETIC_JOURNAL_FAILURE' });
  assert.deepEqual(facts, []);
  assert.equal(rebuildThingIdWatermark(receipts), '000');
  assert.equal((await create('Accepted')).ok, true);
  assert.equal(storedField(facts[0], 'thing').parsed.identity, '001');
  facts = [];
  assert.equal((await create('After rollback')).ok, true);
  assert.equal(storedField(facts[0], 'thing').parsed.identity, '002');
});

test('central journal persists allocator metadata once while every public receipt stays redacted', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-short-id-transaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  await fs.writeFile(contextFile, '[]');
  const persistence = createTransactionalWorldPersistence({
    contextFile,
    journalFile: path.join(directory, 'transactions.json'),
    projectionFile: path.join(directory, 'graph.json'),
    publishLegacyProjection: false
  });
  const beforeFacts = [];
  const facts = [createAtom({ thing: 'Root', identity: '001' })];
  const update = thingIdentityAllocatorUpdate({ previousWatermark: '000', ids: ['001'] });
  const request = {
    correlationId: 'short-id-central-commit',
    expectedRevision: revisionOfWorldFacts(beforeFacts),
    nextRevision: revisionOfWorldFacts(facts),
    beforeFacts,
    facts,
    source: 'test',
    thingIdentityAllocator: update
  };
  const first = await persistence.commit(request);
  const retry = await persistence.commit(request);
  assert.equal(first.commandId, retry.commandId);
  assert.equal(first.result.thingIdentityAllocator, undefined);
  assert.equal(retry.result.thingIdentityAllocator, undefined);
  const metadata = await persistence.readInternalMetadataState();
  assert.deepEqual(metadata.receipts.at(-1).receipt.result.thingIdentityAllocator, update);
  assert.equal(rebuildThingIdWatermark(metadata.receipts), '001');
  await assert.rejects(() => persistence.commit({
    ...request,
    correlationId: 'stale-short-id-allocation',
    expectedRevision: first.afterRevision,
    beforeFacts: facts,
    facts: [...facts, createAtom({ thing: 'Next', identity: '002' })],
    nextRevision: revisionOfWorldFacts([...facts, createAtom({ thing: 'Next', identity: '002' })]),
    thingIdentityAllocator: update
  }), { code: 'THING_IDENTITY_WATERMARK_CONFLICT' });
});
