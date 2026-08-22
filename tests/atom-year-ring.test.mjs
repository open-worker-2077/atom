import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { createJsonRuntimeDiagnosticRepository } from '../src/atom-system/adapters/json-runtime-diagnostic-repository.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository
} from '../src/atom-system/adapters/json-world-repository.mjs';
import {
  createRuntimeDiagnosticStore,
  queryYearRing,
  rebuildYearRingIndex
} from '../src/atom-system/world-runtime/year-ring.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

test('committed receipts retain compact affected Atom and Graph-axis metadata', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-year-ring-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldRepository = createJsonWorldRepository({
    file: path.join(directory, 'atom.json'), worldId: 'primary', initialFacts: []
  });
  const journalRepository = createJsonTransactionJournal({
    file: path.join(directory, 'transactions.json')
  });
  const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
  const initial = await worldRepository.read();

  const receipt = await coordinator.execute({
    command: {
      contract: 'atom.world-command', version: 1, commandId: 'year-ring-1',
      correlationId: 'year-ring-correlation', expectedRevision: initial.revision,
      name: 'transform', payload: { source: 'web' }
    },
    transition: ({ facts }) => ({
      facts: [...facts, { name: '项目', detail: '新建' }],
      result: {
        affectedAtoms: [{ path: '项目', axes: ['name', 'detail'] }],
        source: 'web'
      }
    })
  });

  assert.deepEqual(receipt.affectedAtoms, [{ path: '项目', axes: ['detail', 'name'] }]);
  assert.equal(typeof receipt.committedAt, 'string');
  assert.equal(receipt.source, 'web');
  assert.equal(JSON.stringify(receipt).includes('新建'), false);
});

test('old receipts without year-ring metadata remain readable', async () => {
  const { validateWorldReceipt } = await import('../src/atom-system/public/contracts.mjs');
  const old = validateWorldReceipt({
    contract: 'atom.world-receipt', version: 1,
    commandId: 'old', correlationId: 'old-correlation',
    beforeRevision: 'rev-1', afterRevision: 'rev-2',
    status: 'committed', result: null
  });

  assert.equal(old.commandId, 'old');
  assert.equal(Object.hasOwn(old, 'affectedAtoms'), false);
});

test('runtime diagnostics retain compact Program facts for a bounded period', async () => {
  let now = Date.parse('2026-08-20T10:00:00Z');
  const store = createRuntimeDiagnosticStore({
    now: () => now, retentionMs: 1_000, maxEntries: 2
  });
  await store.record({
    id: 'read-old', type: 'read', durationMs: 4, outcome: 'success',
    affectedAtoms: [{ path: '项目', axes: [] }],
    detail: '不得保存的私密正文'
  });
  now += 500;
  await store.record({
    id: 'program-failed', type: 'program', durationMs: 12, outcome: 'failure',
    program: { path: '测试程序', ref: 'program-ref', fingerprint: 'sha256:program' },
    failure: { code: 'BROKEN', message: '失败原因', detail: '不得复制' },
    affectedAtoms: [{ path: '项目/Step', axes: ['detail'] }]
  });
  now += 600;
  await store.record({
    id: 'read-new', type: 'read', durationMs: 2, outcome: 'success',
    affectedAtoms: [{ path: '其他', axes: [] }]
  });

  const diagnostics = await store.list();
  assert.deepEqual(diagnostics.map((item) => item.id), ['program-failed', 'read-new']);
  assert.equal(diagnostics[0].program.fingerprint, 'sha256:program');
  assert.deepEqual(diagnostics[0].failure, { code: 'BROKEN', message: '失败原因' });
  assert.equal(JSON.stringify(diagnostics).includes('私密正文'), false);
  assert.equal(JSON.stringify(diagnostics).includes('不得复制'), false);
});

test('runtime diagnostics survive a repository restart and reject invalid persisted state', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-runtime-diagnostics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'runtime-diagnostics.json');
  const first = createRuntimeDiagnosticStore({
    repository: createJsonRuntimeDiagnosticRepository({ file }),
    maxEntries: 10
  });
  await first.record({
    id: 'persisted-read', type: 'read', durationMs: 3, outcome: 'success',
    affectedAtoms: [{ path: '项目', axes: [] }],
    detail: '不得写入持久文件'
  });

  const second = createRuntimeDiagnosticStore({
    repository: createJsonRuntimeDiagnosticRepository({ file }),
    maxEntries: 10
  });
  assert.deepEqual((await second.list()).map((item) => item.id), ['persisted-read']);
  const persisted = await fs.readFile(file, 'utf8');
  assert.equal(persisted.includes('不得写入持久文件'), false);
  assert.equal(JSON.parse(persisted).version, 1);

  await fs.writeFile(file, '{"version":2,"diagnostics":[]}', 'utf8');
  await assert.rejects(
    createJsonRuntimeDiagnosticRepository({ file }).read(),
    (error) => error.code === 'INVALID_RUNTIME_DIAGNOSTIC_FILE'
  );
});

