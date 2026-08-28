import assert from 'node:assert/strict';
import test from 'node:test';

const liveModuleUrl = new URL('../scripts/night-watch-business-case-live.mjs', import.meta.url);

const candidate = { commit: '2eac377dd1609619d771e85981deecc5d5c4aa0e', version: '0.3.0', worktree: 'uncommitted' };
const authorityReceipt = {
  contract: 'atom.night-watch-authority-receipt', version: 1, receiptId: 'ATOM-NIGHT-WATCH-20260829-01',
  agent: '🧊', testDomain: 'test', syntheticCleanup: { allowed: true, scope: 'unique-subtree' },
  restart: { allowed: true, deadlineSeconds: 60 }, githubPublication: { allowed: true }, unattended: false,
  expiresAt: '2026-08-30T00:00:00.000Z'
};

test('night-watch recognizes the public CLI stderr-style Chinese Graph error as a failed receipt rather than a successful read', async () => {
  const { isGraphFailureReceipt } = await import(liveModuleUrl);

  assert.equal(isGraphFailureReceipt('关联 redacted-correlation\n错误 ATOM_NOT_FOUND：不存在'), true);
  assert.equal(isGraphFailureReceipt('{"ok":true,"revision":"r-1"}'), false);
});

const deterministicResult = JSON.stringify({
  matter_count: 4,
  source_atom_count: 7,
  reference_count: 4,
  character_count: 58,
  reconstruction_equal: true,
  review_loop_count: 1
});

test('POS-01 accepts a generic Program receipt only when its exact result-node read-back contains all deterministic facts', async () => {
  const { runPos01LiveCase, validatePos01Evidence } = await import(liveModuleUrl);
  const calls = [];
  const result = await runPos01LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        if (source.includes('thing.run.') && source.includes('确定性核验')) {
          return { stdout: '{"thing@program~unchanged":"确定性核验","choices":[]}' };
        }
        if (source.startsWith('explore ') && source.includes('/确定性核验/核验结果')) {
          return { stdout: JSON.stringify({ thing: '核验结果', situation: deterministicResult, revision: 'result-r-18' }) };
        }
        return { stdout: '{"ok":true,"revision":"r-17"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-pos-01', candidate, timestamp: '2026-08-29T00:00:00.000Z',
    rootPath: '世界之外/test/夜巡-nw-pos-01'
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' });
  assert.equal(result.evidence.length >= 8, true);
  for (const evidence of result.evidence) {
    assert.doesNotThrow(() => validatePos01Evidence(evidence));
    assert.equal(evidence.issueNodeId, 'issue-3');
    assert.equal(evidence.testCaseId, 'TC-ESG-ACTIVITY-001-POS-01');
    assert.deepEqual(evidence.businessCase, { id: 'BC-ESG-ACTIVITY-001', version: 'v1' });
    assert.equal(JSON.stringify(evidence).includes('SYNTHETIC_SOURCE_SENTINEL'), false);
    assert.equal(JSON.stringify(evidence).includes('PROGRAM_SOURCE_SENTINEL'), false);
  }
  assert.equal(calls.every(({ agent }) => agent === '🧊'), true);
  assert.equal(calls.some(({ source }) => source.startsWith('explore {"thing":"世界之外/test"')), true);
  assert.equal(calls.some(({ source }) => source.startsWith('transform new ')), true);
  assert.equal(calls.some(({ source }) => source.includes('thing.run.')), true);
  const programReadback = result.evidence.find((item) => item.commandClass === 'deterministic-program-readback');
  assert.equal(programReadback.revision, 'result-r-18');
});

test('POS-01 independently maps its persisted six-field result to four gate-specific proof records', async () => {
  const { evaluatePos01ExternalFourGates } = await import(liveModuleUrl);
  const evaluated = evaluatePos01ExternalFourGates({
    resultSituation: deterministicResult,
    expectedGates: {
      StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed'
    }
  });

  assert.deepEqual(evaluated.gates, {
    StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed'
  });
  assert.equal(evaluated.complete, true);
  assert.deepEqual(evaluated.proofs.map((proof) => proof.gate), [
    'StructureGate', 'QuantityGate', 'ConservationGate', 'SemanticGate'
  ]);
  assert.equal(evaluated.proofs.every((proof) => proof.status === 'passed' && typeof proof.assertion === 'string' && proof.assertion.length > 0), true);
});

test('REJECT-02 rejects the adjacent-role candidate without writing a mapping and records four independent gates', async () => {
  const { evaluateReject02ExternalFourGates } = await import(liveModuleUrl);
  const evaluated = evaluateReject02ExternalFourGates({
    candidate: { role: 'adjacent-role', mappingWritten: false, preservedSourceCount: 3 },
    expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });
  assert.equal(evaluated.rejected, true);
  assert.equal(evaluated.complete, true);
  assert.deepEqual(evaluated.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' });
});

test('REJECT-02 uses the public CLI to reject an adjacent-role mapping atomically, then proves the four gates, receipt, live ^ lock, and final read-back', async () => {
  const { runReject02LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-nw-reject-02';
  const resultPath = `${rootPath}/REJECT-02/相邻角色核验/拒绝结果`;
  const wrongMappingPath = `${rootPath}/REJECT-02/错误映射`;
  const receiptPath = `${rootPath}/REJECT-02/拒绝回单`;
  const lockPath = `${rootPath}/REJECT-02/结果锁定`;
  const resultSituation = JSON.stringify({ source_count: 3, candidate_role: 'adjacent-role', mapping_written: false, rejection_reason: 'adjacent-role' });
  const calls = [];

  const result = await runReject02LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        if (source.startsWith('explore ') && source.includes('"thing":"🧊"')) {
          return { stdout: JSON.stringify({ thing: '🧊', situation: 'ordinary public Agent detail; registration labels are not exposed here.', revision: 'agent-r-1' }) };
        }
        if (source.startsWith('explore ') && source.includes(wrongMappingPath)) {
          return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (source.startsWith('explore ') && source.includes(resultPath)) {
          return { stdout: JSON.stringify({ thing: '拒绝结果', situation: resultSituation, revision: 'result-r-2' }) };
        }
        if (source.startsWith('explore ') && source.includes(receiptPath)) {
          return { stdout: JSON.stringify({ thing: '拒绝回单', situation: 'rejected', revision: 'receipt-r-3' }) };
        }
        if (source.startsWith('explore ') && source.includes(lockPath)) {
          return { stdout: JSON.stringify({ thing: '结果锁定', situation: 'lock({"targets":{"paths":["世界之外/test/夜巡-nw-reject-02/REJECT-02/相邻角色核验/拒绝结果"],"scope":"exact"},"actions":["transform"],"labels":["^"]})', revision: 'lock-r-4' }) };
        }
        if (source.includes('thing.run.') && source.includes('/相邻角色核验')) {
          return { stdout: '{"thing@program~unchanged":"相邻角色核验","revision":"program-r-2"}' };
        }
        if (source.includes('thing.run.') && source.includes('/结果锁定')) {
          return { stdout: '{"thing@program~unchanged":"结果锁定","revision":"lock-r-4"}' };
        }
        return { stdout: '{"ok":true,"revision":"write-r-1"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-reject-02', candidate, timestamp: '2026-08-29T00:00:00.000Z', rootPath,
    lockLabels: ['^']
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' });
  assert.deepEqual(result.proofs.map((proof) => proof.gate), ['StructureGate', 'QuantityGate', 'ConservationGate', 'SemanticGate']);
  assert.equal(calls.every(({ agent }) => agent === '🧊'), true);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes(`\"thing\":\"${rootPath}\"`)).length, 1);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes(wrongMappingPath)), true);
  assert.equal(calls.some(({ source }) => source.startsWith('transform ') && source.includes(receiptPath) && source.includes('situation.rep.rejected')), true);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes('"thing":"🧊"')), true);
  assert.equal(calls.some(({ source }) => source.startsWith('transform ') && source.includes(lockPath) && source.includes('labels')),
    true);
  assert.equal(calls.at(-1).source.startsWith('explore ') && calls.at(-1).source.includes(wrongMappingPath), true);
});

