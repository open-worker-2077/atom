import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryWorldAuthority } from '../src/atom-system/world-runtime/memory-world-authority.mjs';
import { revisionOfWorldFacts, sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';

function version(situation) {
  const facts = [{ thing: 'Root', situation, slot: [], strut: [] }];
  return { facts, revision: sealWorldFactsRevision(facts), compatibilityManifest: null };
}

test('accepted memory version is immediately readable while saved watermark remains behind', () => {
  const before = version('before');
  const after = version('after');
  const authority = createMemoryWorldAuthority({ initialSnapshot: before });

  const accepted = authority.accept({
    expectedVersion: 0,
    expectedRevision: before.revision,
    nextSnapshot: after,
    receipt: { commandId: 'edit-1' }
  });

  assert.equal(accepted.acceptedRevision, after.revision);
  assert.equal(accepted.savedRevision, before.revision);
  assert.equal(authority.snapshot().facts[0].situation, 'after');
  assert.equal(authority.snapshot().compatibilityManifest, null);
});

test('saving an older version cannot roll back the current memory world', () => {
  const before = version('before');
  const after = version('after');
  const authority = createMemoryWorldAuthority({ initialSnapshot: before });
  authority.accept({ expectedVersion: 0, expectedRevision: before.revision, nextSnapshot: after, receipt: { commandId: 'edit-1' } });

  authority.markSaved({ version: 0, revision: before.revision });

  assert.equal(authority.snapshot().revision, after.revision);
  assert.equal(authority.snapshot().facts[0].situation, 'after');
  assert.equal(authority.status().savedRevision, before.revision);
});

test('an obsolete expected revision cannot overwrite a newer accepted version', () => {
  const before = version('before');
  const first = version('first');
  const stale = version('stale');
  const authority = createMemoryWorldAuthority({ initialSnapshot: before });
  authority.accept({ expectedVersion: 0, expectedRevision: before.revision, nextSnapshot: first, receipt: { commandId: 'edit-1' } });

  assert.throws(() => authority.accept({
    expectedVersion: 0,
    expectedRevision: before.revision,
    nextSnapshot: stale,
    receipt: { commandId: 'edit-2' }
  }), { code: 'WORLD_REVISION_CONFLICT' });
  assert.equal(authority.snapshot().facts[0].situation, 'first');
});

test('save acknowledgements use monotonic version when world content returns to an earlier hash', () => {
  const before = version('before');
  const changed = version('changed');
  const returned = version('before');
  const authority = createMemoryWorldAuthority({ initialSnapshot: before });
  const first = authority.accept({ expectedVersion: 0, expectedRevision: before.revision, nextSnapshot: changed,
    receipt: { commandId: 'edit-1' } });
  const second = authority.accept({ expectedVersion: 1, expectedRevision: changed.revision, nextSnapshot: returned,
    receipt: { commandId: 'edit-2' } });

  authority.markSaved({ version: first.acceptedVersion, revision: changed.revision });

  assert.equal(second.acceptedVersion, 2);
  assert.equal(authority.status().savedVersion, 1);
  assert.equal(authority.status().dirty, true);
  assert.equal(authority.snapshot().facts[0].situation, 'before');
});

test('a stale command is rejected even when the content hash cycles back', () => {
  const before = version('before');
  const changed = version('changed');
  const returned = version('before');
  const authority = createMemoryWorldAuthority({ initialSnapshot: before });
  authority.accept({ expectedVersion: 0, expectedRevision: before.revision, nextSnapshot: changed,
    receipt: { commandId: 'edit-1' } });
  authority.accept({ expectedVersion: 1, expectedRevision: changed.revision, nextSnapshot: returned,
    receipt: { commandId: 'edit-2' } });

  assert.throws(() => authority.accept({ expectedVersion: 0, expectedRevision: before.revision,
    nextSnapshot: changed, receipt: { commandId: 'stale-edit' } }), { code: 'WORLD_REVISION_CONFLICT' });
});

test('a shallow-frozen array cannot introduce mutable nested facts into memory authority', () => {
  const facts = [{ thing: 'Root', situation: 'before', slot: [], strut: [] }];
  Object.freeze(facts);
  const revision = revisionOfWorldFacts(facts);

  assert.throws(() => createMemoryWorldAuthority({ initialSnapshot: {
    facts, revision, compatibilityManifest: null
  } }), { code: 'INVALID_WORLD_SNAPSHOT' });
});
