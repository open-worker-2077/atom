import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

test('strict Agent Program parsing rejects Agent as a type', () => {
  for (const rawKey of ['thing@agent', 'thing@program@agent', 'thing@agent@program#legacy']) {
    const parsed = parseAtomKey(rawKey, { allowRetiredAgentKey: false });
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
