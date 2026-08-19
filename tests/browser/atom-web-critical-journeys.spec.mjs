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

test('double-Shift selection survives the real ctrl-right landing gesture as one batch', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('nested');

  const targets = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .filter(({ label }) => label !== '批量目标');
  expect(targets.length).toBeGreaterThan(1);
  const source = targets[0];

  await page.mouse.click(source.clientX, source.clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().latestInteractionKey))
    .toBe(source.key);
  await page.keyboard.press('Shift');
  const firstShift = await page.evaluate(() => ({ ...window.spatialLab.state(), now: performance.now() }));
  await page.waitForTimeout(90);
  await page.keyboard.press('Shift');
  const secondShift = await page.evaluate(() => ({ ...window.spatialLab.state(), now: performance.now() }));
  expect(firstShift.shiftTapCount).toBe(1);
  expect(secondShift.shiftTapCount, JSON.stringify({ firstShift, secondShift })).toBe(2);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount))
    .toBeGreaterThan(1);

  await page.keyboard.down('Control');
  await page.mouse.click(source.clientX, source.clientY, { button: 'right' });
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionBatchCount))
    .toBeGreaterThan(1);

  const persisted = page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('spatial-workspace-persisted', (event) => resolve(event.detail), { once: true });
  }));
  const sourcePath = await page.evaluate(() => window.spatialLab.state().path);
  await page.getByRole('button', { name: '上层' }).click();
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(sourcePath);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('immersive');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)))
    .toContain('目标占位');
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');

  const detail = await persisted;
  const operation = detail.operation;
  expect(operation.kind).toBe('node-land-batch');
  expect(operation.landings).toHaveLength(targets.length);
  const movedPaths = detail.knowledge.nodes
    .filter(({ label }) => targets.some((target) => target.label === label))
    .map(({ atomPath }) => atomPath);
  expect(movedPaths).toHaveLength(targets.length);
  expect(movedPaths.every((atomPath) => atomPath.startsWith('批量目标/'))).toBe(true);
});

test('holding Shift brushes individual nodes into and out of a batch without peer preselection', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);

  const targets = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .filter(({ label }) => Boolean(label))
    .slice(0, 2);
  expect(targets).toHaveLength(2);

  await page.keyboard.down('Shift');
  await page.mouse.move(targets[0].clientX, targets[0].clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(1);

  await page.mouse.move(targets[1].clientX, targets[1].clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(2);

  await page.mouse.move(targets[0].clientX, targets[0].clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(1);
  await page.keyboard.up('Shift');
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
