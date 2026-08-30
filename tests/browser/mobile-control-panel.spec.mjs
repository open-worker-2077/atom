import { test, expect } from '@playwright/test';

async function openIsolatedWorld(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab
    && window.spatialLab.state().visibleNodes > 0
  ));
}

async function dispatchSyntheticPointer(page, selector, type, pointerId) {
  await page.locator(selector).evaluate((element, { type, pointerId }) => {
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      button: 0
    }));
  }, { type, pointerId });
}

test('mobile control panel separates mouse and keyboard without regressing held middle or Ctrl input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openIsolatedWorld(page);

  const panel = page.locator('.mobile-control-panel');
  const mouse = panel.locator('[data-mobile-control-group="mouse"]');
  const keyboard = panel.locator('[data-mobile-control-group="keyboard"]');
  const middle = mouse.getByRole('button', { name: '中键' });
  const ctrl = keyboard.getByRole('button', { name: 'Ctrl' });

  await expect(panel).toBeVisible();
  await expect(mouse.getByRole('heading', { name: '鼠标' })).toBeVisible();
  await expect(keyboard.getByRole('heading', { name: '键盘' })).toBeVisible();
  await expect(keyboard.locator('[data-mobile-key-group]')).toHaveCount(4);
  await expect(keyboard.getByRole('heading', { name: '游走模式' })).toBeVisible();
  await expect(mouse.locator('[data-mobile-mouse-button="1"]')).toHaveCount(1);
  await expect(keyboard.locator('[data-mobile-mouse-button]')).toHaveCount(0);
  expect(await keyboard.locator('.mobile-control-panel__scroll').evaluate((element) => (
    getComputedStyle(element).overflowX
  ))).toBe('auto');
  const panelBox = await panel.boundingBox();
  expect(panelBox.height).toBeLessThan(280);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(844);

  await page.evaluate(() => {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
    window.__mobileKeyboardEvents = [];
    document.addEventListener('keydown', (event) => {
      if (event.code === 'KeyA') {
        window.__mobileKeyboardEvents.push({ ctrlKey: event.ctrlKey, code: event.code });
      }
    });
  });

  await dispatchSyntheticPointer(page, '[data-mobile-mouse-button="1"]', 'pointerdown', 71);
  await expect(middle).toHaveAttribute('data-pressed', 'true');
  await dispatchSyntheticPointer(page, '[data-mobile-mouse-button="1"]', 'pointerup', 71);
  await expect(middle).toHaveAttribute('data-pressed', 'false');

  await dispatchSyntheticPointer(page, '[data-mobile-key="ControlLeft"]', 'pointerdown', 72);
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await dispatchSyntheticPointer(page, '[data-mobile-key="KeyA"]', 'pointerdown', 73);
  await expect.poll(() => page.evaluate(() => window.__mobileKeyboardEvents)).toEqual([
    { ctrlKey: true, code: 'KeyA' }
  ]);
  await dispatchSyntheticPointer(page, '[data-mobile-key="KeyA"]', 'pointerup', 73);
  await dispatchSyntheticPointer(page, '[data-mobile-key="ControlLeft"]', 'pointerup', 72);
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');

  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(panel).toBeHidden();
});

test('A mode keeps a visible nested sphere above the mobile controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openIsolatedWorld(page);
  await expect(page.locator('#helpPanel')).toBeHidden();

  await dispatchSyntheticPointer(page, '[data-mobile-key="KeyA"]', 'pointerdown', 81);
  await dispatchSyntheticPointer(page, '[data-mobile-key="KeyA"]', 'pointerup', 81);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('nested');

  const portal = await page.evaluate(() => {
    const state = window.spatialLab.state();
    const descriptor = state.visibleNodeDescriptors.find((node) => node.hasChildren);
    return state.interactionTargets.find((target) => descriptor && target.key.endsWith(`::${descriptor.id}`));
  });
  expect(portal).toBeTruthy();
  await page.mouse.click(portal.clientX, portal.clientY, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(true);

  const visibleGeometry = await page.evaluate(() => {
    const state = window.spatialLab.state();
    const canvas = document.querySelector('#spaceCanvas');
    const controlsTop = document.querySelector('.mobile-control-panel').getBoundingClientRect().top;
    const target = state.clusterTargets
      .filter((item) => item.y + item.radius > 0 && item.y - item.radius < controlsTop)
      .sort((left, right) => right.radius - left.radius)[0] || null;
    if (!target) return { controlsTop, target, paintPeak: 0 };
    const context = canvas.getContext('2d');
    const scaleX = canvas.width / canvas.getBoundingClientRect().width;
    const scaleY = canvas.height / canvas.getBoundingClientRect().height;
    const samples = Array.from({ length: 32 }, (_, index) => {
      const angle = index / 32 * Math.PI * 2;
      const x = Math.round((target.x + Math.cos(angle) * target.radius * 0.82) * scaleX);
      const y = Math.round((target.y + Math.sin(angle) * target.radius * 0.82) * scaleY);
      return [...context.getImageData(x, y, 1, 1).data].slice(0, 3);
    });
    const paintPeak = Math.max(...samples.map((rgb) => Math.max(...rgb)));
    return { controlsTop, target, paintPeak };
  });
  expect(visibleGeometry.target, JSON.stringify(visibleGeometry)).toBeTruthy();
  expect(visibleGeometry.target.radius, JSON.stringify(visibleGeometry)).toBeGreaterThanOrEqual(12);
  expect(visibleGeometry.paintPeak, JSON.stringify(visibleGeometry)).toBeGreaterThanOrEqual(24);
});