test('Program runtime records success and isolated failure diagnostics without blocking peers', async () => {
  const store = createRuntimeDiagnosticStore({ maxEntries: 10 });
  const scheduler = createProgramRuntimeScheduler({ diagnosticRecorder: store });
  const cycle = await scheduler.refresh([
    atom('成功程序', "message({'level': 'info', 'text': 'ok'})", [], 'program'),
    atom('失败程序', "raise ValueError('broken')", [], 'program')
  ], { isolateFailures: true, force: true });

  assert.equal(
    cycle.messages.some((message) => message.text === 'ok'),
    true,
    JSON.stringify(cycle.failures)
  );
  assert.equal(cycle.failures.length, 1);
  const diagnostics = await store.list();
  assert.deepEqual(diagnostics.map((item) => item.outcome).sort(), ['failure', 'success']);
  for (const item of diagnostics) {
    assert.equal(item.type, 'program');
    assert.match(item.program.fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(typeof item.durationMs, 'number');
    assert.deepEqual(item.affectedAtoms[0].path, item.program.path);
  }
});

test('year-ring index rebuilds exact per-Atom history without changing central facts', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-year-ring-rebuild-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldRepository = createJsonWorldRepository({
    file: path.join(directory, 'atom.json'), worldId: 'primary', initialFacts: []
  });
  const journalRepository = createJsonTransactionJournal({
    file: path.join(directory, 'transactions.json')
  });
  const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
  const initial = await worldRepository.read();
  await coordinator.execute({
    command: {
      contract: 'atom.world-command', version: 1, commandId: 'index-1',
      correlationId: 'index-correlation', expectedRevision: initial.revision,
      name: 'transform', payload: { source: 'cli' }
    },
    transition: ({ facts }) => ({ facts: [...facts, atom('项目', 'secret')] })
  });
  const journal = await journalRepository.readState();
  const journalBefore = structuredClone(journal);
  const committedAt = journal.receipts[0]?.receipt?.committedAt ?? journal.receipts[0]?.committedAt;
  const diagnosticRecordedAt = new Date(Date.parse(committedAt) + 1_000).toISOString();
  const diagnostics = [{
    id: 'program-1', type: 'program', recordedAt: diagnosticRecordedAt,
    durationMs: 3, outcome: 'success',
    program: { path: '项目/程序', ref: 'p1', fingerprint: 'sha256:p1' },
    affectedAtoms: [
      { path: '项目', ref: 'project-ref', axes: ['detail'] },
      { path: '项目', axes: [] }
    ]
  }, {
    id: 'other-read', type: 'read', recordedAt: '2026-08-20T10:01:00.000Z',
    durationMs: 1, outcome: 'success', affectedAtoms: [{ path: '其他', axes: [] }]
  }];

  const first = rebuildYearRingIndex({ journal, diagnostics });
  const rebuilt = rebuildYearRingIndex({ journal, diagnostics });
  assert.deepEqual(rebuilt, first, 'rebuild is deterministic');
  const history = queryYearRing(rebuilt, '项目');
  assert.deepEqual(history.map((item) => item.kind), ['receipt', 'diagnostic']);
  assert.deepEqual(history.map((item) => item.id), ['index-1', 'program-1']);
  assert.equal(JSON.stringify(history).includes('secret'), false);
  assert.deepEqual(await journalRepository.readState(), journalBefore, 'projection rebuild never writes world truth');
});

test('compacted transaction history retains enough receipts to rebuild every affected Atom event', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-year-ring-compact-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldRepository = createJsonWorldRepository({
    file: path.join(directory, 'atom.json'), worldId: 'primary', initialFacts: []
  });
  const journalRepository = createJsonTransactionJournal({
    file: path.join(directory, 'transactions.json')
  });
  const coordinator = createCommitCoordinator({ worldRepository, journalRepository });

  for (const [index, detail] of ['一', '二', '三'].entries()) {
    const current = await worldRepository.read();
    await coordinator.execute({
      command: {
        contract: 'atom.world-command', version: 1, commandId: `compact-${index + 1}`,
        correlationId: `compact-correlation-${index + 1}`, expectedRevision: current.revision,
        name: 'transform', payload: { source: 'cli' }
      },
      transition: ({ facts }) => ({
        facts: index === 0 ? [atom('项目', detail)] : [atom('项目', detail), ...facts.slice(1)]
      })
    });
  }

  const journal = await journalRepository.readState();
  assert.equal(Object.hasOwn(journal.receipts[0].before, 'facts'), false);
  assert.equal(Object.hasOwn(journal.receipts[0].after, 'facts'), false);
  assert.equal(Array.isArray(journal.receipts.at(-1).after.facts), true);
  const history = queryYearRing(rebuildYearRingIndex({ journal }), '项目');
  assert.deepEqual(history.map((item) => item.id), ['compact-1', 'compact-2', 'compact-3']);
  assert.deepEqual(history.map((item) => item.atom.axes), [
    ['children', 'detail', 'name', 'partners'],
    ['detail'],
    ['detail']
  ]);
});
