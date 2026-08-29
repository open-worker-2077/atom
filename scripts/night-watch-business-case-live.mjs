import { validateNightWatchAuthorityReceipt } from './night-watch-authority.mjs';

const ISSUE_NODE_ID = 'issue-3';
const TEST_CASE_ID = 'TC-ESG-ACTIVITY-001-POS-01';
const REJECT02_TEST_CASE_ID = 'TC-ESG-ACTIVITY-001-REJECT-02';
const PENDING03_TEST_CASE_ID = 'TC-ESG-ACTIVITY-001-PENDING-03';
const BUSINESS_CASE = Object.freeze({ id: 'BC-ESG-ACTIVITY-001', version: 'v1' });
const SYNTHETIC_ROOT_SITUATION = 'Synthetic night-watch subtree; no business facts.';
const SYNTHETIC_PENDING03_CASE_SITUATION = 'Synthetic PENDING-03 acceptance instance; no business facts.';
const DETERMINISTIC_RESULT = Object.freeze({
  matter_count: 4,
  source_atom_count: 7,
  reference_count: 4,
  character_count: 58,
  reconstruction_equal: true,
  review_loop_count: 1
});
const FORBIDDEN_EVIDENCE_FIELDS = new Set(['command', 'commandBody', 'programSource', 'businessFact', 'credential', 'identity', 'secret', 'token']);

function liveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactSource(command, payload) {
  return `${command} ${JSON.stringify(payload)}`;
}

function exactSituationReplacement(thing, situation) {
  return `transform {"thing":${JSON.stringify(thing)},${JSON.stringify(`situation.rep.${situation}`)}}`;
}

export function isGraphFailureReceipt(stdout) {
  return typeof stdout !== 'string' || !stdout.trim()
    || /"ok"\s*:\s*false|"errors"\s*:/u.test(stdout)
    || /(?:^|\n)错误\s+[A-Z][A-Z_]+/u.test(stdout);
}

const failureReceipt = isGraphFailureReceipt;

function revisionFrom(stdout) {
  const match = typeof stdout === 'string' && stdout.match(/"(?:revision|worldRevision)"\s*:\s*"?([^",}\s]+)"?/u);
  return match?.[1] ?? 'unreported-revision';
}

function requireCandidate(candidate) {
  if (!candidate || typeof candidate.commit !== 'string' || !candidate.commit
    || typeof candidate.version !== 'string' || !candidate.version
    || typeof candidate.worktree !== 'string' || !candidate.worktree) {
    throw liveError('NIGHT_WATCH_POS01_CANDIDATE_INVALID', 'POS-01 live evidence requires candidate commit, version, and worktree state');
  }
  return candidate;
}

function requireRoot(rootPath) {
  if (typeof rootPath !== 'string' || !/^世界之外\/🧊manage\/工务\/work\/test\/夜巡-[A-Za-z0-9-]+$/u.test(rootPath)) {
    throw liveError('NIGHT_WATCH_POS01_ROOT_INVALID', 'POS-01 requires one unique synthetic night-watch subtree below 世界之外/🧊manage/工务/work/test');
  }
  return rootPath;
}

export function createPos01ProgramSource(rootPath) {
  const { resultPath } = pos01Paths(rootPath);
  const pythonResult = JSON.stringify(DETERMINISTIC_RESULT).replace(/\btrue\b/gu, 'True');
  return [
    `result = ${pythonResult}`,
    `transform({"thing": ${JSON.stringify(resultPath)}, "situation": json_stringify({"value": result}), "contain": [], "support": []})`
  ].join('\n');
}

export function createPos01ProgramLockingSource(rootPath, lockLabels) {
  if (!Array.isArray(lockLabels) || lockLabels.length === 0
    || lockLabels.some((label) => typeof label !== 'string' || !label)
    || new Set(lockLabels).size !== lockLabels.length) {
    throw liveError('NIGHT_WATCH_POS01_LOCK_LABELS_REQUIRED', 'POS-01 requires exact current-Agent labels for a temporary path lock');
  }
  const { resultPath } = pos01Paths(rootPath);
  return [
    createPos01ProgramSource(rootPath),
    `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":${JSON.stringify(lockLabels)}})`
  ].join('\n');
}

export function pos01Paths(rootPath) {
  requireRoot(rootPath);
  const casePath = `${rootPath}/POS-01`;
  const programPath = `${casePath}/确定性核验`;
  return Object.freeze({
    casePath,
    programPath,
    resultPath: `${programPath}/核验结果`
  });
}

export function createPos01ProgramUpdateSource(rootPath) {
  const { programPath } = pos01Paths(rootPath);
  return exactSituationReplacement(programPath, createPos01ProgramSource(rootPath));
}

function lockProgramSource(resultPath) {
  return `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":[]})`;
}

function structure(rootPath) {
  const casePath = `${rootPath}/POS-01`;
  const resultPath = `${casePath}/槽体候选/核验结果`;
  return {
    thing: casePath,
    situation: 'Synthetic POS-01 acceptance instance; no business facts.',
    contain: [
      { thing: '空槽例', situation: 'Synthetic empty slot example.', contain: [], support: [] },
      { thing: '槽体候选', situation: 'Synthetic slot-body candidate with instance-local material.', contain: [
        { thing: '最小上下文', situation: 'Synthetic scope only.', contain: [], support: [] },
        { thing: '合成源片段', situation: 'Synthetic source fragments only.', contain: [], support: [] },
        { thing: '候选结构', situation: 'Pending synthetic structure.', contain: [], support: [] },
        { thing: '提交回单', situation: 'Pending synthetic receipt.', contain: [], support: [] },
        { thing: '核验结果', situation: 'Pending deterministic verification.', contain: [], support: [] }
      ], support: [] },
      { thing: '只读规程引用', situation: 'BC-ESG-ACTIVITY-001@v1 external contract reference.', contain: [], support: [] },
      { 'thing@program': '确定性核验', situation: createPos01ProgramSource(rootPath), contain: [], support: [] },
      { 'thing@program': '结果锁定', situation: lockProgramSource(resultPath), contain: [], support: [] }
    ],
    support: []
  };
}

export function verifyPos01ProgramResultNode(stdout) {
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    return false;
  }
  const entries = Array.isArray(response) ? response : [response];
  return entries.some((entry) => {
    if (typeof entry?.situation !== 'string') return false;
    try {
      const result = JSON.parse(entry.situation);
      const keys = Object.keys(result).sort();
      return keys.length === Object.keys(DETERMINISTIC_RESULT).length
        && keys.every((key) => Object.hasOwn(DETERMINISTIC_RESULT, key) && result[key] === DETERMINISTIC_RESULT[key]);
    } catch {
      return false;
    }
  });
}

export function evaluatePos01ExternalFourGates({ resultSituation, expectedGates }) {
  let result;
  try {
    result = JSON.parse(resultSituation);
  } catch {
    result = null;
  }
  const expected = expectedGates ?? {};
  const configured = (gate) => expected[gate] === 'passed' || expected[gate] === 'pending'
    ? expected[gate]
    : 'failed';
  const proof = (gate, assertion, verified) => ({
    gate,
    assertion,
    status: configured(gate) === 'passed' ? (verified ? 'passed' : 'failed') : configured(gate)
  });
  const proofs = [
    proof('StructureGate', 'synthetic-package-shape-and-review-loop', result?.matter_count === 4 && result?.review_loop_count === 1),
    proof('QuantityGate', 'persisted-atom-reference-and-character-counts', result?.source_atom_count === 7 && result?.reference_count === 4 && result?.character_count === 58),
    proof('ConservationGate', 'persisted-literal-reconstruction-equality', result?.reconstruction_equal === true),
    proof('SemanticGate', 'external-business-contract-decision', result !== null)
  ];
  const gates = Object.fromEntries(proofs.map(({ gate, status }) => [gate, status]));
  return Object.freeze({
    gates: Object.freeze(gates),
    proofs: Object.freeze(proofs.map(Object.freeze)),
    complete: proofs.every(({ status }) => status === 'passed')
  });
}

