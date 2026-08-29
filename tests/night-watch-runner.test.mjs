import assert from 'node:assert/strict';
import test from 'node:test';
import { nightWatchCaseCatalog } from '../scripts/night-watch-case-catalog.mjs';

const runnerModuleUrl = new URL('../scripts/night-watch-runner.mjs', import.meta.url);

const CAPABILITIES = [
  'health', 'web-entry', 'mobile-entry', 'agent', 'program', 'explore-transform',
  'authorization-locks', 'jump', 'shortcut', 'slot-body', 'work-order', 'restart',
  'persistence-read-back'
];

function manifest() {
  return {
    contract: 'atom.night-watch-manifest',
    version: 1,
    caseCatalog: { contract: 'atom.night-watch-case-catalog', version: 1 },
    steps: CAPABILITIES.map((capability, index) => {
      const testCaseId = nightWatchCaseCatalog.coverage[capability].requiredCaseIds[0];
      const mappedCase = nightWatchCaseCatalog.cases.find((entry) => entry.id === testCaseId);
      return {
        id: capability,
        capability,
        dependsOn: ({
        health: [], 'web-entry': ['health'], 'mobile-entry': ['health'], agent: ['health'],
        program: ['agent'], 'explore-transform': ['program'], 'authorization-locks': ['explore-transform'],
        jump: ['authorization-locks'], shortcut: ['explore-transform'], 'slot-body': ['explore-transform'],
        'work-order': ['explore-transform'], restart: ['authorization-locks', 'jump', 'shortcut', 'slot-body', 'work-order'],
        'persistence-read-back': ['restart']
        })[capability],
        mutationClass: 'none',
        commandKind: 'adapter',
        timeoutMilliseconds: 1000,
        evidencePolicy: 'redacted-summary',
        issueNodeId: mappedCase.issueNodeId,
        testCaseId
      };
    })
  };
}

async function loadRunner() {
  return import(runnerModuleUrl);
}

test('night-watch runner preserves order, contains dependent writes at the first blocker, and recovers service', async () => {
  const { runNightWatch } = await loadRunner();
  const called = [];
  let tick = 0;
  const result = await runNightWatch({
    manifest: manifest(), catalog: nightWatchCaseCatalog,
    now: () => new Date(Date.parse('2026-08-29T00:00:00.000Z') + (tick++ * 1000)).toISOString(),
    executeStep: async (step) => {
      called.push(step.id);
      return step.id === 'program'
        ? { status: 'failed', errorCode: 'PROGRAM_FAILED' }
        : { status: 'passed', errorCode: 'OK', evidence: { issueNodeId: step.issueNodeId, testCaseId: step.testCaseId, validity: 'valid', outcome: 'passed', conclusive: true } };
    },
    recoverService: async () => { called.push('recover'); }
  });

  assert.deepEqual(called, ['health', 'web-entry', 'mobile-entry', 'agent', 'program', 'recover']);
  assert.equal(result.firstBlocker, 'program');
  assert.equal(result.report.steps.find((step) => step.id === 'explore-transform').status, 'blocked');
  assert.equal(result.report.steps.find((step) => step.id === 'mobile-entry').status, 'passed');
});

test('night-watch runner rejects a passed step without its exact valid case evidence', async () => {
  const { runNightWatch } = await loadRunner();
  const result = await runNightWatch({
    manifest: manifest(), catalog: nightWatchCaseCatalog,
    executeStep: async () => ({ status: 'passed', errorCode: 'OK' }),
    recoverService: async () => {}
  });
  const health = result.report.steps.find((step) => step.id === 'health');
  assert.equal(health.status, 'revalidation-required');
  assert.equal(health.errorCode, 'NIGHT_WATCH_STEP_EVIDENCE_MISSING');
});

test('night-watch runner does not let shortcut failure block independent slot-body or work-order branches', async () => {
  const { runNightWatch } = await loadRunner();
  const called = [];
  const result = await runNightWatch({
    manifest: manifest(), catalog: nightWatchCaseCatalog,
    executeStep: async (step) => {
      called.push(step.id);
      return step.id === 'shortcut'
        ? { status: 'failed', errorCode: 'SHORTCUT_FAILED' }
        : { status: 'passed', errorCode: 'OK', evidence: { issueNodeId: step.issueNodeId, testCaseId: step.testCaseId, validity: 'valid', outcome: 'passed', conclusive: true } };
    },
    recoverService: async () => {}
  });
  assert.equal(result.firstBlocker, 'shortcut');
  assert.equal(called.includes('slot-body'), true);
  assert.equal(called.includes('work-order'), true);
  assert.equal(result.report.steps.find((step) => step.id === 'restart').status, 'blocked');
});

test('night-watch dry-run emits ordered timing evidence without invoking live adapters', async () => {
  const { runNightWatch } = await loadRunner();
  let executeCount = 0;
  let recoveryCount = 0;

  const result = await runNightWatch({
    manifest: manifest(), catalog: nightWatchCaseCatalog,
    dryRun: true,
    executeStep: async () => { executeCount += 1; },
    recoverService: async () => { recoveryCount += 1; }
  });

  assert.equal(executeCount, 0);
  assert.equal(recoveryCount, 0);
  assert.equal(result.firstBlocker, null);
  assert.equal(result.report.steps.every((step) => step.status === 'dry-run'), true);
});

test('night-watch runner returns an evidence-attached GitHub Markdown status graph without writing GitHub', async () => {
  const { runNightWatch } = await loadRunner();
  const result = await runNightWatch({
    manifest: manifest(), catalog: nightWatchCaseCatalog, dryRun: true,
    statusGraph: {
      issue: { number: 1, url: 'https://github.com/open-worker-2077/atom/issues/1' },
      requirements: [{ id: 'dry-run', status: 'pending', cases: [] }], gates: []
    }
  });
  assert.match(result.statusGraph.markdown, /Issue #1/u);
  assert.deepEqual(result.statusGraph.firstOpenNode, { kind: 'requirement', id: 'dry-run', status: 'pending' });
});
