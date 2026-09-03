import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { planStrutReceiverMigration } from '../work-engine/atom-language/strut-receiver-migration.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { projectAtomContext } from '../work-engine/atom-language/context-store.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const operator = path.join(projectRoot, 'scripts', 'deploy-strut-receiver-world.mjs');

function atom(key, name, situation = '', slot = [], strut = []) {
  return { [key]: name, situation, slot, strut };
}

const receiver = (name, node = 'Result') => atom('thing@program', name, [
  'def receive(delivery):',
  '    return delivery["decision"]',
  `trigger("strut", {"nodes":[${JSON.stringify(node)}]}, receive)`
].join('\n'));

const migratedReceiver = (name) => atom('thing@program', name, [
  'def receive(delivery):',
  '    return delivery["decision"]',
  'trigger("strut", {}, receive)'
].join('\n'));

test('a completed receiver-owned world produces an empty repeatable migration plan', () => {
  const source = [
    atom('thing', 'Source', '', [], [{
      'if@current': true,
      then: [{ 'thing@program': 'Receiver' }]
    }]),
    migratedReceiver('Receiver')
  ];
  const snapshot = structuredClone(source);

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(source, snapshot, 'repeatable preflight must not mutate authoritative facts');
  assert.deepEqual(plan.facts, source);
  assert.deepEqual(plan.summary, {
    migratedPrograms: 0,
    migratedSubscriptions: 0,
    rewrittenConsequents: 0
  });
  assert.deepEqual(plan.changedPaths, []);
  assert.equal(plan.expectedRevision, plan.nextRevision);
});

test('replaces one subscribed fact consequent with its receiver Program and rewrites only the trigger parameters', () => {
  const source = [
    atom('thing', 'Source', '', [], [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ thing: 'Result' }]
    }]),
    atom('thing', 'Result'),
    receiver('Receiver')
  ];
  const snapshot = structuredClone(source);

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(source, snapshot, 'planner must not mutate authoritative source facts');
  assert.deepEqual(plan.facts[0].strut[0].then, [{ 'thing@program': 'Receiver' }]);
  assert.match(plan.facts[2].situation, /trigger\(['"]strut['"], \{\}, receive\)/u);
  assert.equal(plan.summary.migratedPrograms, 1);
  assert.equal(plan.summary.rewrittenConsequents, 1);
  assert.deepEqual(plan.changedPaths, ['Receiver', 'Source']);
});

test('expands one subscribed fact consequent to every explicit receiver Program', () => {
  const source = [
    atom('thing', 'Source', '', [], [{ 'if@current': true, then: [{ thing: 'Result' }] }]),
    atom('thing', 'Result'),
    receiver('First'),
    receiver('Second')
  ];

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(plan.facts[0].strut[0].then, [
    { 'thing@program': 'First' },
    { 'thing@program': 'Second' }
  ]);
  assert.equal(plan.summary.migratedPrograms, 2);
});

test('preserves a current structural consequent while adding its explicit receiver Program', () => {
  const source = [
    atom('thing', 'Source'),
    atom('thing', 'Result', '', [], [{
      if: [{ thing: 'Source' }],
      'then@current': true
    }]),
    receiver('Receiver')
  ];

  const plan = planStrutReceiverMigration(source);

  assert.equal(plan.facts[1].strut[0]['then@current'], true);
  assert.deepEqual(plan.facts[1].strut[0].then, [{ 'thing@program': 'Receiver' }]);
});

test('resolves a relative slot-model node and points the clause at the shared Program role', () => {
  const source = [atom('thing', 'Body', '', [
    atom('thing', 'Model', '', [
      atom('thing', 'Input', '', [], [{ 'if@current': true, then: [{ thing: 'Run' }] }]),
      atom('thing', 'Run'),
      receiver('Action', './Run')
    ])
  ])];

  const plan = planStrutReceiverMigration(source);

  assert.deepEqual(plan.facts[0].slot[0].slot[0].strut[0].then, [
    { 'thing@program': 'Body/Model/Action' }
  ]);
});

test('keeps default-backup history untouched and blocks an active subscription without a Graph consequent', () => {
  const archived = atom('thing@backup@default', 'Backup', '', [receiver('OldReceiver')]);
  assert.deepEqual(planStrutReceiverMigration([archived]).facts, [archived]);

  assert.throws(() => planStrutReceiverMigration([
    atom('thing', 'Result'),
    receiver('Receiver')
  ]), { code: 'STRUT_RECEIVER_MIGRATION_CONSEQUENT_REQUIRED' });
});

test('blocks dynamic strut trigger parameters instead of guessing', () => {
  assert.throws(() => planStrutReceiverMigration([
    atom('thing@program', 'Receiver', [
      'def receive(delivery):',
      '    return True',
      'nodes = ["Result"]',
      'trigger("strut", {"nodes":nodes}, receive)'
    ].join('\n'))
  ]), { code: 'STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER' });
});

test('blocks every malformed or statically unknown top-level trigger before migration', () => {
  for (const [source, code] of [
    ['trigger("strut", {"nodes":["Result"]})', 'STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER'],
    ['trigger(mode, {"nodes":["Result"]}, receive)', 'STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER'],
    ['trigger("strut", {"nodes":["Result"]}, receive, extra=True)', 'STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER'],
    [[
      'trigger("transform", {"nodes":["Source"]}, receive)',
      'trigger("strut", {"nodes":["Result"]}, receive)'
    ].join('\n'), 'STRUT_RECEIVER_MIGRATION_TRIGGER_COUNT']
  ]) {
    assert.throws(() => planStrutReceiverMigration([
      atom('thing@program', 'Receiver', source)
    ]), { code });
  }
});

test('operator apply and receipt-only rollback restore the exact source world', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-receiver-apply-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const source = [
    atom('thing', 'Source', '', [], [{ 'if@current': true, then: [{ thing: 'Result' }] }]),
    atom('thing', 'Result'),
    receiver('Receiver')
  ];
  await fs.mkdir(worldDirectory, { recursive: true });
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');

  const applied = JSON.parse((await execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'apply-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } })).stdout);
  assert.equal(applied.contract, 'atom.strut-receiver-deployment-receipt');
  assert.deepEqual(applied.migrated[0], {
    programPath: 'Receiver', nodePath: 'Result', entrypoint: 'receive'
  });

  await fs.rm(applied.receiptFile);
  await fs.rm(path.join(worldDirectory, 'graph.json'));
  const recovered = JSON.parse((await execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'apply-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } })).stdout);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.transaction.commandId, applied.transaction.commandId);
  const migratedFacts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const { config, graph } = projectAtomContext(migratedFacts);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(worldDirectory, 'graph.json'), 'utf8')), {
    config, graph
  });

  const rolledBack = JSON.parse((await execFileAsync(process.execPath, [
    operator, '--rollback', recovered.receiptFile
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } })).stdout);
  assert.equal(rolledBack.revision, revisionOfWorldFacts(source));
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), source);
});

