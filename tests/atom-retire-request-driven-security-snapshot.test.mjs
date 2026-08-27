import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';
import { createTrustedRequestDrivenSecurityRetirementPersistence } from '../src/atom-system/adapters/trusted-request-driven-security-retirement-persistence.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import {
  applyRequestDrivenSecurityRetirement,
  hashRequestDrivenSecurityBytes,
  planRequestDrivenSecurityRetirement,
  rollbackRequestDrivenSecurityRetirement
} from '../src/atom-system/operations/retire-request-driven-security-snapshot.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(projectRoot, 'scripts', 'retire-request-driven-security-snapshot.mjs');
const TARGET = { contract: 'atom.request-driven-security-retired', version: 1 };

function legacyBytes(overrides = {}) {
  return Buffer.from(`${JSON.stringify({
    version: 1,
    locks: [{ opaque: 'private-lock-body' }],
    agentRegistrations: [{ opaque: 'private-registration-body' }],
    windowSelfLocks: [{ opaque: 'private-window-policy' }],
    windowSelfLockAgents: ['private-agent-coordinate'],
    ...overrides
  }, null, 2)}\n`, 'utf8');
}

function requestFor(bytes, operationId = 'retire-security-state-1') {
  return {
    contract: 'atom.trusted-request-driven-security-retirement',
    version: 1,
    operationId,
    expectedSource: {
      contract: 'atom.request-driven-lock-snapshot',
      version: 1,
      hash: hashRequestDrivenSecurityBytes(bytes)
    }
  };
}

async function fixture(t, bytes = legacyBytes()) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-retire-security-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sidecarFile = path.join(directory, 'request-driven-locks.json');
  const stateDirectory = path.join(directory, 'private-retirement-state');
  await fs.writeFile(sidecarFile, bytes);
  return { directory, sidecarFile, stateDirectory, bytes };
}

function persistenceFor(files, filesystem = fs) {
  return createTrustedRequestDrivenSecurityRetirementPersistence({
    file: files.sidecarFile,
    stateDirectory: files.stateDirectory,
    filesystem
  });
}

async function applyFixture(files, operationId = 'retire-security-state-1', filesystem = fs) {
  const plan = planRequestDrivenSecurityRetirement({
    sourceBytes: files.bytes,
    request: requestFor(files.bytes, operationId)
  });
  const persistence = persistenceFor(files, filesystem);
  const receipt = await applyRequestDrivenSecurityRetirement({ plan, persistence });
  return { plan, persistence, receipt };
}

test('trusted retirement replaces every legacy authority field with one strict tombstone', async (t) => {
  const files = await fixture(t);
  const { receipt } = await applyFixture(files);
  const targetBytes = await fs.readFile(files.sidecarFile);

  assert.deepEqual(JSON.parse(targetBytes), TARGET);
  const repository = createJsonRequestDrivenLockRepository({ file: files.sidecarFile });
  assert.deepEqual(await repository.load(), TARGET);
  const coldScheduler = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
  assert.deepEqual(await coldScheduler.activeRequestDrivenLocks([{
    thing: 'Root', situation: '', contain: [], support: []
  }]), []);
  assert.deepEqual(receipt.retired, {
    locks: 1, agentRegistrations: 1, windowSelfLocks: 1, windowSelfLockAgents: 1
  });
  assert.equal(receipt.sourceHash, hashRequestDrivenSecurityBytes(files.bytes));
  assert.equal(receipt.targetHash, hashRequestDrivenSecurityBytes(targetBytes));
  assert.equal(JSON.stringify(receipt).includes('private-'), false);
  assert.equal(JSON.stringify(receipt).includes(files.sidecarFile), false);

  const backup = await fs.readFile(path.join(
    files.stateDirectory, 'retire-security-state-1', 'source.bin'
  ));
  assert.deepEqual(backup, files.bytes);
  assert.equal(receipt.backupHash, hashRequestDrivenSecurityBytes(backup));
});

test('preflight binds exact source bytes and rejects unknown contracts or fields', () => {
  const bytes = legacyBytes();
  for (const mutate of [
    (request) => { request.expectedSource.hash = 'sha256:' + '0'.repeat(64); },
    (request) => { request.expectedSource.contract = 'unknown'; },
    (request) => { request.expectedSource.version = 2; },
    (request) => { request.unexpected = true; }
  ]) {
    const request = requestFor(bytes);
    mutate(request);
    assert.throws(
      () => planRequestDrivenSecurityRetirement({ sourceBytes: bytes, request }),
      (error) => ['REQUEST_DRIVEN_SECURITY_RETIREMENT_REQUEST_INVALID',
        'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_HASH_MISMATCH'].includes(error.code)
    );
  }

  for (const invalid of [
    Buffer.from('{not-json'),
    legacyBytes({ unexpected: [] }),
    legacyBytes({ locks: {} }),
    Buffer.from('{"version":1}\n')
  ]) {
    assert.throws(
      () => planRequestDrivenSecurityRetirement({
        sourceBytes: invalid, request: requestFor(invalid)
      }),
      { code: 'REQUEST_DRIVEN_SECURITY_RETIREMENT_SOURCE_INVALID' }
    );
  }
});

