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

test('main entry recovers in the same tab when its local stylesheet is interrupted once', async ({ page }) => {
  let stylesheetAttempts = 0;
  let documentLoads = 0;

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentLoads += 1;
  });
  await page.route('**/spatial.css*', async (route) => {
    stylesheetAttempts += 1;
    if (stylesheetAttempts === 1) {
      await route.abort('internetdisconnected');
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  await expect.poll(() => page.evaluate(() => document.body.dataset.spatialBridge), {
    timeout: 15_000
  }).toBe('connected');
  expect(stylesheetAttempts).toBeGreaterThanOrEqual(2);
  expect(documentLoads).toBeGreaterThanOrEqual(2);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('actual data reconnects in the original document after one state failure', async ({ page }) => {
  let stateAttempts = 0;
  let documentLoads = 0;

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentLoads += 1;
  });
  await page.route('**/__spatial/api/state*', async (route) => {
    stateAttempts += 1;
    if (stateAttempts === 1) {
      await route.abort('internetdisconnected');
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  await expect.poll(() => stateAttempts, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('body')).toHaveAttribute('data-spatial-bridge', 'connected', {
    timeout: 15_000
  });
  await expect(page.locator('body')).toHaveAttribute('data-spatial-knowledge', 'authoritative', {
    timeout: 15_000
  });
  expect(stateAttempts).toBeGreaterThanOrEqual(2);
  expect(documentLoads).toBeGreaterThanOrEqual(2);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('actual data recovery does not wait forever when health is unavailable', async ({ page }) => {
  let healthAttempts = 0;
  let stateAttempts = 0;
  let documentLoads = 0;

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentLoads += 1;
  });
  await page.route('**/__spatial/api/health', async (route) => {
    healthAttempts += 1;
    await route.abort('internetdisconnected');
  });
  await page.route('**/__spatial/api/state*', async (route) => {
    stateAttempts += 1;
    if (stateAttempts === 1) {
      await route.abort('internetdisconnected');
      return;
    }
    await route.continue();
  });

  await page.goto('/');

  await expect(page.locator('body')).toHaveAttribute('data-spatial-bridge', 'connected', {
    timeout: 15_000
  });
  await expect(page.locator('body')).toHaveAttribute('data-spatial-knowledge', 'authoritative', {
    timeout: 15_000
  });
  expect(healthAttempts).toBeGreaterThanOrEqual(2);
  expect(stateAttempts).toBeGreaterThanOrEqual(3);
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

test('a stalled optional external font request does not block the Atom runtime', async ({ page }) => {
  test.setTimeout(20_000);
  let releaseFontRequest;
  const stalledFontRequest = new Promise((resolve) => {
    releaseFontRequest = resolve;
  });
  await page.route('https://fonts.googleapis.com/**', async (route) => {
    await stalledFontRequest;
    await route.abort('timedout');
  });

  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect.poll(() => page.evaluate(() => ({
      bridge: document.body?.dataset.spatialBridge,
      authoritative: document.body?.dataset.spatialKnowledge,
      runtimeReady: Boolean(window.spatialLab)
    })), { timeout: 5_000 }).toEqual({
      bridge: 'connected',
      authoritative: 'authoritative',
      runtimeReady: true
    });
  } finally {
    releaseFontRequest();
  }
});
