import { test, expect } from '@playwright/test';

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function openIsolatedWorld(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab
    && window.spatialLab.state().visibleNodes > 0
  ));
}

async function waitForViewToSettle(page, { allowTransaction = false } = {}) {
  await page.waitForFunction((transactionMayRemainActive) => {
    const state = window.spatialLab.state();
    return state.phase === 'idle' && (transactionMayRemainActive || state.transactionActive === false);
  }, allowTransaction);
  await page.waitForTimeout(550);
}

async function enterAtomFile(page, options) {
  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'));
  expect(selected).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page, options);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe('root');
}

test('A-mode double-click activates the visible child instead of its selected outer carrier', async ({ page }) => {
  const parentPath = `root/${hashText('overlap-parent-id').toString(36)}`;
  const knowledge = {
    revision: 1,
    nodes: [
      {
        id: 'overlap-parent-id', key: 'root::overlap-parent-id', path: 'root',
        atomPath: '外层', label: '外层', detail: '', hasChildren: true
      },
      {
        id: 'overlap-child-id', key: `${parentPath}::overlap-child-id`, path: parentPath,
        atomPath: '外层/内层目标', label: '内层目标', detail: '', hasChildren: false
      }
    ],
    edges: []
  };
  await page.route('**/__spatial/api/state?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, scope: { path: 'root' }, knowledge })
  }));
  await page.goto('/');
  await page.waitForFunction(() => (
    window.spatialLab
    && document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab.state().visibleNodeDescriptors.some(({ label }) => label === '外层')
  ));

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('外层'))).toBe(true);
  await page.keyboard.press('a');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(true);
  const readChild = () => page.evaluate(() => (
    window.spatialLab.state().interactionTargets.find(({ label }) => label === '内层目标')
  ));
  await expect.poll(readChild).toBeTruthy();
  const child = await readChild();
  expect(child).toBeTruthy();
  await page.evaluate(() => {
    window.__activationTargets = [];
    window.addEventListener('spatial-visual-intent', (event) => {
      if (event.detail && event.detail.intent === 'activate') {
        window.__activationTargets.push(event.detail.targetId);
      }
    });
  });

  await page.mouse.dblclick(child.clientX, child.clientY);

  await expect.poll(() => page.evaluate(() => window.__activationTargets.at(-1)))
    .toBe('overlap-child-id');
});

test('F-mode enters a visible nested node through its real owner route', async ({ page }) => {
  const workPath = `root/${hashText('work-id').toString(36)}`;
  const personalPath = `${workPath}/${hashText('personal-id').toString(36)}`;
  const knowledge = {
    revision: 1,
    nodes: [
      {
        id: 'work-id', key: 'root::work-id', path: 'root', atomPath: '办包',
        label: '办包', detail: '', hasChildren: true
      },
      {
        id: 'personal-id', key: `${workPath}::personal-id`, path: workPath,
        atomPath: '办包/个务', label: '个务', detail: '', hasChildren: true
      },
      {
        id: 'inside-id', key: `${personalPath}::inside-id`, path: personalPath,
        atomPath: '办包/个务/内部事项', label: '内部事项', detail: '', hasChildren: false
      }
    ],
    edges: []
  };
  await page.route('**/__spatial/api/state?*', (route) => {
    const requestedPath = new URL(route.request().url()).searchParams.get('path') || 'root';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, scope: { path: requestedPath }, knowledge })
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.spatialLab?.state().visibleNodeDescriptors
    .some(({ label }) => label === '办包'));
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('办包'))).toBe(true);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('nested');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().interactionTargets
    .some(({ label }) => label === '个务'))).toBe(true);
  const personal = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find(({ label }) => label === '个务');

  await page.keyboard.press('f');
  await page.mouse.click(personal.clientX, personal.clientY, { button: 'right' });

  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(personalPath);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors
    .map(({ label }) => label))).toContain('内部事项');
  await waitForViewToSettle(page);
  await page.locator('#settingsAction').click();
  const parentAction = page.getByRole('button', { name: '上层' });
  await expect(parentAction).toBeEnabled();
  await parentAction.click({ force: true });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(workPath);
});

