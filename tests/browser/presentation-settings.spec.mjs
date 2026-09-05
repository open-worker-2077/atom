import { test, expect } from '@playwright/test';

const SETTINGS_KEY = 'graph-4d.presentation-settings.v2';
const BACKUP_KEY = 'graph-4d.presentation-settings.pre-shared.v1';

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function twoLevelKnowledge() {
  const childPath = `root/${hashText('parent-id').toString(36)}`;
  return {
    childPath,
    knowledge: {
      revision: 47,
      nodes: [
        { id: 'parent-id', key: 'root::parent-id', path: 'root', atomPath: '母节点', label: '母节点', detail: '', hasChildren: true, position: { x: -2, y: 0, z: 0 } },
        { id: 'peer-id', key: 'root::peer-id', path: 'root', atomPath: '同层节点', label: '同层节点', detail: '', hasChildren: false, position: { x: 1, y: 0, z: 0 } },
        { id: 'child-a', key: `${childPath}::child-a`, path: childPath, atomPath: '母节点/子节点A', label: '子节点A', detail: '', hasChildren: false, position: { x: -1, y: 0, z: 0 } },
        { id: 'child-b', key: `${childPath}::child-b`, path: childPath, atomPath: '母节点/子节点B', label: '子节点B', detail: '', hasChildren: false, position: { x: 1, y: 0, z: 0 } }
      ],
      edges: []
    }
  };
}

async function routeTwoLevelField(page) {
  const fixture = twoLevelKnowledge();
  await page.route('**/__spatial/api/state*', async (route) => {
    const requestUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        scope: { path: requestUrl.searchParams.get('path') || 'root' },
        knowledge: fixture.knowledge
      })
    });
  });
}

async function waitForSharedSettings(page, revision) {
  await page.waitForFunction((expectedRevision) => (
    document.body.dataset.spatialPresentationSettings === 'synced'
    && document.body.dataset.spatialPresentationSettingsRevision === String(expectedRevision)
  ), revision);
}

test('independent mobile context inherits host settings, paints its boundary, and preserves an explicit zero', async ({ browser }) => {
  test.setTimeout(60_000);
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const hostPage = await hostContext.newPage();
    const hostRaw = JSON.stringify({ nestedTunnelPercent: 55, nestedTunnelInteriorPercent: 35 });
    await hostPage.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
      key: SETTINGS_KEY, raw: hostRaw
    });
    await routeTwoLevelField(hostPage);
    await hostPage.goto('/');
    await waitForSharedSettings(hostPage, 1);

    await expect(hostPage.locator('#nestedTunnelStrength')).toHaveValue('55');
    await expect(hostPage.locator('#nestedTunnelInteriorStrength')).toHaveValue('35');
    expect(await hostPage.evaluate((key) => localStorage.getItem(key), BACKUP_KEY)).toBe(hostRaw);

    const mobilePage = await mobileContext.newPage();
    await mobilePage.addInitScript(({ settingsKey }) => {
      localStorage.setItem(settingsKey, JSON.stringify({
        nestedTunnelPercent: 0,
        nestedTunnelInteriorPercent: 0
      }));
      window.__nestedBoundaryStrokes = [];
      const originalStroke = CanvasRenderingContext2D.prototype.stroke;
      CanvasRenderingContext2D.prototype.stroke = function recordedStroke(...args) {
        const style = String(this.strokeStyle);
        if (this.lineWidth === 1 && style.includes('156') && style.includes('225') && style.includes('255')) {
          window.__nestedBoundaryStrokes.push({ style, lineWidth: this.lineWidth });
        }
        return originalStroke.apply(this, args);
      };
    }, { settingsKey: SETTINGS_KEY });
    await routeTwoLevelField(mobilePage);
    await mobilePage.goto('/');
    await waitForSharedSettings(mobilePage, 1);

    await expect(mobilePage.locator('#nestedTunnelStrength')).toHaveValue('55');
    await expect(mobilePage.locator('#nestedTunnelInteriorStrength')).toHaveValue('35');
    await expect(hostPage.locator('#nestedTunnelStrength')).toHaveValue('55');

    await expect.poll(() => mobilePage.evaluate(() => window.spatialLab.state().visibleNodeDescriptors
      .some(({ id }) => id === 'parent-id'))).toBe(true);
    await expect.poll(() => mobilePage.evaluate(() => window.spatialLab.dispatch('setNestedView'))).toBe(true);
    await expect.poll(() => mobilePage.evaluate(() => {
      if (!window.spatialLab.selectByLabel('母节点')) return false;
      window.spatialLab.dispatch('applyViewMode');
      return window.spatialLab.state().clusterFieldOpen;
    })).toBe(true);
    await expect.poll(() => mobilePage.evaluate(() => window.__nestedBoundaryStrokes.some((entry) => {
      const alpha = Number(entry.style.match(/[\d.]+\)$/)?.[0]?.slice(0, -1));
      return entry.lineWidth === 1 && alpha > 0.2;
    }))).toBe(true);

    await mobilePage.locator('#nestedTunnelStrength').evaluate((element) => {
      element.value = '0';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitForSharedSettings(mobilePage, 2);
    const saved = await (await mobilePage.request.get('/__spatial/api/presentation-settings')).json();
    expect(saved.revision).toBe(2);
    expect(saved.settings.nestedTunnelPercent).toBe(0);
    expect(saved.settings.nestedTunnelInteriorPercent).toBe(35);
    await expect(hostPage.locator('#nestedTunnelStrength')).toHaveValue('0');

    await mobilePage.reload();
    await waitForSharedSettings(mobilePage, 2);
    await expect(mobilePage.locator('#nestedTunnelStrength')).toHaveValue('0');
    await expect(mobilePage.locator('#nestedTunnelInteriorStrength')).toHaveValue('35');
  } finally {
    await Promise.all([hostContext.close(), mobileContext.close()]);
  }
});
