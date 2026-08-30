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
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab);
  const childPath = `root/${hashText('parent-id').toString(36)}`;
  await page.evaluate(({ childPath, mode }) => {
    window.spatialLab.importKnowledge({
      nodes: [
        { id: 'parent-id', key: 'root::parent-id', path: 'root', atomPath: '母节点', label: '母节点', detail: '', hasChildren: true, position: { x: -2, y: 0, z: 0 } },
        { id: 'peer-id', key: 'root::peer-id', path: 'root', atomPath: '同层节点', label: '同层节点', detail: '', hasChildren: false, position: { x: 2, y: 0, z: 0 } },
        { id: 'child-a', key: `${childPath}::child-a`, path: childPath, atomPath: '母节点/子节点A', label: '子节点A', detail: '', hasChildren: false, position: { x: -1, y: 0, z: 0 } },
        { id: 'child-b', key: `${childPath}::child-b`, path: childPath, atomPath: '母节点/子节点B', label: '子节点B', detail: '', hasChildren: false, position: { x: 1, y: 0, z: 0 } }
      ],
      edges: []
    });
    window.spatialLab.dispatch(mode);
    window.spatialLab.selectByLabel('母节点');
    window.spatialLab.dispatch('applyViewMode');
  }, { childPath, mode });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(true);
  return childPath;
}

async function moveRange(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('S interval slider immediately rebuilds the visible nested geometry', async ({ page }) => {
  const childPath = await loadTwoLevelField(page, 'setNestedView');
  await moveRange(page, '#nestedCompactness', 0);
  const before = await page.evaluate(() => window.spatialLab.state().clusterGeometry
    .map(({ path, radius }) => ({ path, radius })));
  await moveRange(page, '#nestedCompactness', 100);
  await expect.poll(async () => page.evaluate((before) => {
    const after = window.spatialLab.state().clusterGeometry
      .map(({ path, radius }) => ({ path, radius }));
    return JSON.stringify(after) !== JSON.stringify(before);
  }, before)).toBe(true);
});

test('A child shrink slider immediately changes visible child radii', async ({ page }) => {
  const childPath = await loadTwoLevelField(page, 'setNestedView');
  await moveRange(page, '#peripheralDepthShrink', 0);
  const before = await page.evaluate((path) => window.spatialLab.state().clusterGeometry
    .find((cluster) => cluster.path === path)?.nodeScale, childPath);
  await moveRange(page, '#peripheralDepthShrink', 80);
  await expect.poll(async () => page.evaluate(({ path, before }) => {
    const after = window.spatialLab.state().clusterGeometry
      .find((cluster) => cluster.path === path)?.nodeScale;
    return Number.isFinite(after) && after < before;
  }, { path: childPath, before })).toBe(true);
});