test('first domain entry renders its authoritative child nodes on the next visual frame', async ({ page }) => {
  await openIsolatedWorld(page);
  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'));
  expect(selected).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));

  const firstFrame = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => resolve(window.spatialLab.state()));
  }));
  expect(firstFrame.path).not.toBe('root');
  expect(firstFrame.visibleNodeDescriptors.map(({ label }) => label)).toEqual(expect.arrayContaining([
    '测试入口',
    '批量目标',
    '深层导航入口',
    '顶层参照'
  ]));
});

test('rapid consecutive domain entry renders the second domain on its first visual frame', async ({ page }) => {
  await openIsolatedWorld(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe('root');

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  const firstFrame = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => resolve(window.spatialLab.state()));
  }));

  expect(firstFrame.visibleNodeDescriptors.length).toBeGreaterThan(0);
});

test('Web help renders work-order actions, errors, and receipt fields from the shared registry endpoint', async ({ page }) => {
  await openIsolatedWorld(page);
  await page.keyboard.press('h');
  const panel = page.locator('#workOrderRegistryHelp');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(panel).toContainText('工单 v1');
  const comparison = await page.evaluate(async () => {
    const payload = await fetch('/__atom/api/work-order-registry').then((response) => response.json());
    const version = payload.result.templates[0].versions[0];
    const mount = document.getElementById('workOrderRegistryHelp');
    return {
      endpointActions: version.actions.map((action) => action.id),
      renderedActions: [...mount.querySelectorAll('[data-work-order-action]')]
        .map((element) => element.dataset.workOrderAction),
      endpointErrors: version.errors.map((error) => error.code),
      renderedErrors: [...mount.querySelectorAll('[data-work-order-error]')]
        .map((element) => element.dataset.workOrderError),
      endpointReceipt: version.commitReceipt.required,
      renderedReceipt: mount.querySelector('[data-work-order-receipt]').dataset.workOrderReceipt.split(',')
    };
  });
  expect(comparison.renderedActions).toEqual(comparison.endpointActions);
  expect(comparison.renderedErrors).toEqual(comparison.endpointErrors);
  expect(comparison.renderedReceipt).toEqual(comparison.endpointReceipt);
});

test('F entry keeps every intended child node inside the rendered viewport', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);

  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'));
  expect(selected).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);

  const result = await page.evaluate(() => ({
    state: window.spatialLab.state(),
    field: window.spatialLab.exportField()
  }));
  expect(result.state.viewMode).toBe('immersive');
  expect(result.field.nodes).toHaveLength(8);
  expect(result.state.visibleNodeDescriptors.map(({ label }) => label).sort())
    .toEqual(result.field.nodes.map(({ label }) => label).sort());
});

test('searching a deep portal enters its child domain so the target is actionable', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  const parentPath = await page.evaluate(() => window.spatialLab.state().path);

  await page.locator('[data-ui="search"]').click();
  await page.locator('#spatialSearch').fill('深层导航入口');
  await page.locator('.search-result').first().click();

  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(parentPath);
  await expect.poll(() => page.evaluate(() => (
    window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)
  ))).toContain('深层可点击目标');
});

test('Enter-committed node creation stays visible and preserves the current view after authority replies', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  const before = await page.evaluate(() => window.spatialLab.state());

  await page.evaluate(() => window.spatialLab.dispatch('createNode', {
    point: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.52 }
  }));
  const name = page.locator('#nodeNameEditor');
  await expect(name).toBeVisible();
  await name.fill('浏览器验收节点');
  await name.press('Enter');

  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab.state().transactionActive === false
    && window.spatialLab.exportKnowledge().nodes.some(({ label }) => label === '浏览器验收节点')
  ));
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => ({
    state: window.spatialLab.state(),
    labels: window.spatialLab.exportKnowledge().nodes.map(({ label }) => label)
  }));
  expect(after.labels).toContain('浏览器验收节点');
  expect(after.state.visibleNodeDescriptors.map(({ label }) => label)).toContain('浏览器验收节点');
  expect(after.state.path).toBe(before.path);
  expect(after.state.viewMode).toBe(before.viewMode);
  expect(after.state.camera).toEqual(before.camera);
});

