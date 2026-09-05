import { test, expect } from '@playwright/test';

async function openEditableWorld(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab
    && window.spatialLab.state().visibleNodes > 0
  ));
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await page.waitForFunction(() => (
    window.spatialLab.state().phase === 'idle'
    && window.spatialLab.state().transactionActive === false
    && window.spatialLab.state().path !== 'root'
  ));
}

async function beginNodeCreation(page, label) {
  await page.evaluate(() => window.spatialLab.dispatch('createNode', {
    point: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.52 }
  }));
  const name = page.locator('#nodeNameEditor');
  await expect(name).toBeVisible();
  await name.fill(label);
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

test('mobile Save gives visible in-progress feedback within five seconds and reports success', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const responseGate = deferred();
  await page.route('**/__atom/api/workspace-edit', async (route) => {
    await responseGate.promise;
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({
      response,
      json: {
        ...payload,
        result: {
          ...payload.result,
          projectionStatus: 'published'
        }
      }
    });
  });
  await openEditableWorld(page);
  await beginNodeCreation(page, '移动保存反馈');

  const startedAt = Date.now();
  await page.locator('[data-mobile-key="Enter"]').click();
  const status = page.locator('#saveStatus');
  await expect(status).toBeVisible({ timeout: 4_500 });
  await expect(status).toContainText('正在保存');
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  const mobileBounds = await status.boundingBox();
  expect(mobileBounds).toBeTruthy();
  expect(mobileBounds.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds.x + mobileBounds.width).toBeLessThanOrEqual(390);

  responseGate.resolve();
  await expect(status).toContainText('已保存');
  await expect(status).toHaveAttribute('data-state', 'success');
});

test('desktop Save reports a visible persistence failure without blocking the workspace', async ({ page }) => {
  test.setTimeout(60_000);
  const responseGate = deferred();
  await page.route('**/__atom/api/workspace-edit', async (route) => {
    await responseGate.promise;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: { ok: false, errors: [{ message: '受控保存失败' }] }
      })
    });
  });
  await openEditableWorld(page);
  await beginNodeCreation(page, '桌面保存失败反馈');

  await page.locator('#nodeNameEditor').press('Enter');
  const status = page.locator('#saveStatus');
  await expect(status).toBeVisible({ timeout: 4_500 });
  await expect(status).toContainText('正在保存');
  responseGate.resolve();

  await expect(status).toContainText('保存失败，已恢复保存前内容：受控保存失败');
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#spaceCanvas')).toBeVisible();
});

test('projection-pending feedback stays truthful when an older receipt arrives later', async ({ page }) => {
  test.setTimeout(60_000);
  const responseGate = deferred();
  await page.route('**/__atom/api/workspace-edit', async (route) => {
    await responseGate.promise;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        result: {
          ok: true,
          projectionStatus: 'pending',
          projectionRecovery: { expectedRevision: 19 },
          projectionFailure: { message: '受控投影延迟' }
        }
      })
    });
  });
  await openEditableWorld(page);
  await page.evaluate(() => {
    window.__latestSavePersistenceId = null;
    window.addEventListener('spatial-workspace-committed', (event) => {
      if (Number.isFinite(Number(event.detail?.persistenceId))) {
        window.__latestSavePersistenceId = Number(event.detail.persistenceId);
      }
    });
  });
  await beginNodeCreation(page, '投影待恢复反馈');

  await page.locator('#nodeNameEditor').press('Enter');
  const status = page.locator('#saveStatus');
  await expect(status).toBeVisible({ timeout: 4_500 });
  await expect(status).toContainText('正在保存');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('spatial-workspace-persist-failed', {
      detail: {
        persistenceId: window.__latestSavePersistenceId - 1,
        message: '过期失败回执'
      }
    }));
  });
  await expect(status).toContainText('正在保存');
  await expect(status).toHaveAttribute('data-state', 'saving');
  responseGate.resolve();

  await expect(status).toContainText('事实已保存，派生投影待恢复');
  await expect(status).toHaveAttribute('data-state', 'pending');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('spatial-workspace-persisted', {
      detail: {
        persistenceId: window.__latestSavePersistenceId - 1,
        operation: { kind: 'node-edit' }
      }
    }));
  });
  await expect(status).toContainText('事实已保存，派生投影待恢复');
  await expect(status).toHaveAttribute('data-state', 'pending');
});
