import assert from 'node:assert/strict';
import test from 'node:test';

const catalogModuleUrl = new URL('../scripts/night-watch-business-case-catalog.mjs', import.meta.url);
const statusGraphModuleUrl = new URL('../scripts/night-watch-status-graph.mjs', import.meta.url);

const scenarioIds = [
  'TC-ESG-ACTIVITY-001-POS-01',
  'TC-ESG-ACTIVITY-001-REJECT-02',
  'TC-ESG-ACTIVITY-001-PENDING-03',
  'TC-ESG-ACTIVITY-001-REMAP-04',
  'TC-ESG-ACTIVITY-001-RESUME-05'
];

test('BusinessCase catalog projects the five redacted ESG activity scenarios as pending Issue #3 cases', async () => {
  const { nightWatchBusinessCaseCatalog, validateNightWatchBusinessCaseCatalog } = await import(catalogModuleUrl);

  assert.doesNotThrow(() => validateNightWatchBusinessCaseCatalog(nightWatchBusinessCaseCatalog));
  assert.deepEqual(nightWatchBusinessCaseCatalog.businessCase, { id: 'BC-ESG-ACTIVITY-001', version: 'v1' });
  assert.deepEqual(nightWatchBusinessCaseCatalog.businessCases.map(({ id }) => id), scenarioIds);
  for (const item of nightWatchBusinessCaseCatalog.businessCases) {
    assert.equal(item.issueNodeId, 'issue-3', item.id);
    assert.equal(item.status, 'pending', item.id);
    assert.equal(item.evidence.status, 'pending', item.id);
    assert.deepEqual(item.businessCase, { id: 'BC-ESG-ACTIVITY-001', version: 'v1' }, item.id);
    for (const field of ['syntheticShape', 'prerequisites', 'steps', 'minimalContext', 'prohibitedReads']) {
      assert.equal(Array.isArray(item[field]) && item[field].length > 0, true, `${item.id}:${field}`);
    }
    assert.deepEqual(Object.keys(item.gates).sort(), ['ConservationGate', 'QuantityGate', 'SemanticGate', 'StructureGate']);
  }
});

test('BusinessCase catalog preserves pending and resume semantics without a business conclusion in Issue #10', async () => {
  const { nightWatchBusinessCaseCatalog } = await import(catalogModuleUrl);
  const pending = nightWatchBusinessCaseCatalog.businessCases.find(({ id }) => id === 'TC-ESG-ACTIVITY-001-PENDING-03');
  const resume = nightWatchBusinessCaseCatalog.businessCases.find(({ id }) => id === 'TC-ESG-ACTIVITY-001-RESUME-05');

  assert.equal(pending.gates.SemanticGate, 'pending');
  assert.equal(pending.preciseMissing, '具体审核分工');
  assert.equal(pending.roleSelection, 'forbidden');
  assert.deepEqual(resume.recompute, ['责任关系', '图标', 'SemanticGate']);
  assert.deepEqual(resume.immutableEvidence, ['源片段', '锚定对象', '事项链', 'ConservationGate']);
  assert.equal(nightWatchBusinessCaseCatalog.mechanismCases.every((item) => item.issueNodeId === 'issue-10' && item.kind === 'mechanism'), true);
  assert.equal(nightWatchBusinessCaseCatalog.mechanismCases.some((item) => 'gates' in item), false);
});

test('BusinessCase projection maps Issue #3 scenarios and Issue #10 mechanisms bidirectionally with pending evidence', async () => {
  const { createBusinessCaseStatusProjection, nightWatchBusinessCaseCatalog } = await import(catalogModuleUrl);
  const { renderNightWatchStatusGraph } = await import(statusGraphModuleUrl);
  const projection = createBusinessCaseStatusProjection(nightWatchBusinessCaseCatalog);
  const issue3 = projection.issueInstances.find(({ id }) => id === 'issue-3');
  const issue10 = projection.issueInstances.find(({ id }) => id === 'issue-10');

  assert.deepEqual(issue3.testCaseRefs, scenarioIds);
  assert.equal(issue10.testCaseRefs.length > 0, true);
  assert.equal(projection.testCases.filter(({ issueRef }) => issueRef === 'issue-3').every(({ id }) => scenarioIds.includes(id)), true);
  assert.equal(projection.testCases.filter(({ issueRef }) => issueRef === 'issue-10').every(({ id }) => !scenarioIds.includes(id)), true);
  assert.equal(projection.evidenceAttachments.every((item) => item.outcome === 'pending' && item.validity === 'pending'), true);

  const rendered = renderNightWatchStatusGraph(projection);
  assert.match(rendered.markdown, /Issue instance issue-3 \(#3\).*pending/u);
  assert.match(rendered.markdown, /Issue instance issue-10 \(#10\).*pending/u);
  assert.match(rendered.markdown, /\*\*Evidence E-TC-ESG-ACTIVITY-001-POS-01\*\*: pending; execution: not-run/u);
  assert.doesNotMatch(rendered.markdown, /run: undefined|candidate: unknown|timestamp: unknown/u);
});
