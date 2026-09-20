import assert from 'node:assert/strict';
import test from 'node:test';
import * as acceptance from '../scripts/accept-web-cli-parity.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';

test('browser fact proof rejects a stale revision, stale body, retained Thing or retained relation', () => {
  const knowledge = { revision: 7, nodes: [{ atomPath: '域/目标', detail: '中文正文' }], edges: [], strutClauses: [] };
  const expected = { present: { '域/目标': '中文正文' }, absent: ['域/已删除'], noRelations: true };
  assert.equal(acceptance.verifyImportedProjection(knowledge, 7, expected), 3);
  assert.throws(() => acceptance.verifyImportedProjection({ ...knowledge, revision: 6 }, 7, expected), /exact published revision/u);
  assert.throws(() => acceptance.verifyImportedProjection({ ...knowledge, nodes: [{ atomPath: '域/目标', detail: '旧正文' }] }, 7, expected), /body mismatch/u);
  assert.throws(() => acceptance.verifyImportedProjection({ ...knowledge, nodes: [...knowledge.nodes, { atomPath: '域/已删除' }] }, 7, expected), /retained deleted/u);
  assert.throws(() => acceptance.verifyImportedProjection({ ...knowledge, edges: [{ id: 'old-edge' }] }, 7, expected), /deleted relation/u);
});

test('projection drain waits for both real runtimes exact command revision, not an older publication', async () => {
  assert.equal(typeof acceptance.waitForPublishedProjection, 'function');
  const worlds = await acceptance.createParityWorlds({ unrelatedThings: 2 });
  const source = 'transform {"thing":"验收入口/采样节点","situation.rep.精确投影"}';
  try {
    const web = await fetch(`${worlds.web.url}/__atom/api/web-command`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, interaction: { id: 'web-proof' } }) }).then(r => r.json());
    const cli = await executeAtomCommandEndpoint({ source, interaction: { id: 'cli-proof', agentSelector: '验收入口' } },
      `${worlds.cli.url}/__atom/api/command`);
    const receipts = [web.result, cli];
    for (const [i, world] of [worlds.web, worlds.cli].entries()) {
      await world.observations.get(i ? 'cli-proof' : 'web-proof').settled;
      await world.worldService.flushSaves();
      assert.equal(world.interactionRuntime.projectionStatus().status, 'pending');
    }
    const publications = await Promise.all([worlds.web, worlds.cli].map((world, i) =>
      acceptance.waitForPublishedProjection(world, receipts[i].revisionAfter)));
    for (const [i, publication] of publications.entries()) {
      assert.equal(publication.status, 'published');
      assert.equal(publication.expectedRevision, receipts[i].revisionAfter);
      assert.ok(Number.isSafeInteger(publication.knowledgeRevision));
    }
    await assert.rejects(acceptance.waitForPublishedProjection(worlds.web, 'not-the-published-revision', { timeoutMs: 50 }),
      /exact revision/u);
  } finally { await worlds.close(); }
});
