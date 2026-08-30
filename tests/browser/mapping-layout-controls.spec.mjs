import { test, expect } from '@playwright/test';

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function loadTwoLevelField(page, mode) {
  const childPath = `root/${hashText('parent-id').toString(36)}`;
  const knowledge = {
    revision: 47,
    nodes: [
      { id: 'parent-id', key: 'root::parent-id', path: 'root', atomPath: '母节点', label: '母节点', detail: '', hasChildren: true, position: { x: -2, y: 0, z: 0 } },
      { id: 'peer-id', key: 'root::peer-id', path: 'root', atomPath: '同层节点一', label: '同层节点一', detail: '', hasChildren: false, position: { x: 0, y: 0, z: 0 } },
      { id: 'peer-two', key: 'root::peer-two', path: 'root', atomPath: '同层节点二', label: '同层节点二', detail: '', hasChildren: false, position: { x: 2, y: 0, z: 0 } },
      { id: 'child-a', key: `${childPath}::child-a`, path: childPath, atomPath: '母节点/子节点A', label: '子节点A', detail: '', hasChildren: false, position: { x: -1, y: 0, z: 0 } },
      { id: 'child-b', key: `${childPath}::child-b`, path: childPath, atomPath: '母节点/子节点B', label: '子节点B', detail: '', hasChildren: false, position: { x: 1, y: 0, z: 0 } }
    ],
    edges: []
  };
  await page.route('**/__spatial/api/state*', async (route) => {
    const requestUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        scope: { path: requestUrl.searchParams.get('path') || 'root' },
        knowledge
      })
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => (
    window.spatialLab
    && document.body.dataset.spatialBridge === 'connected'
  ));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors
    .some(({ id }) => id === 'parent-id'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().phase)).toBe('idle');
  await expect.poll(() => page.evaluate((intent) => window.spatialLab.dispatch(intent), mode)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    if (!window.spatialLab.selectByLabel('母节点')) return false;
    window.spatialLab.dispatch('applyViewMode');
    return window.spatialLab.state().clusterFieldOpen;
  })).toBe(true);
  await page.evaluate(() => window.spatialLab.requestVisualIntent('dolly', { delta: 1800 }));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().camera.distance)).toBeGreaterThan(8);
  return childPath;
}

async function moveRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function screenTargets(page, ids) {
  return page.evaluate((requestedIds) => {
    const targets = new Map(window.spatialLab.state().clusterTargets
      .map((target) => [target.id, target]));
    return Object.fromEntries(requestedIds.map((id) => [id, targets.get(id) || null]));
  }, ids);
}

test('S interval changes same-level screen edge gap without resizing those nodes', async ({ page }) => {
  test.setTimeout(60_000);
  await loadTwoLevelField(page, 'setNestedView');
  await moveRange(page, '#nestedCompactness', 0);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterTargets.length)).toBeGreaterThan(2);
  const before = await screenTargets(page, ['child-a', 'child-b']);
  await moveRange(page, '#nestedCompactness', 100);
  const after = await screenTargets(page, ['child-a', 'child-b']);
  const edgeGap = (targets) => Math.hypot(
    targets['child-b'].x - targets['child-a'].x,
    targets['child-b'].y - targets['child-a'].y
  ) - targets['child-a'].radius - targets['child-b'].radius;
  const relativeRadiusDrift = (beforeRadius, afterRadius) => (
    Math.abs(afterRadius - beforeRadius) / beforeRadius
  );

  expect(edgeGap(after)).toBeGreaterThan(edgeGap(before) + 1);
  expect(relativeRadiusDrift(before['child-a'].radius, after['child-a'].radius)).toBeLessThan(0.01);
  expect(relativeRadiusDrift(before['child-b'].radius, after['child-b'].radius)).toBeLessThan(0.01);
});

test('A child shrink changes child screen radii without resizing the parent-domain peer', async ({ page }) => {
  test.setTimeout(60_000);
  await loadTwoLevelField(page, 'setNestedView');
  await moveRange(page, '#peripheralDepthShrink', 0);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterTargets.length)).toBeGreaterThan(2);
  const before = await screenTargets(page, ['child-a', 'child-b', 'peer-id']);
  await moveRange(page, '#peripheralDepthShrink', 80);
  const after = await screenTargets(page, ['child-a', 'child-b', 'peer-id']);

  expect(after['child-a'].radius).toBeLessThan(before['child-a'].radius * 0.3);
  expect(after['child-b'].radius).toBeLessThan(before['child-b'].radius * 0.3);
  expect(after['peer-id'].radius).toBeCloseTo(before['peer-id'].radius, 4);
});
