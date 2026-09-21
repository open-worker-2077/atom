import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { planShortThingIdentityMigration } from '../work-engine/atom-language/thing-identity-migration.mjs';
import { storedField, walkAtoms } from '../work-engine/atom-language/slot-graph-semantics.mjs';
import { thingIdForOrdinal } from '../work-engine/atom-language/thing-id-allocator.mjs';

const ids = Object.freeze({
  root: 'AAAAAAAAAAAAAAAAAAAAAA',
  target: 'BBBBBBBBBBBBBBBBBBBBBB',
  source: 'CCCCCCCCCCCCCCCCCCCCCC',
  shortcut: 'DDDDDDDDDDDDDDDDDDDDDD',
  program: 'EEEEEEEEEEEEEEEEEEEEEE'
});
const source = 'explore({"thing":ref("Root/Target")})';
const sourceHash = `sha256:${createHash('sha256').update(source).digest('hex')}`;

function legacyAtom(id, thing, { types = [], description = null, situation = '', slot = [], strut = [] } = {}) {
  return {
    [`thing${types.map(type => `@${type}`).join('')}&id=${id}${description == null ? '' : `#${description}`}`]: thing,
    situation,
    slot,
    strut
  };
}

function fixture() {
  const facts = [legacyAtom(ids.root, 'Root', { description: '根说明', slot: [
    legacyAtom(ids.target, 'Target', { situation: '正文逐字节保留' }),
    legacyAtom(ids.source, 'Source', {
      strut: [{ 'if@current': true, then: [{ [`thing&id=${ids.target}`]: 'Target' }] }]
    }),
    legacyAtom(ids.shortcut, 'Entry', {
      types: ['shortcut'],
      situation: JSON.stringify({
        contract: 'atom.shortcut', version: 1, referenceId: 'stable-reference',
        target: { state: 'linked', path: 'Root/Target', identity: ids.target }
      })
    }),
    legacyAtom(ids.program, 'Program', { types: ['program'], situation: source })
  ] })];
  const programRefBindings = createProgramRefBindingUpdate({ replacements: [{
    programThingId: ids.program,
    sourceHash,
    sites: [{ fingerprint: 'ref:module.body[0]:0', role: 'ref', targetThingId: ids.target }]
  }] });
  return { facts, programRefBindings };
}

test('cold migration rewrites one complete identity generation in stable preorder', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const plan = planShortThingIdentityMigration({ ...input, sourceWatermark: '000' });

  assert.equal(JSON.stringify(input), before);
  assert.equal(plan.changed, true);
  assert.deepEqual(walkAtoms(plan.facts).map(({ atom }) => storedField(atom, 'thing').parsed.identity),
    ['001', '002', '003', '004', '005']);
  assert.equal(plan.identityMap.get(ids.target), '002');
  assert.equal(plan.summary.thingCount, 5);
  assert.equal(plan.summary.uniqueShortIdentityCount, 5);
  assert.equal(plan.summary.topologyPreserved, true);
  assert.equal(plan.summary.activeLegacyIdentityCount, 0);
  assert.equal(plan.summary.allocatorWatermark, '005');
  assert.equal(Object.keys(plan.facts[0])[0], 'thing&id=001#根说明');
  assert.equal(storedField(plan.facts[0].slot[0], 'situation').value, '正文逐字节保留');
  assert.equal(Object.keys(plan.facts[0].slot[1].strut[0].then[0])[0], 'thing&id=002');
  assert.equal(JSON.parse(plan.facts[0].slot[2].situation).target.identity, '002');
  assert.equal(plan.nextBindings.replacements[0].programThingId, '005');
  assert.equal(plan.nextBindings.replacements[0].sites[0].targetThingId, '002');
  assert.equal(plan.nextBindings.replacements[0].sourceHash, sourceHash);
  assert.deepEqual(plan.receipt.thingIdentityAllocator.issued, ['001', '002', '003', '004', '005']);
  assert.equal(plan.receipt.thingIdentityMigration.thingCount, 5);

  const second = planShortThingIdentityMigration({
    facts: plan.facts,
    programRefBindings: plan.nextBindings,
    sourceWatermark: plan.summary.allocatorWatermark
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.facts, plan.facts);
});

test('migration preflight rejects incomplete, duplicate, mixed and dangling generations without mutation', () => {
  const cases = [];
  {
    const input = fixture();
    delete input.facts[0].slot[0][`thing&id=${ids.target}`];
    input.facts[0].slot[0].thing = 'Target';
    cases.push(input);
  }
  {
    const input = fixture();
    const targetKey = `thing&id=${ids.target}`;
    input.facts[0].slot[1][targetKey] = input.facts[0].slot[1][`thing&id=${ids.source}`];
    delete input.facts[0].slot[1][`thing&id=${ids.source}`];
    cases.push(input);
  }
  {
    const input = fixture();
    input.facts[0].slot[0] = { 'thing&id=001': 'Target', situation: '', slot: [], strut: [] };
    cases.push(input);
  }
  {
    const input = fixture();
    input.facts[0].slot[1].strut[0].then[0] = { thing: 'Target' };
    cases.push(input);
  }
  {
    const input = fixture();
    input.programRefBindings = createProgramRefBindingUpdate({ replacements: [{
      programThingId: ids.program, sourceHash,
      sites: [{ fingerprint: 'ref:module.body[0]:0', role: 'ref', targetThingId: 'ZZZZZZZZZZZZZZZZZZZZZZ' }]
    }] });
    cases.push(input);
  }

  for (const input of cases) {
    const before = JSON.stringify(input);
    assert.throws(() => planShortThingIdentityMigration({ ...input, sourceWatermark: '000' }));
    assert.equal(JSON.stringify(input), before);
  }
});

test('migration barrier replaces the complete active Program binding generation', () => {
  const input = fixture();
  const plan = planShortThingIdentityMigration({ ...input, sourceWatermark: '000' });
  const snapshot = rebuildProgramRefBindings([
    { receipt: { result: { programRefBindings: input.programRefBindings } } },
    { receipt: { result: plan.receipt } }
  ]);
  assert.equal(snapshot.forProgram(ids.program), null);
  assert.equal(snapshot.forProgram('005').sites[0].targetThingId, '002');
  assert.deepEqual(snapshot.programIds, ['005']);
});

test('production-sized migration assigns all 12,243 identities once in linear preorder', () => {
  const thingCount = 12_243;
  const facts = Array.from({ length: thingCount }, (_, index) => legacyAtom(
    `L${index.toString(36).padStart(21, '0')}`,
    `Thing ${index}`
  ));
  const plan = planShortThingIdentityMigration({
    facts,
    programRefBindings: createProgramRefBindingUpdate(),
    sourceWatermark: '000',
    expectedThingCount: thingCount
  });
  assert.equal(plan.summary.thingCount, thingCount);
  assert.equal(plan.summary.uniqueShortIdentityCount, thingCount);
  assert.equal(plan.summary.allocatorWatermark, thingIdForOrdinal(thingCount));
  assert.equal(storedField(plan.facts.at(-1), 'thing').parsed.identity, thingIdForOrdinal(thingCount));
  assert.throws(() => planShortThingIdentityMigration({
    facts,
    programRefBindings: createProgramRefBindingUpdate(),
    expectedThingCount: thingCount + 1
  }), { code: 'THING_IDENTITY_MIGRATION_COUNT_MISMATCH' });
});
