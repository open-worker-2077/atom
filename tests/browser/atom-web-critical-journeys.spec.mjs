import { test, expect } from '@playwright/test';

async function openIsolatedWorld(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab
    && window.spatialLab.state().visibleNodes > 0
  ));
}

async function waitForViewToSettle(page) {
  await page.waitForFunction(() => {
    const state = window.spatialLab.state();
    return state.phase === 'idle' && state.transactionActive === false;
  });
  await page.waitForTimeout(550);
}

async function enterAtomFile(page) {
  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'));
  expect(selected).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe('root');
}

test('F entry keeps every intended child node inside the rendered viewport', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);

  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'));
  expect(selected).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);

  const result = await page.evaluate(() => ({
    state: window.spatialLab.state(),
    field: window.spatialLab.exportField()
  }));
  expect(result.state.viewMode).toBe('immersive');
  expect(result.field.nodes).toHaveLength(8);
  expect(result.state.visibleNodeDescriptors.map(({ label }) => label).sort())
    .toEqual(result.field.nodes.map(({ label }) => label).sort());
});

test('Enter-committed node creation stays visible and preserves the current view after authority replies', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  const before = await page.evaluate(() => window.spatialLab.state());

  await page.evaluate(() => window.spatialLab.dispatch('createNode', {
    point: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.52 }
  }));
  const name = page.locator('#nodeNameEditor');
  await expect(name).toBeVisible();
  await name.fill('浏览器验收节点');
  await name.press('Enter');

  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab.state().transactionActive === false
    && window.spatialLab.exportKnowledge().nodes.some(({ label }) => label === '浏览器验收节点')
  ));
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => ({
    state: window.spatialLab.state(),
    labels: window.spatialLab.exportKnowledge().nodes.map(({ label }) => label)
  }));
  expect(after.labels).toContain('浏览器验收节点');
  expect(after.state.visibleNodeDescriptors.map(({ label }) => label)).toContain('浏览器验收节点');
  expect(after.state.path).toBe(before.path);
  expect(after.state.viewMode).toBe(before.viewMode);
  expect(after.state.camera).toEqual(before.camera);
});

test('a steady domain reuses its rasterized backdrop instead of repainting blurred tunnels', async ({ page }) => {
  await page.addInitScript(() => {
    window.__domainEllipseCalls = 0;
    window.__backdropBlits = 0;
    const ellipse = CanvasRenderingContext2D.prototype.ellipse;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.ellipse = function countedEllipse(...args) {
      window.__domainEllipseCalls += 1;
      return ellipse.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function countedDrawImage(...args) {
      window.__backdropBlits += 1;
      return drawImage.apply(this, args);
    };
  });
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  await page.evaluate(() => {
    window.__domainEllipseCalls = 0;
    window.__backdropBlits = 0;
  });

  await page.waitForTimeout(2000);

  const drawCounts = await page.evaluate(() => ({
    ellipses: window.__domainEllipseCalls,
    backdropBlits: window.__backdropBlits
  }));
  expect(drawCounts.backdropBlits).toBeGreaterThan(0);
  expect(drawCounts.ellipses / drawCounts.backdropBlits).toBeLessThan(70);
});
