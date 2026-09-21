import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { createProgramReferenceIndex } from '../work-engine/atom-language/program-reference-index.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

function atom(id, name, source = '', children = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}&id=${id}`]: name, situation: source, slot: children, strut: [] };
}
function freeze(value) {
  for (const child of Object.values(value ?? {})) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

const hash = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;
const binding = (programThingId, source, targetThingId, fingerprint = 'ref:module.body[0]:0') => ({
  programThingId,
  sourceHash: hash(source),
  sites: [{ fingerprint, role: 'ref', targetThingId }]
});
const receipts = (...replacements) => [{ receipt: { result: {
  programRefBindings: createProgramRefBindingUpdate({ replacements })
} } }];

test('index consumes persisted identities and current ID paths without parsing readable selectors', async () => {
  const sources = Array.from({ length: 10 }, (_, i) => `# ${i}\nexplore({"thing":ref("World/Target")})`);
  const world = freeze([atom('world_________________', 'World', '', [atom('target________________', 'Target'),
    ...Array.from({ length: 100 }, (_, i) => atom(`p${i}`.padEnd(22, '_'), `P${i}`, sources[i % 10], [], 'program'))])]);
  const bytes = JSON.stringify(world);
  const revision = revisionOfWorldFacts(world);
  const replacements = Array.from({ length: 100 }, (_, i) => binding(
    `p${i}`.padEnd(22, '_'), sources[i % 10], 'target________________', `ref:module.body[0]:${i}`
  ));
  const bindings = rebuildProgramRefBindings(receipts(...replacements), replacements);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.equal(index.sitesForTargets(['target________________']).length, 100);
  assert.equal(index.sitesForTargets(['target________________', 'target________________']).length, 100);
  assert.deepEqual(index.sitesForTargets(['absent']), []);
  const [site] = index.sitesForProgram('p7____________________');
  assert.equal(site.programThingId, 'p7____________________');
  assert.equal(site.targetThingId, 'target________________');
  assert.equal(site.exactPath, 'World/Target');
  assert.equal(site.role, 'ref');
  assert.equal(site.sourceHash, hash(sources[7]));
  assert.equal(site.fingerprint, 'ref:module.body[0]:7');
  assert.deepEqual(index.failures, []);
  assert.equal(JSON.stringify(world), bytes);
  assert.equal(revisionOfWorldFacts(world), revision);
});

test('missing binding, source mismatch and missing target quarantine only their Program', async () => {
  const source = 'explore({"thing":ref("World/Target")})';
  const missingId = 'missing'.padEnd(22, '_');
  const staleId = 'stale'.padEnd(22, '_');
  const goneId = 'gone'.padEnd(22, '_');
  const deletedId = 'deleted'.padEnd(22, '_');
  const world = [atom('world_________________', 'World', '', [atom('target________________', 'Target'),
    atom('good__________________', 'Good', source, [], 'program'),
    atom(missingId, 'MissingBinding', source, [], 'program'),
    atom(staleId, 'Stale', `${source}\n# changed`, [], 'program'),
    atom(goneId, 'MissingTarget', source, [], 'program')])];
  const bindings = rebuildProgramRefBindings(receipts(
    binding('good__________________', source, 'target________________'),
    binding(staleId, source, 'target________________'),
    binding(goneId, source, deletedId)
  ), null);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.deepEqual(index.sitesForTargets(['target________________']).map(site => site.programThingId), ['good__________________']);
  assert.deepEqual(index.failures.map(({ programThingId, code }) => ({ programThingId, code })), [
    { programThingId: missingId, code: 'PROGRAM_REF_BINDING_MISSING' },
    { programThingId: staleId, code: 'PROGRAM_REF_SOURCE_MISMATCH' },
    { programThingId: goneId, code: 'PROGRAM_REF_TARGET_MISSING' }
  ]);
});

test('only explicitly typed default backup Programs are excluded from reference inspection', async () => {
  const source = 'explore({"thing":ref("Target")})';
  const world = [atom('target________________', 'Target'),
    atom('backup________________', 'Archive', '', [atom('archived______________', 'Archived', source, [], 'program')], 'backup@default'),
    atom('ordinary______________', '备份', '', [atom('active________________', 'Active', source, [], 'program')])];
  const bindings = rebuildProgramRefBindings(receipts(
    binding('active________________', source, 'target________________')
  ), null);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.deepEqual(index.sitesForProgram('archived______________'), []);
  assert.deepEqual(index.sitesForTargets(['target________________']).map(site => site.programThingId), ['active________________']);
  assert.deepEqual(index.failures, []);
});

test('owner removal and ID-path transitions return immutable disposable snapshots', async () => {
  const source = 'explore({"thing":ref("World/Target")})';
  const world = freeze([atom('world_________________', 'World', '', [atom('target________________', 'Target'),
    atom('owner_________________', 'Owner', source, [], 'program')])]);
  const bindings = rebuildProgramRefBindings(receipts(
    binding('owner_________________', source, 'target________________')
  ), null);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.equal(index.sitesForTargets(['target________________']).length, 1);
  const moved = index.transition({ relocations: [{ thingId: 'target________________', resultPath: 'World/Renamed' }] });
  assert.equal(moved.sitesForProgram('owner_________________')[0].exactPath, 'World/Renamed');
  assert.equal(index.sitesForProgram('owner_________________')[0].exactPath, 'World/Target');
  assert.equal(moved.sitesForProgram('owner_________________')[0].targetThingId, 'target________________');
  assert.equal(moved.withoutProgram('owner_________________').sitesForTargets(['target________________']).length, 0);
  assert.throws(() => { moved.sitesForProgram('owner_________________')[0].exactPath = 'corrupt'; }, TypeError);
  assert.throws(() => { index.sitesForTargets(['target________________']).push({}); }, TypeError);
  assert.equal(world[0].slot[1].situation, source);
});
