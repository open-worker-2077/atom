const SAFE_STEP_FIELDS = new Set([
  'id',
  'status',
  'startedAt',
  'endedAt',
  'durationMilliseconds',
  'dependencyStatus',
  'errorCode'
]);

const DISCARDED_STEP_FIELDS = new Set([
  'agent',
  'businessFact',
  'command',
  'commandBody',
  'credential',
  'credentials',
  'identity',
  'programSource',
  'secret',
  'token'
]);

function reportError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requireNonEmptyString(value, field, index) {
  if (typeof value !== 'string' || !value.trim()) {
    throw reportError('NIGHT_WATCH_REPORT_FIELD_INVALID', `${field} must be a non-empty string`, { field, index });
  }
  return value;
}

function redactStep(step, index) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw reportError('NIGHT_WATCH_REPORT_STEP_INVALID', 'Night-watch report step must be an object', { index });
  }
  for (const field of Object.keys(step)) {
    if (!SAFE_STEP_FIELDS.has(field) && !DISCARDED_STEP_FIELDS.has(field)) {
      throw reportError('NIGHT_WATCH_REPORT_FIELD_FORBIDDEN', 'Night-watch report step contains a forbidden field', {
        field,
        index
      });
    }
  }
  if (!Number.isInteger(step.durationMilliseconds) || step.durationMilliseconds < 0) {
    throw reportError('NIGHT_WATCH_REPORT_DURATION_INVALID', 'Night-watch report duration must be a non-negative integer', { index });
  }
  return {
    id: requireNonEmptyString(step.id, 'id', index),
    status: requireNonEmptyString(step.status, 'status', index),
    startedAt: requireNonEmptyString(step.startedAt, 'startedAt', index),
    endedAt: requireNonEmptyString(step.endedAt, 'endedAt', index),
    durationMilliseconds: step.durationMilliseconds,
    dependencyStatus: requireNonEmptyString(step.dependencyStatus, 'dependencyStatus', index),
    errorCode: requireNonEmptyString(step.errorCode, 'errorCode', index)
  };
}

export function createRedactedNightWatchReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw reportError('NIGHT_WATCH_REPORT_INVALID', 'Night-watch report input must be an object');
  }
  if (!Number.isInteger(input.manifestVersion) || input.manifestVersion <= 0) {
    throw reportError('NIGHT_WATCH_REPORT_MANIFEST_VERSION_INVALID', 'Night-watch report manifest version must be a positive integer');
  }
  if (!Array.isArray(input.steps)) {
    throw reportError('NIGHT_WATCH_REPORT_STEPS_INVALID', 'Night-watch report requires steps');
  }
  return {
    contract: 'atom.night-watch-report',
    version: 1,
    manifestVersion: input.manifestVersion,
    steps: input.steps.map(redactStep)
  };
}
