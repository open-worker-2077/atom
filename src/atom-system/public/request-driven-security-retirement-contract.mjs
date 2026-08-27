import crypto from 'node:crypto';

import { validateRequestDrivenLockSnapshot } from './request-driven-lock-contract.mjs';

export const REQUEST_DRIVEN_SECURITY_SOURCE_CONTRACT = 'atom.request-driven-lock-snapshot';
export const RETIRED_SECURITY_CONTRACT = 'atom.request-driven-security-retired';
export const RETIRED_SECURITY_FIELDS = [
  'locks', 'agentRegistrations', 'windowSelfLocks', 'windowSelfLockAgents'
];

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function hashRequestDrivenSecurityBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

export function validateRetiredSecurityTargetBytes(bytes, expectedHash = null) {
  const source = Buffer.from(bytes);
  if (expectedHash !== null && hashRequestDrivenSecurityBytes(source) !== expectedHash) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_TARGET_INVALID',
      'Retired target bytes do not match the expected hash'
    );
  }
  let value;
  try {
    value = JSON.parse(source.toString('utf8'));
  } catch {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_TARGET_INVALID',
      'Retired target is not valid JSON'
    );
  }
  try {
    return validateRequestDrivenLockSnapshot(value);
  } catch (cause) {
    throw Object.assign(problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_TARGET_INVALID',
      'Retired target is not accepted by the candidate strict reader'
    ), { cause });
  }
}

export function validateLegacySecuritySourceBytes(bytes, expectedHash = null) {
  const sourceBytes = Buffer.from(bytes);
  if (expectedHash !== null && hashRequestDrivenSecurityBytes(sourceBytes) !== expectedHash) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_RESTORE_INVALID',
      'Legacy source bytes do not match the expected hash'
    );
  }
  let value;
  try {
    value = JSON.parse(sourceBytes.toString('utf8'));
  } catch {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_INVALID',
      'Legacy request-driven security state is not valid JSON'
    );
  }
  const allowedKeys = new Set([
    'contract', 'version', ...RETIRED_SECURITY_FIELDS
  ]);
  const presentFields = RETIRED_SECURITY_FIELDS.filter((field) => (
    Object.hasOwn(value ?? {}, field)
  ));
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1
    || (value.contract !== undefined
      && value.contract !== REQUEST_DRIVEN_SECURITY_SOURCE_CONTRACT)
    || Object.keys(value).some((key) => !allowedKeys.has(key))
    || presentFields.length === 0
    || presentFields.some((field) => !Array.isArray(value[field]))) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_INVALID',
      'Legacy request-driven security state does not match the retired contract'
    );
  }
  return {
    value,
    retired: Object.fromEntries(RETIRED_SECURITY_FIELDS.map((field) => [
      field, Array.isArray(value[field]) ? value[field].length : 0
    ]))
  };
}
