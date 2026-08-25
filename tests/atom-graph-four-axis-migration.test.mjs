import assert from 'node:assert/strict';
import test from 'node:test';

import * as graphSchema from '../work-engine/atom-language/graph-schema.mjs';
import {
  applyGraphFourAxisWorldMigration,
  planGraphFourAxisWorldMigration,
  rollbackGraphFourAxisWorldMigration
} from '../src/atom-system/operations/graph-four-axis-migration.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

function legacyNode(name, detail = '', children = [], partners = [], suffix = '') {
  return { [`name${suffix}`]: name, detail, children, partners };
}

test('migration planner is a pure structural conversion that preserves situation bytes', () => {
  assert.equal(typeof graphSchema.planGraphFourAxisMigration, 'function');
  const body = '正文包含 name detail children partners situation support，均不得替换。';
  const result = graphSchema.planGraphFourAxisMigration({
    name: '世界', detail: body, partners: [], children: [
      { name: 'A', detail: 'A', children: [], partners: [] }
    ]
  });
  assert.deepEqual(result.graph, {
    thing: '世界', situation: body, support: [], contain: [
      { thing: 'A', situation: 'A', contain: [], support: [] }
    ]
  });
  assert.equal(result.summary.nodes, 2);
  assert.equal(result.summary.situationBytes, Buffer.byteLength(body) + Buffer.byteLength('A'));
});

test('migration planner blocks every non-empty partners array and preserves exact order and text', () => {
  assert.throws(() => graphSchema.planGraphFourAxisMigration({
    name: '世界', detail: '', partners: [], children: [
      { name: 'A', detail: '', children: [], partners: [
        { verb: '', object: 'B' }, { verb: '', object: 'C' }
      ] },
      { name: 'B', detail: '', children: [], partners: [] },
      { name: 'C', detail: '', children: [], partners: [] }
    ]
  }, { allowEmptyVerbAsSupport: true }), (error) => {
    assert.equal(error.code, 'UNMAPPABLE_LEGACY_SUPPORT_RELATION');
    assert.deepEqual(error.details.relations, [
      { source: '世界/A', ordinal: 0, verb: '', object: 'B' },
      { source: '世界/A', ordinal: 1, verb: '', object: 'C' }
    ]);
    return true;
  });
});

test('migration planner blocks a legacy verb instead of losing it', () => {
  assert.throws(() => graphSchema.planGraphFourAxisMigration({
    name: '世界', detail: '', children: [
      { name: 'A', detail: '', children: [], partners: [{ verb: '依赖', object: 'B' }] },
      { name: 'B', detail: '', children: [], partners: [] }
    ], partners: []
  }), (error) => error.code === 'UNMAPPABLE_LEGACY_SUPPORT_RELATION'
    && error.details.source === '世界/A'
    && error.details.relations[0].object === 'B'
    && error.details.relations[0].verb === '依赖');
});

test('migration dry-run blocks old Program Graph ABI with exact source locations', () => {
  const legacy = legacyNode('Root', '', [legacyNode(
    'Program',
    "def main(arguments):\n    return explore({'name': 'Target', 'detail': 'x'})",
    [],
    [],
    '@program'
  )]);
  assert.throws(() => graphSchema.planGraphFourAxisMigration(legacy), (error) => {
    assert.equal(error.code, 'UNMAPPABLE_LEGACY_PROGRAM_GRAPH_ABI');
    assert.equal(error.details.path, 'Root/Program');
    assert.deepEqual(error.details.uses.map(({ call, axis, line }) => ({ call, axis, line })), [
      { call: 'explore', axis: 'name', line: 2 },
      { call: 'explore', axis: 'detail', line: 2 }
    ]);
    return true;
  });
});

test('migration does not treat ordinary situation words as structural fields', () => {
  const situation = 'name/detail/children/partners 是业务正文，不是 Graph 调用。';
  const { graph } = graphSchema.planGraphFourAxisMigration(legacyNode('Root', situation));
  assert.equal(graph.situation, situation);
});

test('world migration requires a verified recovery backup before one revision-bound commit', async () => {
  const sourceFacts = [{ name: 'A', detail: 'situation 中的 name 不得替换', children: [], partners: [] }];
  const snapshot = { revision: revisionOfWorldFacts(sourceFacts), facts: sourceFacts };
  const plan = planGraphFourAxisWorldMigration({ snapshot, planner: graphSchema.planGraphFourAxisMigration });
  const calls = [];
  const backup = {
    async create(request) { calls.push(['backup', request]); return { backupId: 'private-1' }; },
    async verify(request) { calls.push(['verify', request]); return true; }
  };
  const persistence = {
    async commit(request) {
      calls.push(['commit', request]);
      return { commandId: 'migration-command', afterRevision: request.nextRevision };
    },
    async rollback(request) { calls.push(['rollback', request]); return { status: 'committed' }; }
  };

  const migration = await applyGraphFourAxisWorldMigration({
    plan, confirmation: true, backup, persistence, correlationId: 'migration-test'
  });
  assert.deepEqual(calls.map(([kind]) => kind), ['backup', 'verify', 'commit']);
  assert.equal(calls[2][1].expectedRevision, snapshot.revision);
  assert.equal(calls[2][1].facts[0].situation, sourceFacts[0].detail);
  assert.equal(JSON.stringify(calls[2][1].facts).includes('situation 中的 name 不得替换'), true);

  await rollbackGraphFourAxisWorldMigration({ migration, persistence });
  assert.equal(calls.at(-1)[0], 'rollback');
  assert.equal(calls.at(-1)[1].targetCommandId, 'migration-command');
});

test('world migration never commits when private backup verification fails', async () => {
  const sourceFacts = [{ name: 'A', detail: '', children: [], partners: [] }];
  const plan = planGraphFourAxisWorldMigration({
    snapshot: { revision: revisionOfWorldFacts(sourceFacts), facts: sourceFacts },
    planner: graphSchema.planGraphFourAxisMigration
  });
  let committed = false;
  await assert.rejects(applyGraphFourAxisWorldMigration({
    plan, confirmation: true,
    backup: { create: async () => ({ backupId: 'bad' }), verify: async () => false },
    persistence: { commit: async () => { committed = true; }, rollback: async () => {} }
  }), { code: 'GRAPH_MIGRATION_BACKUP_VERIFICATION_FAILED' });
  assert.equal(committed, false);
});