test('PENDING-03 uses the public CLI to preserve the exact missing assignment without selecting a role, then records a pending semantic gate', async () => {
  const { runPending03LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-nw-pending-03';
  const programPath = `${rootPath}/PENDING-03/待核核验`;
  const resultPath = `${programPath}/待核结果`;
  const queryPath = `${programPath}/待核问询`;
  const receiptPath = `${programPath}/待核回单`;
  const wrongMappingPath = `${rootPath}/PENDING-03/擅自映射`;
  const lockPath = `${rootPath}/PENDING-03/待核状态锁定`;
  const resultSituation = JSON.stringify({
    source_count: 3,
    historical_marker_count: 2,
    review_item_present: true,
    role_selected: false,
    mapping_written: false,
    missing_fact: '具体审核分工',
    query_status: 'pending'
  });
  const calls = [];
  let rootChecks = 0;

  const result = await runPending03LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        if (source.startsWith('explore ') && source.includes(`"thing":"${rootPath}"`)) {
          rootChecks += 1;
          if (rootChecks > 1) return { stdout: JSON.stringify({ thing: '夜巡-nw-pending-03', situation: 'Synthetic night-watch subtree; no business facts.', revision: 'pending-root-r-1' }) };
          return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (source.startsWith('explore ') && source.includes(wrongMappingPath)) {
          return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (source.startsWith('explore ') && source.includes(resultPath)) {
          return { stdout: JSON.stringify({ thing: '待核结果', situation: resultSituation, revision: 'pending-result-r-2' }) };
        }
        if (source.startsWith('explore ') && source.includes(queryPath)) {
          return { stdout: JSON.stringify({ thing: '待核问询', situation: '具体审核分工', revision: 'pending-query-r-3' }) };
        }
        if (source.startsWith('explore ') && source.includes(receiptPath)) {
          return { stdout: JSON.stringify({ thing: '待核回单', situation: 'pending', revision: 'pending-receipt-r-4' }) };
        }
        if (source.startsWith('explore ') && source.includes(lockPath)) {
          return { stdout: JSON.stringify({ thing: '待核状态锁定', situation: `lock({"targets":{"paths":["${resultPath}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`, revision: 'pending-lock-r-5' }) };
        }
        if (source.includes('thing.run.') && source.includes('/待核核验')) {
          return { stdout: '{"thing@program~unchanged":"待核核验","revision":"pending-program-r-2"}' };
        }
        if (source.includes('thing.run.') && source.includes('/待核状态锁定')) {
          return { stdout: '{"thing@program~unchanged":"待核状态锁定","revision":"pending-lock-r-5"}' };
        }
        return { stdout: '{"ok":true,"revision":"pending-write-r-1"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-pending-03', candidate, timestamp: '2026-08-29T00:00:00.000Z', rootPath,
    lockLabels: ['^']
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.accepted, true);
  assert.deepEqual(result.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'pending' });
  assert.equal(result.proofs.find((proof) => proof.gate === 'SemanticGate')?.status, 'pending');
  assert.equal(calls.every(({ agent }) => agent === '🧊'), true);
  assert.equal(calls[0].source.startsWith('explore ') && calls[0].source.includes(rootPath), true);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes(`\"thing\":\"${rootPath}\"`)).length, 1);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes(queryPath)), true);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes(receiptPath)), true);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes(wrongMappingPath)), true);
  assert.equal(calls.some(({ source }) => source.startsWith('transform ') && source.includes(lockPath) && source.includes('labels')), true);
  assert.equal(calls.at(-1).source.startsWith('explore ') && calls.at(-1).source.includes(wrongMappingPath), true);
});