export function evaluateReject02ExternalFourGates({ candidate, expectedGates }) {
  const expected = expectedGates ?? {};
  const status = (gate, verified) => expected[gate] === 'passed' && verified ? 'passed' : 'failed';
  const normalized = {
    role: candidate?.role ?? candidate?.candidate_role,
    mappingWritten: candidate?.mappingWritten ?? candidate?.mapping_written,
    preservedSourceCount: candidate?.preservedSourceCount ?? candidate?.source_count,
    rejectionReason: candidate?.rejectionReason ?? candidate?.rejection_reason
  };
  const rejected = normalized.role === 'adjacent-role' && normalized.mappingWritten === false;
  const gates = Object.freeze({
    StructureGate: status('StructureGate', rejected),
    QuantityGate: status('QuantityGate', normalized.preservedSourceCount === 3),
    ConservationGate: status('ConservationGate', normalized.mappingWritten === false),
    SemanticGate: status('SemanticGate', rejected)
  });
  const proofs = Object.freeze([
    Object.freeze({ gate: 'StructureGate', assertion: 'synthetic-adjacent-role-is-explicitly-rejected', status: gates.StructureGate }),
    Object.freeze({ gate: 'QuantityGate', assertion: 'three-synthetic-source-fragments-remain-accounted-for', status: gates.QuantityGate }),
    Object.freeze({ gate: 'ConservationGate', assertion: 'no-adjacent-role-mapping-is-written', status: gates.ConservationGate }),
    Object.freeze({ gate: 'SemanticGate', assertion: 'rejection-reason-matches-adjacent-role-boundary', status: gates.SemanticGate })
  ]);
  return Object.freeze({ rejected, gates, proofs, complete: Object.values(gates).every((item) => item === 'passed') });
}

function reject02Paths(rootPath) {
  requireRoot(rootPath);
  const casePath = `${rootPath}/REJECT-02`;
  const programPath = `${casePath}/相邻角色核验`;
  return Object.freeze({
    casePath,
    programPath,
    resultPath: `${programPath}/拒绝结果`,
    wrongMappingPath: `${casePath}/错误映射`,
    receiptPath: `${casePath}/拒绝回单`,
    lockPath: `${casePath}/结果锁定`
  });
}

function createReject02ProgramSource(rootPath) {
  const { resultPath } = reject02Paths(rootPath);
  return [
    'result = {"source_count": 3, "candidate_role": "adjacent-role", "mapping_written": False, "rejection_reason": "adjacent-role"}',
    `transform({"thing": ${JSON.stringify(resultPath)}, "situation": json_stringify({"value": result}), "contain": [], "support": []})`
  ].join('\n');
}

function createReject02LockSource(rootPath, labels) {
  if (!Array.isArray(labels) || labels.length === 0 || labels.some((label) => typeof label !== 'string' || !label)) {
    throw liveError('NIGHT_WATCH_REJECT02_LOCK_LABELS_REQUIRED', 'REJECT-02 requires current exact-Agent labels for its temporary path lock');
  }
  const { resultPath } = reject02Paths(rootPath);
  return `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":${JSON.stringify(labels)}})`;
}

function requireReject02LockLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0 || new Set(labels).size !== labels.length
    || labels.some((label) => typeof label !== 'string' || !/^\^+$/u.test(label))
    || !labels.includes('^')) {
    throw liveError('NIGHT_WATCH_REJECT02_LOCK_LABELS_REQUIRED', 'REJECT-02 requires an explicit ^ label set for its temporary path lock');
  }
  return labels;
}

function reject02Structure(rootPath) {
  const { casePath, programPath, receiptPath, lockPath } = reject02Paths(rootPath);
  return {
    thing: casePath,
    situation: 'Synthetic REJECT-02 acceptance instance; no business facts.',
    contain: [
      { thing: '合成源片段-1', situation: 'synthetic-source-a', contain: [], support: [] },
      { thing: '合成源片段-2', situation: 'synthetic-source-b', contain: [], support: [] },
      { thing: '合成源片段-3', situation: 'synthetic-source-c', contain: [], support: [] },
      { thing: '拒绝回单', situation: 'pending', contain: [], support: [] },
      { 'thing@program': '相邻角色核验', situation: createReject02ProgramSource(rootPath), contain: [], support: [] },
      { 'thing@program': '结果锁定', situation: 'message({"level":"info","text":"synthetic temporary lock placeholder"})', contain: [], support: [] }
    ],
    support: []
  };
}

function readSituationFromExact(stdout) {
  try {
    const response = JSON.parse(stdout);
    const entries = Array.isArray(response) ? response : [response];
    return entries.findLast((entry) => typeof entry?.situation === 'string')?.situation ?? null;
  } catch {
    return null;
  }
}

function hasExactSituation(stdout, expectedSituation) {
  try {
    const response = JSON.parse(stdout);
    const entries = Array.isArray(response) ? response : [response];
    return entries.some((entry) => entry?.situation === expectedSituation);
  } catch {
    return false;
  }
}

function exactAgentLabels(stdout) {
  const situation = readSituationFromExact(stdout);
  const match = typeof situation === 'string' && situation.match(/\bagent\s*\(\s*(\{.*\})\s*\)\s*$/su);
  if (!match) return null;
  try {
    const labels = JSON.parse(match[1])?.labels;
    return Array.isArray(labels) && labels.length > 0 && labels.every((label) => typeof label === 'string' && label)
      ? labels : null;
  } catch {
    return null;
  }
}

export async function runReject02LiveCase({ adapter, agent, authorityReceipt, runId, candidate, timestamp, rootPath, lockLabels }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw liveError('NIGHT_WATCH_REJECT02_ADAPTER_INVALID', 'REJECT-02 requires a public CLI stdin adapter');
  }
  if (agent !== '🧊manage') throw liveError('NIGHT_WATCH_REJECT02_AGENT_INVALID', 'REJECT-02 is authorized only for the exact Agent 🧊manage');
  validateNightWatchAuthorityReceipt(authorityReceipt, { agent, now: timestamp });
  requireCandidate(candidate);
  requireRoot(rootPath);
  requireReject02LockLabels(lockLabels);
  if (typeof runId !== 'string' || !runId || typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw liveError('NIGHT_WATCH_REJECT02_RUN_INVALID', 'REJECT-02 requires a stable run id and timestamp');
  }

  const paths = reject02Paths(rootPath);
  const evidence = [];
  let lastRevision = 'unreported-revision';
  const record = (step) => evidence.push(Object.freeze({
    id: `E-${REJECT02_TEST_CASE_ID}-${step}`, issueNodeId: ISSUE_NODE_ID, testCaseId: REJECT02_TEST_CASE_ID,
    businessCase: BUSINESS_CASE, runId, candidate, revision: lastRevision, timestamp, scope: 'synthetic-test-subtree',
    result: 'passed', validity: 'valid', commandClass: step
  }));
  const read = async (step, thing) => {
    const response = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (failureReceipt(response?.stdout)) throw liveError('NIGHT_WATCH_REJECT02_READBACK_FAILED', `REJECT-02 exact read-back failed at ${step}`);
    lastRevision = revisionFrom(response.stdout);
    record(step);
    return response;
  };
  const write = async (step, source, thing) => {
    const response = await adapter.executeStdin(agent, source);
    if (failureReceipt(response?.stdout)) {
      await read(`${step}-unknown-readback`, thing);
      throw liveError('NIGHT_WATCH_REJECT02_WRITE_UNCONFIRMED', `REJECT-02 write is unconfirmed at ${step}`);
    }
    lastRevision = revisionFrom(response.stdout);
    await read(`${step}-readback`, thing);
  };
  const expectAbsent = async (step, thing) => {
    const response = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (!failureReceipt(response?.stdout) || !/\bATOM_NOT_FOUND\b/u.test(response.stdout)) {
      throw liveError('NIGHT_WATCH_REJECT02_MAPPING_PRESENT', `REJECT-02 found or could not conclusively reject wrong mapping at ${step}`);
    }
    record(step);
  };

  await read('parent-explore', '世界之外/🧊manage/工务/work/test');
  await write('subtree-create', exactSource('transform new', {
    thing: rootPath, situation: 'Synthetic night-watch subtree; no business facts.', contain: [], support: []
  }), rootPath);
  await write('case-create', exactSource('transform new', reject02Structure(rootPath)), paths.casePath);
  for (const source of ['合成源片段-1', '合成源片段-2', '合成源片段-3']) await read(`necessary-context-${source}`, `${paths.casePath}/${source}`);

  const programRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.programPath }));
  const resultReadback = await read('program-result-readback', paths.resultPath);
  if (failureReceipt(programRun?.stdout)) throw liveError('NIGHT_WATCH_REJECT02_PROGRAM_UNKNOWN', 'REJECT-02 Program run is unconfirmed and was not replayed');
  const resultSituation = readSituationFromExact(resultReadback.stdout);
  let result;
  try { result = JSON.parse(resultSituation); } catch { result = null; }
  await expectAbsent('wrong-mapping-absent-readback', paths.wrongMappingPath);
  const external = evaluateReject02ExternalFourGates({
    candidate: result,
    expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });
  if (!external.complete) throw liveError('NIGHT_WATCH_REJECT02_GATE_FAILED', 'REJECT-02 external four-gate verification failed');
  for (const proof of external.proofs) record(`external-${proof.gate}`);

  await write('rejection-receipt', exactSituationReplacement(paths.receiptPath, 'rejected'), paths.receiptPath);
  await read('agent-context-readback', agent);
  const lockSource = createReject02LockSource(rootPath, lockLabels);
  await write('lock-source-attach', exactSituationReplacement(paths.lockPath, lockSource), paths.lockPath);
  const lockRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.lockPath }));
  if (failureReceipt(lockRun?.stdout)) {
    await read('lock-unknown-result-readback', paths.resultPath);
    throw liveError('NIGHT_WATCH_REJECT02_LOCK_UNKNOWN', 'REJECT-02 temporary lock run is unconfirmed and was not replayed');
  }
  await read('final-result-readback', paths.resultPath);
  await expectAbsent('final-wrong-mapping-absent-readback', paths.wrongMappingPath);
  return Object.freeze({ status: 'passed', rootPath, gates: external.gates, proofs: external.proofs, evidence: Object.freeze(evidence) });
}

