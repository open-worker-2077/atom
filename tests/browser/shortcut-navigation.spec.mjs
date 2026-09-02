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

test('activating a linked shortcut from A-mode leaves the local entry and enters the target route', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab);
  const parentPath = `root/${hashText('a-mode-target-parent').toString(36)}`;
  await page.evaluate(({ parentPath }) => window.spatialLab.importKnowledge({
    nodes: [
      {
        id: 'a-mode-target-parent', key: 'root::a-mode-target-parent', path: 'root',
        atomPath: '西部', label: '西部', detail: '', hasChildren: true
      },
      {
        id: 'a-mode-target', key: `${parentPath}::a-mode-target`, path: parentPath,
        atomPath: '西部/目标', label: '西部目标', detail: '目标', hasChildren: false
      },
      {
        id: 'a-mode-shortcut', key: 'root::a-mode-shortcut', path: 'root',
        atomPath: '东部入口', label: '东部入口', detail: '', atomTypes: ['shortcut'],
        shortcutTargetPath: '西部/目标', hasChildren: false
      }
    ],
    edges: []
  }), { parentPath });

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('东部入口'))).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('toggleClusterField'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('enter'));

  const targetPath = `${parentPath}/${hashText('a-mode-target').toString(36)}`;
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(targetPath);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(false);
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

test('a progressively loaded shortcut can enter a remote target outside the normal lookahead', async ({ page, request }) => {
  const create = async (params) => {
    const response = await request.post('/__spatial/api/command', {
      data: { method: 'node.create', params }
    });
    expect(response.ok()).toBe(true);
  };
  const westPath = `root/${hashText('remote-west-id').toString(36)}`;
  const districtPath = `${westPath}/${hashText('remote-district-id').toString(36)}`;
  const buildingPath = `${districtPath}/${hashText('remote-building-id').toString(36)}`;
  const roomPath = `${buildingPath}/${hashText('remote-room-id').toString(36)}`;

  await create({
    id: 'remote-west-id', path: 'root', atomPath: '远端西部',
    label: '远端西部', hasChildren: true
  });
  await create({
    id: 'remote-district-id', path: westPath, atomPath: '远端西部/城区',
    label: '城区', hasChildren: true
  });
  await create({
    id: 'remote-building-id', path: districtPath, atomPath: '远端西部/城区/大楼',
    label: '大楼', hasChildren: true
  });
  await create({
    id: 'remote-room-id', path: buildingPath, atomPath: '远端西部/城区/大楼/房间',
    label: '房间', hasChildren: true
  });
  await create({
    id: 'remote-target-id', path: roomPath,
    atomPath: '远端西部/城区/大楼/房间/目标', label: '远端目标'
  });
  await create({
    id: 'remote-shortcut-id', path: 'root', atomPath: '远端快捷入口',
    label: '远端快捷入口', atomTypes: ['shortcut'],
    shortcutTargetPath: '远端西部/城区/大楼/房间/目标'
  });

  await page.goto('/');
  await page.waitForFunction(() => (
    window.spatialLab && document.body.dataset.spatialKnowledge === 'authoritative'
  ));
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('远端快捷入口'))).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('enter'));

  const targetPath = `${roomPath}/${hashText('remote-target-id').toString(36)}`;
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(targetPath);
});
