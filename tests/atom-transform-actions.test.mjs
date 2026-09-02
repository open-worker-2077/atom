import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { ActionRegistry, createActionRegistry } from '../work-engine/atom-language/registry.mjs';
import { parseTransformKey } from '../work-engine/atom-language/transform-key-parser.mjs';

test('Transform parses thing$click through the action registry instead of the Explore matcher registry', () => {
  const parsed = parseTransformKey('thing$click', { actionRegistry: createActionRegistry() });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.transformActions, [{ name: 'click', parameter: null }]);
  assert.deepEqual(parsed.commands, []);
  assert.equal(parsed.matcher, null);
});

test('unknown Transform $ action is rejected by registry identity', () => {
  const parsed = parseTransformKey('thing$teleport', { actionRegistry: createActionRegistry() });
  assert.equal(parsed.errors.at(-1)?.code, 'UNKNOWN_TRANSFORM_ACTION');
});

test('a second registered Transform action needs no parser or Strut runtime change', () => {
  const registry = new ActionRegistry().register('thing', 'pulse', { parameter: 'none' });
  const receiver = createAtomLanguageReceiver({ actionRegistry: registry });
  const request = receiver.receive('transform {"thing$pulse":"世界/前项"}');

  assert.equal(request.ok, true);
  assert.deepEqual(request.items[0].fields[0].transformActions, [
    { name: 'pulse', parameter: null }
  ]);
});
