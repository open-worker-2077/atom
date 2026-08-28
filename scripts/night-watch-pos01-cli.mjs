import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAtomCliAdapter } from './night-watch-cli-adapter.mjs';
import {
  createPos01ProgramSource,
  createPos01ProgramLockingSource,
  createPos01ProgramUpdateSource,
  evaluatePos01ExternalFourGates,
  pos01Paths,
  verifyPos01ProgramResultNode
} from './night-watch-business-case-live.mjs';
import { nightWatchBusinessCaseCatalog } from './night-watch-business-case-catalog.mjs';

function entryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactSource(command, payload) {
  return `${command} ${JSON.stringify(payload)}`;
}

function failedReceipt(stdout) {
  return typeof stdout !== 'string' || !stdout.trim() || /"ok"\s*:\s*false|"errors"\s*:/u.test(stdout);
}

function revisionFrom(stdout) {
  const match = typeof stdout === 'string' && stdout.match(/"(?:revision|worldRevision)"\s*:\s*"?([^",}\s]+)"?/u);
  return match?.[1] ?? 'unreported-revision';
}

function hasExactSituation(stdout, expected) {
  try {
    const response = JSON.parse(stdout);
    const entries = Array.isArray(response) ? response : [response];
    return entries.some((entry) => entry?.situation === expected);
  } catch {
    return false;
  }
}

function readSituation(stdout) {
  try {
    const response = JSON.parse(stdout);
    const entries = Array.isArray(response) ? response : [response];
    return entries.find((entry) => typeof entry?.situation === 'string')?.situation ?? null;
  } catch {
    return null;
  }
}

function readPath(stdout) {
  try {
    const response = JSON.parse(stdout);
    const entries = Array.isArray(response) ? response : [response];
    return entries.find((entry) => typeof entry?.path === 'string')?.path ?? null;
  } catch {
    return null;
  }
}

function readDirectContainNames(stdout) {
  try {
    const response = JSON.parse(stdout);
    const entries = Array.isArray(response) ? response : [response];
    const direct = entries.find((entry) => Array.isArray(entry?.contain))?.contain;
    if (Array.isArray(direct)) return direct.map((item) => item?.thing).filter((thing) => typeof thing === 'string');
    const graph = entries.find((entry) => Array.isArray(entry?.entries));
    const contain = graph?.entries.find((entry) => entry?.key === 'contain')?.value;
    const values = contain?.kind === 'array' && Array.isArray(contain.values) ? contain.values : null;
    return values === null ? null : values.map((value) => {
      const thing = value?.entries?.find((entry) => /^thing(?:@[^~#]+)?(?:[~#].*)?$/u.test(entry?.key ?? ''))?.value;
      return typeof thing === 'string' ? thing : null;
    }).filter(Boolean);
  } catch {
    return null;
  }
}

function publicFailureCode(stdout) {
  return typeof stdout === 'string'
    ? stdout.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u)?.[0] ?? 'UNCLASSIFIED'
    : 'UNCLASSIFIED';
}

function publicProjectionKeys(stdout) {
  try {
    const response = JSON.parse(stdout);
    if (Array.isArray(response?.entries)) return response.entries.map((entry) => entry?.key).filter((key) => typeof key === 'string');
    if (response && typeof response === 'object' && !Array.isArray(response)) return Object.keys(response);
    return [];
  } catch {
    return [];
  }
}

function literalAgentLabels(situation) {
  if (typeof situation !== 'string') return null;
  const match = situation.match(/\bagent\s*\(\s*(\{.*\})\s*\)\s*$/su);
  if (!match) return null;
  try {
    const labels = JSON.parse(match[1])?.labels;
    return Array.isArray(labels) && labels.every((label) => typeof label === 'string' && label) ? labels : null;
  } catch {
    return null;
  }
}

async function readExact(adapter, agent, thing) {
  return adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
}

export {
  createPos01ProgramSource,
  createPos01ProgramLockingSource,
  createPos01ProgramUpdateSource
};

export function isDirectPos01Entry(argvPath) {
  return typeof argvPath === 'string' && path.resolve(argvPath) === fileURLToPath(import.meta.url);
}

export function lockLabelsFromArgs(argv) {
  if (!Array.isArray(argv)) return [];
  const labels = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--lock-label' && typeof argv[index + 1] === 'string' && argv[index + 1]) {
      labels.push(argv[index + 1]);
      index += 1;
    }
  }
  return labels;
}

