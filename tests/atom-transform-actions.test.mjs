import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { ActionRegistry, createActionRegistry } from '../work-engine/atom-language/registry.mjs';
import { applyTransform } from '../work-engine/atom-language/transform-executor.mjs';
import { parseTransformKey } from '../work-engine/atom-language/transform-key-parser.mjs';

test('Transform parses thing$click through the action registry instead of the Explore matcher registry', () => {
  const parsed = parseTransformKey('thing$click', { actionRegistry: createActionRegistry() });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.transformActions, [{ name: 'click', parameter: 1 }]);
  assert.deepEqual(parsed.commands, []);
  assert.equal(parsed.matcher, null);
});

test('click count is an unbounded positive action parameter instead of a hardcoded triple-click branch', () => {
  assert.deepEqual(
    parseTransformKey('thing$click37', { actionRegistry: createActionRegistry() }).transformActions,
    [{ name: 'click', parameter: 37 }]
  );
  assert.equal(
    parseTransformKey('thing$click0', { actionRegistry: createActionRegistry() }).errors.at(-1)?.code,
    'INVALID_TRANSFORM_ACTION_PARAMETER'
  );
});

test('unknown Transform $ action is rejected by registry identity', () => {
  const parsed = parseTransformKey('thing$teleport', { actionRegistry: createActionRegistry() });
  assert.equal(parsed.errors.at(-1)?.code, 'UNKNOWN_TRANSFORM_ACTION');
});

test('a second registered Transform action needs no parser or Strut runtime change', () => {
  const registry = new ActionRegistry().register('thing', 'pulse', {
    parameter: 'none', context: 'transform'
  });
  const receiver = createAtomLanguageReceiver({ actionRegistry: registry });
  const request = receiver.receive('transform {"thing$pulse":"世界/前项"}');

  assert.equal(request.ok, true);
  assert.deepEqual(request.items[0].fields[0].transformActions, [
    { name: 'pulse', parameter: null }
  ]);
});

test('Transform parses one act label packet while keeping the Thing value as the exact target', () => {
  const receiver = createAtomLanguageReceiver();
  const request = receiver.receive(
    'transform {"thing$act=钻木取火|人工介入|Scene1":"世界/木头"}'
  );

  assert.equal(request.ok, true, JSON.stringify(request.errors));
  assert.equal(request.items[0].fields[0].value, '世界/木头');
  assert.deepEqual(request.items[0].fields[0].transformActions, [{
    name: 'act',
    parameter: null,
    payload: { labels: ['钻木取火', '人工介入', 'Scene1'] }
  }]);
});

test('Transform rejects malformed act label packets without silently cleaning them', () => {
  const receiver = createAtomLanguageReceiver();
  const invalidKeys = [
    ['thing$act', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=钻木取火|', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=钻木取火||人工介入', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=钻木取火|钻木取火', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=manual intervention', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=人工_介入', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=人工$介入', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=人工$click', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=人工@program', 'INVALID_TRANSFORM_ACTION_PAYLOAD'],
    ['thing$act=人工~hidden', 'INVALID_TRANSFORM_ACTION_PAYLOAD']
  ];

  for (const [key, errorCode] of invalidKeys) {
    const request = receiver.receive(`transform {${JSON.stringify(key)}:"世界/木头"}`);
    assert.equal(request.ok, false, key);
    assert.equal(
      request.errors.some(({ code }) => code === errorCode),
      true,
      `${key}: ${JSON.stringify(request.errors)}`
    );
  }
});

test('Transform act requires write permission on the exact target even when it changes no facts', async () => {
  const request = createAtomLanguageReceiver().receive(
    'transform {"thing$act=人工介入":"世界/木头"}'
  );
  const authorizations = [];
  const result = await applyTransform({
    atoms: [{ thing: '世界', situation: '', slot: [
      { thing: '木头', situation: '现成', slot: [], strut: [] }
    ], strut: [] }],
    item: request.items[0],
    contextFile: 'atom.json',
    authorize: async (match, operation, field) => {
      authorizations.push({ path: match.path.join('/'), operation, field });
      return { decision: 'deny', code: 'WINDOW_ACCESS_DENIED' };
    }
  });

  assert.equal(result.error?.code, 'WINDOW_ACCESS_DENIED');
  assert.deepEqual(authorizations, [{
    path: '世界/木头', operation: 'write', field: 'thing'
  }]);
});

test('Transform act rejects a second Thing field instead of authorizing a different target', async () => {
  const request = createAtomLanguageReceiver().receive(
    'transform {"thing":"允许目标","thing$act=人工介入":"拒绝目标"}'
  );
  const authorizations = [];
  const result = await applyTransform({
    atoms: [
      { thing: '允许目标', situation: '', slot: [], strut: [] },
      { thing: '拒绝目标', situation: '', slot: [], strut: [] }
    ],
    item: request.items[0],
    contextFile: 'atom.json',
    authorize: async (match, operation, field) => {
      authorizations.push({ path: match.path.join('/'), operation, field });
      return { decision: 'allow' };
    }
  });

  assert.equal(result.error?.code, 'INVALID_TRANSFORM_ACTION_TARGET');
  assert.deepEqual(authorizations, []);
});

test('Transform ignores action-like text after the first description marker', () => {
  const parsed = parseTransformKey(
    'thing$click#memo$act=A@B',
    { actionRegistry: createActionRegistry() }
  );

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.transformActions, [{ name: 'click', parameter: 1 }]);
  assert.equal(parsed.description, 'memo$act=A@B');

  const act = parseTransformKey(
    'thing$act=人工#说明@program',
    { actionRegistry: createActionRegistry() }
  );
  assert.deepEqual(act.errors, []);
  assert.deepEqual(act.transformActions, [{
    name: 'act',
    parameter: null,
    payload: { labels: ['人工'] }
  }]);
  assert.equal(act.description, '说明@program');
});