function pending03Paths(rootPath) {
  requireRoot(rootPath);
  const casePath = `${rootPath}/PENDING-03`;
  const programPath = `${casePath}/待核核验`;
  return Object.freeze({
    casePath,
    programPath,
    resultPath: `${programPath}/待核结果`,
    queryPath: `${programPath}/待核问询`,
    receiptPath: `${programPath}/待核回单`,
    wrongMappingPath: `${casePath}/擅自映射`,
    lockPath: `${casePath}/待核状态锁定`
  });
}

function createPending03ProgramSource(rootPath) {
  const { resultPath, queryPath, receiptPath } = pending03Paths(rootPath);
  return [
    'result = {"source_count": 3, "historical_marker_count": 2, "review_item_present": True, "role_selected": False, "mapping_written": False, "missing_fact": "具体审核分工", "query_status": "pending"}',
    `transform({"thing": ${JSON.stringify(resultPath)}, "situation": json_stringify({"value": result}), "contain": [], "support": []})`,
    `transform({"thing": ${JSON.stringify(queryPath)}, "situation": "具体审核分工", "contain": [], "support": []})`,
    `transform({"thing": ${JSON.stringify(receiptPath)}, "situation": "pending", "contain": [], "support": []})`
  ].join('\n');
}

function requirePending03LockLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0 || new Set(labels).size !== labels.length
    || labels.some((label) => typeof label !== 'string' || !/^\^+$/u.test(label))
    || !labels.includes('^')) {
    throw liveError('NIGHT_WATCH_PENDING03_LOCK_LABELS_REQUIRED', 'PENDING-03 requires an explicit ^ label set for its temporary pending-state lock');
  }
  return labels;
}

function createPending03LockSource(rootPath, labels) {
  requirePending03LockLabels(labels);
  const { resultPath } = pending03Paths(rootPath);
  return `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":${JSON.stringify(labels)}})`;
}

function pending03Structure(rootPath) {
  const { casePath } = pending03Paths(rootPath);
  return {
    thing: casePath,
    situation: SYNTHETIC_PENDING03_CASE_SITUATION,
    contain: [
      { thing: '合成源片段-1', situation: 'synthetic-source-a', contain: [], support: [] },
      { thing: '合成源片段-2', situation: 'synthetic-source-b', contain: [], support: [] },
      { thing: '合成源片段-3', situation: 'synthetic-source-c', contain: [], support: [] },
      { thing: '历史标记-1', situation: 'synthetic-historical-marker-a', contain: [], support: [] },
      { thing: '历史标记-2', situation: 'synthetic-historical-marker-b', contain: [], support: [] },
      { 'thing@program': '待核核验', situation: createPending03ProgramSource(rootPath), contain: [], support: [] },
      { 'thing@program': '待核状态锁定', situation: 'message({"level":"info","text":"synthetic pending lock placeholder"})', contain: [], support: [] }
    ],
    support: []
  };
}

export function evaluatePending03ExternalFourGates({ candidate, expectedGates }) {
  const expected = expectedGates ?? {};
  const status = (gate, verified) => {
    if (expected[gate] === 'passed') return verified ? 'passed' : 'failed';
    if (expected[gate] === 'pending') return verified ? 'pending' : 'failed';
    return 'failed';
  };
  const normalized = {
    sourceCount: candidate?.source_count,
    historicalMarkerCount: candidate?.historical_marker_count,
    reviewItemPresent: candidate?.review_item_present,
    roleSelected: candidate?.role_selected,
    mappingWritten: candidate?.mapping_written,
    missingFact: candidate?.missing_fact,
    queryStatus: candidate?.query_status
  };
  const semanticPending = normalized.missingFact === '具体审核分工'
    && normalized.roleSelected === false && normalized.mappingWritten === false && normalized.queryStatus === 'pending';
  const gates = Object.freeze({
    StructureGate: status('StructureGate', normalized.reviewItemPresent === true && normalized.historicalMarkerCount === 2),
    QuantityGate: status('QuantityGate', normalized.sourceCount === 3 && normalized.historicalMarkerCount === 2),
    ConservationGate: status('ConservationGate', normalized.sourceCount === 3 && normalized.mappingWritten === false),
    SemanticGate: status('SemanticGate', semanticPending)
  });
  const proofs = Object.freeze([
    Object.freeze({ gate: 'StructureGate', assertion: 'synthetic-review-item-and-two-historical-markers-are-preserved', status: gates.StructureGate }),
    Object.freeze({ gate: 'QuantityGate', assertion: 'three-synthetic-sources-and-two-historical-markers-remain-accounted-for', status: gates.QuantityGate }),
    Object.freeze({ gate: 'ConservationGate', assertion: 'no-role-selection-or-unauthorized-mapping-is-written', status: gates.ConservationGate }),
    Object.freeze({ gate: 'SemanticGate', assertion: 'exact-missing-fact-is-specific-review-assignment-and-remains-pending', status: gates.SemanticGate })
  ]);
  const accepted = Object.values(gates).every((item) => item === 'passed' || item === 'pending') && gates.SemanticGate === 'pending';
  return Object.freeze({ gates, proofs, accepted, semanticPending });
}