export async function inspectPos01Result({ adapter, agent = '🧊', rootPath }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 result inspection requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 result inspection requires the exact Agent 🧊');
  const { resultPath } = pos01Paths(rootPath);
  const resultReadback = await readExact(adapter, agent, resultPath);
  const situation = readSituation(resultReadback?.stdout);
  if (situation === null) throw entryError('NIGHT_WATCH_POS01_RESULT_READBACK_FAILED', 'POS-01 result node exact read-back failed');
  return Object.freeze({
    status: verifyPos01ProgramResultNode(resultReadback.stdout) ? 'passed' : 'revalidation-required',
    revision: revisionFrom(resultReadback.stdout),
    path: readPath(resultReadback.stdout),
    situation
  });
}

export async function inspectPos01Program({ adapter, agent = '🧊', rootPath }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 Program inspection requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 Program inspection requires the exact Agent 🧊');
  const { programPath } = pos01Paths(rootPath);
  const sourceReadback = await readExact(adapter, agent, programPath);
  return Object.freeze({
    status: hasExactSituation(sourceReadback?.stdout, createPos01ProgramSource(rootPath)) ? 'matched' : 'revalidation-required',
    revision: revisionFrom(sourceReadback?.stdout)
  });
}

export async function inspectPos01Receipt({ adapter, agent = '🧊', rootPath }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 receipt inspection requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 receipt inspection requires the exact Agent 🧊');
  const { casePath } = pos01Paths(rootPath);
  const receiptReadback = await readExact(adapter, agent, `${casePath}/槽体候选/提交回单`);
  const situation = readSituation(receiptReadback?.stdout);
  if (situation === null) throw entryError('NIGHT_WATCH_POS01_RECEIPT_READBACK_FAILED', 'POS-01 receipt exact read-back failed');
  return Object.freeze({
    status: situation === 'submitted' ? 'submitted' : 'revalidation-required',
    revision: revisionFrom(receiptReadback.stdout)
  });
}

export async function inspectPos01ResultParent({ adapter, agent = '🧊', rootPath }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 containment inspection requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 containment inspection requires the exact Agent 🧊');
  const { programPath } = pos01Paths(rootPath);
  const readback = await adapter.executeStdin(agent, exactSource('explore', { thing: programPath, 'contain$latitude+1': true }));
  const childNames = readDirectContainNames(readback?.stdout);
  if (childNames === null) {
    const projectionKeys = publicProjectionKeys(readback?.stdout);
    if (projectionKeys.length) return Object.freeze({
      status: 'revalidation-required', childNames: Object.freeze([]), projectionKeys: Object.freeze(projectionKeys), revision: revisionFrom(readback.stdout)
    });
    throw entryError(
      'NIGHT_WATCH_POS01_PARENT_READBACK_FAILED',
      `POS-01 Program containment exact read-back failed: ${publicFailureCode(readback?.stdout)}`
    );
  }
  return Object.freeze({ childNames: Object.freeze(childNames), revision: revisionFrom(readback.stdout) });
}

export async function inspectExactAgentLabels({ adapter, agent = '🧊' }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 lock preparation requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 lock preparation requires the exact Agent 🧊');
  const readback = await readExact(adapter, agent, agent);
  const labels = literalAgentLabels(readSituation(readback?.stdout));
  if (labels === null) throw entryError('NIGHT_WATCH_POS01_AGENT_LABELS_UNAVAILABLE', 'POS-01 cannot derive exact Agent labels for a temporary lock');
  return Object.freeze({ labels: Object.freeze(labels), revision: revisionFrom(readback.stdout) });
}

