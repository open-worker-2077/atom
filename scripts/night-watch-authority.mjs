export const NIGHT_WATCH_AUTHORITY_CONTRACT = 'atom.night-watch-authority-receipt';
export const NIGHT_WATCH_AUTHORITY_VERSION = 1;
const NIGHT_WATCH_TEST_DOMAIN_PREFIX = '🧊manage/工务/work/test/';

function authorityError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requireNonEmptyString(value, code, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw authorityError(code, `${field} must be a non-empty string`);
  }
  return value;
}

function requirePermission(value, code, name, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.allowed !== 'boolean') {
    throw authorityError(code, `${name} permission must declare allowed`);
  }
  if (options.scope && value.scope !== options.scope) {
    throw authorityError(code, `${name} permission scope is invalid`, { scope: value.scope });
  }
  if (options.deadline && (!Number.isInteger(value.deadlineSeconds) || value.deadlineSeconds <= 0)) {
    throw authorityError(code, `${name} permission deadline must be a positive integer`, {
      deadlineSeconds: value.deadlineSeconds
    });
  }
  return value;
}

export function validateNightWatchAuthorityReceipt(receipt, options = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw authorityError('NIGHT_WATCH_AUTHORITY_INVALID', 'Night-watch authority receipt must be an object');
  }
  if (receipt.contract !== NIGHT_WATCH_AUTHORITY_CONTRACT
    || receipt.version !== NIGHT_WATCH_AUTHORITY_VERSION) {
    throw authorityError('NIGHT_WATCH_AUTHORITY_VERSION_INVALID', 'Night-watch authority receipt contract or version is invalid');
  }
  for (const field of ['credentials', 'password', 'secret', 'token']) {
    if (Object.hasOwn(receipt, field)) {
      throw authorityError('NIGHT_WATCH_AUTHORITY_SENSITIVE_FIELD', 'Night-watch authority receipt must not slot sensitive material', { field });
    }
  }

  requireNonEmptyString(receipt.receiptId, 'NIGHT_WATCH_AUTHORITY_RECEIPT_ID_INVALID', 'receipt id');
  const agent = requireNonEmptyString(receipt.agent, 'NIGHT_WATCH_AUTHORITY_AGENT_INVALID', 'agent');
  if (options.agent !== undefined && agent !== options.agent) {
    throw authorityError('NIGHT_WATCH_AUTHORITY_AGENT_MISMATCH', 'Night-watch authority receipt does not authorize this Agent', {
      authorizedAgent: agent,
      requestedAgent: options.agent
    });
  }
  const testRunId = typeof receipt.testDomain === 'string'
    && receipt.testDomain.startsWith(NIGHT_WATCH_TEST_DOMAIN_PREFIX)
    ? receipt.testDomain.slice(NIGHT_WATCH_TEST_DOMAIN_PREFIX.length)
    : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(testRunId) || testRunId === '.' || testRunId === '..') {
    throw authorityError('NIGHT_WATCH_AUTHORITY_TEST_DOMAIN_INVALID', 'Night-watch authority is limited to one exact synthetic run below 🧊manage/工务/work/test', {
      testDomain: receipt.testDomain
    });
  }
  requirePermission(receipt.syntheticCleanup, 'NIGHT_WATCH_AUTHORITY_CLEANUP_INVALID', 'synthetic cleanup', {
    scope: 'unique-subtree'
  });
  requirePermission(receipt.restart, 'NIGHT_WATCH_AUTHORITY_RESTART_INVALID', 'restart', { deadline: true });
  requirePermission(receipt.githubPublication, 'NIGHT_WATCH_AUTHORITY_PUBLICATION_INVALID', 'GitHub publication');
  if (typeof receipt.unattended !== 'boolean') {
    throw authorityError('NIGHT_WATCH_AUTHORITY_UNATTENDED_INVALID', 'Night-watch authority must declare unattended execution');
  }
  if (typeof receipt.expiresAt !== 'string' || Number.isNaN(Date.parse(receipt.expiresAt))) {
    throw authorityError('NIGHT_WATCH_AUTHORITY_EXPIRY_INVALID', 'Night-watch authority receipt expiry is invalid');
  }
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  if (Number.isNaN(now)) {
    throw authorityError('NIGHT_WATCH_AUTHORITY_NOW_INVALID', 'Night-watch authority validation time is invalid');
  }
  if (Date.parse(receipt.expiresAt) <= now) {
    throw authorityError('NIGHT_WATCH_AUTHORITY_EXPIRED', 'Night-watch authority receipt has expired', {
      expiresAt: receipt.expiresAt
    });
  }
  return structuredClone(receipt);
}
