import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorldLawRegistry,
  createDefaultWorldLawRegistry
} from '../work-engine/atom-language/world-laws/registry.mjs';
import {
  decodeLockAtoms,
  evaluateLockAccess
} from '../work-engine/atom-language/world-laws/locks.mjs';
import { selectCoordinateScope } from '../work-engine/atom-language/world-laws/coordinates.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

function atom(thing, situation = '', contain = [], support = [], type = '') {
  const agentProgram = type === 'agent';
  const storedType = agentProgram ? 'program' : type;
  const storedSituation = agentProgram
    ? `LEGACY_AGENT_SITUATION = ${JSON.stringify(situation)}\nagent({"labels":[],"functions":{"groups":[],"names":["explore"]}})`
    : situation;
  return {
    [`thing${storedType ? `@${storedType}` : ''}`]: thing,
    situation: storedSituation,
    contain,
    support
  };
}

function property(name, detail) {
  return atom(name, detail);
}

function lock(name, options = {}) {
  const children = [
    property('law', options.law ?? 'atom.lock.basic'),
    property('effect', options.effect ?? 'seal'),
    property('actions', options.actions ?? 'read,write'),
    property('scope', options.scope ?? 'subtree'),
    property('grade', String(options.grade ?? 0)),
    property('key_requirement', options.keyRequirement ?? ''),
    property('protects', options.protects ?? 'Personal'),
    property('applies_to', options.appliesTo ?? ''),
    property('enabled', String(options.enabled ?? true))
  ];
  return atom(name, '', children, [], 'lock');
}

test('decodes a lock from ordinary Atom axes without adding Graph fields', () => {
  const [decoded] = decodeLockAtoms([lock('Personal seal', {
    grade: 4,
    keyRequirement: 'personal-key',
    appliesTo: 'Work Agent'
  })]);

  assert.deepEqual(decoded, {
    id: 'Personal seal',
    path: 'Personal seal',
    law: 'atom.lock.basic',
    effect: 'seal',
    actions: ['read', 'write'],
    scope: 'subtree',
    protects: ['Personal'],
    appliesTo: ['Work Agent'],
    grade: 4,
    keyRequirement: 'personal-key',
    enabled: true
  });
});

test('lock relations resolve unique short names to full paths before enforcement', () => {
  const world = [
    atom('Agents', '', [atom('Work Agent', '', [], [], 'agent')]),
    atom('Domains', '', [atom('Personal')]),
    atom('Rules', '', [lock('Personal seal', {
      protects: 'Personal', appliesTo: 'Work Agent'
    })])
  ];
  const [decoded] = decodeLockAtoms(world);

  assert.equal(decoded.path, 'Rules/Personal seal');
  assert.deepEqual(decoded.protects, ['Domains/Personal']);
  assert.deepEqual(decoded.appliesTo, ['Agents/Work Agent']);
});

test('a seal hides a protected subtree and a compatible higher-grade key opens it', async () => {
  const locks = decodeLockAtoms([lock('Personal seal', {
    grade: 3,
    keyRequirement: 'personal-key',
    appliesTo: 'Work Agent'
  })]);
  const registry = createDefaultWorldLawRegistry();
  const request = {
    locks,
    registry,
    operation: 'read',
    window: 'Work Agent',
    target: { name: 'Diary', path: 'Personal/Diary' }
  };

  assert.equal((await evaluateLockAccess(request)).decision, 'truncate');
  assert.equal((await evaluateLockAccess({
    ...request,
    keys: [{ id: 'personal-key', grade: 2, actions: ['read'] }]
  })).decision, 'truncate');
  assert.equal((await evaluateLockAccess({
    ...request,
    keys: [{ id: 'personal-key', grade: 4, actions: ['read'] }]
  })).decision, 'allow');
  assert.equal((await evaluateLockAccess({
    ...request,
    keys: [{
      id: 'personal-key', grade: 4, actions: ['read'], scopes: ['Work']
    }]
  })).decision, 'truncate');
});

test('a write-only seal remains readable but rejects modification', async () => {
  const registry = createDefaultWorldLawRegistry();
  const locks = decodeLockAtoms([lock('Read only', { actions: 'write' })]);
  const base = {
    locks, registry, window: 'Any Agent', target: { path: 'Personal' }
  };
  assert.equal((await evaluateLockAccess({ ...base, operation: 'read' })).decision, 'allow');
  assert.equal((await evaluateLockAccess({ ...base, operation: 'write' })).decision, 'deny');
});