test('PENDING-03 resumes only an exact known synthetic root and does not replay its root creation after an unknown write', async () => {
  const { runPending03LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-nw-pending-03-resume';
  const programPath = `${rootPath}/PENDING-03/待核核验`;
  const resultPath = `${programPath}/待核结果`;
  const queryPath = `${programPath}/待核问询`;
  const receiptPath = `${programPath}/待核回单`;
  const wrongMappingPath = `${rootPath}/PENDING-03/擅自映射`;
  const lockPath = `${rootPath}/PENDING-03/待核状态锁定`;
  const resultSituation = JSON.stringify({ source_count: 3, historical_marker_count: 2, review_item_present: true, role_selected: false, mapping_written: false, missing_fact: '具体审核分工', query_status: 'pending' });
  const calls = [];

  const result = await runPending03LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        if (source.startsWith('explore ') && source.includes(`"thing":"${rootPath}"`)) {
          return { stdout: JSON.stringify({ thing: '夜巡-nw-pending-03-resume', situation: 'Synthetic night-watch subtree; no business facts.', revision: 'known-root-r-1' }) };
        }
        if (source.startsWith('explore ') && source.includes(`"thing":"${rootPath}/PENDING-03"`)) {
          return { stdout: JSON.stringify({ thing: 'PENDING-03', situation: 'Synthetic PENDING-03 acceptance instance; no business facts.', revision: 'known-case-r-1' }) };
        }
        if (source.startsWith('explore ') && source.includes(wrongMappingPath)) return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        if (source.startsWith('explore ') && source.includes(resultPath)) return { stdout: JSON.stringify({ thing: '待核结果', situation: resultSituation, revision: 'result-r-2' }) };
        if (source.startsWith('explore ') && source.includes(queryPath)) return { stdout: JSON.stringify({ thing: '待核问询', situation: '具体审核分工', revision: 'query-r-3' }) };
        if (source.startsWith('explore ') && source.includes(receiptPath)) return { stdout: JSON.stringify({ thing: '待核回单', situation: 'pending', revision: 'receipt-r-4' }) };
        if (source.startsWith('explore ') && source.includes(lockPath)) return { stdout: JSON.stringify({ thing: '待核状态锁定', situation: `lock({"targets":{"paths":["${resultPath}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`, revision: 'lock-r-5' }) };
        if (source.includes('thing.run.')) return { stdout: '{"thing@program~unchanged":"synthetic","revision":"program-r-2"}' };
        return { stdout: '{"ok":true,"revision":"write-r-1"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-pending-03-resume', candidate, timestamp: '2026-08-29T00:00:00.000Z', rootPath,
    lockLabels: ['^'], resumeExistingRoot: true
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.accepted, true);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes(`"thing":"${rootPath}"`)).length, 0);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes('PENDING-03')).length, 0);
});

test('POS-01 does not pass its external gate set when the external semantic contract remains pending', async () => {
  const { evaluatePos01ExternalFourGates } = await import(liveModuleUrl);
  const evaluated = evaluatePos01ExternalFourGates({
    resultSituation: deterministicResult,
    expectedGates: {
      StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'pending'
    }
  });

  assert.equal(evaluated.gates.SemanticGate, 'pending');
  assert.equal(evaluated.complete, false);
  assert.equal(evaluated.proofs.find((proof) => proof.gate === 'SemanticGate')?.status, 'pending');
});

test('POS-01 rejects a Program receipt that spoofs counts when the result node has not been written', async () => {
  const { runPos01LiveCase } = await import(liveModuleUrl);
  await assert.rejects(
    runPos01LiveCase({
      adapter: {
        async executeStdin(_agent, source) {
          if (source.includes('thing.run.') && source.includes('确定性核验')) {
            return { stdout: '{"ok":true,"matter_count":4,"source_atom_count":7,"reference_count":4,"character_count":58,"reconstruction_equal":true,"review_loop_count":1}' };
          }
          if (source.startsWith('explore ') && source.includes('/确定性核验/核验结果')) {
            return { stdout: '{"thing":"核验结果","situation":"Pending deterministic verification.","revision":"result-r-19"}' };
          }
          return { stdout: '{"ok":true,"revision":"r-17"}' };
        }
      },
      agent: '🧊', authorityReceipt, runId: 'nw-pos-01-spoof', candidate, timestamp: '2026-08-29T00:00:00.000Z',
      rootPath: '世界之外/test/夜巡-nw-pos-01-spoof'
    }),
    (error) => error.code === 'NIGHT_WATCH_POS01_PROGRAM_PROOF_INVALID'
  );
});

