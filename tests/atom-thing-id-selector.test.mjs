import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { normalizeProgramReferences } from '../work-engine/atom-language/program-reference-runtime.mjs';
import { createAccessController, exactMatches } from '../work-engine/atom-language/query-capability.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { parseThingSelector, resolveThingSelector } from '../work-engine/atom-language/thing-selector.mjs';
import { walkAtoms } from '../work-engine/atom-language/slot-graph-semantics.mjs';

const atom = (identity, thing) => ({ [`thing&id=${identity}`]: thing, situation: '', slot: [], strut: [] });

test('valid @id selectors remain case-sensitive while names stay semantic selectors', () => {
  assert.deepEqual(parseThingSelector('@00A'), { kind: 'identity', identity: '00A' });
  assert.deepEqual(parseThingSelector('@00a'), { kind: 'identity', identity: '00a' });
  assert.deepEqual(parseThingSelector('域/目标'), { kind: 'semantic', selector: '域/目标' });
  const candidates = walkAtoms([atom('00A', '上层'), atom('00a', '下层')]);
  assert.equal(resolveThingSelector(candidates, parseThingSelector('@00A')).match.path.join('/'), '上层');
  assert.equal(resolveThingSelector(candidates, parseThingSelector('@00a')).match.path.join('/'), '下层');
});

test('malformed, reserved and legacy-shaped @ selectors fail before semantic matching', () => {
  for (const selector of ['@000', '@ab', '@AbCdEfGhIjKlMnOpQrStUv', '@00-', '@']) {
    const parsed = parseThingSelector(selector);
    assert.equal(parsed.kind, 'invalid-identity');
    assert.equal(parsed.error.code, selector === '@000' ? 'RESERVED_THING_ID' : 'INVALID_THING_ID_SELECTOR');
  }
});

test('a valid @id selector never falls back to a Thing whose semantic name is identical', () => {
  const candidates = walkAtoms([atom('001', '@00A'), atom('00A', '实际目标')]);
  assert.equal(resolveThingSelector(candidates, parseThingSelector('@00A')).match.path.join('/'), '实际目标');
});

test('identity selection is unique and missing identities return one stable diagnostic without echoing the id', () => {
  const candidates = walkAtoms([atom('00A', '甲')]);
  const missing = resolveThingSelector(candidates, parseThingSelector('@00B'));
  assert.equal(missing.error.code, 'ATOM_NOT_FOUND');
  assert.doesNotMatch(missing.error.message, /00B/u);
  const duplicate = resolveThingSelector([...candidates, ...walkAtoms([atom('00A', '乙')])], parseThingSelector('@00A'));
  assert.equal(duplicate.error.code, 'DUPLICATE_THING_IDENTITY');
  assert.doesNotMatch(JSON.stringify(duplicate.error), /00A/u);
});

test('Program ref accepts an explicit short identity and persists the resolved readable path', () => {
  const source = 'ref("@aZ3")';
  const sourceHash = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const normalized = normalizeProgramReferences({
    source,
    sourceHash,
    referenceSites: [{
      kind: 'ref', role: 'ref', selector: '@aZ3', fingerprint: 'ref:0',
      startByte: 4, endByte: 10, selectorStart: 0, selectorEnd: 4,
      literalValue: '@aZ3', literalTokens: [{ startByte: 4, endByte: 10 }]
    }],
    worldBindings: [{ id: 'aZ3', path: 'Root/Target' }]
  });
  assert.equal(normalized.source, 'ref("Root/Target")');
  assert.equal(normalized.referenceSites[0].targetThingId, 'aZ3');
  assert.equal(normalized.referenceSites[0].exactPath, 'Root/Target');
});

test('@id selection enters the same Graph lock authorization as a readable path', async () => {
  const facts = [atom('001', 'Root')];
  facts[0].slot = [atom('aZ3', 'Target')];
  const receiver = createAtomLanguageReceiver();
  const item = receiver.receive('explore {"thing":"@aZ3"}').items[0];
  const selected = exactMatches(facts, item, receiver.matcherRegistry);
  assert.equal(selected.matches[0].path.join('/'), 'Root/Target');
  const graphLocks = [{
    kind: 'node', path: 'Root/Target', actions: ['explore', 'transform'], labels: ['secret']
  }];
  const denied = createAccessController(facts, { graphLocks, agentSecurity: { labels: [] } });
  const allowed = createAccessController(facts, { graphLocks, agentSecurity: { labels: ['secret'] } });
  assert.notEqual((await denied.authorize(selected.matches[0], 'read')).decision, 'allow');
  assert.notEqual((await denied.authorize(selected.matches[0], 'write', 'situation')).decision, 'allow');
  assert.equal((await allowed.authorize(selected.matches[0], 'read')).decision, 'allow');
  assert.equal((await allowed.authorize(selected.matches[0], 'write', 'situation')).decision, 'allow');
});
