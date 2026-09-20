import { test, expect } from '@playwright/test';

test('real browser edits and CLI replay preserve one source, four-axis facts and bounded latency', async ({ page }, testInfo) => {
  // Thirty-five real deferred projection drains are part of this acceptance,
  // not part of a command latency budget.
  test.setTimeout(600_000);
  const acceptance = await import('../../scripts/accept-web-cli-parity.mjs');
  expect(acceptance?.createParityWorlds, 'the acceptance harness must produce actual twin-world evidence').toBeInstanceOf(Function);
  const worlds = await acceptance.createParityWorlds();
  page.on('pageerror', error => console.log('parity browser error:', error.message));
  try {
    const report = await acceptance.runBrowserParity({ page, worlds });
    expect(report.operations).toEqual(['node-create', 'node-edit', 'rename', 'node-land', 'edge-create', 'edge-delete', 'node-delete']);
    expect(report.sameFacts).toBe(true);
    expect(report.samples).toBe(30);
    expect(report.projectionProofs).toHaveLength(35);
    for (const proof of report.projectionProofs) {
      expect(proof.web.status).toBe('published');
      expect(proof.cli.status).toBe('published');
      expect(proof.browserImportedRevision).toBe(proof.web.knowledgeRevision);
    }
    expect(report.refreshProofs.map(proof => proof.checkpoint)).toEqual(['moved-body', 'relation-deleted', 'thing-deleted', 'final']);
    await testInfo.attach('web-cli-parity.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    const { records, measurements, projectionProofs, ...summary } = report;
    console.log(JSON.stringify({ ...summary, feedbackDomMs: records.map(r => r.feedbackDomMs),
      feedbackNextPaintMs: records.map(r => r.feedbackNextPaintMs) }));
  } catch (error) {
    console.log('parity failure state:', await page.evaluate(() => ({ dataset: { ...document.body.dataset },
      state: window.spatialLab?.state(), mappers: window.__parityMappers, save: document.querySelector('#saveStatus')?.textContent })).catch(() => null));
    throw error;
  } finally { await page.close(); await worlds.close(); }
});