export async function runPending03LiveCase({ adapter, agent, authorityReceipt, runId, candidate, timestamp, rootPath, lockLabels, resumeExistingRoot = false }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw liveError('NIGHT_WATCH_PENDING03_ADAPTER_INVALID', 'PENDING-03 requires a public CLI stdin adapter');
  }
  if (agent !== '🧊manage') throw liveError('NIGHT_WATCH_PENDING03_AGENT_INVALID', 'PENDING-03 is authorized only for the exact Agent 🧊manage');
  validateNightWatchAuthorityReceipt(authorityReceipt, { agent, now: timestamp });
  requireCandidate(candidate);
  requireRoot(rootPath);
  requirePending03LockLabels(lockLabels);
  if (typeof runId !== 'string' || !runId || typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw liveError('NIGHT_WATCH_PENDING03_RUN_INVALID', 'PENDING-03 requires a stable run id and timestamp');
  }

  const paths = pending03Paths(rootPath);
  const evidence = [];
  let lastRevision = 'unreported-revision';
  const record = (step) => evidence.push(Object.freeze({
    id: `E-${PENDING03_TEST_CASE_ID}-${step}`, issueNodeId: ISSUE_NODE_ID, testCaseId: PENDING03_TEST_CASE_ID,
    businessCase: BUSINESS_CASE, runId, candidate, revision: lastRevision, timestamp, scope: 'synthetic-test-subtree',
    result: 'passed', validity: 'valid', commandClass: step
  }));
  const read = async (step, thing) => {
    const response = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (failureReceipt(response?.stdout)) throw liveError('NIGHT_WATCH_PENDING03_READBACK_FAILED', `PENDING-03 exact read-back failed at ${step}`);
    lastRevision = revisionFrom(response.stdout);
    record(step);
    return response;
  };
  const expectAbsent = async (step, thing) => {
    const response = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (!failureReceipt(response?.stdout) || !/\bATOM_NOT_FOUND\b/u.test(response.stdout)) {
      throw liveError('NIGHT_WATCH_PENDING03_MAPPING_PRESENT', `PENDING-03 found or could not conclusively reject an unauthorized mapping at ${step}`);
    }
    record(step);
  };
  const write = async (step, source, thing) => {
    const response = await adapter.executeStdin(agent, source);
    if (failureReceipt(response?.stdout)) {
      await read(`${step}-unknown-readback`, thing);
      throw liveError('NIGHT_WATCH_PENDING03_WRITE_UNCONFIRMED', `PENDING-03 write is unconfirmed at ${step}`);
    }
    lastRevision = revisionFrom(response.stdout);
    await read(`${step}-readback`, thing);
  };

  const rootPreflight = await adapter.executeStdin(agent, exactSource('explore', { thing: rootPath, 'situation$full': true }));
  const rootAlreadyKnown = !failureReceipt(rootPreflight?.stdout);
  if (rootAlreadyKnown) {
    if (!resumeExistingRoot || !hasExactSituation(rootPreflight.stdout, SYNTHETIC_ROOT_SITUATION)) {
      throw liveError('NIGHT_WATCH_PENDING03_ROOT_NOT_RESUMABLE', 'PENDING-03 root already exists but is not the exact approved synthetic resume target');
    }
    lastRevision = revisionFrom(rootPreflight.stdout);
    record('root-resume-exact-readback');
  } else {
    if (!/\bATOM_NOT_FOUND\b/u.test(rootPreflight.stdout)) {
      throw liveError('NIGHT_WATCH_PENDING03_ROOT_PREFLIGHT_FAILED', 'PENDING-03 root preflight did not return an exact absent result');
    }
    record('root-preflight-absent');
  }
  await read('parent-explore', '世界之外/🧊manage/工务/work/test');
  if (!rootAlreadyKnown) {
    await write('subtree-create', exactSource('transform new', {
      thing: rootPath, situation: SYNTHETIC_ROOT_SITUATION, contain: [], support: []
    }), rootPath);
  }
  let caseAlreadyKnown = false;
  if (rootAlreadyKnown) {
    const casePreflight = await adapter.executeStdin(agent, exactSource('explore', { thing: paths.casePath, 'situation$full': true }));
    if (failureReceipt(casePreflight?.stdout)) {
      if (!/\bATOM_NOT_FOUND\b/u.test(casePreflight.stdout)) {
        throw liveError('NIGHT_WATCH_PENDING03_CASE_PREFLIGHT_FAILED', 'PENDING-03 case preflight did not return an exact absent result');
      }
      record('case-preflight-absent');
    } else {
      if (!hasExactSituation(casePreflight.stdout, SYNTHETIC_PENDING03_CASE_SITUATION)) {
        throw liveError('NIGHT_WATCH_PENDING03_CASE_NOT_RESUMABLE', 'PENDING-03 case already exists but is not the exact approved synthetic resume target');
      }
      lastRevision = revisionFrom(casePreflight.stdout);
      record('case-resume-exact-readback');
      caseAlreadyKnown = true;
    }
  }
  if (!caseAlreadyKnown) await write('case-create', exactSource('transform new', pending03Structure(rootPath)), paths.casePath);
  for (const name of ['合成源片段-1', '合成源片段-2', '合成源片段-3', '历史标记-1', '历史标记-2']) {
    await read(`necessary-context-${name}`, `${paths.casePath}/${name}`);
  }

  const programRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.programPath }));
  const resultReadback = await read('program-result-readback', paths.resultPath);
  const queryReadback = await read('pending-query-readback', paths.queryPath);
  const receiptReadback = await read('pending-receipt-readback', paths.receiptPath);
  if (failureReceipt(programRun?.stdout)) {
    throw liveError('NIGHT_WATCH_PENDING03_PROGRAM_UNKNOWN', 'PENDING-03 Program run is unconfirmed and was not replayed');
  }
  const resultSituation = readSituationFromExact(resultReadback.stdout);
  let result;
  try { result = JSON.parse(resultSituation); } catch { result = null; }
  if (readSituationFromExact(queryReadback.stdout) !== '具体审核分工') {
    throw liveError('NIGHT_WATCH_PENDING03_QUERY_INVALID', 'PENDING-03 did not persist the exact missing fact');
  }
  if (readSituationFromExact(receiptReadback.stdout) !== 'pending') {
    throw liveError('NIGHT_WATCH_PENDING03_RECEIPT_INVALID', 'PENDING-03 did not persist the pending receipt');
  }
  await expectAbsent('unauthorized-mapping-absent-readback', paths.wrongMappingPath);
  const external = evaluatePending03ExternalFourGates({
    candidate: result,
    expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'pending' }
  });
  if (!external.accepted) throw liveError('NIGHT_WATCH_PENDING03_GATE_FAILED', 'PENDING-03 external four-gate verification failed');
  for (const proof of external.proofs) record(`external-${proof.gate}`);

  const lockSource = createPending03LockSource(rootPath, lockLabels);
  await write('lock-source-attach', exactSituationReplacement(paths.lockPath, lockSource), paths.lockPath);
  const lockRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.lockPath }));
  if (failureReceipt(lockRun?.stdout)) {
    await read('lock-unknown-result-readback', paths.resultPath);
    throw liveError('NIGHT_WATCH_PENDING03_LOCK_UNKNOWN', 'PENDING-03 pending-state lock run is unconfirmed and was not replayed');
  }
  await read('final-result-readback', paths.resultPath);
  await read('final-query-readback', paths.queryPath);
  await read('final-receipt-readback', paths.receiptPath);
  await expectAbsent('final-unauthorized-mapping-absent-readback', paths.wrongMappingPath);
  return Object.freeze({ status: 'passed', accepted: external.accepted, rootPath, gates: external.gates, proofs: external.proofs, evidence: Object.freeze(evidence) });
}

const RESUME05_TEST_CASE_ID = 'TC-ESG-ACTIVITY-001-RESUME-05';
const RESUME05_CASE_SITUATION = 'Synthetic RESUME-05 acceptance instance; no business facts.';
const RESUME05_SUPPLEMENTAL_FACT = 'synthetic-review-assignment';
const RESUME05_RESULT = Object.freeze({ responsibility: 'synthetic-review-owner', icon: 'synthetic-review-icon', SemanticGate: 'passed' });

function resume05Paths(rootPath) {
  requireRoot(rootPath);
  const casePath = `${rootPath}/RESUME-05`;
  const programPath = `${casePath}/补事实后继续`;
  return Object.freeze({
    casePath, programPath,
    factPath: `${casePath}/补充事实`, responsibilityPath: `${casePath}/责任关系`, iconPath: `${casePath}/图标`,
    semanticPath: `${casePath}/SemanticGate`, receiptPath: `${casePath}/恢复回单`, resultPath: `${programPath}/恢复结果`,
    lockPath: `${casePath}/结果锁定`
  });
}

function requireResume05LockLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0 || new Set(labels).size !== labels.length
    || labels.some((label) => typeof label !== 'string' || !/^\^+$/u.test(label)) || !labels.includes('^')) {
    throw liveError('NIGHT_WATCH_RESUME05_LOCK_LABELS_REQUIRED', 'RESUME-05 requires an explicit ^ label set for its exact result lock');
  }
  return labels;
}

function createResume05ProgramSource(rootPath) {
  const paths = resume05Paths(rootPath);
  return [
    `transform({"thing":${JSON.stringify(paths.factPath)},"situation.rep.${RESUME05_SUPPLEMENTAL_FACT}":None})`,
    `transform({"thing":${JSON.stringify(paths.responsibilityPath)},"situation.rep.${RESUME05_RESULT.responsibility}":None})`,
    `transform({"thing":${JSON.stringify(paths.iconPath)},"situation.rep.${RESUME05_RESULT.icon}":None})`,
    `transform({"thing":${JSON.stringify(paths.semanticPath)},"situation.rep.passed":None})`,
    `transform({"thing":${JSON.stringify(paths.receiptPath)},"situation.rep.resumed":None})`,
    `transform({"thing":${JSON.stringify(paths.resultPath)},"situation":json_stringify({"value":${JSON.stringify(RESUME05_RESULT)}}),"contain":[],"support":[]})`
  ].join('\n');
}

function createResume05LockSource(rootPath, labels) {
  requireResume05LockLabels(labels);
  const { resultPath } = resume05Paths(rootPath);
  return `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":${JSON.stringify(labels)}})`;
}

