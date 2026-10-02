import { test, expect } from '@playwright/test';

function childPath(id) {
  let hash = 2166136261;
  for (const character of id) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `root/${(hash >>> 0).toString(36)}`;
}

test('CapsLock fulltext reads a node and its dissected group while middle click frames that group', async ({ page }) => {
  test.setTimeout(90_000);
  const groupPath = childPath('fulltext-group');
  const knowledge = { revision: 1, nodes: [
    { id: 'fulltext-group', key: 'root::fulltext-group', path: 'root', atomPath: '正文团',
      label: '正文团', detail: '# 团的全文\n\n团正文验收内容', hasChildren: true },
    { id: 'fulltext-left', key: `${groupPath}::fulltext-left`, path: groupPath, atomPath: '正文团/左节点',
      label: '左节点', detail: '左节点全文', hasChildren: false },
    { id: 'fulltext-right', key: `${groupPath}::fulltext-right`, path: groupPath, atomPath: '正文团/右节点',
      label: '右节点', detail: '右节点全文', hasChildren: false }
  ], edges: [] };
  await page.route('**/__spatial/api/state?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || 'root';
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, scope: { path }, knowledge }) });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab?.state().interactionTargets.some(({ label }) => label === '正文团'));
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
  const target = await page.evaluate(() => window.spatialLab.state().interactionTargets.find(({ label }) => label === '正文团'));
  for (let i = 0; i < 3; i++) await page.keyboard.press('CapsLock');
  await page.mouse.move(target.clientX, target.clientY);
  await expect(page.locator('#detailMagnifierContent')).toContainText('团正文验收内容');
  // Close the reader before opening the node, then turn it on again over its shell.
  for (let i = 0; i < 3; i++) await page.keyboard.press('CapsLock');
  await page.mouse.click(target.clientX, target.clientY, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().interactionTargets
    .some(({ label, clusterShellProxy }) => label === '正文团' && clusterShellProxy))).toBe(true);
  await page.waitForTimeout(450);
  const blank = await page.evaluate(() => {
    const targets = window.spatialLab.state().interactionTargets;
    const shell = targets.find(({ label, clusterShellProxy }) => label === '正文团' && clusterShellProxy);
    const concrete = targets.filter(({ clusterShellProxy }) => !clusterShellProxy);
    const rect = document.querySelector('#spaceCanvas').getBoundingClientRect();
    for (let y = shell.y - shell.radius; y < shell.y + shell.radius; y += 6) {
      for (let x = shell.x - shell.radius; x < shell.x + shell.radius; x += 6) {
        if (Math.hypot(x - shell.x, y - shell.y) > shell.radius * 0.6) continue;
        if (concrete.some((target) => Math.hypot(x - target.x, y - target.y) <= target.radius * 1.2)) continue;
        if (document.elementFromPoint(x + rect.left, y + rect.top)?.id !== 'spaceCanvas') continue;
        return { x: x + rect.left, y: y + rect.top };
      }
    }
    return null;
  });
  expect(blank).toBeTruthy();
  for (let i = 0; i < 3; i++) await page.keyboard.press('CapsLock');
  await page.mouse.move(blank.x, blank.y);
  await expect(page.locator('#detailMagnifierTitle')).toContainText('正文团');
  await expect(page.locator('#detailMagnifierContent')).toContainText('团正文验收内容');
  for (let i = 0; i < 3; i++) await page.keyboard.press('CapsLock');
  await page.mouse.click(blank.x, blank.y, { button: 'middle' });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().selected)).toBe('fulltext-group');
  expect(await page.evaluate(() => window.spatialLab.state().clusterPaths)).toContain(groupPath);
});
