import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nightWatchCaseCatalog } from '../scripts/night-watch-case-catalog.mjs';

const catalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/night-watch-case-catalog.mjs');

const requiredCases = {
  health: ['TC-I7-HEALTH-RECOVERY'],
  'web-entry': ['TC-I10-WEB-DEEP-REFRESH'],
  'mobile-entry': ['TC-I17-MOBILE-AUTOMATED', 'TC-I17-PHYSICAL-MOBILE'],
  agent: ['TC-I1-AGENT-EXACT'],
  program: ['TC-I1-PROGRAM-RUN-READBACK'],
  'explore-transform': ['TC-I10-TRANSFORM-VIRTUAL-ROOT'],
  'authorization-locks': ['TC-I13-LOCK-MATRIX'],
  jump: ['TC-I2-JUMP-LIFECYCLE'],
  shortcut: ['TC-I11-SHORTCUT-LIFECYCLE'],
  'slot-body': ['TC-I4-SLOT-CONSERVATION'],
  'work-order': ['TC-I1-WORK-ORDER-ATOMIC'],
  restart: ['TC-I7-RESTART-ROLLBACK'],
  'persistence-read-back': ['TC-I7-PERSISTENCE-READBACK']
};

test('night-watch catalog declares stable explicit cases rather than a capability-category template', async () => {
  const source = await fs.readFile(catalogPath, 'utf8');
  assert.doesNotMatch(source, /\.flatMap\(/);
  assert.doesNotMatch(source, /REQUIRED_SCENARIOS|category:\s*/);
  assert.deepEqual(nightWatchCaseCatalog.coverage, Object.fromEntries(
    Object.entries(requiredCases).map(([capability, requiredCaseIds]) => [capability, { requiredCaseIds }])
  ));

  const byId = new Map(nightWatchCaseCatalog.cases.map((item) => [item.id, item]));
  for (const [capability, ids] of Object.entries(requiredCases)) {
    for (const id of ids) {
      const item = byId.get(id);
      assert.equal(item?.capability, capability, id);
      assert.equal(item?.testCaseId, id, id);
      assert.equal(typeof item?.issueNodeId, 'string', id);
      for (const field of ['prerequisites', 'actions', 'expected', 'negative', 'readBack']) {
        assert.equal(Array.isArray(item?.[field]) && item[field].length > 0, true, `${id}:${field}`);
      }
      assert.equal(item?.evidencePolicy, 'redacted-summary', id);
    }
  }
});

test('night-watch catalog keeps physical-mobile and ESG upstream work explicitly pending', () => {
  const physical = nightWatchCaseCatalog.cases.find(({ id }) => id === 'TC-I17-PHYSICAL-MOBILE');
  const automated = nightWatchCaseCatalog.cases.find(({ id }) => id === 'TC-I17-MOBILE-AUTOMATED');
  const workOrder = nightWatchCaseCatalog.cases.find(({ id }) => id === 'TC-I1-WORK-ORDER-ATOMIC');

  assert.equal(physical.status, 'pending-user-acceptance');
  assert.equal(automated.status, 'pending');
  assert.equal(workOrder.upstream, 'BC-ESG-ACTIVITY-*');
  assert.equal(workOrder.upstreamStatus, 'pending');
});