test('a malformed lock action fails closed instead of being skipped', async () => {
  const lock = { id: 'bad', enabled: true, law: 'basic-lock', actions: ['reed'], appliesTo: [], protects: ['Work/Secret'] };
  const decision = await evaluateLockAccess({
    locks: [lock], registry: createDefaultWorldLawRegistry(), operation: 'read',
    window: 'Work', target: { path: 'Work/Secret' }, keys: []
  });
  assert.equal(decision.decision, 'truncate');
  assert.equal(decision.code, 'LOCK_LAW_FAILED_CLOSED');
});

test('a fence admits only its protected region for the selected window', async () => {
  const locks = decodeLockAtoms([lock('Work fence', {
    effect: 'fence',
    protects: 'Work',
    appliesTo: 'Work Agent'
  })]);
  const registry = createDefaultWorldLawRegistry();

  const inside = await evaluateLockAccess({
    locks, registry, operation: 'write', window: 'Work Agent',
    target: { name: 'Task', path: 'Work/Task' }
  });
  const outside = await evaluateLockAccess({
    locks, registry, operation: 'write', window: 'Work Agent',
    target: { name: 'Diary', path: 'Personal/Diary' }
  });

  assert.equal(inside.decision, 'allow');
  assert.equal(outside.decision, 'deny');
});

test('registered script locks fail closed on exceptions and invalid decisions', async () => {
  const registry = new WorldLawRegistry();
  registry.register({
    id: 'example.throwing', version: '1.0.0',
    validate: () => ({ ok: true }),
    evaluate: () => { throw new Error('boom'); }
  });
  registry.register({
    id: 'example.invalid', version: '1.0.0',
    validate: () => ({ ok: true }),
    evaluate: () => ({ decision: 'maybe' })
  });
  const base = { operation: 'write', window: 'Work Agent', target: { path: 'Work' } };

  for (const law of ['example.throwing', 'example.invalid']) {
    const result = await evaluateLockAccess({
      ...base,
      registry,
      locks: [{
        id: law, law, effect: 'seal', actions: ['write'], scope: 'subtree',
        protects: ['Work'], appliesTo: [], grade: 0, keyRequirement: '', enabled: true
      }]
    });
    assert.equal(result.decision, 'deny');
    assert.equal(result.code, 'LOCK_LAW_FAILED_CLOSED');
  }
});

test('a script lock that exceeds its evaluation budget fails closed', async () => {
  const registry = new WorldLawRegistry().register({
    id: 'example.slow', version: '1.0.0',
    validate: () => ({ ok: true }),
    evaluate: () => new Promise((resolve) => setTimeout(() => resolve({ decision: 'allow' }), 50))
  });
  const result = await evaluateLockAccess({
    registry,
    lawTimeoutMs: 5,
    operation: 'read',
    window: 'Work Agent',
    target: { path: 'Personal' },
    locks: [{
      id: 'slow', law: 'example.slow', effect: 'seal', actions: ['read'],
      scope: 'subtree', protects: ['Personal'], appliesTo: [], grade: 0,
      keyRequirement: '', enabled: true
    }]
  });
  assert.equal(result.decision, 'truncate');
  assert.equal(result.code, 'LOCK_LAW_FAILED_CLOSED');
});

test('latitude and longitude select a concurrent union from one anchor', () => {
  const root = { name: 'Root', path: 'Root', parent: null, index: 0 };
  const left = { name: 'Left', path: 'Root/Left', parent: root, index: 0 };
  const anchor = { name: 'Anchor', path: 'Root/Anchor', parent: root, index: 1 };
  const right = { name: 'Right', path: 'Root/Right', parent: root, index: 2 };
  const child = { name: 'Child', path: 'Root/Anchor/Child', parent: anchor, index: 0 };
  const matches = [root, left, anchor, child, right];

  const selected = selectCoordinateScope(anchor, matches, [
    { axis: 'latitude', parameter: 1 },
    { axis: 'latitude', parameter: -1 },
    { axis: 'longitude', parameter: -1 },
    { axis: 'longitude', parameter: 1 }
  ]);

  assert.deepEqual([...selected].map((item) => item.path).sort(), [
    'Root', 'Root/Anchor', 'Root/Anchor/Child', 'Root/Left', 'Root/Right'
  ]);
});

test('coordinate actions accept signed integers and retired routes explain migration', () => {
  const latitude = parseAtomKey('contain$latitude-2');
  const longitude = parseAtomKey('contain$longitude+3');
  const retired = parseAtomKey('contain$up2');

  assert.equal(latitude.errors.length, 0);
  assert.deepEqual(latitude.actions[0], {
    symbol: '$', raw: 'latitude-2', name: 'latitude', parameter: -2
  });
  assert.equal(longitude.errors.length, 0);
  assert.equal(longitude.actions[0].parameter, 3);
  assert.equal(retired.errors[0].code, 'RETIRED_ROUTE_ACTION');
});