export async function updateCommittedPos01Program({ adapter, agent = '🧊', rootPath }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 source update requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 source update requires the exact Agent 🧊');

  const { programPath, resultPath } = pos01Paths(rootPath);
  const expectedProgram = createPos01ProgramSource(rootPath);
  const update = await adapter.executeStdin(agent, createPos01ProgramUpdateSource(rootPath));
  const sourceReadback = await readExact(adapter, agent, programPath);
  if (!hasExactSituation(sourceReadback?.stdout, expectedProgram)) {
    throw entryError('NIGHT_WATCH_POS01_PROGRAM_SOURCE_UNCONFIRMED', 'POS-01 Program source was not confirmed by exact read-back');
  }
  if (failedReceipt(update?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_PROGRAM_SOURCE_UNKNOWN', 'POS-01 Program source update has no accepted receipt; it was not replayed');
  }

  const run = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': programPath }));
  const resultReadback = await readExact(adapter, agent, resultPath);
  if (failedReceipt(run?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_PROGRAM_RUN_UNKNOWN', 'POS-01 Program run has no accepted receipt; it was not replayed');
  }
  if (!verifyPos01ProgramResultNode(resultReadback?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_PROGRAM_PROOF_INVALID', 'POS-01 Program result node lacks deterministic proof');
  }
  return Object.freeze({
    status: 'passed',
    programRevision: revisionFrom(sourceReadback.stdout),
    revision: revisionFrom(resultReadback.stdout),
    resultPath
  });
}

export async function attachCommittedPos01ProgramLock({ adapter, agent = '🧊', rootPath, lockLabels }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 lock attachment requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 lock attachment requires the exact Agent 🧊');
  requireLockLabels(lockLabels);
  const { programPath } = pos01Paths(rootPath);
  const baselineSource = createPos01ProgramSource(rootPath);
  const committed = await readExact(adapter, agent, programPath);
  if (!hasExactSituation(committed?.stdout, baselineSource)) {
    throw entryError('NIGHT_WATCH_POS01_PROGRAM_SOURCE_REVALIDATION_REQUIRED', 'POS-01 Program source is not the exactly read-back deterministic baseline; lock update was not attempted');
  }
  const lockingSource = createPos01ProgramLockingSource(rootPath, lockLabels);
  const update = await adapter.executeStdin(agent, `transform {"thing":${JSON.stringify(programPath)},${JSON.stringify(`situation.rep.${lockingSource}`)}}`);
  const confirmed = await readExact(adapter, agent, programPath);
  if (!hasExactSituation(confirmed?.stdout, lockingSource)) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_SOURCE_UNCONFIRMED', 'POS-01 Program-local lock source was not confirmed by exact read-back');
  }
  if (failedReceipt(update?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_SOURCE_UNKNOWN', 'POS-01 Program-local lock source has no accepted receipt and was not replayed');
  }
  return Object.freeze({ status: 'locked-source-attached', revision: revisionFrom(confirmed.stdout) });
}

function expectedPos01Gates() {
  const pos01 = nightWatchBusinessCaseCatalog.businessCases.find((item) => item.id === 'TC-ESG-ACTIVITY-001-POS-01');
  return pos01?.gates;
}

function requireLockLabels(lockLabels) {
  if (!Array.isArray(lockLabels) || lockLabels.length === 0
    || lockLabels.some((label) => typeof label !== 'string' || !label)
    || new Set(lockLabels).size !== lockLabels.length) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_LABELS_REQUIRED', 'POS-01 requires an exact current-Agent label set for its temporary path lock');
  }
  return lockLabels;
}

function createPos01LockSource(rootPath, lockLabels) {
  const { resultPath } = pos01Paths(rootPath);
  return `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":${JSON.stringify(requireLockLabels(lockLabels))}})`;
}

function isAtomNotFound(error) {
  return error?.code === 'ATOM_NOT_FOUND' || /\bATOM_NOT_FOUND\b/u.test(String(error?.message ?? ''));
}

export async function finalizeCommittedPos01({ adapter, agent = '🧊', rootPath, expectedGates = expectedPos01Gates(), lockLabels }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 finalization requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 finalization requires the exact Agent 🧊');
  requireLockLabels(lockLabels);
  const { casePath, resultPath } = pos01Paths(rootPath);
  const receiptPath = `${casePath}/槽体候选/提交回单`;
  const lockPath = `${casePath}/结果锁定`;
  const initial = await inspectPos01Result({ adapter, agent, rootPath });
  const external = evaluatePos01ExternalFourGates({ resultSituation: initial.situation, expectedGates });
  if (!external.complete) {
    throw entryError('NIGHT_WATCH_POS01_GATE_FAILED', 'POS-01 requires independently passed external four-gate proof before receipt or lock');
  }

  const submit = await adapter.executeStdin(agent, `transform {"thing":${JSON.stringify(receiptPath)},"situation.rep.submitted"}`);
  const receiptReadback = await readExact(adapter, agent, receiptPath);
  if (!hasExactSituation(receiptReadback?.stdout, 'submitted')) {
    throw entryError('NIGHT_WATCH_POS01_RECEIPT_UNCONFIRMED', 'POS-01 receipt was not confirmed by exact read-back');
  }
  if (failedReceipt(submit?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_RECEIPT_UNKNOWN', 'POS-01 receipt has no accepted write receipt and was not replayed');
  }

  const lockSource = createPos01LockSource(rootPath, lockLabels);
  const lockUpdate = await adapter.executeStdin(agent, `transform {"thing":${JSON.stringify(lockPath)},${JSON.stringify(`situation.rep.${lockSource}`)}}`);
  const lockSourceReadback = await readExact(adapter, agent, lockPath);
  if (!hasExactSituation(lockSourceReadback?.stdout, lockSource)) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_SOURCE_UNCONFIRMED', 'POS-01 lock Program source was not confirmed by exact read-back');
  }
  if (failedReceipt(lockUpdate?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_SOURCE_UNKNOWN', 'POS-01 lock Program source has no accepted receipt and was not replayed');
  }

  const lockRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': lockPath }));
  const final = await inspectPos01Result({ adapter, agent, rootPath });
  if (failedReceipt(lockRun?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_RUN_UNKNOWN', 'POS-01 lock run has no accepted receipt and was not replayed');
  }
  if (final.status !== 'passed') {
    throw entryError('NIGHT_WATCH_POS01_FINAL_READBACK_FAILED', 'POS-01 final result node no longer contains the deterministic proof');
  }
  return Object.freeze({ status: 'passed', gates: external.gates, gateProofs: external.proofs, finalRevision: final.revision, resultPath });
}

export async function completeCommittedPos01Lock({ adapter, agent = '🧊', rootPath, expectedGates = expectedPos01Gates(), lockLabels }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw entryError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 lock recovery requires a public CLI stdin adapter');
  }
  if (agent !== '🧊') throw entryError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 lock recovery requires the exact Agent 🧊');
  requireLockLabels(lockLabels);
  const receipt = await inspectPos01Receipt({ adapter, agent, rootPath });
  if (receipt.status !== 'submitted') {
    throw entryError('NIGHT_WATCH_POS01_RECEIPT_UNCONFIRMED', 'POS-01 lock recovery requires an exactly read-back submitted receipt');
  }
  const initial = await inspectPos01Result({ adapter, agent, rootPath });
  const external = evaluatePos01ExternalFourGates({ resultSituation: initial.situation, expectedGates });
  if (!external.complete) {
    throw entryError('NIGHT_WATCH_POS01_GATE_FAILED', 'POS-01 lock recovery requires independently passed external four-gate proof');
  }

  const { casePath } = pos01Paths(rootPath);
  const lockPath = `${casePath}/结果锁定`;
  const lockSource = createPos01LockSource(rootPath, lockLabels);
  let lockSourceReadback;
  let createdLockProgram = false;
  try {
    lockSourceReadback = await readExact(adapter, agent, lockPath);
  } catch (error) {
    if (!isAtomNotFound(error)) throw error;
    const create = await adapter.executeStdin(agent, exactSource('transform new', {
      'thing@program': lockPath, situation: lockSource, contain: [], support: []
    }));
    lockSourceReadback = await readExact(adapter, agent, lockPath);
    if (failedReceipt(create?.stdout)) {
      throw entryError('NIGHT_WATCH_POS01_LOCK_CREATE_UNKNOWN', 'POS-01 lock Program creation has no accepted receipt and was not replayed');
    }
    createdLockProgram = true;
  }
  if (!hasExactSituation(lockSourceReadback?.stdout, lockSource)) {
    const update = await adapter.executeStdin(agent, `transform {"thing":${JSON.stringify(lockPath)},${JSON.stringify(`situation.rep.${lockSource}`)}}`);
    lockSourceReadback = await readExact(adapter, agent, lockPath);
    if (!hasExactSituation(lockSourceReadback?.stdout, lockSource)) {
      throw entryError('NIGHT_WATCH_POS01_LOCK_SOURCE_UNCONFIRMED', 'POS-01 lock Program source was not confirmed by exact read-back');
    }
    if (failedReceipt(update?.stdout)) {
      throw entryError('NIGHT_WATCH_POS01_LOCK_SOURCE_UNKNOWN', 'POS-01 lock Program source has no accepted receipt and was not replayed');
    }
  }

  const lockRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': lockPath }));
  const final = await inspectPos01Result({ adapter, agent, rootPath });
  if (failedReceipt(lockRun?.stdout)) {
    throw entryError('NIGHT_WATCH_POS01_LOCK_RUN_UNKNOWN', 'POS-01 lock run has no accepted receipt and was not replayed');
  }
  if (final.status !== 'passed') {
    throw entryError('NIGHT_WATCH_POS01_FINAL_READBACK_FAILED', 'POS-01 final result node no longer contains deterministic proof');
  }
  return Object.freeze({ status: 'passed', gates: external.gates, gateProofs: external.proofs, finalRevision: final.revision, createdLockProgram, resultPath: pos01Paths(rootPath).resultPath });
}

async function main() {
  const rootIndex = process.argv.indexOf('--root');
  const rootPath = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
  if (!rootPath) throw entryError('NIGHT_WATCH_POS01_ROOT_REQUIRED', 'Use --root with the exact unique synthetic night-watch subtree');
  const lockLabels = lockLabelsFromArgs(process.argv);
  const adapter = createAtomCliAdapter();
  await adapter.validateHelp();
  await adapter.resolveExactAgent('🧊');
  const result = process.argv.includes('--inspect-program')
    ? await inspectPos01Program({ adapter, rootPath })
    : process.argv.includes('--inspect')
      ? await inspectPos01Result({ adapter, rootPath })
      : process.argv.includes('--inspect-receipt')
        ? await inspectPos01Receipt({ adapter, rootPath })
      : process.argv.includes('--inspect-result-parent')
        ? await inspectPos01ResultParent({ adapter, rootPath })
      : process.argv.includes('--inspect-agent-labels')
        ? await inspectExactAgentLabels({ adapter })
      : process.argv.includes('--complete-lock')
        ? await completeCommittedPos01Lock({ adapter, rootPath, lockLabels })
      : process.argv.includes('--attach-program-lock')
        ? await attachCommittedPos01ProgramLock({ adapter, rootPath, lockLabels })
      : process.argv.includes('--finalize')
        ? await finalizeCommittedPos01({ adapter, rootPath, lockLabels })
        : await updateCommittedPos01Program({ adapter, rootPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectPos01Entry(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.code ?? 'NIGHT_WATCH_POS01_ENTRY_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
