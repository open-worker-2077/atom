import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { createProgramReferenceIndex } from '../work-engine/atom-language/program-reference-index.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { thingIdForOrdinal } from '../work-engine/atom-language/thing-id-allocator.mjs';

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
  const programId = (index) => thingIdForOrdinal(1_000 + index);
  const world = freeze([atom('101', 'World', '', [atom('102', 'Target'),
    ...Array.from({ length: 100 }, (_, i) => atom(programId(i), `P${i}`, sources[i % 10], [], 'program'))])]);
  const bytes = JSON.stringify(world);
  const revision = revisionOfWorldFacts(world);
  const replacements = Array.from({ length: 100 }, (_, i) => binding(
    programId(i), sources[i % 10], '102', `ref:module.body[0]:${i}`
  ));
  const bindings = rebuildProgramRefBindings(receipts(...replacements), replacements);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.equal(index.sitesForTargets(['102']).length, 100);
  assert.equal(index.sitesForTargets(['102', '102']).length, 100);
  assert.deepEqual(index.sitesForTargets(['absent']), []);
  const [site] = index.sitesForProgram(programId(7));
  assert.equal(site.programThingId, programId(7));
  assert.equal(site.targetThingId, '102');
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
  const missingId = '202';
  const staleId = '203';
  const goneId = '204';
  const deletedId = '205';
  const world = [atom('101', 'World', '', [atom('102', 'Target'),
    atom('201', 'Good', source, [], 'program'),
    atom(missingId, 'MissingBinding', source, [], 'program'),
    atom(staleId, 'Stale', `${source}\n# changed`, [], 'program'),
    atom(goneId, 'MissingTarget', source, [], 'program')])];
  const bindings = rebuildProgramRefBindings(receipts(
    binding('201', source, '102'),
    binding(staleId, source, '102'),
    binding(goneId, source, deletedId)
  ), null);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.deepEqual(index.sitesForTargets(['102']).map(site => site.programThingId), ['201']);
  assert.deepEqual(index.failures.map(({ programThingId, code }) => ({ programThingId, code })), [
    { programThingId: missingId, code: 'PROGRAM_REF_BINDING_MISSING' },
    { programThingId: staleId, code: 'PROGRAM_REF_SOURCE_MISMATCH' },
    { programThingId: goneId, code: 'PROGRAM_REF_TARGET_MISSING' }
  ]);
});

test('missing-target scheduler exception and warning expose no hidden Thing identity', async () => {
  const source = 'explore({"thing":ref("World/Target")})';
  const programId = '201';
  const missingTargetId = '202';
  const world = [atom('101', 'World', '', [
    atom(programId, 'MissingTarget', source, [], 'program')
  ])];
  const bindings = rebuildProgramRefBindings(receipts(
    binding(programId, source, missingTargetId)
  ));
  const index = await createProgramReferenceIndex(world, { bindings });
  const scheduler = createProgramRuntimeScheduler();
  const records = scheduler.prepareRuntimeRecords(world);
  scheduler.programReferenceIndex = index;

  assert.throws(() => scheduler.activeProgramRecords(records, 'MissingTarget'), (error) => {
    assert.equal(error.code, 'PROGRAM_REF_TARGET_MISSING');
    assert.equal(error.programPath, 'World/MissingTarget');
    assert.equal(error.details.fingerprint, 'ref:module.body[0]:0');
    assert.equal(error.details.role, 'ref');
    const exposed = JSON.stringify({ message: error.message, ...error });
    assert.equal(exposed.includes(programId), false);
    assert.equal(exposed.includes(missingTargetId), false);
    return true;
  });

  const withWarnings = await scheduler.overlayRequestDrivenLocks({ records, locks: [] });
  assert.equal(withWarnings.runtimeWarnings[0].code, 'PROGRAM_REF_TARGET_MISSING');
  assert.equal(withWarnings.runtimeWarnings[0].programPath, 'World/MissingTarget');
  const exposed = JSON.stringify(withWarnings.runtimeWarnings);
  assert.equal(exposed.includes(programId), false);
  assert.equal(exposed.includes(missingTargetId), false);
});

test('only explicitly typed default backup Programs are excluded from reference inspection', async () => {
  const source = 'explore({"thing":ref("Target")})';
  const world = [atom('101', 'Target'),
    atom('102', 'Archive', '', [atom('103', 'Archived', source, [], 'program')], 'backup@default'),
    atom('104', '备份', '', [atom('105', 'Active', source, [], 'program')])];
  const bindings = rebuildProgramRefBindings(receipts(
    binding('105', source, '101')
  ), null);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.deepEqual(index.sitesForProgram('103'), []);
  assert.deepEqual(index.sitesForTargets(['101']).map(site => site.programThingId), ['105']);
  assert.deepEqual(index.failures, []);
});

test('owner removal and ID-path transitions return immutable disposable snapshots', async () => {
  const source = 'explore({"thing":ref("World/Target")})';
  const world = freeze([atom('101', 'World', '', [atom('102', 'Target'),
    atom('103', 'Owner', source, [], 'program')])]);
  const bindings = rebuildProgramRefBindings(receipts(
    binding('103', source, '102')
  ), null);
  const index = await createProgramReferenceIndex(world, { bindings });
  assert.equal(index.sitesForTargets(['102']).length, 1);
  const moved = index.transition({ relocations: [{ thingId: '102', resultPath: 'World/Renamed' }] });
  assert.equal(moved.sitesForProgram('103')[0].exactPath, 'World/Renamed');
  assert.equal(index.sitesForProgram('103')[0].exactPath, 'World/Target');
  assert.equal(moved.sitesForProgram('103')[0].targetThingId, '102');
  assert.equal(moved.withoutProgram('103').sitesForTargets(['102']).length, 0);
  assert.throws(() => { moved.sitesForProgram('103')[0].exactPath = 'corrupt'; }, TypeError);
  assert.throws(() => { index.sitesForTargets(['102']).push({}); }, TypeError);
  assert.equal(world[0].slot[1].situation, source);
});