test('TC-I24-CLI-WEB-LOCAL-FRESHNESS keeps the open page and F5 on the CLI value', async ({ page, request }) => {
  test.setTimeout(60_000);
  const atomPath = '测试入口/第一节点';
  const beforeDetail = '用于检查视角稳定';
  const cliDetail = 'CLI 刷新后的正文';
  const readDetail = () => page.evaluate((expectedPath) => (
    window.spatialLab.exportKnowledge().nodes.find(({ atomPath }) => atomPath === expectedPath)?.detail
  ), atomPath);

  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await readDetail()).toBe(beforeDetail);

  const response = await request.post('/__atom/api/command', {
    data: {
      source: `transform {"thing":"${atomPath}","situation.rep.${cliDetail}"}`,
      interaction: {
        id: 'cli-web-browser-local-freshness',
        agentSelector: '测试入口',
        agent: { path: '测试入口' }
      },
      history: []
    }
  });
  const receipt = await response.json();
  expect({ status: response.status(), receipt }).toMatchObject({
    status: 200,
    receipt: { ok: true, result: { ok: true } }
  });

  await expect.poll(readDetail, { timeout: 20_000 }).toBe(cliDetail);

  await page.reload();
  await page.waitForFunction(() => (
    document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab
    && window.spatialLab.state().visibleNodes > 0
  ));
  await enterAtomFile(page);
  await expect.poll(readDetail, { timeout: 20_000 }).toBe(cliDetail);
});

test('a CLI revision preserves the complete expanded scene instead of mixing old and partial scopes', async ({ page, request }) => {
  test.setTimeout(60_000);
  const atomPath = '测试入口/第一节点';
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await page.keyboard.press('a');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.exportField().expandedPaths.length))
    .toBeGreaterThan(0);
  await page.waitForTimeout(700);

  const before = await page.evaluate(() => ({
    camera: window.spatialLab.state().camera,
    expandedPaths: window.spatialLab.exportField().expandedPaths,
    targets: window.spatialLab.state().interactionTargets.map(({ key, label, clientX, clientY }) => ({
      key, label, clientX, clientY
    }))
  }));
  const response = await request.post('/__atom/api/command', {
    data: {
      source: `transform {"thing":"${atomPath}","situation.rep.CLI 场景连续性"}`,
      interaction: {
        id: 'cli-web-expanded-scene-continuity',
        agentSelector: '测试入口',
        agent: { path: '测试入口' }
      },
      history: []
    }
  });
  expect(response.status()).toBe(200);
  await expect.poll(() => page.evaluate((expectedPath) => (
    window.spatialLab.exportKnowledge().nodes.find(({ atomPath: actual }) => actual === expectedPath)?.detail
  ), atomPath), { timeout: 20_000 }).toBe('CLI 场景连续性');
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => ({
    camera: window.spatialLab.state().camera,
    expandedPaths: window.spatialLab.exportField().expandedPaths,
    targets: window.spatialLab.state().interactionTargets.map(({ key, label, clientX, clientY }) => ({
      key, label, clientX, clientY
    }))
  }));
  expect(after.expandedPaths).toEqual(before.expandedPaths);
  expect(after.camera).toEqual(before.camera);
  const beforeByKey = new Map(before.targets.map((target) => [target.key, target]));
  for (const target of after.targets) {
    const prior = beforeByKey.get(target.key);
    if (!prior) continue;
    expect(Math.hypot(target.clientX - prior.clientX, target.clientY - prior.clientY)).toBeLessThan(1);
  }
  expect(after.targets.length).toBe(before.targets.length);
});