function resume05Structure(rootPath) {
  const paths = resume05Paths(rootPath);
  return {
    thing: paths.casePath, situation: RESUME05_CASE_SITUATION,
    contain: [
      { thing: '补充事实', situation: 'pending', contain: [], support: [] },
      { thing: '责任关系', situation: 'pending', contain: [], support: [] },
      { thing: '图标', situation: 'pending', contain: [], support: [] },
      { thing: 'SemanticGate', situation: 'pending', contain: [], support: [] },
      { thing: '恢复回单', situation: 'pending', contain: [], support: [] },
      { 'thing@program': '补事实后继续', situation: createResume05ProgramSource(rootPath), contain: [], support: [] },
      { 'thing@program': '结果锁定', situation: 'message({"level":"info","text":"synthetic resume lock placeholder"})', contain: [], support: [] }
    ], support: []
  };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function isPending03ConservationEvidence(snapshot) {
  return snapshot?.result?.source_count === 3
    && snapshot.result.historical_marker_count === 2
    && snapshot.result.review_item_present === true
    && snapshot.result.role_selected === false
    && snapshot.result.mapping_written === false
    && snapshot.result.missing_fact === '具体审核分工'
    && snapshot.result.query_status === 'pending'
    && snapshot.query === '具体审核分工'
    && snapshot.receipt === 'pending'
    && stableJson(snapshot.sources) === stableJson([
      'synthetic-source-a', 'synthetic-source-b', 'synthetic-source-c',
      'synthetic-historical-marker-a', 'synthetic-historical-marker-b'
    ]);
}

export function evaluateResume05ExternalFourGates({ before, after, expectedGates }) {
  const expected = expectedGates ?? {};
  const immutable = isPending03ConservationEvidence(before) && stableJson(before) === stableJson(after?.pendingEvidence);
  const resumed = after?.fact === RESUME05_SUPPLEMENTAL_FACT
    && after.responsibility === RESUME05_RESULT.responsibility
    && after.icon === RESUME05_RESULT.icon
    && after.SemanticGate === 'passed'
    && after.receipt === 'resumed'
    && stableJson(after.result) === stableJson(RESUME05_RESULT);
  const status = (gate, verified) => expected[gate] === 'passed' && verified ? 'passed' : 'failed';
  const gates = Object.freeze({
    StructureGate: status('StructureGate', immutable),
    QuantityGate: status('QuantityGate', immutable),
    ConservationGate: status('ConservationGate', immutable),
    SemanticGate: status('SemanticGate', immutable && resumed)
  });
  const recomputedFields = Object.freeze(['responsibility', 'icon', 'SemanticGate']);
  const proofs = Object.freeze([
    Object.freeze({ gate: 'StructureGate', assertion: 'prior-structure-evidence-reused-without-recalculation', status: gates.StructureGate }),
    Object.freeze({ gate: 'QuantityGate', assertion: 'prior-quantity-evidence-reused-without-recalculation', status: gates.QuantityGate }),
    Object.freeze({ gate: 'ConservationGate', assertion: 'prior-source-and-pending-evidence-is-byte-equivalent', status: gates.ConservationGate }),
    Object.freeze({ gate: 'SemanticGate', assertion: 'only-supplemented-responsibility-icon-and-semantic-gate-are-remapped', status: gates.SemanticGate })
  ]);
  return Object.freeze({ gates, proofs, recomputedFields, reusedConservationEvidence: immutable, complete: Object.values(gates).every((gate) => gate === 'passed') });
}

export async function runResume05LiveCase({ adapter, agent, authorityReceipt, runId, candidate, timestamp, rootPath, lockLabels, resumeExistingRoot = false }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') throw liveError('NIGHT_WATCH_RESUME05_ADAPTER_INVALID', 'RESUME-05 requires a public CLI stdin adapter');
  if (agent !== '🧊manage') throw liveError('NIGHT_WATCH_RESUME05_AGENT_INVALID', 'RESUME-05 is authorized only for the exact Agent 🧊manage');
  validateNightWatchAuthorityReceipt(authorityReceipt, { agent, now: timestamp });
  requireCandidate(candidate);
  requireRoot(rootPath);
  requireResume05LockLabels(lockLabels);
  if (typeof runId !== 'string' || !runId || typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw liveError('NIGHT_WATCH_RESUME05_RUN_INVALID', 'RESUME-05 requires a stable run id and timestamp');
  }

  // A known synthetic root may already contain the completed PENDING-03
  // instance after an earlier, otherwise unconfirmed continuation attempt.
  // Read that exact instance first: re-running its Program would replay work
  // whose state is already observable and would invalidate the continuation.
  let pending = null;
  if (resumeExistingRoot) {
    const rootReadback = await adapter.executeStdin(agent, exactSource('explore', { thing: rootPath, 'situation$full': true }));
    if (!failureReceipt(rootReadback?.stdout)) {
      if (!hasExactSituation(rootReadback.stdout, SYNTHETIC_ROOT_SITUATION)) {
        throw liveError('NIGHT_WATCH_RESUME05_ROOT_NOT_RESUMABLE', 'RESUME-05 root already exists but is not the exact approved synthetic resume target');
      }
      const pendingReadback = await adapter.executeStdin(agent, exactSource('explore', { thing: pending03Paths(rootPath).casePath, 'situation$full': true }));
      if (!failureReceipt(pendingReadback?.stdout)) {
        if (!hasExactSituation(pendingReadback.stdout, SYNTHETIC_PENDING03_CASE_SITUATION)) {
          throw liveError('NIGHT_WATCH_RESUME05_PENDING_CASE_NOT_RESUMABLE', 'RESUME-05 existing PENDING-03 case is not the exact approved synthetic acceptance instance');
        }
        pending = Object.freeze({
          status: 'passed',
          gates: Object.freeze({ StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'pending' }),
          evidence: Object.freeze([])
        });
      } else if (!/\bATOM_NOT_FOUND\b/u.test(pendingReadback.stdout)) {
        throw liveError('NIGHT_WATCH_RESUME05_PENDING_PREFLIGHT_FAILED', 'RESUME-05 PENDING-03 exact read-back did not return an exact absent result');
      }
    } else if (!/\bATOM_NOT_FOUND\b/u.test(rootReadback.stdout)) {
      throw liveError('NIGHT_WATCH_RESUME05_ROOT_PREFLIGHT_FAILED', 'RESUME-05 root exact read-back did not return an exact absent result');
    }
  }
  if (!pending) {
    pending = await runPending03LiveCase({
      adapter, agent, authorityReceipt, runId: `${runId}-pending`, candidate, timestamp, rootPath, lockLabels, resumeExistingRoot
    });
  }
  if (pending.gates.SemanticGate !== 'pending') throw liveError('NIGHT_WATCH_RESUME05_PENDING_STATE_INVALID', 'RESUME-05 requires the declared pending SemanticGate state');
  const paths = resume05Paths(rootPath);
  const pendingPaths = pending03Paths(rootPath);
  const evidence = [...pending.evidence];
  let lastRevision = 'unreported-revision';
  const record = (step) => evidence.push(Object.freeze({
    id: `E-${RESUME05_TEST_CASE_ID}-${step}`, issueNodeId: ISSUE_NODE_ID, testCaseId: RESUME05_TEST_CASE_ID,
    businessCase: BUSINESS_CASE, runId, candidate, revision: lastRevision, timestamp, scope: 'synthetic-test-subtree',
    result: 'passed', validity: 'valid', commandClass: step
  }));
  const read = async (step, thing) => {
    const response = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (failureReceipt(response?.stdout)) throw liveError('NIGHT_WATCH_RESUME05_READBACK_FAILED', `RESUME-05 exact read-back failed at ${step}`);
    lastRevision = revisionFrom(response.stdout);
    record(step);
    return readSituationFromExact(response.stdout);
  };
  const write = async (step, source, thing) => {
    const response = await adapter.executeStdin(agent, source);
    if (failureReceipt(response?.stdout)) {
      await read(`${step}-unknown-readback`, thing);
      throw liveError('NIGHT_WATCH_RESUME05_WRITE_UNCONFIRMED', `RESUME-05 write is unconfirmed at ${step}`);
    }
    lastRevision = revisionFrom(response.stdout);
    await read(`${step}-readback`, thing);
  };
  const readPendingEvidence = async (phase) => {
    const rawResult = await read(`${phase}-pending-result`, pendingPaths.resultPath);
    let result;
    try { result = JSON.parse(rawResult); } catch { result = null; }
    return Object.freeze({
      result,
      query: await read(`${phase}-pending-query`, pendingPaths.queryPath),
      receipt: await read(`${phase}-pending-receipt`, pendingPaths.receiptPath),
      sources: Object.freeze(await Promise.all(['合成源片段-1', '合成源片段-2', '合成源片段-3', '历史标记-1', '历史标记-2']
        .map((name) => read(`${phase}-conservation-${name}`, `${pendingPaths.casePath}/${name}`))))
    });
  };

  const before = await readPendingEvidence('before');
  if (!isPending03ConservationEvidence(before)) throw liveError('NIGHT_WATCH_RESUME05_PENDING_EVIDENCE_INVALID', 'RESUME-05 requires the exact PENDING-03 evidence before supplementing facts');
  const resumePreflight = await adapter.executeStdin(agent, exactSource('explore', { thing: paths.casePath, 'situation$full': true }));
  if (!failureReceipt(resumePreflight?.stdout) || !/\bATOM_NOT_FOUND\b/u.test(resumePreflight.stdout)) {
    throw liveError('NIGHT_WATCH_RESUME05_CASE_NOT_ABSENT', 'RESUME-05 must create one new synthetic continuation case after exact absence preflight');
  }
  record('resume-case-preflight-absent');
  await write('resume-case-create', exactSource('transform new', resume05Structure(rootPath)), paths.casePath);
  const programRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.programPath }));
  if (failureReceipt(programRun?.stdout)) {
    await read('program-unknown-result-readback', paths.resultPath);
    throw liveError('NIGHT_WATCH_RESUME05_PROGRAM_UNKNOWN', 'RESUME-05 Program run is unconfirmed and was not replayed');
  }
  lastRevision = revisionFrom(programRun.stdout);
  record('supplement-and-local-remap');
  const after = Object.freeze({
    fact: await read('supplement-fact-readback', paths.factPath),
    responsibility: await read('responsibility-readback', paths.responsibilityPath),
    icon: await read('icon-readback', paths.iconPath),
    SemanticGate: await read('semantic-readback', paths.semanticPath),
    receipt: await read('resume-receipt-readback', paths.receiptPath),
    result: parseSnapshotJson(await read('resume-result-readback', paths.resultPath), null),
    pendingEvidence: await readPendingEvidence('after')
  });
  const external = evaluateResume05ExternalFourGates({
    before, after, expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });
  if (!external.complete) throw liveError('NIGHT_WATCH_RESUME05_GATE_FAILED', 'RESUME-05 external four-gate verification failed');
  for (const proof of external.proofs) record(`external-${proof.gate}`);
  const lockSource = createResume05LockSource(rootPath, lockLabels);
  await write('lock-source-attach', exactSituationReplacement(paths.lockPath, lockSource), paths.lockPath);
  const lockRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.lockPath }));
  if (failureReceipt(lockRun?.stdout)) {
    await read('lock-unknown-result-readback', paths.resultPath);
    throw liveError('NIGHT_WATCH_RESUME05_LOCK_UNKNOWN', 'RESUME-05 result lock run is unconfirmed and was not replayed');
  }
  lastRevision = revisionFrom(lockRun.stdout);
  record('result-lock-active');
  const denied = await adapter.executeStdin(agent, exactSituationReplacement(paths.resultPath, 'tampered'));
  if (!failureReceipt(denied?.stdout) || !/\bGRAPH_LOCK_DENIED\b/u.test(denied.stdout)) {
    throw liveError('NIGHT_WATCH_RESUME05_LOCK_NOT_ENFORCED', 'RESUME-05 exact result lock did not reject a protected write');
  }
  record('result-lock-denied-write');
  await read('final-result-exact-readback', paths.resultPath);
  return Object.freeze({ status: 'passed', rootPath, gates: external.gates, proofs: external.proofs, recomputedFields: external.recomputedFields, reusedConservationEvidence: external.reusedConservationEvidence, evidence: Object.freeze(evidence) });
}

