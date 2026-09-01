import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphDocument } from '../cli/lib/graph-json.mjs';
import { GRAPH_AXES, GRAPH_SCHEMA_VERSION } from '../work-engine/atom-language/graph-schema.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

const leaf = (thing, strut = []) => ({ thing, situation: '', slot: [], strut });

test('Graph 3.0 accepts only thing situation slot and strut axes', () => {
  assert.equal(GRAPH_SCHEMA_VERSION, '3.0.0');
  assert.deepEqual(GRAPH_AXES, ['thing', 'situation', 'slot', 'strut']);
  for (const axis of GRAPH_AXES) assert.deepEqual(parseAtomKey(axis).errors, []);
  for (const retired of ['name', 'detail', 'children', 'partners', 'contain', 'support']) {
    assert.equal(parseAtomKey(retired).errors[0]?.code, 'RETIRED_GRAPH_AXIS');
  }
});
test('Graph 3.0 parses recursive slots and owner-local struts', () => {
  const input = {
    config: { schema_version: '3.0.0' },
    graph: {
      thing: '世界', situation: '', strut: [],
      slot: [
        leaf('前项', [{ 'if@current': true, then: [{ thing: '后项' }] }]),
        leaf('后项')
      ]
    }
  };

  const parsed = parseGraphDocument(input);

  assert.deepEqual(parsed.graph, input.graph);
  assert.equal(parsed.strutClauses.length, 1);
  assert.equal(parsed.strutClauses[0].id, 'strut:世界/前项:0');
});

test('strut rejects type markers because direction belongs to its clause', () => {
  assert.equal(parseAtomKey('strut@program').errors[0]?.code, 'INVALID_STRUT_KEY');
});
