import assert from 'node:assert/strict';
import test from 'node:test';

import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';
import { projectAtomGraphToKnowledge } from '../work-engine/atom-language/graph-4d-projection.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { collectDefaultBackupBoundary } from '../work-engine/atom-language/default-backup-boundary.mjs';
import { sealWorldFactsRevision } from '../src/atom-system/world-runtime/world-revision.mjs';

const atom = (key, name, situation = '', slot = [], strut = []) => ({
  [key]: name,
  situation,
  slot,
  strut
});

function worldWithArchivedSubtree() {
  return [
    atom('thing', 'Active'),
    atom('thing@backup@default', 'Default Backup', '', [
      atom('thing', 'Archived Parent', 'recoverable', [
        atom('thing@program', 'Archived Program', "message({'level':'info','text':'must stay cold'})")
      ])
    ])
  ];
}

test('default-backup descendants remain authoritative but never enter active Graph, Spatial, or Program records', async () => {
  const facts = worldWithArchivedSubtree();
  const before = structuredClone(facts);

  const graph = projectAtomContext(facts);
  const backup = graph.graph.slot.find((entry) => entry['thing@backup@default'] === 'Default Backup');
  assert.ok(backup);
  assert.deepEqual(backup.slot, []);

  const knowledge = await projectAtomGraphToKnowledge(graph);
  assert.equal(knowledge.nodes.some(({ atomPath }) => atomPath?.startsWith('Default Backup/')), false);

  const scheduler = createProgramRuntimeScheduler();
  const records = scheduler.prepareRuntimeRecords(facts);
  assert.deepEqual(records.map(({ path }) => path), ['Active', 'Default Backup']);
  assert.deepEqual(facts, before, 'derived projections must not mutate authoritative archive facts');
});

test('a display name cannot create an inactive backup boundary without explicit types', () => {
  const records = createProgramRuntimeScheduler().prepareRuntimeRecords([
    atom('thing', 'Default Backup', '', [atom('thing', 'Still Active')])
  ]);

  assert.deepEqual(records.map(({ path }) => path), [
    'Default Backup',
    'Default Backup/Still Active'
  ]);
});

test('multiple explicitly typed default-backup roots fail before projection', () => {
  assert.throws(
    () => projectAtomContext([
      atom('thing@backup@default', 'Backup A'),
      atom('thing@backup@default', 'Backup B')
    ]),
    (error) => error.code === 'AMBIGUOUS_DEFAULT_BACKUP'
  );
});

test('active relations into the default-backup subtree are removed before strict Graph validation', () => {
  const facts = worldWithArchivedSubtree();
  facts.push(atom('thing', 'Active Target'));
  facts[0].strut = [{
    'if@current': true,
    then: [
      { thing: 'Active Target' },
      { thing: 'Default Backup/Archived Parent' }
    ]
  }];

  const graph = projectAtomContext(facts);

  assert.deepEqual(graph.graph.slot[0].strut, [{
    'if@current': true,
    then: [{ thing: 'Active Target' }]
  }]);
});

test('identity-bound relations cannot keep an archived endpoint active', () => {
  const archivedId = 'AAAAAAAAAAAAAAAAAAAAAA';
  const facts = [
    {
      'thing&id=BBBBBBBBBBBBBBBBBBBBBB': 'Active',
      situation: '',
      slot: [],
      strut: [{
        'if@current': true,
        then: [{ [`thing&id=${archivedId}`]: 'Former Name' }]
      }]
    },
    {
      'thing@backup@default': 'Default Backup',
      situation: '',
      slot: [{ [`thing&id=${archivedId}`]: 'Archived', situation: '', slot: [], strut: [] }],
      strut: []
    }
  ];

  assert.deepEqual(projectAtomContext(facts).graph.slot[0].strut, []);
});

test('unique archived short names are removed while an active homonym still resolves', () => {
  const facts = worldWithArchivedSubtree();
  facts.unshift(atom('thing', 'Archived Parent'));
  facts[1].strut = [{
    'if@current': true,
    then: [{ thing: 'Archived Parent' }, { thing: 'Archived Program' }]
  }];

  assert.deepEqual(projectAtomContext(facts).graph.slot[1].strut, [{
    'if@current': true,
    then: [{ thing: 'Archived Parent' }]
  }]);
});

test('short-name resolution uses the authoritative nearest domain before pruning', () => {
  const facts = [
    atom('thing', 'Domain', '', [
      atom('thing', 'Source', '', [], [{ 'if@current': true, then: [{ thing: 'X' }] }]),
      atom('thing@backup@default', 'Backup', '', [atom('thing', 'X')])
    ]),
    atom('thing', 'Other', '', [atom('thing', 'X')])
  ];

  assert.deepEqual(projectAtomContext(facts).graph.slot[0].slot[0].strut, []);
});

test('an invalid root-qualified-looking path is not rebound into the source domain', () => {
  const facts = [atom('thing', 'Domain', '', [
    atom('thing', 'Source', '', [], [{
      'if@current': true,
      then: [{ thing: 'Backup/Archived' }]
    }]),
    atom('thing@backup@default', 'Backup', '', [atom('thing', 'Archived')])
  ])];

  assert.throws(
    () => projectAtomContext(facts),
    (error) => error.code === 'STRUT_SELECTOR_NOT_FOUND'
  );
});

