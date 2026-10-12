import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const knowledge = { revision: 1, nodes: Array.from({ length: 12 }, (_, i) => ({
    id: `probe-${i}`, key: `root::probe-${i}`, path: 'root', label: `绘图样本${i}`,
    atomPath: `绘图样本${i}`, hasChildren: false, detail: ''
  })), edges: [] };
  await page.route('**/__spatial/api/state*', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ok: true, scope: { path: 'root' }, knowledge }) }));
});

test('idle and hidden pages stop drawing; input and knowledge updates wake the scene', async ({ page }) => {
  await page.addInitScript(() => {
    window.drawCount = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.isConnected) window.drawCount++;
      return clear.apply(this, args);
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.state().visibleNodes)).toBeGreaterThan(0);
  await page.evaluate(() => window.spatialLab.applyPresentationSettings({ idleSeconds: null }));
  await page.waitForTimeout(1200);
  const idle = await page.evaluate(() => window.drawCount);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.drawCount)).toBe(idle);
  await page.mouse.move(300, 300);
  await expect.poll(() => page.evaluate(() => window.drawCount)).toBeGreaterThan(idle);
  await page.waitForTimeout(1200);
  const beforeUpdate = await page.evaluate(() => window.drawCount);
  await page.evaluate(() => {
    const knowledge = window.spatialLab.exportKnowledge();
    window.spatialLab.importKnowledge(knowledge);
  });
  await expect.poll(() => page.evaluate(() => window.drawCount)).toBeGreaterThan(beforeUpdate);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await page.evaluate(() => window.drawCount);
  await page.mouse.move(400, 400);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.drawCount)).toBe(hidden);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.drawCount)).toBeGreaterThan(hidden);
});

test('an idle tour wakes on time without drawing while waiting', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.state().visibleNodes)).toBeGreaterThan(0);
  await page.evaluate(() => window.spatialLab.applyPresentationSettings({ idleSeconds: 1 }));
  await expect(page.locator('body')).toHaveAttribute('data-demo-active', 'true');
  await page.evaluate(() => window.spatialLab.applyPresentationSettings({ idleSeconds: null }));
  await page.mouse.move(400, 400);
  await expect(page.locator('body')).toHaveAttribute('data-demo-active', 'false');
});

test('an open editor defers the idle tour without restarting scene drawing', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.selectByLabel('绘图样本0'))).toBe(true);
  await page.evaluate(() => {
    window.spatialLab.dispatch('editNode');
    window.spatialLab.applyPresentationSettings({ idleSeconds: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionActive)).toBe(true);
  await page.waitForTimeout(1500);
  const frames = await page.evaluate(() => window.spatialLab.state().rendering.frames);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.spatialLab.state().rendering.frames)).toBe(frames);
  await expect(page.locator('body')).not.toHaveAttribute('data-demo-active', 'true');
});
