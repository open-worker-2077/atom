import { test, expect } from '@playwright/test';

async function holdRightTarget(page, label) {
  const target = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((candidate) => candidate.label === label);
  expect(target).toBeTruthy();
  await page.mouse.move(target.clientX, target.clientY);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(440);
  await page.mouse.up({ button: 'right' });
}

async function openEditableWorld(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab
    && window.spatialLab.state().visibleNodes > 0
  ));
  if (await page.locator('#helpPanel').isVisible()) {
    await page.locator('[data-close="help"]').click();
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'))).toBe(true);
  await holdRightTarget(page, 'atom.json');
  await page.waitForFunction(() => (
    window.spatialLab.state().phase === 'idle'
    && window.spatialLab.state().transactionActive === false
    && window.spatialLab.state().path !== 'root'
  ));
  await page.waitForFunction(() => window.spatialLab.state().interactionTargets
    .some(({ label }) => label === '测试入口'));
  await holdRightTarget(page, '测试入口');
  await page.waitForFunction(() => window.spatialLab.state().interactionTargets
    .some(({ label }) => label === '第一节点'));
}

test('desktop node edit keeps its local picture and confirms the source within five seconds', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditableWorld(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('第一节点'))).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('editNode'));
  const detail = page.locator('#nodeDetailEditorMount .cm-content');
  await expect(detail).toBeVisible();
  await detail.fill('局部原子编辑已生效');

  await page.locator('#nodeNameEditor').focus();
  const startedAt = Date.now();
  await page.keyboard.press('Enter');
  const status = page.locator('#saveStatus');
  await expect(status).toContainText('已保存', { timeout: 4_500 });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  const localDetail = await page.evaluate(() => (
    window.spatialLab.exportKnowledge().nodes.find((node) => node.label === '第一节点')?.detail
  ));
  expect(localDetail).toBe('局部原子编辑已生效');
});
