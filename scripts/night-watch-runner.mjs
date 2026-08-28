import { validateNightWatchManifest } from './night-watch-manifest.mjs';
import { createRedactedNightWatchReport } from './night-watch-report.mjs';
import { renderNightWatchStatusGraph } from './night-watch-status-graph.mjs';

function safeTimestamp(now) {
  const value = now();
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError('Night-watch clock must return an ISO timestamp');
  }
  return timestamp;
}

function durationMilliseconds(startedAt, endedAt) {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

function failedStatus(status) {
  return status !== 'passed' && status !== 'dry-run';
}

function verifiedOutcome(step, outcome) {
  if (outcome?.status !== 'passed') return outcome;
  const evidence = outcome.evidence;
  const valid = evidence && evidence.issueNodeId === step.issueNodeId
    && evidence.testCaseId === step.testCaseId
    && evidence.validity === 'valid'
    && evidence.outcome === 'passed'
    && evidence.conclusive === true;
  if (valid) return outcome;
  return { status: 'revalidation-required', errorCode: 'NIGHT_WATCH_STEP_EVIDENCE_MISSING' };
}

function blockedStep(step, results, now) {
  const startedAt = safeTimestamp(now);
  const endedAt = safeTimestamp(now);
  return {
    id: step.id,
    status: 'blocked',
    startedAt,
    endedAt,
    durationMilliseconds: durationMilliseconds(startedAt, endedAt),
    dependencyStatus: 'blocked',
    errorCode: 'DEPENDENCY_BLOCKED'
  };
}

export async function runNightWatch(options = {}) {
  const manifest = validateNightWatchManifest(options.manifest, options.catalog);
  const dryRun = options.dryRun === true;
  const now = options.now ?? (() => new Date().toISOString());
  const executeStep = options.executeStep;
  const recoverService = options.recoverService;
  if (!dryRun && typeof executeStep !== 'function') {
    throw new TypeError('Night-watch live runs require an executeStep adapter');
  }
  if (!dryRun && typeof recoverService !== 'function') {
    throw new TypeError('Night-watch live runs require a recoverService adapter');
  }

  const results = new Map();
  let firstBlocker = null;
  let recoveryErrorCode = null;
  try {
    for (const step of manifest.steps) {
      if (step.dependsOn.some((dependency) => failedStatus(results.get(dependency).status))) {
        results.set(step.id, blockedStep(step, results, now));
        continue;
      }
      const startedAt = safeTimestamp(now);
      let status = 'passed';
      let errorCode = 'OK';
      if (dryRun) {
        status = 'dry-run';
        errorCode = 'DRY_RUN';
      } else {
        try {
          const outcome = verifiedOutcome(step, await executeStep(step));
          status = outcome?.status === 'passed' ? 'passed' : 'failed';
          if (outcome?.status === 'revalidation-required') status = 'revalidation-required';
          errorCode = typeof outcome?.errorCode === 'string' && outcome.errorCode
            ? outcome.errorCode
            : status === 'passed' ? 'OK' : 'UNKNOWN_COMMIT_STATE';
        } catch (error) {
          status = 'failed';
          errorCode = typeof error?.code === 'string' && error.code ? error.code : 'STEP_EXECUTION_FAILED';
        }
      }
      const endedAt = safeTimestamp(now);
      const result = {
        id: step.id,
        status,
        startedAt,
        endedAt,
        durationMilliseconds: durationMilliseconds(startedAt, endedAt),
        dependencyStatus: 'ready',
        errorCode
      };
      results.set(step.id, result);
      if (firstBlocker === null && failedStatus(status)) firstBlocker = step.id;
    }
  } finally {
    if (!dryRun) {
      try {
        await recoverService();
      } catch (error) {
        recoveryErrorCode = typeof error?.code === 'string' && error.code
          ? error.code
          : 'SERVICE_RECOVERY_FAILED';
      }
    }
  }

  const statusGraph = options.statusGraph === undefined ? undefined : renderNightWatchStatusGraph(options.statusGraph);
  return {
    firstBlocker,
    recoveryErrorCode,
    ...(statusGraph ? { statusGraph } : {}),
    report: createRedactedNightWatchReport({
      manifestVersion: manifest.version,
      steps: manifest.steps.map((step) => results.get(step.id))
    })
  };
}
