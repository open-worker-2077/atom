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
  await expect(mouse.locator('[data-mobile-mouse-button="1"]')).toHaveCount(1);
  await expect(keyboard.locator('[data-mobile-mouse-button]')).toHaveCount(0);
  expect(await keyboard.locator('.mobile-control-panel__scroll').evaluate((element) => (
    getComputedStyle(element).overflowX
  ))).toBe('auto');

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