test('POS-01 adapter exact-reads an unknown write and does not replay it', async () => {
  const { runPos01LiveCase } = await import(liveModuleUrl);
  const calls = [];
  await assert.rejects(
    runPos01LiveCase({
      adapter: {
        async executeStdin(agent, source) {
          calls.push(source);
          if (source.startsWith('transform new ')) return { stdout: '{"ok":false,"errors":[{"code":"WORLD_REVISION_CONFLICT"}]}' };
          return { stdout: '{"ok":true,"revision":"r-17"}' };
        }
      },
      agent: '🧊', authorityReceipt, runId: 'nw-pos-01', candidate, timestamp: '2026-08-29T00:00:00.000Z',
      rootPath: '世界之外/test/夜巡-nw-pos-01'
    }),
    (error) => error.code === 'NIGHT_WATCH_POS01_WRITE_UNCONFIRMED'
  );
  assert.equal(calls.filter((source) => source.startsWith('transform new ')).length, 1);
  assert.equal(calls.at(-1).startsWith('explore {"thing":"世界之外/test/夜巡-nw-pos-01"'), true);
});

test('POS-01 exact-reads the result node once after an unknown Program run and does not replay it', async () => {
  const { runPos01LiveCase } = await import(liveModuleUrl);
  const calls = [];
  await assert.rejects(
    runPos01LiveCase({
      adapter: {
        async executeStdin(_agent, source) {
          calls.push(source);
          if (source.includes('thing.run.') && source.includes('确定性核验')) return { stdout: '' };
          return { stdout: '{"ok":true,"revision":"r-17"}' };
        }
      },
      agent: '🧊', authorityReceipt, runId: 'nw-pos-01-unknown-run', candidate, timestamp: '2026-08-29T00:00:00.000Z',
      rootPath: '世界之外/test/夜巡-nw-pos-01-unknown-run'
    }),
    (error) => error.code === 'NIGHT_WATCH_POS01_WRITE_UNCONFIRMED'
  );
  assert.equal(calls.filter((source) => source.includes('thing.run.') && source.includes('确定性核验')).length, 1);
  assert.equal(calls.at(-1).startsWith('explore {"thing":"世界之外/test/夜巡-nw-pos-01-unknown-run/POS-01/确定性核验/核验结果"'), true);
});

