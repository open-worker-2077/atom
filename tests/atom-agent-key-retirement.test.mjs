import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';

test('strict Agent Program parsing rejects Agent as a type', () => {
  for (const rawKey of ['thing@agent', 'thing@program@agent', 'thing@agent@program#legacy']) {
    const parsed = parseAtomKey(rawKey);
    assert.equal(parsed.errors.find((error) => error.code === 'RETIRED_AGENT_KEY_TYPE')?.details.rawKey, rawKey);
  }
  assert.deepEqual(parseAtomKey('thing@program').errors, []);
});

test('maintenance parsing exposes legacy structure without making it valid at runtime', () => {
  const parsed = parseAtomKey('thing@program@agent#legacy', {
    allowRetiredAgentKey: true,
    descriptionSymbolWarnings: false
  });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.types.map((type) => type.raw), ['program', 'agent']);
  assert.equal(parsed.description, 'legacy');
});

test('retired Agent markers remain opaque inside descriptions', () => {
  const rawKey = 'situation#简介中的@agent$full~more438';
  const parsed = parseAtomKey(rawKey);

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.types, []);
  assert.deepEqual(parsed.actions, []);
  assert.deepEqual(parsed.hints, []);
  assert.equal(parsed.description, '简介中的@agent$full~more438');
  assert.equal(parsed.persistentKey, rawKey);
});

test('retired Agent markers remain opaque inside Situation values', () => {
  const value = '正文中提到 @agent、@program、@backup，但正文不能决定 Atom 类型。';
  const result = createAtomLanguageReceiver().receive(`explore {
    "situation#类型说明":${JSON.stringify(value)},
    "thing":"普通节点正文也提到 @agent @program @backup"
  }`);
  const situation = result.items[0].fields.find((field) => field.baseKey === 'situation');
  const thing = result.items[0].fields.find((field) => field.baseKey === 'thing');

  assert.equal(result.ok, true);
  assert.equal(situation.value, value);
  assert.deepEqual(situation.types, []);
  assert.deepEqual(thing.types, []);
});
