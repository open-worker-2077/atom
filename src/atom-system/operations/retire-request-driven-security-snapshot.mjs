import { validateRequestDrivenLockSnapshot } from '../public/request-driven-lock-contract.mjs';
import {
  hashRequestDrivenSecurityBytes,
  REQUEST_DRIVEN_SECURITY_SOURCE_CONTRACT,
  RETIRED_SECURITY_CONTRACT,
  validateLegacySecuritySourceBytes
} from '../public/request-driven-security-retirement-contract.mjs';

export { hashRequestDrivenSecurityBytes } from '../public/request-driven-security-retirement-contract.mjs';

const REQUEST_CONTRACT = 'atom.trusted-request-driven-security-retirement';
const SOURCE_CONTRACT = REQUEST_DRIVEN_SECURITY_SOURCE_CONTRACT;
const PLAN_CONTRACT = 'atom.request-driven-security-retirement-plan';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function validOperationId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function validateRequest(request, sourceBytes, sourceVersion) {
  if (!exactKeys(request, ['contract', 'version', 'operationId', 'expectedSource'])
    || request.contract !== REQUEST_CONTRACT || request.version !== 1
    || !validOperationId(request.operationId)
    || !exactKeys(request.expectedSource, ['contract', 'version', 'hash'])
    || request.expectedSource.contract !== SOURCE_CONTRACT
    || request.expectedSource.version !== sourceVersion
    || typeof request.expectedSource.hash !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(request.expectedSource.hash)) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_REQUEST_INVALID',
      'Trusted retirement request is invalid'
    );
  }
  const sourceHash = hashRequestDrivenSecurityBytes(sourceBytes);
  if (request.expectedSource.hash !== sourceHash) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_HASH_MISMATCH',
      'Expected source hash does not match the exact source bytes'
    );
  }
  return sourceHash;
}

export function planRequestDrivenSecurityRetirement({ sourceBytes, request }) {
  const bytes = Buffer.from(sourceBytes);
  const { value, retired } = validateLegacySecuritySourceBytes(bytes);
  const sourceHash = validateRequest(request, bytes, value.version);
  const target = { contract: RETIRED_SECURITY_CONTRACT, version: 1 };
  validateRequestDrivenLockSnapshot(target);
  const targetBytes = Buffer.from(`${JSON.stringify(target, null, 2)}\n`, 'utf8');
  return Object.freeze({
    contract: PLAN_CONTRACT,
    version: 1,
    operationId: request.operationId,
    requestHash: hashRequestDrivenSecurityBytes(Buffer.from(JSON.stringify(request))),
    sourceContract: SOURCE_CONTRACT,
    sourceVersion: value.version,
    sourceHash,
    targetContract: RETIRED_SECURITY_CONTRACT,
    targetVersion: 1,
    targetHash: hashRequestDrivenSecurityBytes(targetBytes),
    targetBytes,
    retired: Object.freeze(retired)
  });
}

export async function applyRequestDrivenSecurityRetirement({ plan, persistence }) {
  if (plan?.contract !== PLAN_CONTRACT || plan.version !== 1
    || typeof persistence?.commit !== 'function') {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_PLAN_INVALID',
      'Retirement plan or trusted persistence port is invalid'
    );
  }
  return persistence.commit(plan);
}

export async function rollbackRequestDrivenSecurityRetirement({ receipt, persistence }) {
  if (receipt?.contract !== 'atom.trusted-request-driven-security-retirement-receipt'
    || receipt.version !== 1 || typeof persistence?.rollback !== 'function') {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_RECEIPT_INVALID',
      'Retirement receipt or trusted persistence port is invalid'
    );
  }
  return persistence.rollback(receipt);
}
