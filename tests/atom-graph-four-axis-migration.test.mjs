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

test('migration planner preserves every non-empty partners item without assigning support semantics', () => {
  const result = graphSchema.planGraphFourAxisMigration({
    name: '世界', detail: '', partners: [], children: [
      { name: 'A', detail: '', children: [], partners: [
        { verb: '', object: 'B' }, { verb: '', object: 'C' }
      ] },
      { name: 'B', detail: '', children: [], partners: [] },
      { name: 'C', detail: '', children: [], partners: [] }
    ]
  }, { allowEmptyVerbAsSupport: true });
  assert.deepEqual(result.summary.legacyRelations, [
      { source: '世界/A', ordinal: 0, verb: '', object: 'B' },
      { source: '世界/A', ordinal: 1, verb: '', object: 'C' }
  ]);
  assert.deepEqual(result.graph.contain[0].support, [
    { verb: '', object: 'B' }, { verb: '', object: 'C' }
  ]);
  assert.equal(JSON.stringify(result.graph).includes('if@current'), false);
});

test('migration planner preserves a legacy verb instead of losing or guessing it', () => {
  const result = graphSchema.planGraphFourAxisMigration({
    name: '世界', detail: '', children: [
      { name: 'A', detail: '', children: [], partners: [{ verb: '依赖', object: 'B' }] },
      { name: 'B', detail: '', children: [], partners: [] }
    ], partners: []
  });
  assert.deepEqual(result.summary.legacyRelations[0], {
    source: '世界/A', ordinal: 0, verb: '依赖', object: 'B'
  });
  assert.deepEqual(result.graph.contain[0].support[0], { verb: '依赖', object: 'B' });
});

test('migration upgrades only proven Graph API keys and AtomView attributes', () => {
  const legacy = legacyNode('Root', '', [legacyNode(
    'Program',
    "# name stays in this comment\ndef main(arguments):\n    nodes = explore({'name': 'Target', 'detail': 'name stays'})\n    return {'label': nodes[0].name, 'text': 'partners stays'}",
    [],
    [],
    '@program'
  )]);
  const result = graphSchema.planGraphFourAxisMigration(legacy);
  assert.equal(result.summary.programs[0].path, 'Root/Program');
  assert.deepEqual(result.summary.programs[0].uses.map(({ call, axis, line }) => ({ call, axis, line })), [
      { call: 'explore', axis: 'name', line: 3 },
      { call: 'explore', axis: 'detail', line: 3 },
      { call: 'AtomView', axis: 'name', line: 4 }
  ]);
  assert.equal(result.summary.programs[0].disposition, 'upgraded');
  assert.equal(result.summary.programs[0].sourceHashBefore, result.summary.programs[0].sourceHash);
  assert.notEqual(result.summary.programs[0].sourceHashAfter, result.summary.programs[0].sourceHashBefore);
  assert.deepEqual(result.summary.programs[0].blockers, []);
  assert.equal(result.graph.contain[0].situation, [
    '# name stays in this comment',
    'def main(arguments):',
    "    nodes = explore({'thing': 'Target', 'situation': 'name stays'})",
    "    return {'label': nodes[0].thing, 'text': 'partners stays'}"
  ].join('\n'));
  assert.equal(result.summary.readyToCommit, true);
});

test('migration reports every ambiguous executable Program and closes the commit gate', () => {
  const legacy = legacyNode('Root', '', [
    legacyNode('Dynamic', "axis = 'name'\nexplore({axis: 'A'})", [], [], '@program'),
    legacyNode('Unknown View', [
      'def first(items):',
      '    return items[0]',
      "payload = first(explore({'thing':'Root'}))",
      "message({'level':'info','text':payload.name})"
    ].join('\n'), [], [], '@program')
  ]);
  const result = graphSchema.planGraphFourAxisMigration(legacy);

  assert.equal(result.summary.readyToCommit, false);
  assert.deepEqual(result.summary.blockedPrograms.map(({ path }) => path), [
    'Root/Dynamic', 'Root/Unknown View'
  ]);
  for (const blocked of result.summary.blockedPrograms) {
    assert.match(blocked.sourceHash, /^sha256:/u);
    assert.ok(blocked.blockers.every(({ line, column, reason }) => (
      Number.isInteger(line) && Number.isInteger(column) && reason
    )));
  }
  assert.equal(result.graph.contain[0].situation, legacy.children[0].detail);
  assert.equal(result.graph.contain[1].situation, legacy.children[1].detail);
});

