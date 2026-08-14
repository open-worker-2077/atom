import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hierarchyFor,
  hierarchyGroups
} from '../scripts/lib/manageboard-hierarchy.mjs';

test('ManageBoard records nest under administration then development inside one boss', () => {
  const records = [
    {
      recordId: 'rec-a',
      bossId: 'individual',
      administration: 'AI',
      development: 'Frontier'
    },
    {
      recordId: 'rec-b',
      bossId: 'individual',
      administration: 'AI',
      development: 'Rocket'
    }
  ];
  const result = hierarchyGroups(records);
  assert.equal(result.administrations.length, 1);
  assert.equal(result.developments.length, 2);
  assert.equal(result.developments[0].leaderId, result.administrations[0].id);
  assert.equal(result.assignments.get('rec-a'), result.developments[0].id);
});

test('group identities are deterministic and isolated by relationship boss', () => {
  const base = {
    recordId: 'rec-a',
    administration: 'AI',
    development: 'Rocket'
  };
  const first = hierarchyFor({ ...base, bossId: 'individual' });
  const again = hierarchyFor({ ...base, bossId: 'individual' });
  const otherBoss = hierarchyFor({ ...base, bossId: 'civilization-division' });
  assert.deepEqual(first, again);
  assert.notEqual(first.administration.id, otherBoss.administration.id);
  assert.notEqual(first.development.id, otherBoss.development.id);
});

test('blank classification remains visible instead of dropping a node', () => {
  const hierarchy = hierarchyFor({
    recordId: 'rec-a',
    bossId: 'individual'
  });
  assert.equal(hierarchy.administration.label, '未分配 administration');
  assert.equal(hierarchy.development.label, '未分配 development');
});
