import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../scripts/night-watch-shared-cli-live.mjs', import.meta.url);

test('shared night-watch accepts only the approved Agent and exact bounded run subtree', async () => {
  const { parseSharedNightWatchOptions } = await import(moduleUrl);
  const options = parseSharedNightWatchOptions([
    '--agent', '🧊manage',
    '--root', '🧊manage/工务/work/test/nw-20260829-001',
    '--evidence-dir', 'evidence'
  ]);

  assert.equal(options.agent, '🧊manage');
  assert.equal(options.rootPath, '🧊manage/工务/work/test/nw-20260829-001');
  assert.match(options.evidenceDir, /evidence$/u);
  assert.throws(
    () => parseSharedNightWatchOptions([
      '--agent', '🧊manage', '--root', '🧊manage/工务/work/test/../个务', '--evidence-dir', 'evidence'
    ]),
    (error) => error.code === 'NIGHT_WATCH_SHARED_SCOPE_INVALID'
  );
});

test('shared night-watch readiness follows the current atomProjection health field', async () => {
  const { assertSharedHealth } = await import(moduleUrl);
  assert.deepEqual(assertSharedHealth({
    ok: true,
    version: '0.3.0',
    atomProjection: { status: 'published', revision: 6898 }
  }), { version: '0.3.0', revision: 6898, projectionStatus: 'published' });
  assert.throws(
    () => assertSharedHealth({ ok: true, atomProjection: { status: 'recovering' } }),
    (error) => error.code === 'NIGHT_WATCH_SHARED_NOT_READY'
  );
});

test('shared evidence entries carry timing, dependency, and exact Issue-TestCase refs', async () => {
  const { createSharedEvidenceEntry } = await import(moduleUrl);
  const entry = createSharedEvidenceEntry({
    id: 'verify.lock-denied',
    status: 'passed',
    startedAt: '2026-08-29T00:00:00.000Z',
    endedAt: '2026-08-29T00:00:01.250Z',
    receiptText: 'expected denial',
    diagnostics: ['GRAPH_LOCK_DENIED']
  });

  assert.equal(entry.durationMilliseconds, 1250);
  assert.equal(entry.dependencyStatus, 'ready');
  assert.equal(entry.errorCode, 'OK');
  assert.equal(entry.issueNodeId, 'issue-13');
  assert.equal(entry.testCaseId, 'TC-I13-LOCK-MATRIX');
  assert.match(entry.receiptHash, /^[a-f0-9]{64}$/u);
  assert.throws(
    () => createSharedEvidenceEntry({
      id: 'unmapped-step', status: 'passed', startedAt: '2026-08-29T00:00:00.000Z',
      endedAt: '2026-08-29T00:00:00.001Z', receiptText: '', diagnostics: []
    }),
    (error) => error.code === 'NIGHT_WATCH_SHARED_STEP_UNMAPPED'
  );
});

test('shared runtime exit recovery starts the service once when the journey leaves it unavailable', async () => {
  const { runWithSharedServiceRecovery } = await import(moduleUrl);
  let probes = 0;
  let starts = 0;

  await assert.rejects(
    runWithSharedServiceRecovery(
      async () => { throw Object.assign(new Error('journey failed'), { code: 'JOURNEY_FAILED' }); },
      {
        probeHealth: async () => {
          probes += 1;
          if (probes === 1) throw Object.assign(new Error('offline'), { code: 'OFFLINE' });
          return { ok: true };
        },
        startService: async () => { starts += 1; }
      }
    ),
    (error) => error.code === 'JOURNEY_FAILED'
  );
  assert.equal(starts, 1);
  assert.equal(probes, 2);
});
