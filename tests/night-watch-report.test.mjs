import assert from 'node:assert/strict';
import test from 'node:test';

const reportModuleUrl = new URL('../scripts/night-watch-report.mjs', import.meta.url);

async function loadReporter() {
  return import(reportModuleUrl);
}

test('night-watch report keeps ordered result evidence while excluding sensitive step payloads', async () => {
  const { createRedactedNightWatchReport } = await loadReporter();
  const report = createRedactedNightWatchReport({
    manifestVersion: 1,
    steps: [{
      id: 'program',
      status: 'failed',
      startedAt: '2026-08-29T00:00:00.000Z',
      endedAt: '2026-08-29T00:00:01.000Z',
      durationMilliseconds: 1000,
      dependencyStatus: 'ready',
      errorCode: 'PROGRAM_LOCK_DENIED',
      command: 'COMMAND_BODY_SENTINEL',
      programSource: 'PROGRAM_SOURCE_SENTINEL',
      businessFact: 'BUSINESS_FACT_SENTINEL',
      credential: 'CREDENTIAL_SENTINEL',
      agent: 'UNAPPROVED_AGENT_SENTINEL'
    }]
  });

  assert.deepEqual(report.steps, [{
    id: 'program',
    status: 'failed',
    startedAt: '2026-08-29T00:00:00.000Z',
    endedAt: '2026-08-29T00:00:01.000Z',
    durationMilliseconds: 1000,
    dependencyStatus: 'ready',
    errorCode: 'PROGRAM_LOCK_DENIED'
  }]);
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    'COMMAND_BODY_SENTINEL',
    'PROGRAM_SOURCE_SENTINEL',
    'BUSINESS_FACT_SENTINEL',
    'CREDENTIAL_SENTINEL',
    'UNAPPROVED_AGENT_SENTINEL'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('night-watch report rejects unbounded step summaries rather than serializing them', async () => {
  const { createRedactedNightWatchReport } = await loadReporter();

  assert.throws(
    () => createRedactedNightWatchReport({
      manifestVersion: 1,
      steps: [{
        id: 'program',
        status: 'passed',
        startedAt: '2026-08-29T00:00:00.000Z',
        endedAt: '2026-08-29T00:00:01.000Z',
        durationMilliseconds: 1000,
        dependencyStatus: 'ready',
        errorCode: 'OK',
        summary: 'unbounded text is not evidence'
      }]
    }),
    (error) => error.code === 'NIGHT_WATCH_REPORT_FIELD_FORBIDDEN'
      && error.details.field === 'summary'
  );
});
