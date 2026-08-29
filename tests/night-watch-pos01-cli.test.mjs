import assert from 'node:assert/strict';
import test from 'node:test';

const entryUrl = new URL('../scripts/night-watch-pos01-cli.mjs', import.meta.url);

const rootPath = '世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update';
const expectedResult = JSON.stringify({
  matter_count: 4,
  source_atom_count: 7,
  reference_count: 4,
  character_count: 58,
  reconstruction_equal: true,
  review_loop_count: 1
});

test('POS-01 Node entry serializes multiline quoted Program source exactly once and proves it through result-node read-back', async () => {
  const { createPos01ProgramSource, createPos01ProgramUpdateSource, updateCommittedPos01Program, isDirectPos01Entry } = await import(entryUrl);
  assert.equal(isDirectPos01Entry('scripts/night-watch-pos01-cli.mjs'), true);
  const source = createPos01ProgramUpdateSource(rootPath);
  const expectedProgram = createPos01ProgramSource(rootPath);
  assert.equal(expectedProgram.startsWith('def main'), false, 'explicit CLI .run. must expose its public transform effect at Program top level');
  assert.equal(expectedProgram.includes('\\'), false, 'Python source must not depend on backslash-escaped Graph-JSON keys');
  assert.equal(expectedProgram.includes('situation.rep.'), false, 'an outer situation.rep update must not contain a nested dot-command marker');
  assert.match(expectedProgram, /transform\(\{"thing": "世界之外\/🧊manage\/工务\/work\/test\/夜巡-nw-pos01-update\/POS-01\/确定性核验\/核验结果", "situation": json_stringify\(\{"value": result\}\), "contain": \[\], "support": \[\]\}\)/u);
  assert.match(source, /^transform \{"thing":"世界之外\/🧊manage\/工务\/work\/test\/夜巡-nw-pos01-update\/POS-01\/确定性核验",/u);
  assert.equal(source, `transform {"thing":${JSON.stringify(`${rootPath}/POS-01/确定性核验`)},${JSON.stringify(`situation.rep.${expectedProgram}`)}}`);
  assert.equal(source.includes('\\\\n'), false, 'the source must contain one JSON newline escape, not a shell-produced double escape');

  const calls = [];
  const result = await updateCommittedPos01Program({
    adapter: {
      async executeStdin(agent, request) {
        calls.push({ agent, request });
        if (request.startsWith('transform {') && request.includes('situation.rep.result')) return { stdout: '{"thing@program~updated":"确定性核验","revision":"program-r-20"}' };
        if (request.startsWith('explore ') && request.includes('/确定性核验/核验结果')) return { stdout: JSON.stringify({ thing: '核验结果', situation: expectedResult, revision: 'result-r-21' }) };
        if (request.startsWith('explore ') && request.endsWith('/确定性核验","situation$full":true}')) return { stdout: JSON.stringify({ thing: '确定性核验', situation: expectedProgram, revision: 'program-r-20' }) };
        if (request.includes('thing.run.')) return { stdout: '{"thing@program~unchanged":"确定性核验","choices":[]}' };
        throw new Error(`Unexpected request: ${request}`);
      }
    },
    agent: '🧊manage',
    rootPath
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.revision, 'result-r-21');
  assert.deepEqual(calls.map((call) => call.agent), ['🧊manage', '🧊manage', '🧊manage', '🧊manage']);
  assert.equal(calls[0].request, source);
  assert.equal(calls[2].request.includes('thing.run.'), true);
});

test('POS-01 can attach the current Agent temporary path lock to its existing deterministic Program without changing the result contract', async () => {
  const { createPos01ProgramSource, createPos01ProgramLockingSource } = await import(entryUrl);
  const baseline = createPos01ProgramSource(rootPath);
  const locking = createPos01ProgramLockingSource(rootPath, ['^']);

  assert.ok(locking.startsWith(`${baseline}\n`));
  assert.match(locking, /lock\(\{"targets":\{"paths":\["世界之外\/🧊manage\/工务\/work\/test\/夜巡-nw-pos01-update\/POS-01\/确定性核验\/核验结果"\],"scope":"exact"\},"actions":\["transform"\],"labels":\["\^"\]\}\)/u);
  assert.equal(locking.includes('submitted'), false);
  assert.equal(locking.includes('matter_count'), true);
});

test('POS-01 attaches a Program-local lock only after the committed source exact-matches and never reruns the result Program', async () => {
  const { attachCommittedPos01ProgramLock, createPos01ProgramSource, createPos01ProgramLockingSource } = await import(entryUrl);
  const baseline = createPos01ProgramSource(rootPath);
  const locking = createPos01ProgramLockingSource(rootPath, ['^']);
  const calls = [];
  const result = await attachCommittedPos01ProgramLock({
    rootPath,
    lockLabels: ['^'],
    adapter: {
      async executeStdin(agent, request) {
        calls.push({ agent, request });
        if (request.startsWith('explore ')) return { stdout: JSON.stringify({ thing: '确定性核验', situation: calls.length === 1 ? baseline : locking, revision: `program-r-${calls.length}` }) };
        if (request.startsWith('transform ')) return { stdout: '{"thing@program~updated":"确定性核验","revision":"program-r-2"}' };
        throw new Error(`Unexpected request: ${request}`);
      }
    }
  });

  assert.equal(result.status, 'locked-source-attached');
  assert.equal(calls.length, 3);
  assert.equal(calls.every(({ agent }) => agent === '🧊manage'), true);
  assert.equal(calls[1].request.includes('situation.rep.'), true);
  assert.equal(calls.some(({ request }) => request.includes('thing.run.')), false);
});

test('POS-01 Node entry inspects the exact result node without exposing Program source', async () => {
  const { inspectPos01Result } = await import(entryUrl);
  const inspected = await inspectPos01Result({
    adapter: {
      async executeStdin(agent, request) {
        assert.equal(agent, '🧊manage');
        assert.equal(request.startsWith('explore {"thing":"世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/确定性核验/核验结果"'), true);
        return { stdout: '{"thing":"核验结果","path":"世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/确定性核验/核验结果","situation":"Pending deterministic verification.","revision":"result-r-22"}' };
      }
    },
    rootPath
  });
  assert.deepEqual(inspected, {
    status: 'revalidation-required',
    revision: 'result-r-22',
    path: '世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/确定性核验/核验结果',
    situation: 'Pending deterministic verification.'
  });
  assert.equal(JSON.stringify(inspected).includes('def main'), false);
});

test('POS-01 Node entry reports only whether the exact Program source is current', async () => {
  const { createPos01ProgramSource, inspectPos01Program } = await import(entryUrl);
  const inspected = await inspectPos01Program({
    adapter: {
      async executeStdin(agent, request) {
        assert.equal(agent, '🧊manage');
        assert.equal(request.endsWith('/确定性核验","situation$full":true}'), true);
        return { stdout: JSON.stringify({ thing: '确定性核验', situation: createPos01ProgramSource(rootPath), revision: 'program-r-23' }) };
      }
    },
    rootPath
  });
  assert.deepEqual(inspected, { status: 'matched', revision: 'program-r-23' });
  assert.equal(JSON.stringify(inspected).includes('def main'), false);
});

test('POS-01 finalization submits and locks only after all externally evaluated gates pass, then exact-reads the locked result', async () => {
  const { finalizeCommittedPos01 } = await import(entryUrl);
  const calls = [];
  const finalization = await finalizeCommittedPos01({
    adapter: {
      async executeStdin(agent, request) {
        calls.push({ agent, request });
        if (request.startsWith('explore ') && request.includes('/确定性核验/核验结果')) {
          return { stdout: JSON.stringify({ thing: '核验结果', situation: expectedResult, revision: 'result-r-31' }) };
        }
        if (request.startsWith('transform ') && request.includes('/提交回单') && request.includes('situation.rep.submitted')) {
          return { stdout: '{"ok":true,"revision":"receipt-r-32"}' };
        }
        if (request.startsWith('explore ') && request.includes('/提交回单')) {
          return { stdout: '{"thing":"提交回单","situation":"submitted","revision":"receipt-r-32"}' };
        }
        if (request.startsWith('transform ') && request.includes('/结果锁定') && request.includes('situation.rep.lock')) {
          return { stdout: '{"ok":true,"revision":"lock-source-r-33"}' };
        }
        if (request.startsWith('explore ') && request.includes('/结果锁定')) {
          return { stdout: '{"thing":"结果锁定","situation":"lock({\\"targets\\":{\\"paths\\":[\\"世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/确定性核验/核验结果\\"],\\"scope\\":\\"exact\\"},\\"actions\\":[\\"transform\\"],\\"labels\\":[\\"^^\\"]})","revision":"lock-source-r-33"}' };
        }
        if (request.includes('thing.run.') && request.includes('/结果锁定')) {
          return { stdout: '{"thing@program~unchanged":"结果锁定","choices":[]}' };
        }
        throw new Error(`Unexpected request: ${request}`);
      }
    },
    agent: '🧊manage', rootPath, lockLabels: ['^^'],
    expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }
  });

  assert.equal(finalization.status, 'passed');
  assert.deepEqual(finalization.gates, {
    StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed'
  });
  assert.equal(finalization.finalRevision, 'result-r-31');
  assert.equal(calls.every(({ agent }) => agent === '🧊manage'), true);
  assert.equal(calls.findIndex(({ request }) => request.includes('/提交回单')) > calls.findIndex(({ request }) => request.includes('/确定性核验/核验结果')), true);
  assert.equal(calls.some(({ request }) => request.includes('thing.run.') && request.includes('/结果锁定')), true);
  assert.equal(calls.at(-1).request.includes('/确定性核验/核验结果'), true);
});

test('POS-01 finalization refuses to submit or lock when an external gate is pending', async () => {
  const { finalizeCommittedPos01 } = await import(entryUrl);
  const calls = [];
  await assert.rejects(
    finalizeCommittedPos01({
      adapter: {
        async executeStdin(_agent, request) {
          calls.push(request);
          return { stdout: JSON.stringify({ thing: '核验结果', situation: expectedResult, revision: 'result-r-34' }) };
        }
      },
      agent: '🧊manage', rootPath, lockLabels: ['^'],
      expectedGates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'pending' }
    }),
    (error) => error.code === 'NIGHT_WATCH_POS01_GATE_FAILED'
  );
  assert.equal(calls.length, 1);
});