test('double-Shift selection survives the real ctrl-right landing gesture as one batch', async ({ page }) => {
  test.setTimeout(90_000);
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  await page.keyboard.press('a');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('nested');

  const targets = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .filter(({ label }) => label !== '批量目标');
  expect(targets.length).toBeGreaterThan(1);
  const source = targets[0];

  await page.mouse.click(source.clientX, source.clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().latestInteractionKey))
    .toBe(source.key);
  await page.keyboard.press('Shift');
  const firstShift = await page.evaluate(() => ({ ...window.spatialLab.state(), now: performance.now() }));
  await page.waitForTimeout(90);
  await page.keyboard.press('Shift');
  const secondShift = await page.evaluate(() => ({ ...window.spatialLab.state(), now: performance.now() }));
  expect(firstShift.shiftTapCount).toBe(1);
  expect(secondShift.shiftTapCount, JSON.stringify({ firstShift, secondShift })).toBe(2);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount))
    .toBeGreaterThan(1);

  await page.keyboard.down('Control');
  await page.mouse.click(source.clientX, source.clientY, { button: 'right' });
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionBatchCount))
    .toBeGreaterThan(1);

  const persisted = page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('spatial-workspace-persisted', (event) => resolve(event.detail), { once: true });
  }));
  const sourcePath = await page.evaluate(() => window.spatialLab.state().path);
  await page.getByRole('button', { name: '上层' }).click();
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(sourcePath);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('immersive');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)))
    .toContain('目标占位');
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');

  const detail = await persisted;
  const operation = detail.operation;
  expect(operation.kind).toBe('node-land-batch');
  expect(operation.landings).toHaveLength(targets.length);
  const movedPaths = detail.knowledge.nodes
    .filter(({ label }) => targets.some((target) => target.label === label))
    .map(({ atomPath }) => atomPath);
  expect(movedPaths).toHaveLength(targets.length);
  expect(movedPaths.every((atomPath) => atomPath.startsWith('批量目标/'))).toBe(true);
});

test('single Web landing is authoritative, survives F5, and leaves no source copy', async ({ page }) => {
  test.setTimeout(90_000);
  const label = '单节点搬移验收';
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);

  await page.evaluate(() => window.spatialLab.dispatch('createNode', {
    point: { x: window.innerWidth * 0.58, y: window.innerHeight * 0.52 }
  }));
  const name = page.locator('#nodeNameEditor');
  await expect(name).toBeVisible();
  await name.fill(label);
  await name.press('Enter');
  await expect.poll(() => page.evaluate((expected) => (
    window.spatialLab.state().visibleNodeDescriptors.some(({ label: actual }) => actual === expected)
  ), label)).toBe(true);

  const sourcePath = await page.evaluate(() => window.spatialLab.state().path);
  const source = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((entry) => entry.label === label);
  expect(source).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.click(source.clientX, source.clientY, { button: 'right' });
  await page.keyboard.up('Control');

  await page.getByRole('button', { name: '上层' }).click();
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(sourcePath);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().phase)).toBe('idle');
  await page.waitForTimeout(550);
  const targetPath = await page.evaluate(() => window.spatialLab.state().path);

  const persisted = page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('spatial-workspace-persisted', (event) => resolve(event.detail), { once: true });
  }));
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  const receipt = await persisted;
  expect(receipt.operation.kind).toBe('node-land');

  const authoritative = await page.evaluate(async ({ expectedLabel, expectedSource, expectedTarget }) => {
    const payload = await fetch('/__spatial/api/state').then((response) => response.json());
    const matching = payload.knowledge.nodes.filter(({ label }) => label === expectedLabel);
    return {
      total: matching.length,
      source: matching.filter(({ path }) => path === expectedSource).length,
      target: matching.filter(({ path }) => path === expectedTarget).length
    };
  }, { expectedLabel: label, expectedSource: sourcePath, expectedTarget: targetPath });
  expect(authoritative).toEqual({ total: 1, source: 0, target: 1 });

  await page.reload();
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  await expect.poll(() => page.evaluate((expected) => (
    window.spatialLab.state().visibleNodeDescriptors.filter(({ label: actual }) => actual === expected).length
  ), label)).toBe(1);

  await page.getByRole('button', { name: '上层' }).click();
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  expect(await page.evaluate((expected) => (
    window.spatialLab.state().visibleNodeDescriptors.some(({ label: actual }) => actual === expected)
  ), label)).toBe(false);
});