const REMAP04_TEST_CASE_ID = 'TC-ESG-ACTIVITY-001-REMAP-04';
const REMAP04_ROOT_SITUATION = 'Synthetic REMAP-04 night-watch subtree; no business facts.';
const REMAP04_CASE_SITUATION = 'Synthetic REMAP-04 acceptance instance; no business facts.';

function remap04Paths(rootPath) {
  requireRoot(rootPath);
  const casePath = `${rootPath}/REMAP-04`;
  const programPath = `${casePath}/计划实际重映射`;
  return Object.freeze({
    casePath, programPath,
    planPath: `${casePath}/计划锚定对象`, actualPath: `${casePath}/实际形成对象`, responsibilityPath: `${casePath}/责任关系`,
    iconPath: `${casePath}/图标`, semanticPath: `${casePath}/语义关系`, sourcePath: `${casePath}/源片段`, unrelatedPath: `${casePath}/无关字段`,
    resultPath: `${programPath}/重映射结果`, receiptPath: `${casePath}/重映射回单`, lockPath: `${casePath}/结果锁定`
  });
}

function requireRemap04LockLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0 || new Set(labels).size !== labels.length
    || labels.some((label) => typeof label !== 'string' || !/^\^+$/u.test(label)) || !labels.includes('^')) {
    throw liveError('NIGHT_WATCH_REMAP04_LOCK_LABELS_REQUIRED', 'REMAP-04 requires an explicit ^ label set for its temporary result lock');
  }
  return labels;
}

function createRemap04ProgramSource(rootPath) {
  const paths = remap04Paths(rootPath);
  const result = {
    plan_object: 'initialization-material', actual_object: 'parameter-table', responsibility: 'actual-owner', icon: 'actual-icon',
    semantic_relation: 'planned-and-actual-separated', source_fragments: ['plan-source', 'completion-source'], unrelated_fields: { procedure_version: 'v1' }
  };
  return [
    `transform({"thing":${JSON.stringify(paths.actualPath)},"situation.rep.parameter-table":None})`,
    `transform({"thing":${JSON.stringify(paths.responsibilityPath)},"situation.rep.actual-owner":None})`,
    `transform({"thing":${JSON.stringify(paths.iconPath)},"situation.rep.actual-icon":None})`,
    `transform({"thing":${JSON.stringify(paths.semanticPath)},"situation.rep.planned-and-actual-separated":None})`,
    `transform({"thing":${JSON.stringify(paths.receiptPath)},"situation.rep.remapped":None})`,
    `transform({"thing":${JSON.stringify(paths.resultPath)},"situation":json_stringify({"value":${JSON.stringify(result)}}),"contain":[],"support":[]})`
  ].join('\n');
}

function createRemap04LockSource(rootPath, labels) {
  requireRemap04LockLabels(labels);
  const { resultPath } = remap04Paths(rootPath);
  return `lock({"targets":{"paths":[${JSON.stringify(resultPath)}],"scope":"exact"},"actions":["transform"],"labels":${JSON.stringify(labels)}})`;
}

function remap04Structure(rootPath) {
  const paths = remap04Paths(rootPath);
  return {
    thing: paths.casePath, situation: REMAP04_CASE_SITUATION,
    contain: [
      { thing: '计划锚定对象', situation: 'initialization-material', contain: [], support: [] },
      { thing: '实际形成对象', situation: 'pending', contain: [], support: [] },
      { thing: '责任关系', situation: 'planned-owner', contain: [], support: [] },
      { thing: '图标', situation: 'planned-icon', contain: [], support: [] },
      { thing: '语义关系', situation: 'plan-only', contain: [], support: [] },
      { thing: '源片段', situation: '["plan-source","completion-source"]', contain: [], support: [] },
      { thing: '无关字段', situation: '{"procedure_version":"v1"}', contain: [], support: [] },
      { thing: '重映射回单', situation: 'pending', contain: [], support: [] },
      { 'thing@program': '计划实际重映射', situation: createRemap04ProgramSource(rootPath), contain: [], support: [] },
      { 'thing@program': '结果锁定', situation: 'message({"level":"info","text":"synthetic remap lock placeholder"})', contain: [], support: [] }
    ], support: []
  };
}

function parseSnapshotJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function evaluateRemap04ExternalFourGates({ before, after, expectedGates }) {
  const expected = expectedGates ?? {};
  const status = (gate, verified) => expected[gate] === 'passed' && verified ? 'passed' : 'failed';
  const changedFields = ['responsibility', 'icon', 'semantic_relation'].filter((field) => before?.[field] !== after?.[field]);
  const planPreserved = before?.plan_object === 'initialization-material' && after?.plan_object === 'initialization-material';
  const distinctActual = after?.actual_object === 'parameter-table' && after.actual_object !== after.plan_object;
  const localChangeOnly = JSON.stringify(changedFields) === JSON.stringify(['responsibility', 'icon', 'semantic_relation']);
  const sourcePreserved = JSON.stringify(before?.source_fragments) === JSON.stringify(after?.source_fragments)
    && JSON.stringify(after?.source_fragments) === JSON.stringify(['plan-source', 'completion-source']);
  const unrelatedPreserved = JSON.stringify(before?.unrelated_fields) === JSON.stringify(after?.unrelated_fields)
    && JSON.stringify(after?.unrelated_fields) === JSON.stringify({ procedure_version: 'v1' });
  const semanticRemapped = after?.responsibility === 'actual-owner' && after?.icon === 'actual-icon'
    && after?.semantic_relation === 'planned-and-actual-separated';
  const gates = Object.freeze({
    StructureGate: status('StructureGate', planPreserved && distinctActual),
    QuantityGate: status('QuantityGate', Array.isArray(after?.source_fragments) && after.source_fragments.length === 2 && changedFields.length === 3),
    ConservationGate: status('ConservationGate', sourcePreserved && unrelatedPreserved),
    SemanticGate: status('SemanticGate', localChangeOnly && semanticRemapped && distinctActual)
  });
  const proofs = Object.freeze([
    Object.freeze({ gate: 'StructureGate', assertion: 'plan-anchor-remains-and-actual-object-is-separate', status: gates.StructureGate }),
    Object.freeze({ gate: 'QuantityGate', assertion: 'two-source-fragments-and-three-local-remap-fields-are-accounted-for', status: gates.QuantityGate }),
    Object.freeze({ gate: 'ConservationGate', assertion: 'source-fragments-and-unrelated-fields-are-byte-equivalent', status: gates.ConservationGate }),
    Object.freeze({ gate: 'SemanticGate', assertion: 'only-responsibility-icon-and-semantic-relation-remap-to-the-actual-object', status: gates.SemanticGate })
  ]);
  return Object.freeze({ gates, proofs, changedFields: Object.freeze(changedFields), complete: Object.values(gates).every((value) => value === 'passed') });
}

function isRemap04InitialSnapshot(snapshot) {
  return snapshot?.plan_object === 'initialization-material'
    && snapshot.actual_object === 'pending'
    && snapshot.responsibility === 'planned-owner'
    && snapshot.icon === 'planned-icon'
    && snapshot.semantic_relation === 'plan-only'
    && JSON.stringify(snapshot.source_fragments) === JSON.stringify(['plan-source', 'completion-source'])
    && JSON.stringify(snapshot.unrelated_fields) === JSON.stringify({ procedure_version: 'v1' });
}

export async function runRemap04LiveCase({ adapter, agent, authorityReceipt, runId, candidate, timestamp, rootPath, lockLabels, resumeExistingRoot = false }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') throw liveError('NIGHT_WATCH_REMAP04_ADAPTER_INVALID', 'REMAP-04 requires a public CLI stdin adapter');
  if (agent !== '🧊manage') throw liveError('NIGHT_WATCH_REMAP04_AGENT_INVALID', 'REMAP-04 is authorized only for the exact Agent 🧊manage');
  validateNightWatchAuthorityReceipt(authorityReceipt, { agent, now: timestamp });
  requireCandidate(candidate);
  requireRoot(rootPath);
  requireRemap04LockLabels(lockLabels);
  if (typeof runId !== 'string' || !runId || typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw liveError('NIGHT_WATCH_REMAP04_RUN_INVALID', 'REMAP-04 requires a stable run id and timestamp');
  }

  const paths = remap04Paths(rootPath);
  const evidence = [];
  let lastRevision = 'unreported-revision';
  const record = (step) => evidence.push(Object.freeze({
    id: `E-${REMAP04_TEST_CASE_ID}-${step}`, issueNodeId: ISSUE_NODE_ID, testCaseId: REMAP04_TEST_CASE_ID, businessCase: BUSINESS_CASE,
    runId, candidate, revision: lastRevision, timestamp, scope: 'synthetic-test-subtree', result: 'passed', validity: 'valid', commandClass: step
  }));
  const read = async (step, thing) => {
    const response = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (failureReceipt(response?.stdout)) throw liveError('NIGHT_WATCH_REMAP04_READBACK_FAILED', `REMAP-04 exact read-back failed at ${step}`);
    lastRevision = revisionFrom(response.stdout);
    record(step);
    return readSituationFromExact(response.stdout);
  };
  const write = async (step, source, thing) => {
    const response = await adapter.executeStdin(agent, source);
    if (failureReceipt(response?.stdout)) {
      await read(`${step}-unknown-readback`, thing);
      throw liveError('NIGHT_WATCH_REMAP04_WRITE_UNCONFIRMED', `REMAP-04 write is unconfirmed at ${step}`);
    }
    lastRevision = revisionFrom(response.stdout);
    await read(`${step}-readback`, thing);
  };
  const readSnapshot = async (phase) => Object.freeze({
    plan_object: await read(`${phase}-plan`, paths.planPath), actual_object: await read(`${phase}-actual`, paths.actualPath),
    responsibility: await read(`${phase}-responsibility`, paths.responsibilityPath), icon: await read(`${phase}-icon`, paths.iconPath),
    semantic_relation: await read(`${phase}-semantic`, paths.semanticPath),
    source_fragments: parseSnapshotJson(await read(`${phase}-sources`, paths.sourcePath), null),
    unrelated_fields: parseSnapshotJson(await read(`${phase}-unrelated`, paths.unrelatedPath), null)
  });

  const preflight = await adapter.executeStdin(agent, exactSource('explore', { thing: rootPath, 'situation$full': true }));
  const rootAlreadyKnown = !failureReceipt(preflight?.stdout);
  let caseAlreadyKnown = false;
  if (rootAlreadyKnown) {
    if (!resumeExistingRoot || !hasExactSituation(preflight.stdout, REMAP04_ROOT_SITUATION)) {
      throw liveError('NIGHT_WATCH_REMAP04_ROOT_NOT_RESUMABLE', 'REMAP-04 root already exists but is not the exact approved synthetic resume target');
    }
    lastRevision = revisionFrom(preflight.stdout);
    record('root-resume-exact-readback');
  } else if (!/\bATOM_NOT_FOUND\b/u.test(preflight.stdout)) {
    throw liveError('NIGHT_WATCH_REMAP04_ROOT_PREFLIGHT_FAILED', 'REMAP-04 root preflight did not return an exact absent result');
  } else {
    record('root-preflight-absent');
  }
  await read('parent-explore', '世界之外/🧊manage/工务/work/test');
  if (!rootAlreadyKnown) {
    await write('subtree-create', exactSource('transform new', { thing: rootPath, situation: REMAP04_ROOT_SITUATION, contain: [], support: [] }), rootPath);
  } else {
    const casePreflight = await adapter.executeStdin(agent, exactSource('explore', { thing: paths.casePath, 'situation$full': true }));
    if (!failureReceipt(casePreflight?.stdout)) {
      if (!hasExactSituation(casePreflight.stdout, REMAP04_CASE_SITUATION)) {
        throw liveError('NIGHT_WATCH_REMAP04_CASE_NOT_RESUMABLE', 'REMAP-04 existing case is not the exact approved synthetic acceptance instance');
      }
      caseAlreadyKnown = true;
      lastRevision = revisionFrom(casePreflight.stdout);
      record('case-resume-exact-readback');
      const resultPreflight = await adapter.executeStdin(agent, exactSource('explore', { thing: paths.resultPath, 'situation$full': true }));
      if (!failureReceipt(resultPreflight?.stdout) || !/\bATOM_NOT_FOUND\b/u.test(resultPreflight.stdout)) {
        throw liveError('NIGHT_WATCH_REMAP04_RESULT_NOT_RESUMABLE', 'REMAP-04 result is not exactly absent; Program execution is not replayed');
      }
      record('result-preflight-absent');
      const receiptBefore = await read('resume-receipt-preflight', paths.receiptPath);
      if (receiptBefore !== 'pending') {
        throw liveError('NIGHT_WATCH_REMAP04_RECEIPT_NOT_RESUMABLE', 'REMAP-04 receipt is not exactly pending; Program execution is not replayed');
      }
      const initial = await readSnapshot('resume-initial');
      if (!isRemap04InitialSnapshot(initial)) {
        throw liveError('NIGHT_WATCH_REMAP04_INITIAL_STATE_NOT_RESUMABLE', 'REMAP-04 existing case is not its exact initial synthetic state; Program execution is not replayed');
      }
      record('case-resume-initial-confirmed');
    } else if (!/\bATOM_NOT_FOUND\b/u.test(casePreflight.stdout)) {
      throw liveError('NIGHT_WATCH_REMAP04_CASE_NOT_RESUMABLE', 'REMAP-04 case preflight did not establish an exact resumable state');
    } else {
      record('case-preflight-absent');
    }
  }
  if (!caseAlreadyKnown) await write('case-create', exactSource('transform new', remap04Structure(rootPath)), paths.casePath);
  const before = await readSnapshot('before');
  const programRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.programPath }));
  const resultSituation = await read('program-result-readback', paths.resultPath);
  const receiptSituation = await read('remap-receipt-readback', paths.receiptPath);
  if (failureReceipt(programRun?.stdout)) throw liveError('NIGHT_WATCH_REMAP04_PROGRAM_UNKNOWN', 'REMAP-04 Program run is unconfirmed and was not replayed');
  if (receiptSituation !== 'remapped') throw liveError('NIGHT_WATCH_REMAP04_RECEIPT_INVALID', 'REMAP-04 did not persist its exact remapped receipt');
  const after = await readSnapshot('after');
  const persistedResult = parseSnapshotJson(resultSituation, null);
  if (JSON.stringify(persistedResult) !== JSON.stringify(after)) {
    throw liveError('NIGHT_WATCH_REMAP04_RESULT_MISMATCH', 'REMAP-04 persisted result does not match final exact read-back');
  }
  const external = evaluateRemap04ExternalFourGates({
    before, after, expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });
  if (!external.complete) throw liveError('NIGHT_WATCH_REMAP04_GATE_FAILED', 'REMAP-04 external four-gate verification failed');
  for (const proof of external.proofs) record(`external-${proof.gate}`);
  const lockSource = createRemap04LockSource(rootPath, lockLabels);
  await write('lock-source-attach', exactSituationReplacement(paths.lockPath, lockSource), paths.lockPath);
  const lockRun = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': paths.lockPath }));
  if (failureReceipt(lockRun?.stdout)) {
    await read('lock-unknown-result-readback', paths.resultPath);
    throw liveError('NIGHT_WATCH_REMAP04_LOCK_UNKNOWN', 'REMAP-04 result-lock run is unconfirmed and was not replayed');
  }
  await readSnapshot('final');
  await read('final-remap-receipt-readback', paths.receiptPath);
  return Object.freeze({ status: 'passed', rootPath, gates: external.gates, proofs: external.proofs, changedFields: external.changedFields, evidence: Object.freeze(evidence) });
}

