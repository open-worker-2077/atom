import assert from 'node:assert/strict';
import test from 'node:test';

const statusGraphModuleUrl = new URL('../scripts/night-watch-status-graph.mjs', import.meta.url);

test('night-watch status graph renders bidirectional Issue, test-case, and evidence triples', async () => {
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  const input = {
    issue: { id: 'issue-1', number: 1, url: 'https://github.com/open-worker-2077/atom/issues/1' },
    issueInstances: [{
      id: 'issue-7', number: 7, status: 'passed', rootIssueRef: 'issue-1',
      testCaseRefs: ['cli-virtual-root'], evidenceRefs: ['evidence-cli-7']
    }],
    testCases: [{
      id: 'cli-virtual-root', issueRef: 'issue-7', status: 'passed', evidenceRefs: ['evidence-cli-7']
    }],
    evidenceAttachments: [{
      id: 'evidence-cli-7', issueRefs: ['issue-7'], testCaseRefs: ['cli-virtual-root'],
      provenNodes: [
        { id: 'issue-7', proof: 'candidate deployment is installed' },
        { id: 'cli-virtual-root', proof: 'exact virtual-root selection passed' }
      ],
      runId: 'night-watch-run-7', candidate: { commit: 'abc123', version: '0.3.0' },
      timestamp: '2026-08-29T00:00:00.000Z', scope: 'local-cli', command: 'COMMAND_BODY_SENTINEL',
      outcome: 'passed', validity: 'valid', conclusive: true
    }],
    requirements: [],
    gates: [{ id: 'local-delivery', status: 'passed', required: ['issue-7', 'cli-virtual-root'] }]
  };

  const root = renderNightWatchStatusGraph(input);
  assert.match(root.markdown, /Issue #1/u);
  assert.match(root.markdown, /Issue instance issue-7 \(#7\)/u);
  assert.match(root.markdown, /Test case cli-virtual-root/u);
  assert.match(root.markdown, /Evidence evidence-cli-7/u);
  assert.match(root.markdown, /candidate: abc123\/0\.3\.0/u);
  assert.match(root.markdown, /Managed backlink\*\*: Issue #1/u);
  assert.equal(root.markdown.includes('COMMAND_BODY_SENTINEL'), false);
  assert.deepEqual(root.gates, [{ id: 'local-delivery', status: 'passed' }]);

  const managed = renderNightWatchStatusGraph({ ...input, managedIssueId: 'issue-7' });
  assert.match(managed.markdown, /Managed backlink\*\*: Issue #1/u);
  assert.match(managed.markdown, /Test case cli-virtual-root/u);
  assert.match(managed.markdown, /Evidence evidence-cli-7/u);
  assert.equal(managed.markdown.includes('Delivery gate'), false);
});

test('night-watch status graph downgrades a one-sided Issue-test-evidence relation', async () => {
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  const rendered = renderNightWatchStatusGraph({
    issue: { id: 'issue-1', number: 1 },
    issueInstances: [{
      id: 'issue-7', number: 7, status: 'passed', rootIssueRef: 'issue-1',
      testCaseRefs: ['cli-virtual-root'], evidenceRefs: ['evidence-cli-7']
    }],
    testCases: [{ id: 'cli-virtual-root', issueRef: 'issue-7', status: 'passed', evidenceRefs: ['evidence-cli-7'] }],
    evidenceAttachments: [{
      id: 'evidence-cli-7', issueRefs: [], testCaseRefs: ['cli-virtual-root'],
      provenNodes: [{ id: 'cli-virtual-root', proof: 'only one side maps' }],
      runId: 'run-7', candidate: { commit: 'abc123', version: '0.3.0' }, timestamp: '2026-08-29T00:00:00.000Z',
      scope: 'local-cli', command: 'redacted', outcome: 'passed', validity: 'valid', conclusive: true
    }],
    requirements: [], gates: [{ id: 'local-delivery', status: 'passed', required: ['issue-7', 'cli-virtual-root'] }]
  });
  assert.match(rendered.markdown, /Issue instance issue-7 \(#7\)\*\*: revalidation-required/u);
  assert.deepEqual(rendered.gates, [{ id: 'local-delivery', status: 'revalidation-required' }]);
});

test('night-watch status graph renders one existing Issue through requirements, cases, evidence, and gates', async () => {
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  const rendered = renderNightWatchStatusGraph({
    issue: { number: 1, url: 'https://github.com/open-worker-2077/atom/issues/1' },
    requirements: [{
      id: 'public-cli', status: 'passed',
      cases: [{ id: 'cli-help', status: 'passed', evidence: { id: 'local-cli-help', outcome: 'passed' } }]
    }, {
      id: 'physical-mobile', status: 'pending-user-acceptance',
      cases: [{ id: 'real-phone', status: 'pending-user-acceptance', evidence: { id: 'manual-check', outcome: 'pending-user-acceptance' } }]
    }],
    gates: [{ id: 'local-delivery', status: 'pending' }]
  });

  assert.match(rendered.markdown, /Issue #1/u);
  assert.match(rendered.markdown, /public-cli/u);
  assert.match(rendered.markdown, /cli-help/u);
  assert.match(rendered.markdown, /local-cli-help/u);
  assert.match(rendered.markdown, /pending-user-acceptance/u);
  assert.deepEqual(rendered.firstOpenNode, { kind: 'requirement', id: 'physical-mobile', status: 'pending-user-acceptance' });
});

test('night-watch status graph rejects a non-root management Issue', async () => {
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  assert.throws(() => renderNightWatchStatusGraph({ issue: { number: 10 }, requirements: [], gates: [] }),
    (error) => error.code === 'NIGHT_WATCH_ROOT_ISSUE_INVALID');
});

test('night-watch status graph keeps evidence redacted and rejects unknown per-case state', async () => {
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  const rendered = renderNightWatchStatusGraph({
    issue: { number: 1 },
    requirements: [{ id: 'report', status: 'passed', cases: [{
      id: 'redaction', status: 'passed', evidence: { id: 'safe-evidence', outcome: 'passed', command: 'COMMAND_BODY_SENTINEL' }
    }] }],
    gates: []
  });
  assert.equal(rendered.markdown.includes('COMMAND_BODY_SENTINEL'), false);
  assert.throws(() => renderNightWatchStatusGraph({
    issue: { number: 1 },
    requirements: [{ id: 'broken', status: 'passed', cases: [{ id: 'case', status: 'complete', evidence: { id: 'evidence', outcome: 'passed' } }] }],
    gates: []
  }), (error) => error.code === 'NIGHT_WATCH_STATUS_INVALID');
});

test('night-watch delivery gates fail closed when required evidence is stale or inconclusive', async () => {
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  const rendered = renderNightWatchStatusGraph({
    issue: { number: 1 }, expectedCommit: 'abc123', now: '2026-08-29T00:00:00.000Z', evidenceMaxAgeMilliseconds: 60_000,
    evidenceAttachments: [{
      id: 'run-17', runId: 'run-17', commit: 'abc123', timestamp: '2026-08-28T00:00:00.000Z', scope: 'local', outcome: 'passed', conclusive: true,
      provenNodes: [{ id: 'cli', proof: 'CLI contract passed' }, { id: 'stdin', proof: 'stdin journey passed' }]
    }],
    requirements: [{ id: 'cli', status: 'passed', evidenceRefs: ['run-17'], cases: [{ id: 'stdin', status: 'passed', evidenceRefs: ['run-17'] }] }],
    gates: [{ id: 'local-delivery', status: 'passed', required: ['cli', 'stdin'] }]
  });

  assert.deepEqual(rendered.gates, [{ id: 'local-delivery', status: 'revalidation-required' }]);
  assert.deepEqual(rendered.firstOpenNode, { kind: 'requirement', id: 'cli', status: 'revalidation-required' });
});