test('TC-I24-WEB-MOVE-PERSISTENCE moves the whole work subtree to the exact nested destination', async ({ page }) => {
  test.setTimeout(120_000);
  const label = 'work';
  const workspaceRequests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/__atom/api/workspace-edit')) {
      workspaceRequests.push(request.postDataJSON());
    }
  });

  await openIsolatedWorld(page);
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page);
  }

  const sourcePath = await page.evaluate(() => window.spatialLab.state().path);
  const source = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((entry) => entry.label === label);
  expect(source).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.click(source.clientX, source.clientY, { button: 'right' });
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionActive)).toBe(true);

  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe('root');
  await enterAtomFile(page, { allowTransaction: true });
  for (const portal of ['🧊manage', '办包', '究谋', '个务', '外务', '推进']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page, { allowTransaction: true });
  }
  const targetPath = await page.evaluate(() => window.spatialLab.state().path);

  const persisted = page.evaluate(() => new Promise((resolve) => {
    window.addEventListener('spatial-workspace-persisted', (event) => resolve(event.detail), { once: true });
  }));
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  await persisted;

  expect(workspaceRequests.filter(({ operation }) => operation?.kind === 'node-land')).toHaveLength(1);
  const authoritative = await page.evaluate(async ({ expectedLabel, expectedSource, expectedTarget }) => {
    const payload = await fetch('/__spatial/api/state').then((response) => response.json());
    const matching = payload.knowledge.nodes.filter(({ label }) => label === expectedLabel);
    const child = payload.knowledge.nodes.filter(({ label }) => label === 'test');
    return {
      total: matching.length,
      source: matching.filter(({ path }) => path === expectedSource).length,
      target: matching.filter(({ path }) => path === expectedTarget).length,
      workAtomPath: matching[0]?.atomPath,
      childAtomPath: child[0]?.atomPath
    };
  }, { expectedLabel: label, expectedSource: sourcePath, expectedTarget: targetPath });
  expect(authoritative).toMatchObject({
    total: 1,
    source: 0,
    target: 1,
    workAtomPath: '🧊manage/办包/究谋/个务/外务/推进/work',
    childAtomPath: '🧊manage/办包/究谋/个务/外务/推进/work/test'
  });

  await page.reload();
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '办包', '究谋', '个务', '外务', '推进']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('work'))).toBe(true);
  await page.keyboard.press('Home');
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('work'))).toBe(false);
});

