import assert from 'node:assert/strict';
import test from 'node:test';

import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';
import { routeSlotTagPackets } from '../work-engine/atom-language/slot-signal-runtime.mjs';

const atom = (thing, situation = '', slot = [], strut = [], type = '') => ({
  [`thing${type ? `@${type}` : ''}`]: thing,
  situation,
  slot,
  strut
});

const line = 'def main(packet):\n    slot_provide(packet["labels"])';
const provide = (sourceNodePath, labels) => ({
  sourceProgramPath: `${sourceNodePath}/提供程序`, sourceNodePath, labels
});

test('tag packets select exact outgoing Graph struts rather than containment relatives', () => {
  const world = [atom('父', '', [atom('子')]), atom('后项')];
  const graph = projectAtomContext(world);

  assert.deepEqual(routeSlotTagPackets(graph, [provide('父/子', ['A'])], {
    scene: 'scene-1', revision: 'sha256:r1'
  }), []);
});

test('one source packet becomes one explicit line-Program invocation', () => {
  const world = [
    atom('前项', '', [], [{
      'if@current': true,
      if: [{ program: line }],
      then: [{ thing: '后项' }]
    }]),
    atom('后项')
  ];
  const [invocation] = routeSlotTagPackets(
    projectAtomContext(world), [provide('前项', ['钻木取火', '人工介入'])],
    { scene: 'scene-1', revision: 'sha256:r1' }
  );

  assert.deepEqual(invocation, {
    mode: 'slot-tag-strut',
    scene: 'scene-1',
    revision: 'sha256:r1',
    clauseId: 'strut:atom.json/前项:0',
    lineProgram: {
      predicateId: 'strut:atom.json/前项:0:predicate:1',
      source: line
    },
    sourcePackets: [{ sourceNodePath: '前项', labels: ['钻木取火', '人工介入'] }],
    labels: ['钻木取火', '人工介入'],
    consequentPaths: ['后项']
  });
  assert.ok(Object.isFrozen(invocation));
  assert.ok(Object.isFrozen(invocation.labels));
});

test('same-wave compound antecedents are grouped once in Graph order', () => {
  const world = [
    atom('甲'),
    atom('乙'),
    atom('枢纽', '', [], [{
      'if@current': true,
      if: [{ and: [{ thing: '甲' }, { thing: '乙' }, { program: line }] }],
      then: [{ thing: '后项' }]
    }]),
    atom('后项')
  ];
  const invocations = routeSlotTagPackets(projectAtomContext(world), [
    provide('乙', ['B', '共同']),
    provide('枢纽', ['H']),
    provide('甲', ['A', '共同'])
  ], { scene: 'scene-2', revision: 'sha256:r2' });

  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0].sourcePackets, [
    { sourceNodePath: '枢纽', labels: ['H'] },
    { sourceNodePath: '甲', labels: ['A', '共同'] },
    { sourceNodePath: '乙', labels: ['B', '共同'] }
  ]);
  assert.deepEqual(invocations[0].labels, ['H', 'A', '共同', 'B']);
});

test('canonical routing requires exactly one explicit line Program', () => {
  const noProgram = projectAtomContext([
    atom('前项', '', [], [{ 'if@current': true, then: [{ thing: '后项' }] }]),
    atom('后项')
  ]);
  assert.deepEqual(routeSlotTagPackets(noProgram, [provide('前项', ['A'])], {
    scene: 'scene-3', revision: 'sha256:r3'
  }), []);

  const twoPrograms = projectAtomContext([
    atom('前项', '', [], [{
      'if@current': true,
      if: [{ and: [{ program: line }, { program: line }] }],
      then: [{ thing: '后项' }]
    }]),
    atom('后项')
  ]);
  assert.throws(() => routeSlotTagPackets(twoPrograms, [provide('前项', ['A'])], {
    scene: 'scene-4', revision: 'sha256:r4'
  }), { code: 'MULTIPLE_SLOT_TAG_STRUT_PROGRAMS' });
});
