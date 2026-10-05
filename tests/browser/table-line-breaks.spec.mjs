import { test, expect } from '@playwright/test';
test.setTimeout(60_000);

async function openReader(page, detail) {
  await page.route('**/__spatial/api/state*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, scope: { path: 'root' }, knowledge: { revision: 1, nodes: [
      { id: 'table-reader', key: 'root::table-reader', path: 'root', atomPath: '换行表格', label: '换行表格', hasChildren: false, detail }
    ], edges: [] } }) }));
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab?.selectByLabel('换行表格'));
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
  const session = await page.context().newCDPSession(page);
  await Promise.all(Array.from({ length: 6 }, (_, i) => session.send('Input.dispatchKeyEvent', {
    type: i % 2 ? 'keyUp' : 'keyDown', key: 'CapsLock', code: 'CapsLock', windowsVirtualKeyCode: 20, nativeVirtualKeyCode: 20
  })));
  await session.detach();
  const target = await page.evaluate(() => window.spatialLab.state().interactionTargets.find(t => t.label === '换行表格'));
  await page.mouse.move(target.clientX, target.clientY);
  await expect(page.locator('#detailMagnifier')).toBeVisible();
  await expect(page.locator('#detailMagnifierContent table')).toBeVisible();
}

test('explicit table cell breaks render as separate lines', async ({ page }) => {
  await openReader(page, '|事项|时间|\n|---|---|\n|甲<br>乙<br/>丙<BR />丁|09:50|');
  const cell = page.locator('#detailMagnifierContent td').first();
  await expect(cell.locator('br')).toHaveCount(3);
  expect(await cell.innerText()).toBe('甲\n乙\n丙\n丁');
});

test('table bullet items display on separate lines while inline code stays literal', async ({ page }) => {
  await openReader(page, '|事项|原文|\n|---|---|\n|●研讨=1 ●排期=1 ●交棒=1|`●甲●乙<br>`|');
  const cells = page.locator('#detailMagnifierContent td');
  expect(await cells.nth(0).innerText()).toBe('●研讨=1\n●排期=1\n●交棒=1');
  await expect(cells.nth(1).locator('br')).toHaveCount(0);
  await expect(cells.nth(1).locator('code')).toHaveText('●甲●乙<br>');
});

test('table wrapping keeps short time values whole and wraps long prose', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await openReader(page, '|冲程|事项目标|衔接起点|人时预算|实际人时|实际衔接|实际结果|偏差反馈|\n|---|---|---|---|---|---|---|---|\n|职务|'
    + '这是需要按列宽换行的连续事项说明'.repeat(12) + '|09:50|02:00|01:30|10:00|'
    + '这是需要按列宽换行的实绩说明'.repeat(10) + '|待接续|');
  const layout = await page.locator('#detailMagnifierContent tbody tr').evaluate(row => {
    const cells = [...row.cells];
    const lines = cell => { const range = document.createRange(); range.selectNodeContents(cell); return range.getClientRects().length; };
    return { timeLines: lines(cells[2]), proseLines: lines(cells[1]) };
  });
  expect(layout.timeLines).toBe(1);
  expect(layout.proseLines).toBeGreaterThan(1);
});

test('supporting cell breaks does not execute raw HTML or turn code into markup', async ({ page }) => {
  await openReader(page, '|事项|\n|---|\n|甲<br onclick="window.tableInjected=1">乙<img src=x onerror="window.tableInjected=1">`<br>`|');
  const cell = page.locator('#detailMagnifierContent td');
  await expect(cell.locator('img,script,br')).toHaveCount(0);
  await expect(cell.locator('code')).toHaveText('<br>');
  expect(await page.evaluate(() => window.tableInjected)).toBeUndefined();
});


test('table breaks compose with emphasis and links without adding empty lines', async ({ page }) => {
  await openReader(page, '|事项|\n|---|\n|●**研讨**=1<br>●[排期](https://example.com)=1 ●交棒=1|');
  const cell = page.locator('#detailMagnifierContent td');
  expect(await cell.innerText()).toBe('●研讨=1\n●排期=1\n●交棒=1');
  await expect(cell.locator('br')).toHaveCount(2);
  await expect(cell.locator('strong')).toHaveText('研讨');
  await expect(cell.locator('a')).toHaveAttribute('href', 'https://example.com');
  const outside = await page.evaluate(() => window.SpatialMarkdownEditor.renderMarkdown('●甲 ●乙<br>丙'));
  expect(outside).not.toContain('<br>');
});
