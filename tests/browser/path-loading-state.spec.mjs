import { test, expect } from '@playwright/test';

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

test('a newly entered scope stays visibly loading and non-editable until its state arrives', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-spatial-knowledge', 'authoritative');

  const childPath = `root/${hashText('parent-id').toString(36)}`;
  await page.route(`**/__spatial/api/state?path=${encodeURIComponent(childPath)}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        scope: { path: childPath },
        knowledge: { revision: 1, nodes: [], edges: [] }
      })
    });
  });

  await page.evaluate(() => {
    window.spatialLab.importKnowledge({
      revision: 1,
      nodes: [{
        id: 'parent-id', key: 'root::parent-id', path: 'root', atomPath: '母节点',
        label: '母节点', detail: '', hasChildren: true, position: { x: 0, y: 0, z: 0 }
      }],
      edges: []
    });
    window.spatialLab.dispatch('setImmersiveView');
    window.spatialLab.selectByLabel('母节点');
    window.spatialLab.dispatch('applyViewMode');
  });

  await expect(page.locator('#scopeLoadState')).toBeVisible();
  await expect(page.locator('#scopeLoadState')).toContainText('正在加载');
  await expect.poll(() => page.evaluate(() => window.spatialLab.dispatch('createNode'))).toBe(false);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionActive)).toBe(false);

  await expect(page.locator('#scopeLoadState')).toContainText('已加载，当前节点没有子内容');
  await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state', 'loaded-empty');
});

for (const entry of [
  { label: 'normal desktop', immersive: false, viewport: { width: 1440, height: 960 } },
  { label: 'F desktop', immersive: true, viewport: { width: 1440, height: 960 } },
  { label: 'normal mobile', immersive: false, viewport: { width: 390, height: 844 } },
  { label: 'F mobile', immersive: true, viewport: { width: 390, height: 844 } }
]) {
  test(`${entry.label} return restores the cached parent field and clears child empty state`, async ({ page }) => {
    await page.setViewportSize(entry.viewport);
    await page.goto('/');
    await expect(page.locator('body')).toHaveAttribute('data-spatial-knowledge', 'authoritative');

    await page.evaluate(({ immersive }) => {
      window.spatialLab.importKnowledge({
        revision: 1,
        nodes: [{
          id: 'parent-id', key: 'root::parent-id', path: 'root', atomPath: '母节点',
          label: '母节点', detail: '', hasChildren: true, position: { x: 0, y: 0, z: 0 }
        }],
        edges: []
      });
      window.spatialLab.setScopeLoadState('root', 'loaded');
      window.spatialLab.selectByLabel('母节点');
      if (immersive) {
        window.spatialLab.dispatch('setImmersiveView');
        window.spatialLab.dispatch('applyViewMode');
      } else {
        window.spatialLab.dispatch('enter');
      }
    }, { immersive: entry.immersive });

    await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe('root');
    await page.evaluate(() => window.spatialLab.setScopeLoadState(window.spatialLab.state().path, 'loaded'));
    await expect(page.locator('#scopeLoadState')).toContainText('已加载，当前节点没有子内容');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.spatialLab.dispatch('exit'));

    await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe('root');
    await expect.poll(() => page.evaluate(() => window.spatialLab.state().visibleNodes)).toBeGreaterThan(0);
    await expect(page.locator('#scopeLoadState')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state', 'loaded');
  });
}

test('a failed current scope stays explicit and rejects editing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-spatial-knowledge', 'authoritative');

  await page.evaluate(() => window.spatialLab.setScopeLoadState('root', 'failed', { message: '测试故障' }));
  await expect(page.locator('#scopeLoadState')).toContainText('加载失败');
  await expect(page.locator('#scopeLoadState')).toContainText('测试故障');
  await expect.poll(() => page.evaluate(() => window.spatialLab.dispatch('createNode'))).toBe(false);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionActive)).toBe(false);
});