test('malformed cold payload is preserved without entering active Graph validation', () => {
  const archived = { thing: 'Cold', situation: 'recoverable', slot: [] };
  const facts = [atom('thing@backup@default', 'Default Backup', '', [archived])];

  const graph = projectAtomContext(facts);

  assert.deepEqual(graph.graph.slot[0].slot, []);
  assert.deepEqual(facts[0].slot[0], archived);
});

test('restoring an archived subtree outside the boundary reactivates its derived records', () => {
  const [, backup] = worldWithArchivedSubtree();
  const restored = backup.slot[0];
  backup.slot = [];

  const records = createProgramRuntimeScheduler().prepareRuntimeRecords([backup, restored]);

  assert.deepEqual(records.map(({ path }) => path), [
    'Default Backup',
    'Archived Parent',
    'Archived Parent/Archived Program'
  ]);
});

test('large archived subtrees keep active derived records bounded to the backup root', () => {
  const archived = Array.from({ length: 12_000 }, (_, index) => (
    atom('thing', `Archived ${index}`)
  ));
  const facts = [atom('thing', 'Active'), atom('thing@backup@default', 'Default Backup', '', archived)];

  const graph = projectAtomContext(facts);
  const records = createProgramRuntimeScheduler().prepareRuntimeRecords(facts);

  assert.equal(graph.graph.slot.length, 2);
  assert.deepEqual(graph.graph.slot[1].slot, []);
  assert.deepEqual(records.map(({ path }) => path), ['Active', 'Default Backup']);
});

test('sealed ordinary edits reuse private archive proof without reparsing archived facts', (t) => {
  const archived = Array.from({ length: 300 }, (_, index) => atom('thing', `Archived ${index}`));
  const before = [atom('thing', 'Active', 'before'),
    atom('thing@backup@default', 'Backup', '', archived)];
  sealWorldFactsRevision(before);
  const prior = collectDefaultBackupBoundary(before);
  prior.entriesByPath.clear();
  prior.entriesByName.get('Archived 0').push({ path: 'forged' });
  prior.thingPathByIdentity.clear();
  prior.inactiveAtomPaths.clear();
  const after = [{ ...before[0], situation: 'after' }, before[1]];
  sealWorldFactsRevision(after);
  const output = [];
  const originalWrite = process.stderr.write;
  const originalTrace = process.env.ATOM_PERF_TRACE;
  process.env.ATOM_PERF_TRACE = '1';
  t.mock.method(process.stderr, 'write', (chunk, ...args) => {
    output.push(String(chunk));
    return true;
  });
  try {
    const graph = projectAtomContext(after);
    const records = createProgramRuntimeScheduler().prepareRuntimeRecords(after);
    assert.equal(graph.graph.slot[0].situation, 'after');
    assert.deepEqual(records.map(({ path }) => path), ['Active', 'Backup']);
    const again = collectDefaultBackupBoundary(after);
    assert.equal(again.entriesByPath.get('Backup/Archived 0')?.name, 'Archived 0');
    assert.equal(again.entriesByName.get('Archived 0').length, 1);
    const stats = output.flatMap((line) => line.split('\n')).filter((line) => line.includes('"event":"default-backup-boundary"'))
      .map((line) => JSON.parse(line.slice(line.indexOf('{'))));
    assert.ok(stats.some(({ reusedArchiveAtoms, visitedAtoms }) => reusedArchiveAtoms >= 300 && visitedAtoms <= 2),
      'a sealed COW candidate must validate active entries while reusing archived metadata');
  } finally {
    if (originalTrace === undefined) delete process.env.ATOM_PERF_TRACE;
    else process.env.ATOM_PERF_TRACE = originalTrace;
    process.stderr.write = originalWrite;
  }
});

test('archive proof never hides active identity collisions, another backup root, or restore', () => {
  const archivedId = 'AAAAAAAAAAAAAAAAAAAAAA';
  const before = [atom('thing', 'Active'), atom('thing@backup@default', 'Backup', '', [
    atom(`thing&id=${archivedId}`, 'Archived')
  ])];
  sealWorldFactsRevision(before);
  projectAtomContext(before);

  const collision = [atom(`thing&id=${archivedId}`, 'Active'), before[1]];
  sealWorldFactsRevision(collision);
  assert.throws(() => projectAtomContext(collision), { code: 'DUPLICATE_THING_IDENTITY' });

  const multiple = [...before, atom('thing@backup@default', 'Another Backup')];
  sealWorldFactsRevision(multiple);
  assert.throws(() => projectAtomContext(multiple), { code: 'AMBIGUOUS_DEFAULT_BACKUP' });

  const restored = [before[0], { ...before[1], slot: [] }, before[1].slot[0]];
  sealWorldFactsRevision(restored);
  assert.deepEqual(createProgramRuntimeScheduler().prepareRuntimeRecords(restored)
    .map(({ path }) => path), ['Active', 'Backup', 'Archived']);
});
