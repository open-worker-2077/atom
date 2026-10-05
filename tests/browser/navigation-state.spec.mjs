import { test, expect } from '@playwright/test';
test.setTimeout(90_000);

function child(path, id) {
  let hash = 2166136261;
  for (const c of id) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${path}/${(hash >>> 0).toString(36)}`;
}
const parentPath = child('root', 'parent');
const leftPath = child(parentPath, 'left');
const rightPath = child(parentPath, 'right');
const knowledge = { revision: 1, nodes: [
  ['parent', 'root', '总域', true],
  ['left', parentPath, '左团', true], ['right', parentPath, '右团', true],
  ['l1', leftPath, '左一', false], ['l2', leftPath, '左二', false],
  ['r1', rightPath, '右一', false], ['r2', rightPath, '右二', false]
].map(([id, path, label, hasChildren]) => ({ id, key: `${path}::${id}`, path, label, atomPath: label, hasChildren, detail: '' })), edges: [] };
async function open(page) {
  await page.route('**/__spatial/api/state*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, scope: { path: new URL(route.request().url()).searchParams.get('path') || 'root' }, knowledge }) }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.selectByLabel('总域'))).toBe(true);
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
}
async function enter(page, label, path) {
  await expect.poll(() => page.evaluate(label => window.spatialLab.selectByLabel(label), label)).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('applyImmersiveInwardView'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(path);
  await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state', 'loaded');
  await page.waitForTimeout(600);
}
async function expand(page) {
  const region = await page.evaluate(() => window.spatialLab.state().clusterRegions.find(r => r.path === window.spatialLab.state().path));
  await page.mouse.move(region.clientX, region.clientY);
  await page.locator('canvas').focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths.length)).toBe(3);
  await page.waitForTimeout(600);
}
test('upward navigation removes departed expansions and frames the parent', async ({ page }) => {
  await open(page);
  await enter(page, '总域', parentPath);
  await expand(page);
  await enter(page, '左团', leftPath);
  await page.evaluate(() => window.spatialLab.dispatch('exit'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual([parentPath]);
  await page.evaluate(() => window.spatialLab.dispatch('exit'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe('root');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual(['root']);
  await expect.poll(() => page.evaluate(() => {
    const t = window.spatialLab.state().interactionTargets.find(t => t.label === '总域');
    return t ? Math.hypot(t.clientX - innerWidth / 2, t.clientY - innerHeight / 2) : Infinity;
  })).toBeLessThan(5);
});
test('reload keeps the current domain but clears expansions before fresh descent', async ({ page }) => {
  await open(page);
  await enter(page, '总域', parentPath);
  await expand(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.spatialLab?.state().path)).toBe(parentPath);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual([parentPath]);
  await page.evaluate(() => window.spatialLab.dispatch('exit'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe('root');
  await enter(page, '总域', parentPath);
  expect(await page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual([parentPath]);
});
test('right-click collapse after PageDown centers the resulting carrier', async ({ page }) => {
  await open(page);
  await enter(page, '总域', parentPath);
  await expand(page);
  const point = await page.evaluate(path => {
    const s = window.spatialLab.state();
    const region = s.clusterRegions.find(r => r.path === path);
    for (let i = 0; i < 48; i++) {
      const x = region.clientX + Math.cos(i / 48 * Math.PI * 2) * region.radius * 0.75;
      const y = region.clientY + Math.sin(i / 48 * Math.PI * 2) * region.radius * 0.75;
      if (x > 10 && y > 10 && x < innerWidth - 10 && y < innerHeight - 10
        && !s.interactionTargets.some(t => !t.clusterShellProxy && Math.hypot(x - t.clientX, y - t.clientY) < t.radius + 12)) return { x, y };
    }
    throw new Error('no shell blank found');
  }, leftPath);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(path => window.spatialLab.state().clusterPaths.includes(path), leftPath)).toBe(false);
  expect(await page.evaluate(path => window.spatialLab.state().clusterPaths.includes(path), rightPath)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const t = window.spatialLab.state().interactionTargets.find(t => t.label === '左团' && !t.clusterShellProxy);
    return t ? Math.hypot(t.clientX - innerWidth / 2, t.clientY - innerHeight / 2) : Infinity;
  })).toBeLessThan(5);
});

test('PageUp frames the rebuilt parent after a recently centered child collapse', async ({ page }) => {
  await open(page);
  await enter(page, '总域', parentPath);
  await expand(page);
  await page.evaluate(() => {
    window.spatialLab.selectByLabel('左团');
    window.spatialLab.dispatch('applyInwardView');
  });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths.length)).toBe(2);
  await page.waitForTimeout(600);
  // Reframe the parent with the existing product operation before the next level gesture.
  await page.evaluate(() => window.spatialLab.refitCurrentDomain());
  await page.waitForTimeout(600);
  await page.mouse.move(720, 480);
  await page.locator('canvas').focus();
  await page.keyboard.press('PageUp');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual([parentPath]);
  await expect.poll(() => page.evaluate(() => {
    const s = window.spatialLab.state(), r = s.clusterRegions.find(r => r.path === s.path);
    return r ? Math.hypot(r.clientX - innerWidth / 2, r.clientY - innerHeight / 2) : Infinity;
  })).toBeLessThan(5);
});
