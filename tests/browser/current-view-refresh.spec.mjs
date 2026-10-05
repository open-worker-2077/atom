import { test, expect } from '@playwright/test';

function childPath(id) {
  let hash = 2166136261;
  for (const c of id) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `root/${(hash >>> 0).toString(36)}`;
}
const groupPath = childPath('reader-parent');
function fixture(detail = '旧正文') {
  return { revision: detail === '旧正文' ? 1 : 2, nodes: [
    { id: 'reader-parent', key: 'root::reader-parent', path: 'root', atomPath: '阅读团', label: '阅读团', detail, hasChildren: true },
    { id: 'reader-child', key: `${groupPath}::reader-child`, path: groupPath, atomPath: '阅读团/内容', label: '内容', detail: '|项目|结果|\n|---|---|\n|验收|通过|', hasChildren: false }
  ], edges: [] };
}
async function open(page) {
  await page.route('**/__spatial/api/state*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, scope: { path: new URL(route.request().url()).searchParams.get('path') || 'root' }, knowledge: fixture() }) }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.selectByLabel('阅读团'))).toBe(true);
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
}
test('fixed selection raw text defaults off and its independent toggle survives reload', async ({ page }) => {
  await open(page);
  await expect(page.locator('#selectionCopy')).toBeHidden();
  await expect(page.locator('#selectionLabel')).toContainText('阅读团');
  await page.locator('#selectionCopyToggle').click();
  await expect(page.locator('#selectionCopy')).toContainText('旧正文');
  await expect(page.locator('#selectionCopy')).toBeVisible();
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.spatialLab?.selectByLabel('阅读团'))).toBe(true);
  await expect(page.locator('#selectionCopy')).toBeVisible();
});
test('F5 restores the current domain and camera instead of opening root', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.spatialLab.dispatch('applyImmersiveInwardView'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(groupPath);
  await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state', 'loaded');
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => ({ path: window.spatialLab.state().path, camera: window.spatialLab.state().camera }));
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.spatialLab?.state().path)).toBe(before.path);
  expect(await page.evaluate(() => window.spatialLab.state().camera)).toEqual(before.camera);
});
test('F5 restores expanded groups with the same camera', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.spatialLab.dispatch('applyInwardView'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths.length)).toBeGreaterThan(1);
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => ({ paths: window.spatialLab.state().clusterPaths, camera: window.spatialLab.state().camera }));
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.spatialLab?.state().clusterPaths)).toEqual(before.paths);
  expect(await page.evaluate(() => window.spatialLab.state().camera)).toEqual(before.camera);
});

test('invalid saved browsing data does not prevent loading the current world', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('atom.browser-view.v1', JSON.stringify({ version: 1,
    snapshot: { path: 'root', crumbs: ['全域'], expandedClusters: [null] } })));
  await open(page);
  await expect(page.locator('body')).toHaveAttribute('data-spatial-bridge', 'connected');
});