test('REMAP-04 keeps plan and actual separate while independently proving four gates', async () => {
  const { evaluateRemap04ExternalFourGates } = await import(liveModuleUrl);
  const before = {
    plan_object: 'initialization-material', actual_object: 'pending', responsibility: 'planned-owner', icon: 'planned-icon',
    semantic_relation: 'plan-only', source_fragments: ['plan-source', 'completion-source'], unrelated_fields: { procedure_version: 'v1' }
  };
  const after = {
    plan_object: 'initialization-material', actual_object: 'parameter-table', responsibility: 'actual-owner', icon: 'actual-icon',
    semantic_relation: 'planned-and-actual-separated', source_fragments: ['plan-source', 'completion-source'], unrelated_fields: { procedure_version: 'v1' }
  };

  const evaluated = evaluateRemap04ExternalFourGates({
    before, after,
    expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });

  assert.equal(evaluated.complete, true);
  assert.deepEqual(evaluated.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' });
  assert.deepEqual(evaluated.changedFields, ['responsibility', 'icon', 'semantic_relation']);
  assert.equal(evaluated.proofs.every((proof) => proof.status === 'passed'), true);
});

test('REMAP-04 uses public CLI on a new synthetic root, changes only remapped fields, locks the live result, and exact-reads the final state', async () => {
  const { runRemap04LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-remap04-tdd';
  const casePath = `${rootPath}/REMAP-04`;
  const paths = {
    plan: `${casePath}/计划锚定对象`, actual: `${casePath}/实际形成对象`, responsibility: `${casePath}/责任关系`,
    icon: `${casePath}/图标`, semantic: `${casePath}/语义关系`, sources: `${casePath}/源片段`, unrelated: `${casePath}/无关字段`,
    result: `${casePath}/计划实际重映射/重映射结果`, receipt: `${casePath}/重映射回单`, lock: `${casePath}/结果锁定`
  };
  const values = new Map([
    [paths.plan, 'initialization-material'], [paths.actual, 'pending'], [paths.responsibility, 'planned-owner'],
    [paths.icon, 'planned-icon'], [paths.semantic, 'plan-only'],
    [paths.sources, '["plan-source","completion-source"]'], [paths.unrelated, '{"procedure_version":"v1"}']
  ]);
  const calls = [];
  let rootPreflight = true;

  const result = await runRemap04LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        const request = source.startsWith('explore ') ? JSON.parse(source.slice('explore '.length)) : null;
        if (request?.thing === rootPath && rootPreflight) {
          rootPreflight = false;
          return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (request?.thing && values.has(request.thing)) {
          return { stdout: JSON.stringify([
            { thing: '夜巡-remap04-tdd', situation: 'Synthetic REMAP-04 night-watch subtree; no business facts.' },
            { thing: request.thing.split('/').at(-1), situation: values.get(request.thing), revision: 'remap-r-5' }
          ]) };
        }
        if (request?.thing === paths.result) {
          return { stdout: JSON.stringify({ thing: '重映射结果', situation: JSON.stringify({ plan_object: 'initialization-material', actual_object: 'parameter-table', responsibility: 'actual-owner', icon: 'actual-icon', semantic_relation: 'planned-and-actual-separated', source_fragments: ['plan-source', 'completion-source'], unrelated_fields: { procedure_version: 'v1' } }), revision: 'remap-r-6' }) };
        }
        if (request?.thing === paths.receipt) {
          return { stdout: JSON.stringify({ thing: '重映射回单', situation: 'remapped', revision: 'remap-r-6' }) };
        }
        if (request?.thing === paths.lock) {
          return { stdout: JSON.stringify({ thing: '结果锁定', situation: `lock({"targets":{"paths":["${paths.result}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`, revision: 'remap-r-7' }) };
        }
        if (source.includes('thing.run.') && source.includes('/计划实际重映射')) {
          values.set(paths.actual, 'parameter-table');
          values.set(paths.responsibility, 'actual-owner');
          values.set(paths.icon, 'actual-icon');
          values.set(paths.semantic, 'planned-and-actual-separated');
          return { stdout: '{"thing@program~unchanged":"计划实际重映射","revision":"remap-r-6"}' };
        }
        if (source.includes('thing.run.') && source.includes('/结果锁定')) return { stdout: '{"thing@program~unchanged":"结果锁定","revision":"remap-r-7"}' };
        return { stdout: '{"ok":true,"revision":"remap-write-r-1"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-remap-04-tdd', candidate, timestamp: '2026-08-29T00:00:00.000Z', rootPath,
    lockLabels: ['^']
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' });
  assert.equal(calls.every(({ agent }) => agent === '🧊'), true);
  assert.equal(calls[0].source.startsWith('explore ') && calls[0].source.includes(rootPath), true);
  assert.equal(calls.filter(({ source }) => source.includes('thing.run.') && source.includes('/计划实际重映射')).length, 1);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes(paths.receipt)), true);
  assert.equal(calls.some(({ source }) => source.startsWith('transform ') && source.includes(paths.lock) && source.includes('labels')), true);
  assert.equal(calls.some(({ source }) => source.startsWith('explore ') && source.includes(paths.unrelated)), true);
  assert.equal(calls.at(-1).source.startsWith('explore ') && calls.at(-1).source.includes(paths.receipt), true);
});

test('REMAP-04 resumes only an exactly read-back synthetic root and never replays its confirmed root creation', async () => {
  const { runRemap04LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-remap04-resume';
  const calls = [];
  await assert.rejects(
    runRemap04LiveCase({
      adapter: {
        async executeStdin(_agent, source) {
          calls.push(source);
          if (source.startsWith('explore ') && source.includes(`"thing":"${rootPath}"`)) {
            return { stdout: JSON.stringify({ thing: '夜巡-remap04-resume', situation: 'Synthetic REMAP-04 night-watch subtree; no business facts.', revision: 'known-root-r-1' }) };
          }
          if (source.startsWith('explore ') && source.includes(`"thing":"${rootPath}/REMAP-04"`)) {
            return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
          }
          return { stdout: '{"ok":true,"revision":"generic-r-1"}' };
        }
      },
      agent: '🧊', authorityReceipt, runId: 'nw-remap-04-resume', candidate, timestamp: '2026-08-29T00:00:00.000Z', rootPath,
      lockLabels: ['^'], resumeExistingRoot: true
    }),
    (error) => error.code === 'NIGHT_WATCH_REMAP04_READBACK_FAILED'
  );
  assert.equal(calls.filter((source) => source.startsWith('transform new ') && source.includes(`"thing":"${rootPath}"`)).length, 0);
  assert.equal(calls.filter((source) => source.startsWith('transform new ') && source.includes('/REMAP-04')).length, 1);
});

test('REMAP-04 continues a confirmed initial case only when its result is exactly absent', async () => {
  const { runRemap04LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-remap04-resume-initial';
  const casePath = `${rootPath}/REMAP-04`;
  const paths = {
    plan: `${casePath}/计划锚定对象`, actual: `${casePath}/实际形成对象`, responsibility: `${casePath}/责任关系`,
    icon: `${casePath}/图标`, semantic: `${casePath}/语义关系`, sources: `${casePath}/源片段`, unrelated: `${casePath}/无关字段`,
    result: `${casePath}/计划实际重映射/重映射结果`, receipt: `${casePath}/重映射回单`, lock: `${casePath}/结果锁定`
  };
  const values = new Map([
    [paths.plan, 'initialization-material'], [paths.actual, 'pending'], [paths.responsibility, 'planned-owner'],
    [paths.icon, 'planned-icon'], [paths.semantic, 'plan-only'],
    [paths.sources, '["plan-source","completion-source"]'], [paths.unrelated, '{"procedure_version":"v1"}'],
    [paths.receipt, 'pending']
  ]);
  const resultValue = {
    plan_object: 'initialization-material', actual_object: 'parameter-table', responsibility: 'actual-owner', icon: 'actual-icon',
    semantic_relation: 'planned-and-actual-separated', source_fragments: ['plan-source', 'completion-source'], unrelated_fields: { procedure_version: 'v1' }
  };
  const calls = [];
  let resultCreated = false;
  let lockAttached = false;

  const result = await runRemap04LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        const request = source.startsWith('explore ') ? JSON.parse(source.slice('explore '.length)) : null;
        if (request?.thing === rootPath) {
          return { stdout: JSON.stringify({ thing: '夜巡-remap04-resume-initial', situation: 'Synthetic REMAP-04 night-watch subtree; no business facts.', revision: 'resume-r-1' }) };
        }
        if (request?.thing === casePath) {
          return { stdout: JSON.stringify({ thing: 'REMAP-04', situation: 'Synthetic REMAP-04 acceptance instance; no business facts.', revision: 'resume-r-1' }) };
        }
        if (request?.thing && values.has(request.thing)) {
          return { stdout: JSON.stringify({ thing: request.thing.split('/').at(-1), situation: values.get(request.thing), revision: 'resume-r-2' }) };
        }
        if (request?.thing === paths.result) {
          return resultCreated
            ? { stdout: JSON.stringify({ thing: '重映射结果', situation: JSON.stringify(resultValue), revision: 'resume-r-3' }) }
            : { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (request?.thing === paths.lock) {
          return { stdout: JSON.stringify({
            thing: '结果锁定',
            situation: lockAttached
              ? `lock({"targets":{"paths":["${paths.result}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})`
              : 'message({"level":"info","text":"synthetic remap lock placeholder"})',
            revision: 'resume-r-4'
          }) };
        }
        if (source.includes('thing.run.') && source.includes('/计划实际重映射')) {
          values.set(paths.actual, 'parameter-table');
          values.set(paths.responsibility, 'actual-owner');
          values.set(paths.icon, 'actual-icon');
          values.set(paths.semantic, 'planned-and-actual-separated');
          values.set(paths.receipt, 'remapped');
          resultCreated = true;
          return { stdout: '{"thing@program~unchanged":"计划实际重映射","revision":"resume-r-3"}' };
        }
        if (source.includes('thing.run.') && source.includes('/结果锁定')) {
          return { stdout: '{"thing@program~unchanged":"结果锁定","revision":"resume-r-4"}' };
        }
        if (source.startsWith('transform ') && source.includes(paths.lock) && source.includes('situation.rep.lock(')) {
          lockAttached = true;
        }
        return { stdout: '{"ok":true,"revision":"resume-write-r-1"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-remap-04-resume-initial', candidate,
    timestamp: '2026-08-29T00:00:00.000Z', rootPath, lockLabels: ['^'], resumeExistingRoot: true
  });

  assert.equal(result.status, 'passed');
  assert.equal(calls.every(({ agent }) => agent === '🧊'), true);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes(`"thing":"${rootPath}"`)).length, 0);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes(`"thing":"${casePath}"`)).length, 0);
  assert.equal(calls.filter(({ source }) => source.includes('thing.run.') && source.includes('/计划实际重映射')).length, 1);
});

test('RESUME-05 establishes a new synthetic PENDING root, supplements only the missing fact, reuses conservation evidence, and locks the exact final result', async () => {
  const { runResume05LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-resume05-tdd';
  const pendingPath = `${rootPath}/PENDING-03`;
  const pendingProgramPath = `${pendingPath}/待核核验`;
  const pendingResultPath = `${pendingProgramPath}/待核结果`;
  const pendingQueryPath = `${pendingProgramPath}/待核问询`;
  const pendingReceiptPath = `${pendingProgramPath}/待核回单`;
  const resumePath = `${rootPath}/RESUME-05`;
  const paths = {
    fact: `${resumePath}/补充事实`, responsibility: `${resumePath}/责任关系`, icon: `${resumePath}/图标`,
    semantic: `${resumePath}/SemanticGate`, receipt: `${resumePath}/恢复回单`,
    result: `${resumePath}/补事实后继续/恢复结果`, program: `${resumePath}/补事实后继续`, lock: `${resumePath}/结果锁定`
  };
  const pendingResult = JSON.stringify({
    source_count: 3, historical_marker_count: 2, review_item_present: true, role_selected: false,
    mapping_written: false, missing_fact: '具体审核分工', query_status: 'pending'
  });
  const pendingEvidence = new Map([
    [`${pendingPath}/合成源片段-1`, 'synthetic-source-a'], [`${pendingPath}/合成源片段-2`, 'synthetic-source-b'],
    [`${pendingPath}/合成源片段-3`, 'synthetic-source-c'], [`${pendingPath}/历史标记-1`, 'synthetic-historical-marker-a'],
    [`${pendingPath}/历史标记-2`, 'synthetic-historical-marker-b']
  ]);
  const resumeValues = new Map();
  const calls = [];
  let rootExists = false;
  let resumeCaseExists = false;
  let resumeProgramRan = false;
  let lockAttached = false;

  const result = await runResume05LiveCase({
    adapter: {
      async executeStdin(agent, source) {
        calls.push({ agent, source });
        const request = source.startsWith('explore ') ? JSON.parse(source.slice('explore '.length)) : null;
        if (request?.thing === rootPath) {
          return rootExists
            ? { stdout: JSON.stringify({ thing: '夜巡-resume05-tdd', situation: 'Synthetic night-watch subtree; no business facts.', revision: 'resume05-r-1' }) }
            : { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (request?.thing === pendingPath) return { stdout: JSON.stringify({ thing: 'PENDING-03', situation: 'Synthetic PENDING-03 acceptance instance; no business facts.', revision: 'resume05-r-2' }) };
        if (request?.thing === `${pendingPath}/擅自映射`) return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        if (request?.thing === pendingResultPath) return { stdout: JSON.stringify({ thing: '待核结果', situation: pendingResult, revision: 'resume05-r-3' }) };
        if (request?.thing === pendingQueryPath) return { stdout: JSON.stringify({ thing: '待核问询', situation: '具体审核分工', revision: 'resume05-r-3' }) };
        if (request?.thing === pendingReceiptPath) return { stdout: JSON.stringify({ thing: '待核回单', situation: 'pending', revision: 'resume05-r-3' }) };
        if (request?.thing && pendingEvidence.has(request.thing)) return { stdout: JSON.stringify({ thing: request.thing.split('/').at(-1), situation: pendingEvidence.get(request.thing), revision: 'resume05-r-3' }) };
        if (request?.thing === resumePath) return resumeCaseExists
          ? { stdout: JSON.stringify({ thing: 'RESUME-05', situation: 'Synthetic RESUME-05 acceptance instance; no business facts.', revision: 'resume05-r-5' }) }
          : { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        if (request?.thing === paths.result) {
          const situation = resumeProgramRan ? JSON.stringify({ responsibility: 'synthetic-review-owner', icon: 'synthetic-review-icon', SemanticGate: 'passed' }) : '';
          return situation
            ? { stdout: JSON.stringify({ thing: '恢复结果', situation, revision: 'resume05-r-6' }) }
            : { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
        }
        if (request?.thing && resumeValues.has(request.thing)) return { stdout: JSON.stringify({ thing: request.thing.split('/').at(-1), situation: resumeValues.get(request.thing), revision: 'resume05-r-6' }) };
        if (request?.thing === paths.lock) return { stdout: JSON.stringify({ thing: '结果锁定', situation: lockAttached ? `lock({"targets":{"paths":["${paths.result}"],"scope":"exact"},"actions":["transform"],"labels":["^"]})` : 'message({})', revision: 'resume05-r-7' }) };
        if (source.startsWith('transform new ') && source.includes(`"thing":"${rootPath}"`)) {
          rootExists = true;
          return { stdout: '{"ok":true,"revision":"resume05-root-write"}' };
        }
        if (source.startsWith('transform new ') && source.includes(`"thing":"${resumePath}"`)) {
          resumeCaseExists = true;
          return { stdout: '{"ok":true,"revision":"resume05-case-write"}' };
        }
        if (source.includes('thing.run.') && source.includes('/待核核验')) return { stdout: '{"thing@program~unchanged":"待核核验","revision":"resume05-r-3"}' };
        if (source.includes('thing.run.') && source.includes('/补事实后继续')) {
          resumeProgramRan = true;
          resumeValues.set(paths.fact, 'synthetic-review-assignment');
          resumeValues.set(paths.responsibility, 'synthetic-review-owner');
          resumeValues.set(paths.icon, 'synthetic-review-icon');
          resumeValues.set(paths.semantic, 'passed');
          resumeValues.set(paths.receipt, 'resumed');
          return { stdout: '{"thing@program~unchanged":"补事实后继续","revision":"resume05-r-6"}' };
        }
        if (source.includes('thing.run.') && source.includes('/结果锁定')) return { stdout: '{"thing@program~unchanged":"结果锁定","revision":"resume05-r-7"}' };
        if (source.startsWith('transform ') && source.includes(paths.result) && source.includes('tampered')) return { stdout: '{"ok":false,"errors":[{"code":"GRAPH_LOCK_DENIED"}]}' };
        if (source.startsWith('transform ') && source.includes(paths.lock) && source.includes('situation.rep.lock(')) lockAttached = true;
        return { stdout: '{"ok":true,"revision":"resume05-write"}' };
      }
    },
    agent: '🧊', authorityReceipt, runId: 'nw-resume-05-tdd', candidate,
    timestamp: '2026-08-29T00:00:00.000Z', rootPath, lockLabels: ['^']
  });

  assert.deepEqual(result.gates, { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' });
  assert.deepEqual(result.recomputedFields, ['responsibility', 'icon', 'SemanticGate']);
  assert.equal(result.reusedConservationEvidence, true);
  assert.equal(calls.every(({ agent }) => agent === '🧊'), true);
  assert.equal(calls[0].source.includes(`"thing":"${rootPath}"`), true);
  assert.equal(calls.filter(({ source }) => source.startsWith('transform new ') && source.includes(`"thing":"${rootPath}"`)).length, 1);
  assert.equal(calls.filter(({ source }) => source.includes('thing.run.') && source.includes('/待核核验')).length, 1);
  assert.equal(calls.filter(({ source }) => source.includes('thing.run.') && source.includes('/补事实后继续')).length, 1);
  assert.equal(calls.some(({ source }) => source.includes('situation.rep.synthetic-review-assignment')), true);
  assert.equal(calls.filter(({ source }) => source.includes(pendingResultPath) && source.startsWith('explore ')).length >= 2, true);
  assert.equal(calls.some(({ source }) => source.includes('GRAPH_LOCK_DENIED')), false);
  assert.equal(calls.some(({ source }) => source.startsWith('transform ') && source.includes(paths.result) && source.includes('tampered')), true);
  assert.equal(calls.at(-1).source.startsWith('explore ') && calls.at(-1).source.includes(paths.result), true);
});

test('RESUME-05 continues from an exact read-back root after an unknown root-write without replaying that root creation', async () => {
  const { runResume05LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-resume05-known-root';
  const calls = [];
  let pendingCaseExists = false;
  await assert.rejects(
    runResume05LiveCase({
      adapter: {
        async executeStdin(_agent, source) {
          calls.push(source);
          if (source.startsWith('explore ') && source.includes(`"thing":"${rootPath}"`)) {
            return { stdout: JSON.stringify({ thing: '夜巡-resume05-known-root', situation: 'Synthetic night-watch subtree; no business facts.', revision: 'known-root-r-1' }) };
          }
          if (source.startsWith('explore ') && source.includes(`${rootPath}/PENDING-03`)) {
            return pendingCaseExists
              ? { stdout: JSON.stringify({ thing: 'PENDING-03', situation: 'Synthetic PENDING-03 acceptance instance; no business facts.', revision: 'known-case-r-1' }) }
              : { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
          }
          if (source.startsWith('transform new ') && source.includes(`${rootPath}/PENDING-03`)) pendingCaseExists = true;
          return { stdout: '{"ok":true,"revision":"generic-r-1"}' };
        }
      },
      agent: '🧊', authorityReceipt, runId: 'nw-resume-05-known-root', candidate,
      timestamp: '2026-08-29T00:00:00.000Z', rootPath, lockLabels: ['^'], resumeExistingRoot: true
    }),
    (error) => error.code === 'NIGHT_WATCH_PENDING03_QUERY_INVALID'
  );
  assert.equal(calls.filter((source) => source.startsWith('transform new ') && source.includes(`"thing":"${rootPath}"`)).length, 0);
  assert.equal(calls.filter((source) => source.startsWith('transform new ') && source.includes('/PENDING-03')).length, 1);
});

test('RESUME-05 exact-reads an already pending synthetic case instead of replaying its Program', async () => {
  const { runResume05LiveCase } = await import(liveModuleUrl);
  const rootPath = '世界之外/test/夜巡-resume05-pending-readback';
  const pendingPath = `${rootPath}/PENDING-03`;
  const pendingProgramPath = `${pendingPath}/待核核验`;
  const calls = [];
  const pendingResult = JSON.stringify({
    source_count: 3, historical_marker_count: 2, review_item_present: true, role_selected: false,
    mapping_written: false, missing_fact: '具体审核分工', query_status: 'pending'
  });
  const values = new Map([
    [`${pendingProgramPath}/待核结果`, pendingResult], [`${pendingProgramPath}/待核问询`, '具体审核分工'],
    [`${pendingProgramPath}/待核回单`, 'pending'], [`${pendingPath}/合成源片段-1`, 'synthetic-source-a'],
    [`${pendingPath}/合成源片段-2`, 'synthetic-source-b'], [`${pendingPath}/合成源片段-3`, 'synthetic-source-c'],
    [`${pendingPath}/历史标记-1`, 'synthetic-historical-marker-a'], [`${pendingPath}/历史标记-2`, 'synthetic-historical-marker-b']
  ]);

  await assert.rejects(
    runResume05LiveCase({
      adapter: {
        async executeStdin(_agent, source) {
          calls.push(source);
          const request = source.startsWith('explore ') ? JSON.parse(source.slice('explore '.length)) : null;
          if (request?.thing === rootPath) {
            return { stdout: JSON.stringify({ thing: '夜巡-resume05-pending-readback', situation: 'Synthetic night-watch subtree; no business facts.', revision: 'pending-root-r-1' }) };
          }
          if (request?.thing === pendingPath) {
            return { stdout: JSON.stringify({ thing: 'PENDING-03', situation: 'Synthetic PENDING-03 acceptance instance; no business facts.', revision: 'pending-case-r-2' }) };
          }
          if (request?.thing && values.has(request.thing)) {
            return { stdout: JSON.stringify({ thing: request.thing.split('/').at(-1), situation: values.get(request.thing), revision: 'pending-r-3' }) };
          }
          if (request?.thing === `${pendingPath}/擅自映射`) return { stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}' };
          return { stdout: '{"ok":true,"revision":"generic-r-1"}' };
        }
      },
      agent: '🧊', authorityReceipt, runId: 'nw-resume-05-pending-readback', candidate,
      timestamp: '2026-08-29T00:00:00.000Z', rootPath, lockLabels: ['^'], resumeExistingRoot: true
    }),
    (error) => error.code === 'NIGHT_WATCH_RESUME05_CASE_NOT_ABSENT'
  );

  assert.equal(calls.some((source) => source.includes('thing.run.') && source.includes('/待核核验')), false);
});
