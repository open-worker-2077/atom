import { test, expect } from '@playwright/test';

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

test('activating a linked shortcut enters the target domain instead of its local static path', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab);
  await page.evaluate(() => window.spatialLab.importKnowledge({
    nodes: [
      {
        id: 'target-id', key: 'root::target-id', path: 'root', atomPath: '合成目标',
        label: '合成目标', detail: '目标', hasChildren: false
      },
      {
        id: 'shortcut-id', key: 'root::shortcut-id', path: 'root', atomPath: '合成入口',
        label: '合成入口', detail: '', atomTypes: ['shortcut'], hasChildren: false,
        shortcutTargetPath: '合成目标'
      }
    ],
    edges: []
  }));

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('合成入口'))).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('enter'));

  const targetPath = `root/${hashText('target-id').toString(36)}`;
  const shortcutPath = `root/${hashText('shortcut-id').toString(36)}`;
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(targetPath);
  expect(await page.evaluate(() => window.spatialLab.state().path)).not.toBe(shortcutPath);
});

test('activating a linked shortcut reconstructs an unvisited deep target route', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab);
  const parentPath = `root/${hashText('parent-id').toString(36)}`;
  await page.evaluate(({ parentPath }) => window.spatialLab.importKnowledge({
    nodes: [
      {
        id: 'parent-id', key: 'root::parent-id', path: 'root', atomPath: '合成容器',
        label: '合成容器', detail: '', hasChildren: true
      },
      {
        id: 'target-id', key: `${parentPath}::target-id`, path: parentPath,
        atomPath: '合成容器/合成目标', label: '合成目标', detail: '目标', hasChildren: false
      },
      {
        id: 'shortcut-id', key: 'root::shortcut-id', path: 'root', atomPath: '深层合成入口',
        label: '深层合成入口', detail: '', atomTypes: ['shortcut'], hasChildren: false,
        shortcutTargetPath: '合成容器/合成目标'
      }
    ],
    edges: []
  }), { parentPath });

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('深层合成入口'))).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('enter'));

  const targetPath = `${parentPath}/${hashText('target-id').toString(36)}`;
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(targetPath);
});

test('a broken shortcut stays in place and reports the failure', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab);
  await page.evaluate(() => window.spatialLab.importKnowledge({
    nodes: [{
      id: 'shortcut-id', key: 'root::shortcut-id', path: 'root', atomPath: '失效入口',
      label: '失效入口', detail: '', atomTypes: ['shortcut'], hasChildren: false,
      shortcutTargetPath: '不存在的目标'
    }],
    edges: []
  }));

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('失效入口'))).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('enter'));

  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe('root');
  await expect(page.locator('#ariaLive')).toContainText('快捷目标不可用');
});