test('backup, replace, and strict readback failures preserve the exact original bytes', async (t) => {
  for (const fault of ['backup', 'replace', 'readback']) {
    const files = await fixture(t);
    let targetReplaced = false;
    let injected = false;
    const filesystem = {
      ...fs,
      async open(file, ...args) {
        const handle = await fs.open(file, ...args);
        if (fault !== 'backup' || !String(file).endsWith('source.bin') || injected) {
          return handle;
        }
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'sync') {
              return async () => {
                injected = true;
                throw Object.assign(new Error('injected backup fsync failure'), { code: 'EIO' });
              };
            }
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      },
      async rename(source, destination) {
        if (path.resolve(destination) === path.resolve(files.sidecarFile)
          && fault === 'replace' && !injected) {
          injected = true;
          throw Object.assign(new Error('injected replace failure'), { code: 'EIO' });
        }
        await fs.rename(source, destination);
        if (path.resolve(destination) === path.resolve(files.sidecarFile)) targetReplaced = true;
      },
      async readFile(file, ...args) {
        if (path.resolve(file) === path.resolve(files.sidecarFile)
          && fault === 'readback' && targetReplaced && !injected) {
          injected = true;
          throw Object.assign(new Error('injected readback failure'), { code: 'EIO' });
        }
        return fs.readFile(file, ...args);
      }
    };
    await assert.rejects(
      applyFixture(files, `retire-fault-${fault}`, filesystem),
      { code: 'REQUEST_DRIVEN_SECURITY_RETIREMENT_COMMIT_FAILED' }
    );
    assert.deepEqual(await fs.readFile(files.sidecarFile), files.bytes, fault);
  }
});

test('same operation is idempotent and conflicting payload reuse is rejected', async (t) => {
  const files = await fixture(t);
  const first = await applyFixture(files);
  const repeated = await applyRequestDrivenSecurityRetirement({
    plan: first.plan, persistence: first.persistence
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.targetHash, first.receipt.targetHash);

  const otherBytes = legacyBytes({ locks: [] });
  const conflict = planRequestDrivenSecurityRetirement({
    sourceBytes: otherBytes,
    request: requestFor(otherBytes)
  });
  await assert.rejects(
    applyRequestDrivenSecurityRetirement({ plan: conflict, persistence: first.persistence }),
    { code: 'REQUEST_DRIVEN_SECURITY_RETIREMENT_OPERATION_CONFLICT' }
  );
});

test('explicit rollback is idempotent and refuses to cross later sidecar drift', async (t) => {
  const files = await fixture(t);
  const applied = await applyFixture(files);
  const rollback = await rollbackRequestDrivenSecurityRetirement({
    receipt: applied.receipt, persistence: applied.persistence
  });
  assert.equal(rollback.status, 'rolled-back');
  assert.equal(rollback.restoredHash, hashRequestDrivenSecurityBytes(files.bytes));
  assert.deepEqual(await fs.readFile(files.sidecarFile), files.bytes);
  assert.equal((await rollbackRequestDrivenSecurityRetirement({
    receipt: applied.receipt, persistence: applied.persistence
  })).idempotent, true);

  const reapplied = await applyFixture(files);
  await fs.writeFile(files.sidecarFile, Buffer.from('{"later":true}\n'));
  await assert.rejects(
    rollbackRequestDrivenSecurityRetirement({
      receipt: reapplied.receipt, persistence: reapplied.persistence
    }),
    { code: 'REQUEST_DRIVEN_SECURITY_RETIREMENT_ROLLBACK_DIVERGED' }
  );
});

test('CLI emits a redacted receipt and performs explicit rollback', async (t) => {
  const files = await fixture(t);
  const requestFile = path.join(files.directory, 'request.json');
  const receiptFile = path.join(files.directory, 'receipt.json');
  await fs.writeFile(requestFile, `${JSON.stringify(requestFor(files.bytes), null, 2)}\n`);

  const applied = JSON.parse((await execFileAsync(process.execPath, [
    script, '--sidecar', files.sidecarFile, '--state-directory', files.stateDirectory,
    '--request', requestFile, '--apply'
  ], { cwd: projectRoot })).stdout);
  assert.equal(applied.status, 'committed');
  assert.equal(JSON.stringify(applied).includes(files.sidecarFile), false);
  await fs.writeFile(receiptFile, `${JSON.stringify(applied, null, 2)}\n`);

  const rolledBack = JSON.parse((await execFileAsync(process.execPath, [
    script, '--sidecar', files.sidecarFile, '--state-directory', files.stateDirectory,
    '--rollback', receiptFile
  ], { cwd: projectRoot })).stdout);
  assert.equal(rolledBack.status, 'rolled-back');
  assert.deepEqual(await fs.readFile(files.sidecarFile), files.bytes);
});
