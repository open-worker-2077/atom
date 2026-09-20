import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import * as acceptance from '../../scripts/accept-web-cli-parity.mjs';

test('real browser reload reimports exact revisions, moved body and deletion facts, with next-paint feedback', async ({ page }) => {
  test.setTimeout(240_000); // Includes four real F5 checks and source/target navigation.
  const worlds = await acceptance.createParityWorlds({ unrelatedThings: 2 });
  try {
    const report = await acceptance.runBrowserParity({ page, worlds, measurePerformance: false });
    assert.ok(Array.isArray(report.refreshProofs), 'F5 requires browser-imported revision and facts, not server equality');
    assert.deepEqual(report.refreshProofs.map(proof => proof.checkpoint), ['moved-body', 'relation-deleted', 'thing-deleted', 'final']);
    for (const proof of report.refreshProofs) {
      assert.equal(proof.importedRevision, proof.publication.knowledgeRevision);
      assert.equal(proof.publication.status, 'published');
      assert.ok(proof.checkedFacts > 0);
    }
    const moved = report.refreshProofs.find(proof => proof.checkpoint === 'moved-body');
    assert.ok(moved.sourceScopeProof, 'move absence requires a loaded source scope, not an unloaded projection');
    assert.equal(moved.sourceScopeProof.importedRevision, moved.publication.knowledgeRevision);
    assert.equal(moved.sourceScopeProof.presentWitness, '验收入口/源域/源参照');
    assert.deepEqual(moved.sourceScopeProof.absentPaths, ['验收入口/源域/已改名']);
    assert.equal(moved.sourceScopeProof.checkedFacts, 2);
    assert.ok(report.records.every(record => Number.isFinite(record.feedbackNextPaintMs)
      && record.feedbackNextPaintMs >= record.feedbackDomMs), 'feedback must report synchronous DOM and next-paint intervals separately');
  } finally { await page.close(); await worlds.close(); }
});

test('public smoke blocks startup mutations before the first navigation', async () => {
  const worlds = await acceptance.createParityWorlds({ unrelatedThings: 2 });
  const receivedMutations = [];
  worlds.web.server.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method)) receivedMutations.push({ method: request.method, url: request.url });
  });
  try {
    const report = await acceptance.publicSmoke(worlds.web.url);
    assert.deepEqual(receivedMutations, [], 'read-only smoke must not reach any mutation endpoint');
    assert.ok(report.blockedMutations.length > 0, 'fixture must exercise startup presentation bootstrap');
    assert.deepEqual(report.actualMutations, []);
    assert.equal(report.f5.before.healthRevision, report.f5.after.healthRevision);
    assert.equal(report.f5.before.buildFingerprint, report.f5.after.buildFingerprint);
    assert.equal(report.f5.before.stateHash, report.f5.after.stateHash);
  } finally { await worlds.close(); }
});