test('TC-I24-WEB-MOVE-ATOMIC-ROLLBACK restores the source atom and view without a target copy', async ({ page }) => {
  test.setTimeout(120_000);
  const label = '回滚work';
  const persistenceEvents = { failed: [], persisted: [] };

  await openIsolatedWorld(page);
  await page.evaluate((events) => {
    window.addEventListener('spatial-workspace-persist-failed', (event) => {
      events.failed.push(event.detail);
    });
    window.addEventListener('spatial-workspace-persisted', (event) => {
      events.persisted.push(event.detail);
    });
    window.__landingPersistenceEvents = events;
  }, persistenceEvents);
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page);
  }

  const sourcePath = await page.evaluate(() => window.spatialLab.state().path);
  const source = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((entry) => entry.label === label);
  expect(source).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.click(source.clientX, source.clientY, { button: 'right' });
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionActive)).toBe(true);

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page, { allowTransaction: true });
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚test'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page, { allowTransaction: true });
  const targetPath = await page.evaluate(() => window.spatialLab.state().path);

  const workspaceResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/__atom/api/workspace-edit')
  ));
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');

  await expect(page.locator('#ariaLive')).toContainText('保存失败，已恢复保存前内容');
  await expect(page.locator('#ariaLive')).toContainText('不能把 Atom 移入自身后代');
  await expect.poll(() => page.evaluate(() => ({
    failed: window.__landingPersistenceEvents.failed.length,
    persisted: window.__landingPersistenceEvents.persisted.length
  }))).toEqual({ failed: 1, persisted: 0 });

  const workspaceResponse = await workspaceResponsePromise;
  expect({ status: workspaceResponse.status(), body: await workspaceResponse.json() }).toMatchObject({
    status: 200,
    body: {
      ok: true,
      result: { ok: false, errors: [{ code: 'ATOM_MOVE_CYCLE' }] }
    }
  });
  const authoritative = await page.evaluate(async ({ expectedLabel, expectedSource, expectedTarget }) => {
    const payload = await fetch('/__spatial/api/state').then((response) => response.json());
    const matching = payload.knowledge.nodes.filter(({ label: actual }) => actual === expectedLabel);
    return {
      total: matching.length,
      source: matching.filter(({ path }) => path === expectedSource).length,
      target: matching.filter(({ path }) => path === expectedTarget).length,
      workAtomPath: matching[0]?.atomPath
    };
  }, { expectedLabel: label, expectedSource: sourcePath, expectedTarget: targetPath });
  expect(authoritative).toEqual({
    total: 1,
    source: 1,
    target: 0,
    workAtomPath: '🧊manage/工务/回滚work'
  });
  expect(await page.evaluate((expected) => window.spatialLab.state().path === expected, targetPath)).toBe(true);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(false);

  await page.keyboard.press('Home');
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(true);

  await page.reload();
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await page.keyboard.press('f');
    await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚test'))).toBe(true);
  await page.keyboard.press('f');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await waitForViewToSettle(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(false);
});

test('holding Shift brushes individual nodes into and out of a batch without peer preselection', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);

  const targets = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .filter(({ label }) => Boolean(label))
    .slice(0, 2);
  expect(targets).toHaveLength(2);

  await page.keyboard.down('Shift');
  await page.mouse.move(targets[0].clientX, targets[0].clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(1);

  await page.mouse.move(targets[1].clientX, targets[1].clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(2);

  await page.mouse.move(targets[0].clientX, targets[0].clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(1);
  await page.keyboard.up('Shift');
});

test('Shift brushing remains available after Home returns from another context', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);

  const innerTarget = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find(({ label }) => Boolean(label));
  expect(innerTarget).toBeTruthy();
  await page.keyboard.down('Shift');
  await page.mouse.move(innerTarget.clientX, innerTarget.clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(1);
  await page.keyboard.up('Shift');

  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe('root');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(0);

  const rootTarget = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find(({ label }) => Boolean(label));
  expect(rootTarget).toBeTruthy();
  await page.keyboard.down('Shift');
  await page.mouse.move(rootTarget.clientX, rootTarget.clientY);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().batchSelectionCount)).toBe(1);
  await page.keyboard.up('Shift');
});

test('a steady domain reuses its rasterized backdrop instead of repainting blurred tunnels', async ({ page }) => {
  await page.addInitScript(() => {
    window.__domainEllipseCalls = 0;
    window.__backdropBlits = 0;
    const ellipse = CanvasRenderingContext2D.prototype.ellipse;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.ellipse = function countedEllipse(...args) {
      window.__domainEllipseCalls += 1;
      return ellipse.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function countedDrawImage(...args) {
      window.__backdropBlits += 1;
      return drawImage.apply(this, args);
    };
  });
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  await page.evaluate(() => {
    window.__domainEllipseCalls = 0;
    window.__backdropBlits = 0;
  });

  await page.waitForTimeout(2000);

  const drawCounts = await page.evaluate(() => ({
    ellipses: window.__domainEllipseCalls,
    backdropBlits: window.__backdropBlits
  }));
  expect(drawCounts.backdropBlits).toBeGreaterThan(0);
  expect(drawCounts.ellipses / drawCounts.backdropBlits).toBeLessThan(70);
});