test('POS-01 finalization inspector exact-reads the synthetic receipt without exposing Program source', async () => {
  const { inspectPos01Receipt } = await import(entryUrl);
  const inspected = await inspectPos01Receipt({
    adapter: {
      async executeStdin(agent, request) {
        assert.equal(agent, '🧊manage');
        assert.equal(request.startsWith('explore {"thing":"世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/槽体候选/提交回单"'), true);
        return { stdout: '{"thing":"提交回单","situation":"submitted","revision":"receipt-r-35"}' };
      }
    },
    rootPath
  });
  assert.deepEqual(inspected, { status: 'submitted', revision: 'receipt-r-35' });
  assert.equal(JSON.stringify(inspected).includes('lock({'), false);
});

test('POS-01 lock recovery creates only a missing synthetic lock Program after exact receipt read-back and never replays the receipt', async () => {
  const { completeCommittedPos01Lock } = await import(entryUrl);
  const calls = [];
  const result = await completeCommittedPos01Lock({
    adapter: {
      async executeStdin(agent, request) {
        calls.push({ agent, request });
        if (request.startsWith('explore ') && request.includes('/提交回单')) {
          return { stdout: '{"thing":"提交回单","situation":"submitted","revision":"receipt-r-36"}' };
        }
        if (request.startsWith('explore ') && request.includes('/结果锁定') && calls.filter((call) => call.request.includes('/结果锁定')).length === 1) {
          throw Object.assign(new Error('ATOM_NOT_FOUND'), { code: 'ATOM_NOT_FOUND' });
        }
        if (request.startsWith('transform new ') && request.includes('thing@program') && request.includes('/结果锁定')) {
          return { stdout: '{"ok":true,"revision":"lock-create-r-37"}' };
        }
        if (request.startsWith('explore ') && request.includes('/结果锁定')) {
          return { stdout: '{"thing":"结果锁定","situation":"lock({\\"targets\\":{\\"paths\\":[\\"世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/确定性核验/核验结果\\"],\\"scope\\":\\"exact\\"},\\"actions\\":[\\"transform\\"],\\"labels\\":[\\"^^\\"]})","revision":"lock-r-37"}' };
        }
        if (request.includes('thing.run.') && request.includes('/结果锁定')) {
          return { stdout: '{"thing@program~unchanged":"结果锁定","choices":[]}' };
        }
        if (request.startsWith('explore ') && request.includes('/确定性核验/核验结果')) {
          return { stdout: JSON.stringify({ thing: '核验结果', situation: expectedResult, revision: 'result-r-38' }) };
        }
        throw new Error(`Unexpected request: ${request}`);
      }
    },
    agent: '🧊manage', rootPath, lockLabels: ['^^']
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.createdLockProgram, true);
  assert.equal(calls.some(({ request }) => request.includes('situation.rep.submitted')), false);
  assert.equal(calls.some(({ request }) => request.startsWith('transform new ') && request.includes('/结果锁定')), true);
  assert.equal(calls.at(-1).request.includes('/确定性核验/核验结果'), true);
});

test('POS-01 diagnostic reads only the deterministic Program direct-child names without exposing its source', async () => {
  const { inspectPos01ResultParent } = await import(entryUrl);
  const inspected = await inspectPos01ResultParent({
    adapter: {
      async executeStdin(agent, request) {
        assert.equal(agent, '🧊manage');
        assert.equal(request, 'explore {"thing":"世界之外/🧊manage/工务/work/test/夜巡-nw-pos01-update/POS-01/确定性核验","contain$latitude+1":true}');
        return { stdout: '{"thing":"确定性核验","contain":[{"thing":"核验结果"}],"revision":"program-r-39"}' };
      }
    },
    rootPath
  });
  assert.deepEqual(inspected, { childNames: ['核验结果'], revision: 'program-r-39' });
  assert.equal(JSON.stringify(inspected).includes('result ='), false);
});

test('POS-01 containment diagnostic accepts the public Graph-JSON children-tree shape', async () => {
  const { inspectPos01ResultParent } = await import(entryUrl);
  const inspected = await inspectPos01ResultParent({
    adapter: {
      async executeStdin() {
        return {
          stdout: JSON.stringify({
            kind: 'object',
            entries: [
              { key: 'thing@program', value: '确定性核验' },
              { key: 'contain', value: { kind: 'array', values: [
                { kind: 'object', entries: [{ key: 'thing', value: '核验结果' }] }
              ] } }
            ]
          })
        };
      }
    },
    rootPath
  });
  assert.deepEqual(inspected.childNames, ['核验结果']);
});

test('POS-01 containment diagnostic reports only a sanitized public failure code when no child tree is returned', async () => {
  const { inspectPos01ResultParent } = await import(entryUrl);
  await assert.rejects(
    inspectPos01ResultParent({
      adapter: { async executeStdin() { return { stdout: '错误 GRAPH_LOCK_DENIED：redacted' }; } },
      rootPath
    }),
    (error) => error.code === 'NIGHT_WATCH_POS01_PARENT_READBACK_FAILED'
      && error.message.includes('GRAPH_LOCK_DENIED')
      && !error.message.includes('redacted')
  );
});

test('POS-01 containment diagnostic classifies an inconclusive public projection without treating it as a business failure', async () => {
  const { inspectPos01ResultParent } = await import(entryUrl);
  const inspected = await inspectPos01ResultParent({
    adapter: {
      async executeStdin() {
        return { stdout: JSON.stringify({ kind: 'object', entries: [
          { key: 'thing@program', value: '确定性核验' },
          { key: 'situation', value: 'redacted' }
        ] }) };
      }
    },
    rootPath
  });
  assert.deepEqual(inspected, {
    status: 'revalidation-required', childNames: [], projectionKeys: ['thing@program', 'situation'], revision: 'unreported-revision'
  });
});

test('POS-01 lock preparation derives only the exact Agent literal labels and never returns Agent source', async () => {
  const { inspectExactAgentLabels } = await import(entryUrl);
  const inspected = await inspectExactAgentLabels({
    adapter: {
      async executeStdin(agent, request) {
        assert.equal(agent, '🧊manage');
        assert.equal(request, 'explore {"thing":"🧊manage","situation$full":true}');
        return { stdout: JSON.stringify({
          thing: '🧊manage',
          situation: 'agent({"labels":["^^","night-watch"],"functions":{"groups":[],"names":["lock"]}})',
          revision: 'agent-r-40'
        }) };
      }
    }
  });
  assert.deepEqual(inspected, { labels: ['^^', 'night-watch'], revision: 'agent-r-40' });
  assert.equal(JSON.stringify(inspected).includes('functions'), false);
});

test('POS-01 lock recovery rejects a missing exact-Agent label set before any public write', async () => {
  const { completeCommittedPos01Lock } = await import(entryUrl);
  let calls = 0;
  await assert.rejects(
    completeCommittedPos01Lock({
      adapter: { async executeStdin() { calls += 1; return { stdout: '{}' }; } },
      agent: '🧊manage', rootPath
    }),
    (error) => error.code === 'NIGHT_WATCH_POS01_LOCK_LABELS_REQUIRED'
  );
  assert.equal(calls, 0);
});

test('POS-01 CLI accepts only explicit repeated temporary lock labels and never supplies a default', async () => {
  const { lockLabelsFromArgs } = await import(entryUrl);
  assert.deepEqual(lockLabelsFromArgs(['node', 'entry', '--lock-label', '^', '--lock-label', 'audit']), ['^', 'audit']);
  assert.deepEqual(lockLabelsFromArgs(['node', 'entry', '--complete-lock']), []);
});
