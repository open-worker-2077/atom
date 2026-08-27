import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  hashRequestDrivenSecurityBytes,
  validateLegacySecuritySourceBytes,
  validateRetiredSecurityTargetBytes
} from '../public/request-driven-security-retirement-contract.mjs';

const RECORD_CONTRACT = 'atom.trusted-request-driven-security-retirement-record';
const RECEIPT_CONTRACT = 'atom.trusted-request-driven-security-retirement-receipt';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

async function durableAtomicReplace(filesystem, destination, bytes) {
  await filesystem.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await filesystem.open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await filesystem.rename(temporary, destination);
    const directory = await filesystem.open(path.dirname(destination), 'r');
    try {
      await directory.sync().catch((error) => {
        if (!['EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
      });
    } finally {
      await directory.close();
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await filesystem.rm(temporary, { force: true }).catch(() => {});
  }
}

function receiptFor(record, idempotent = false) {
  return {
    contract: RECEIPT_CONTRACT,
    version: 1,
    operationId: record.operationId,
    status: 'committed',
    idempotent,
    source: { contract: record.sourceContract, version: record.sourceVersion },
    target: { contract: record.targetContract, version: record.targetVersion },
    sourceHash: record.sourceHash,
    targetHash: record.targetHash,
    backupHash: record.backupHash,
    retired: structuredClone(record.retired),
    rollback: { expectedTargetHash: record.targetHash }
  };
}

export function createTrustedRequestDrivenSecurityRetirementPersistence({
  file, stateDirectory, filesystem = fs
}) {
  if (typeof file !== 'string' || !file
    || typeof stateDirectory !== 'string' || !stateDirectory) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_PERSISTENCE_INVALID',
      'Explicit sidecar and private state directory are required'
    );
  }

  async function readRecord(recordFile) {
    try {
      return JSON.parse(await filesystem.readFile(recordFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function commit(plan) {
    const operationDirectory = path.join(stateDirectory, plan.operationId);
    const backupFile = path.join(operationDirectory, 'source.bin');
    const recordFile = path.join(operationDirectory, 'operation.json');
    let record = await readRecord(recordFile);
    let sourceBytes;

    if (record) {
      if (record.contract !== RECORD_CONTRACT || record.version !== 1
        || record.requestHash !== plan.requestHash
        || record.sourceHash !== plan.sourceHash || record.targetHash !== plan.targetHash) {
        throw problem(
          'REQUEST_DRIVEN_SECURITY_RETIREMENT_OPERATION_CONFLICT',
          'Operation id already belongs to another retirement payload'
        );
      }
      const current = await filesystem.readFile(file);
      const currentHash = hashRequestDrivenSecurityBytes(current);
      if (currentHash === plan.targetHash) {
        validateRetiredSecurityTargetBytes(current, plan.targetHash);
        return receiptFor(record, true);
      }
      if (currentHash !== plan.sourceHash) {
        throw problem(
          'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_DRIFT',
          'Sidecar changed after this operation was recorded'
        );
      }
      validateLegacySecuritySourceBytes(current, plan.sourceHash);
      sourceBytes = current;
    } else {
      sourceBytes = await filesystem.readFile(file);
      if (hashRequestDrivenSecurityBytes(sourceBytes) !== plan.sourceHash) {
        throw problem(
          'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_DRIFT',
          'Sidecar does not match the planned exact source bytes'
        );
      }
      validateLegacySecuritySourceBytes(sourceBytes, plan.sourceHash);
    }

    try {
      if (!record) {
        await filesystem.mkdir(operationDirectory, { recursive: true });
        const backupHandle = await filesystem.open(backupFile, 'wx');
        try {
          await backupHandle.writeFile(sourceBytes);
          await backupHandle.sync();
        } finally {
          await backupHandle.close();
        }
        const backup = await filesystem.readFile(backupFile);
        validateLegacySecuritySourceBytes(backup, plan.sourceHash);
        record = {
          contract: RECORD_CONTRACT,
          version: 1,
          operationId: plan.operationId,
          requestHash: plan.requestHash,
          sourceContract: plan.sourceContract,
          sourceVersion: plan.sourceVersion,
          sourceHash: plan.sourceHash,
          targetContract: plan.targetContract,
          targetVersion: plan.targetVersion,
          targetHash: plan.targetHash,
          backupHash: hashRequestDrivenSecurityBytes(backup),
          retired: structuredClone(plan.retired),
          status: 'prepared'
        };
        await durableAtomicReplace(
          filesystem,
          recordFile,
          Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
        );
      }

      await durableAtomicReplace(filesystem, file, plan.targetBytes);
      validateRetiredSecurityTargetBytes(await filesystem.readFile(file), plan.targetHash);
      record = { ...record, status: 'committed' };
      await durableAtomicReplace(
        filesystem,
        recordFile,
        Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
      );
      return receiptFor(record);
    } catch (cause) {
      try {
        const backup = await filesystem.readFile(backupFile).catch(() => sourceBytes);
        validateLegacySecuritySourceBytes(backup, plan.sourceHash);
        await durableAtomicReplace(filesystem, file, backup);
        validateLegacySecuritySourceBytes(await filesystem.readFile(file), plan.sourceHash);
        if (record) {
          record = { ...record, status: 'compensated' };
          await durableAtomicReplace(
            filesystem,
            recordFile,
            Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
          );
        }
      } catch (restoreCause) {
        throw Object.assign(problem(
          'REQUEST_DRIVEN_SECURITY_RETIREMENT_RESTORE_FAILED',
          'Retirement failed and exact-byte restoration also failed'
        ), { cause: restoreCause });
      }
      throw Object.assign(problem(
        'REQUEST_DRIVEN_SECURITY_RETIREMENT_COMMIT_FAILED',
        'Retirement failed and the original bytes were restored'
      ), { cause });
    }
  }

  async function rollback(receipt) {
    const operationDirectory = path.join(stateDirectory, receipt.operationId);
    const recordFile = path.join(operationDirectory, 'operation.json');
    const record = await readRecord(recordFile);
    if (!record || record.contract !== RECORD_CONTRACT || record.version !== 1
      || record.sourceHash !== receipt.sourceHash || record.targetHash !== receipt.targetHash
      || record.backupHash !== receipt.backupHash) {
      throw problem(
        'REQUEST_DRIVEN_SECURITY_RETIREMENT_RECEIPT_INVALID',
        'Receipt does not match the private retirement record'
      );
    }
    const current = await filesystem.readFile(file);
    const currentHash = hashRequestDrivenSecurityBytes(current);
    if (currentHash === record.sourceHash) {
      validateLegacySecuritySourceBytes(current, record.sourceHash);
      return {
        contract: RECEIPT_CONTRACT, version: 1, operationId: record.operationId,
        status: 'rolled-back', idempotent: true, restoredHash: record.sourceHash
      };
    }
    if (currentHash !== record.targetHash) {
      throw problem(
        'REQUEST_DRIVEN_SECURITY_RETIREMENT_ROLLBACK_DIVERGED',
        'Rollback refuses to cross a later sidecar revision'
      );
    }
    validateRetiredSecurityTargetBytes(current, record.targetHash);
    const backup = await filesystem.readFile(path.join(operationDirectory, 'source.bin'));
    validateLegacySecuritySourceBytes(backup, record.sourceHash);
    await durableAtomicReplace(filesystem, file, backup);
    validateLegacySecuritySourceBytes(await filesystem.readFile(file), record.sourceHash);
    await durableAtomicReplace(
      filesystem,
      recordFile,
      Buffer.from(`${JSON.stringify({ ...record, status: 'rolled-back' }, null, 2)}\n`)
    );
    return {
      contract: RECEIPT_CONTRACT, version: 1, operationId: record.operationId,
      status: 'rolled-back', idempotent: false, restoredHash: record.sourceHash
    };
  }

  return Object.freeze({ commit, rollback });
}
