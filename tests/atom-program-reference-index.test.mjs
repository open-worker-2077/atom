import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createProgramReferenceIndex } from '../work-engine/atom-language/program-reference-index.mjs';
import { inspectProgramReferenceSites } from '../work-engine/atom-language/program-reference-runtime.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

function atom(id, name, source = '', children = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}&id=${id}`]: name, situation: source, slot: children, strut: [] };
}
function freeze(value) {
  for (const child of Object.values(value ?? {})) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

test('100 active Programs parse every distinct source hash once and share identical-source inspection', async () => {
  const sources = Array.from({ length: 10 }, (_, i) => `# ${i}\nexplore({"thing":"World/Target"})`);
  const world = freeze([atom('world_________________', 'World', '', [atom('target________________', 'Target'),
    ...Array.from({ length: 100 }, (_, i) => atom(`p${i}`.padEnd(22, '_'), `P${i}`, sources[i % 10], [], 'program'))])]);
  const bytes = JSON.stringify(world);
  const revision = revisionOfWorldFacts(world);
  const inspected = [];
  const index = await createProgramReferenceIndex(world, { inspectProgram: async (request) => {
    inspected.push(request.source);
    return inspectProgramReferenceSites(request);
  } });
  assert.equal(inspected.length, 10);
  assert.equal(new Set(inspected).size, 10);
  assert.equal(index.sitesForTargets(['target________________']).length, 100);
  assert.equal(index.sitesForTargets(['target________________', 'target________________']).length, 100);
  assert.deepEqual(index.sitesForTargets(['absent']), []);
  const [site] = index.sitesForProgram('p7____________________');
  assert.equal(site.programThingId, 'p7____________________');
  assert.equal(site.targetThingId, 'target________________');
  assert.equal(site.exactPath, 'World/Target');
  assert.equal(site.role, 'explore.thing');
  assert.equal(site.sourceHash, `sha256:${createHash('sha256').update(sources[7]).digest('hex')}`);
  assert.ok(site.astPath);
  assert.ok(site.positionFingerprint);
  assert.deepEqual(index.failures, []);
  assert.equal(JSON.stringify(world), bytes);
  assert.equal(revisionOfWorldFacts(world), revision);
});

test('missing exact paths quarantine only their Program without suffix rebinding or partial sites', async () => {
  const world = [atom('world_________________', 'World', '', [atom('target________________', 'Target'),
    atom('good__________________', 'Good', 'explore({"thing":"World/Target"})', [], 'program'),
    atom('bad___________________', 'Bad', 'explore({"thing":"World/Target"})\nexplore({"thing":"Missing"})', [], 'program'),
    atom('short_________________', 'Short', 'explore({"thing":"Target"})', [], 'program')])];
  const index = await createProgramReferenceIndex(world);
  assert.deepEqual(index.sitesForTargets(['target________________']).map(site => site.programThingId), ['good__________________']);
  assert.deepEqual(index.sitesForProgram('bad___________________'), []);
  assert.deepEqual(index.failures.map(({ programThingId, code }) => ({ programThingId, code })), [
    { programThingId: 'bad___________________', code: 'PROGRAM_REFERENCE_TARGET_MISSING' },
    { programThingId: 'short_________________', code: 'PROGRAM_REFERENCE_TARGET_MISSING' }
  ]);
});

test('only explicitly typed default backup Programs are excluded from reference inspection', async () => {
  const world = [atom('target________________', 'Target'),
    atom('backup________________', 'Archive', '', [atom('archived______________', 'Archived', 'explore({"thing":"Missing"})', [], 'program')], 'backup@default'),
    atom('ordinary______________', '备份', '', [atom('active________________', 'Active', 'explore({"thing":"Target"})', [], 'program')])];
  const index = await createProgramReferenceIndex(world);
  assert.deepEqual(index.sitesForProgram('archived______________'), []);
  assert.deepEqual(index.sitesForTargets(['target________________']).map(site => site.programThingId), ['active________________']);
  assert.deepEqual(index.failures, []);
});

test('owner replacement, removal and transition return immutable snapshots without modifying inspections or facts', async () => {
  const source = 'explore({"thing":"World/Target"})';
  const world = freeze([atom('world_________________', 'World', '', [atom('target________________', 'Target'), atom('other_________________', 'Other'),
    atom('owner_________________', 'Owner', source, [], 'program')])]);
  const index = await createProgramReferenceIndex(world);
  const replacement = freeze({ ...await inspectProgramReferenceSites({ source: 'explore({"thing":"World/Other"})' }),
    programPath: 'World/Owner' });
  const updated = index.withProgram('owner_________________', replacement);
  assert.equal(index.sitesForTargets(['target________________']).length, 1);
  assert.equal(updated.sitesForTargets(['target________________']).length, 0);
  assert.equal(updated.sitesForTargets(['other_________________']).length, 1);
  const moved = updated.transition({ relocations: [{ thingId: 'other_________________', sourcePath: 'World/Other', resultPath: 'World/Renamed' }],
    changedPrograms: [] });
  assert.equal(moved.sitesForProgram('owner_________________')[0].exactPath, 'World/Renamed');
  assert.equal(updated.sitesForProgram('owner_________________')[0].exactPath, 'World/Other');
  assert.equal(moved.sitesForProgram('owner_________________')[0].targetThingId, 'other_________________');
  assert.equal(moved.withoutProgram('owner_________________').sitesForTargets(['other_________________']).length, 0);
  assert.equal(moved.transition({ changedPrograms: [{ programThingId: 'owner_________________', inspection: null }] }).sitesForProgram('owner_________________').length, 0);
  assert.throws(() => { moved.sitesForProgram('owner_________________')[0].astPath = 'corrupt'; }, TypeError);
  assert.throws(() => { index.sitesForTargets(['target________________']).push({}); }, TypeError);
  assert.equal(replacement.sites[0].selector, 'World/Other');
  assert.equal(world[0].slot[2].situation, source);
});