test('operator refuses a linked backup root before any migration write', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-receiver-link-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const outside = path.join(localAppData, 'outside');
  const source = [
    atom('thing', 'Source', '', [], [{ 'if@current': true, then: [{ thing: 'Result' }] }]),
    atom('thing', 'Result'),
    receiver('Receiver')
  ];
  await fs.mkdir(worldDirectory, { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  try {
    await fs.symlink(outside, path.join(worldDirectory, 'migration-backups'),
      process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`linked directory creation unsupported: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'link-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } }), (error) => (
    error.stderr.includes('STRUT_RECEIVER_MIGRATION_UNSAFE_PATH')
  ));
  assert.deepEqual(await fs.readdir(outside), []);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), source);
});

test('a committed projection failure automatically restores the exact source revision', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-strut-receiver-fault-'));
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }));
  const worldDirectory = path.join(localAppData, 'AtomGraph', 'worlds', 'primary');
  const contextFile = path.join(worldDirectory, 'atom.json');
  const graphFile = path.join(worldDirectory, 'graph.json');
  const source = [
    atom('thing', 'Source', '', [], [{ 'if@current': true, then: [{ thing: 'Result' }] }]),
    atom('thing', 'Result'),
    receiver('Receiver')
  ];
  await fs.mkdir(worldDirectory, { recursive: true });
  await fs.mkdir(graphFile);
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');

  await assert.rejects(execFileAsync(process.execPath, [
    operator, '--apply', '--attempt', 'fault-1'
  ], { cwd: projectRoot, env: { ...process.env, LOCALAPPDATA: localAppData } }));
  assert.equal(
    revisionOfWorldFacts(JSON.parse(await fs.readFile(contextFile, 'utf8'))),
    revisionOfWorldFacts(source)
  );
});
