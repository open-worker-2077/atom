import { test, expect } from '@playwright/test';

test('main entry recovers in the same tab when a startup asset is interrupted once', async ({ page }) => {
  let engineAttempts = 0;
  let documentLoads = 0;

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentLoads += 1;
  });
  await page.route('**/spatial-engine.js*', async (route) => {
    engineAttempts += 1;
    if (engineAttempts === 1) {
      await route.abort('internetdisconnected');
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  await expect.poll(() => page.evaluate(() => document.body.dataset.spatialBridge), {
    timeout: 15_000
  }).toBe('connected');
  await expect.poll(() => page.evaluate(() => document.body.dataset.spatialKnowledge), {
    timeout: 15_000
  }).toBe('authoritative');
  expect(engineAttempts).toBeGreaterThanOrEqual(2);
  expect(documentLoads).toBeGreaterThanOrEqual(2);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('an optional external font failure does not reload the main entry', async ({ page }) => {
  let documentLoads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentLoads += 1;
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort('internetdisconnected'));

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.body.dataset.spatialBridge), {
    timeout: 15_000
  }).toBe('connected');
  await page.waitForTimeout(2_000);

  expect(documentLoads).toBe(1);
});