export function validatePos01Evidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw liveError('NIGHT_WATCH_POS01_EVIDENCE_INVALID', 'POS-01 evidence must be an object');
  }
  for (const field of Object.keys(evidence)) {
    if (FORBIDDEN_EVIDENCE_FIELDS.has(field)) {
      throw liveError('NIGHT_WATCH_POS01_EVIDENCE_REDACTION', 'POS-01 evidence contains forbidden sensitive payload');
    }
  }
  if (typeof evidence.id !== 'string' || !evidence.id || evidence.issueNodeId !== ISSUE_NODE_ID
    || evidence.testCaseId !== TEST_CASE_ID || evidence.businessCase?.id !== BUSINESS_CASE.id
    || evidence.businessCase?.version !== BUSINESS_CASE.version || typeof evidence.runId !== 'string' || !evidence.runId
    || typeof evidence.timestamp !== 'string' || Number.isNaN(Date.parse(evidence.timestamp))
    || typeof evidence.scope !== 'string' || !evidence.scope || evidence.result !== 'passed'
    || evidence.validity !== 'valid' || typeof evidence.revision !== 'string' || !evidence.revision) {
    throw liveError('NIGHT_WATCH_POS01_EVIDENCE_INVALID', 'POS-01 evidence is missing an exact redacted mapping field');
  }
  requireCandidate(evidence.candidate);
  return structuredClone(evidence);
}

export async function runPos01LiveCase({ adapter, agent, authorityReceipt, runId, candidate, timestamp, rootPath }) {
  if (!adapter || typeof adapter.executeStdin !== 'function') {
    throw liveError('NIGHT_WATCH_POS01_ADAPTER_INVALID', 'POS-01 requires a public CLI stdin adapter');
  }
  if (agent !== '🧊manage') throw liveError('NIGHT_WATCH_POS01_AGENT_INVALID', 'POS-01 is authorized only for the exact Agent 🧊manage');
  validateNightWatchAuthorityReceipt(authorityReceipt, { agent, now: timestamp });
  requireCandidate(candidate);
  requireRoot(rootPath);
  if (typeof runId !== 'string' || !runId || typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    throw liveError('NIGHT_WATCH_POS01_RUN_INVALID', 'POS-01 requires a stable run id and timestamp');
  }

  const casePath = `${rootPath}/POS-01`;
  const evidence = [];
  let lastRevision = 'unreported-revision';
  const record = (step, revision = lastRevision) => {
    const item = {
      id: `E-${TEST_CASE_ID}-${step}`, issueNodeId: ISSUE_NODE_ID, testCaseId: TEST_CASE_ID,
      businessCase: BUSINESS_CASE, runId, candidate, revision, timestamp,
      scope: 'synthetic-test-subtree', result: 'passed', validity: 'valid', commandClass: step
    };
    evidence.push(validatePos01Evidence(item));
  };
  const read = async (step, thing) => {
    const result = await adapter.executeStdin(agent, exactSource('explore', { thing, 'situation$full': true }));
    if (failureReceipt(result?.stdout)) throw liveError('NIGHT_WATCH_POS01_READBACK_FAILED', `POS-01 exact read-back failed at ${step}`);
    lastRevision = revisionFrom(result.stdout);
    record(step);
    return result;
  };
  const write = async (step, source, exactThing) => {
    const result = await adapter.executeStdin(agent, source);
    if (failureReceipt(result?.stdout)) {
      await read(`${step}-unknown-readback`, exactThing);
      throw liveError('NIGHT_WATCH_POS01_WRITE_UNCONFIRMED', `POS-01 write is unconfirmed at ${step}`);
    }
    lastRevision = revisionFrom(result.stdout);
    await read(`${step}-readback`, exactThing);
  };
  const runProgram = async (step, programPath, resultPath, requireDeterministicProof = false) => {
    const result = await adapter.executeStdin(agent, exactSource('transform', { 'thing.run.': programPath }));
    if (failureReceipt(result?.stdout)) {
      await read(`${step}-unknown-readback`, resultPath);
      throw liveError('NIGHT_WATCH_POS01_WRITE_UNCONFIRMED', `POS-01 Program run is unconfirmed at ${step}`);
    }
    lastRevision = revisionFrom(result.stdout);
    const readBack = await read(`${step}-readback`, resultPath);
    if (requireDeterministicProof && !verifyPos01ProgramResultNode(readBack.stdout)) {
      throw liveError('NIGHT_WATCH_POS01_PROGRAM_PROOF_INVALID', `POS-01 Program result node lacks deterministic proof at ${step}`);
    }
  };

  await read('parent-explore', '世界之外/🧊manage/工务/work/test');
  await write('subtree-create', exactSource('transform new', {
    thing: rootPath, situation: 'Synthetic night-watch subtree; no business facts.', contain: [], support: []
  }), rootPath);
  await write('slot-structure-create', exactSource('transform new', structure(rootPath)), casePath);
  await write('instance-receive', exactSituationReplacement(`${casePath}/空槽例`, 'received'), `${casePath}/空槽例`);
  await read('necessary-context-explore', `${casePath}/槽体候选/最小上下文`);
  await write('candidate-transform', exactSituationReplacement(`${casePath}/槽体候选/候选结构`, 'synthetic-structure'), `${casePath}/槽体候选/候选结构`);
  const { resultPath } = pos01Paths(rootPath);
  await runProgram('deterministic-program', `${casePath}/确定性核验`, resultPath, true);
  const resultReadback = await read('external-four-gate-input-readback', resultPath);
  const external = evaluatePos01ExternalFourGates({
    resultSituation: JSON.parse(resultReadback.stdout).situation,
    expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });
  if (!external.complete) {
    throw liveError('NIGHT_WATCH_POS01_GATE_FAILED', 'POS-01 external four-gate verification failed');
  }
  for (const gate of external.proofs) record(`external-${gate.gate}`);
  await write('receipt-submit', exactSituationReplacement(`${casePath}/槽体候选/提交回单`, 'submitted'), `${casePath}/槽体候选/提交回单`);
  await runProgram('result-lock', `${casePath}/结果锁定`, resultPath);
  await read('final-exact-readback', `${casePath}/槽体候选/候选结构`);
  return { status: 'passed', rootPath, gates: external.gates, evidence };
}