test('default backup Program preserves source while exact test Program is upgraded', () => {
  const archivedSource = "explore({'name':'Archived'})";
  const testSource = "explore({'name':'Fixture'})";
  const legacy = legacyNode('Root', '', [
    legacyNode('Backup', '', [legacyNode('Archived', archivedSource, [], [], '@program')], [], '@backup@default'),
    legacyNode('test', '', [legacyNode('Fixture', testSource, [], [], '@program')])
  ]);
  const result = graphSchema.planGraphFourAxisMigration(legacy, { testRoots: ['Root/test'] });

  assert.equal(result.graph.contain[0].contain[0].situation, archivedSource);
  assert.equal(result.graph.contain[1].contain[0].situation, "explore({'thing':'Fixture'})");
  assert.deepEqual(result.summary.programs.map(({ path, disposition }) => ({ path, disposition })), [
    { path: 'Root/Backup/Archived', disposition: 'historical-non-executable' },
    { path: 'Root/test/Fixture', disposition: 'upgraded-test' }
  ]);
});

test('Program upgrader follows proven current_atom and explore loop views only', () => {
  const source = [
    "label = 'detail stays text'",
    'current = current_atom()',
    'message({\'level\':\'info\', \'text\': current.detail})',
    "for node in explore({'children': []}):",
    '    message({\'level\':\'info\', \'text\': node.name})'
  ].join('\n');
  const result = graphSchema.planGraphFourAxisMigration(legacyNode(
    'Root', '', [legacyNode('Views', source, [], [], '@program')]
  ));

  assert.equal(result.summary.readyToCommit, true);
  assert.equal(result.graph.contain[0].situation, [
    "label = 'detail stays text'",
    'current = current_atom()',
    'message({\'level\':\'info\', \'text\': current.situation})',
    "for node in explore({'contain': []}):",
    '    message({\'level\':\'info\', \'text\': node.thing})'
  ].join('\n'));
});

test('ordinary object attributes remain byte-identical when no Graph view exists', () => {
  const source = [
    'class Payload:',
    "    name = 'business'",
    'payload = Payload()',
    "message({'level':'info','text':payload.name})"
  ].join('\n');
  const result = graphSchema.planGraphFourAxisMigration(legacyNode(
    'Root', '', [legacyNode('Business', source, [], [], '@program')]
  ));

  assert.equal(result.summary.readyToCommit, true);
  assert.equal(result.graph.contain[0].situation, source);
  assert.deepEqual(result.summary.programs[0].edits, []);
});

test('world migration refuses to commit a plan with Program source blockers', async () => {
  const sourceFacts = [legacyNode('Root', '', [legacyNode(
    'Blocked', "axis = 'name'\nexplore({axis:'Root'})", [], [], '@program'
  )])];
  const plan = planGraphFourAxisWorldMigration({
    snapshot: { revision: revisionOfWorldFacts(sourceFacts), facts: sourceFacts },
    planner: graphSchema.planGraphFourAxisMigration
  });
  let backedUp = false;
  let committed = false;
  await assert.rejects(applyGraphFourAxisWorldMigration({
    plan,
    confirmation: true,
    backup: {
      create: async () => { backedUp = true; return {}; },
      verify: async () => true
    },
    persistence: {
      commit: async () => { committed = true; },
      rollback: async () => {}
    }
  }), (error) => error?.code === 'GRAPH_PROGRAM_SOURCE_UPGRADE_BLOCKED'
    && error.details.programs[0].path === 'Root/Blocked');
  assert.equal(backedUp, false);
  assert.equal(committed, false);
});

test('migration does not treat ordinary situation words as structural fields', () => {
  const situation = 'name/detail/children/partners 是业务正文，不是 Graph 调用。';
  const { graph } = graphSchema.planGraphFourAxisMigration(legacyNode('Root', situation));
  assert.equal(graph.situation, situation);
});

test('world migration requires a verified recovery backup before one revision-bound commit', async () => {
  const programSource = "nodes = explore({'name':'A'})\nmessage({'level':'info','text':nodes[0].name})";
  const sourceFacts = [{
    name: 'A', detail: 'situation 中的 name 不得替换', partners: [], children: [
      legacyNode('Reader', programSource, [], [], '@program')
    ]
  }];
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
  assert.equal(calls[0][1].facts[0].children[0].detail, programSource);
  assert.equal(calls[2][1].facts[0].contain[0].situation,
    "nodes = explore({'thing':'A'})\nmessage({'level':'info','text':nodes[0].thing})");
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
