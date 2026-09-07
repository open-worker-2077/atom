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

async function observeFirstPathChangeFrame(page, initialPath) {
  await page.evaluate((path) => {
    window.__firstPathChangeFrame = null;
    const observe = () => {
      const state = window.spatialLab.state();
      if (state.path !== path) {
        window.__firstPathChangeFrame = {
          path: state.path,
          scopeState: document.body.dataset.spatialScopeState,
          knowledgeState: document.body.dataset.spatialKnowledge,
          phase: state.phase,
          camera: state.camera,
          field: window.spatialLab.exportField(),
          visibleNodeDescriptors: state.visibleNodeDescriptors
        };
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }, initialPath);
}

async function readFirstPathChangeFrame(page) {
  await expect.poll(() => page.evaluate(() => window.__firstPathChangeFrame)).toBeTruthy();
  return page.evaluate(() => window.__firstPathChangeFrame);
}

function observeWorkspaceCommit(page) {
  const projectionSignal = page.evaluate(() => new Promise((resolve) => {
    const finish = (type, event) => {
      window.removeEventListener('spatial-workspace-persisted', onPersisted);
      window.removeEventListener('spatial-workspace-projection-pending', onPending);
      resolve({ type, detail: event.detail });
    };
    const onPersisted = (event) => finish('persisted', event);
    const onPending = (event) => finish('pending', event);
    window.addEventListener('spatial-workspace-persisted', onPersisted);
    window.addEventListener('spatial-workspace-projection-pending', onPending);
  }));
  const workspaceResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/__atom/api/workspace-edit')
  ));
  return { projectionSignal, workspaceResponsePromise };
}

async function enterAtomFile(page, options) {
  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'));
  expect(selected).toBe(true);
  await holdRightTarget(page, 'atom.json');
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
  await rightClickTarget(page, '外层', 1);
  await page.waitForTimeout(430);
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

test('A right hold enters a visible nested node through its real owner route', async ({ page }) => {
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
  await rightClickTarget(page, '办包', 1);
  await page.waitForTimeout(430);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().interactionTargets
    .some(({ label }) => label === '个务'))).toBe(true);
  await holdRightTarget(page, '个务');

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

test('first domain entry exposes its target field immediately and authoritative children after settling', async ({ page }) => {
  await openIsolatedWorld(page);
  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'));
  expect(selected).toBe(true);
  await observeFirstPathChangeFrame(page, 'root');
  await holdRightTarget(page, 'atom.json');

  const firstFrame = await readFirstPathChangeFrame(page);
  expect(firstFrame.path).not.toBe('root');
  expect(firstFrame.scopeState).toBe('loaded');
  expect(firstFrame.knowledgeState).toBe('authoritative');
  expect(firstFrame.field.path).toBe(firstFrame.path);
  expect(firstFrame.field.nodes).toHaveLength(5);
  expect(firstFrame.field.nodes.map(({ label }) => label)).toEqual(expect.arrayContaining([
    '测试入口',
    '批量目标',
    '深层导航入口',
    '顶层参照'
  ]));
  expect(firstFrame.visibleNodeDescriptors.length).toBeGreaterThan(0);
  expect(firstFrame.visibleNodeDescriptors.every(({ ownerPath }) => ownerPath === firstFrame.path)).toBe(true);
  await waitForViewToSettle(page);
  const settledLabels = await page.evaluate(() => (
    window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)
  ));
  expect(settledLabels).toEqual(expect.arrayContaining([
    '测试入口',
    '批量目标',
    '深层导航入口',
    '顶层参照'
  ]));
});

test('rapid consecutive domain entry renders the second domain on its first visual frame', async ({ page }) => {
  await openIsolatedWorld(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('atom.json'))).toBe(true);
  await holdRightTarget(page, 'atom.json');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe('root');

  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  const parentPath = await page.evaluate(() => window.spatialLab.state().path);
  await observeFirstPathChangeFrame(page, parentPath);
  await holdRightTarget(page, '测试入口');
  const firstFrame = await readFirstPathChangeFrame(page);

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

test('A right hold keeps every intended child node inside the rendered viewport', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);

  const selected = await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'));
  expect(selected).toBe(true);
  await holdRightTarget(page, '测试入口');
  await waitForViewToSettle(page);

  const result = await page.evaluate(() => ({
    state: window.spatialLab.state(),
    field: window.spatialLab.exportField()
  }));
  expect(result.state.viewMode).toBe('nested');
  expect(result.field.nodes).toHaveLength(8);
  expect(result.state.visibleNodeDescriptors.map(({ label }) => label).sort())
    .toEqual(result.field.nodes.map(({ label }) => label).sort());
});

test('searching a deep portal enters its child domain so the target is actionable', async ({ page }) => {
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  const parentPath = await page.evaluate(() => window.spatialLab.state().path);

  await page.keyboard.press('Control+K');
  await expect(page.locator('#spatialSearch')).toBeVisible();
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
  await rightClickTarget(page, '测试入口', 1);
  await page.waitForTimeout(430);
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
  test.setTimeout(120_000);
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await holdRightTarget(page, '测试入口');
  await waitForViewToSettle(page);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('nested');

  const targets = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .filter(({ label }) => label !== '批量目标');
  expect(targets.length).toBeGreaterThan(1);
  const source = targets[0];
  const targetLabels = targets.map(({ label }) => label);
  expect(new Set(targetLabels).size).toBe(targets.length);
  const relationEvidenceBefore = await page.evaluate(({ labels, destination }) => {
    const knowledge = window.spatialLab.exportKnowledge();
    const nodesById = new Map(knowledge.nodes.map((node) => [node.id, node]));
    const matchedNodes = knowledge.nodes.filter((node) => labels.includes(node.label));
    const ids = new Set(matchedNodes.map((node) => node.id));
    const relations = knowledge.edges
      .filter((edge) => ids.has(edge.from.nodeId) && ids.has(edge.to.nodeId));
    return {
      matchedNodeCount: matchedNodes.length,
      sourcePairs: relations.map((edge) => JSON.stringify([
        nodesById.get(edge.from.nodeId).atomPath,
        nodesById.get(edge.to.nodeId).atomPath,
        edge.label
      ])).sort(),
      expectedDestinationPairs: relations.map((edge) => JSON.stringify([
        `${destination}/${nodesById.get(edge.from.nodeId).label}`,
        `${destination}/${nodesById.get(edge.to.nodeId).label}`,
        edge.label
      ])).sort()
    };
  }, {
    labels: targetLabels,
    destination: '批量目标'
  });
  expect(relationEvidenceBefore.matchedNodeCount).toBe(targets.length);
  expect(relationEvidenceBefore.sourcePairs).toHaveLength(11);
  expect(relationEvidenceBefore.expectedDestinationPairs).toHaveLength(11);

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

  const sourcePath = await page.evaluate(() => window.spatialLab.state().path);
  await page.mouse.click(48, 360, { button: 'right' });
  await page.waitForTimeout(430);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(sourcePath);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await holdRightTarget(page, '批量目标');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().viewMode)).toBe('nested');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)))
    .toContain('目标占位');
  const { projectionSignal, workspaceResponsePromise } = observeWorkspaceCommit(page);
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');

  const [workspaceResponse, signal] = await Promise.all([workspaceResponsePromise, projectionSignal]);
  const payload = await workspaceResponse.json();
  expect({ status: workspaceResponse.status(), ok: payload.ok, resultOk: payload.result?.ok })
    .toEqual({ status: 200, ok: true, resultOk: true });
  expect(payload.result.changed).toBe(true);
  expect(payload.result.results).toHaveLength(targets.length);
  expect(payload.result.results.every((entry) => (
    entry.changed === true && entry.result?.path?.startsWith('批量目标/')
  ))).toBe(true);

  expect(['persisted', 'pending']).toContain(signal.type);
  const operation = signal.detail.operation;
  expect(operation.kind).toBe('node-land-batch');
  expect(operation.landings).toHaveLength(targets.length);

  const readPublishedState = () => page.evaluate(async (labels) => {
    const response = await fetch('/__spatial/api/state');
    const statePayload = await response.json();
    const knowledge = statePayload.knowledge;
    const nodesById = new Map(knowledge.nodes.map((node) => [node.id, node]));
    const ids = new Set(knowledge.nodes
      .filter((node) => labels.includes(node.label))
      .map((node) => node.id));
    return {
      targetCount: knowledge.nodes.filter((node) => (
        labels.includes(node.label) && node.atomPath.startsWith('批量目标/')
      )).length,
      sourceCount: knowledge.nodes.filter((node) => (
        labels.includes(node.label) && !node.atomPath.startsWith('批量目标/')
      )).length,
      movedPaths: knowledge.nodes
        .filter((node) => labels.includes(node.label))
        .map(({ atomPath }) => atomPath)
        .sort(),
      relationPairs: knowledge.edges
        .filter((edge) => ids.has(edge.from.nodeId) && ids.has(edge.to.nodeId))
        .map((edge) => JSON.stringify([
          nodesById.get(edge.from.nodeId).atomPath,
          nodesById.get(edge.to.nodeId).atomPath,
          edge.label
        ]))
        .sort()
    };
  }, targets.map(({ label }) => label));
  await expect.poll(readPublishedState, { timeout: 30_000 }).toMatchObject({
    targetCount: targets.length,
    sourceCount: 0,
    movedPaths: targets.map(({ label }) => `批量目标/${label}`).sort()
  });
  const published = await readPublishedState();
  expect(published.relationPairs).toEqual(relationEvidenceBefore.expectedDestinationPairs);

  const readBrowserRecovery = () => page.evaluate((labels) => {
    const knowledge = window.spatialLab.exportKnowledge();
    const nodesById = new Map(knowledge.nodes.map((node) => [node.id, node]));
    const ids = new Set(knowledge.nodes
      .filter((node) => labels.includes(node.label))
      .map((node) => node.id));
    return {
      targetCount: knowledge.nodes.filter((node) => (
        labels.includes(node.label) && node.atomPath.startsWith('批量目标/')
      )).length,
      sourceCount: knowledge.nodes.filter((node) => (
        labels.includes(node.label) && !node.atomPath.startsWith('批量目标/')
      )).length,
      movedPaths: knowledge.nodes
        .filter((node) => labels.includes(node.label))
        .map(({ atomPath }) => atomPath)
        .sort(),
      relationPairs: knowledge.edges
        .filter((edge) => ids.has(edge.from.nodeId) && ids.has(edge.to.nodeId))
        .map((edge) => JSON.stringify([
          nodesById.get(edge.from.nodeId).atomPath,
          nodesById.get(edge.to.nodeId).atomPath,
          edge.label
        ]))
        .sort()
    };
  }, targets.map(({ label }) => label));
  await expect.poll(readBrowserRecovery, { timeout: 30_000 }).toMatchObject({
    targetCount: targets.length,
    sourceCount: 0,
    movedPaths: targets.map(({ label }) => `批量目标/${label}`).sort()
  });
  expect((await readBrowserRecovery()).relationPairs)
    .toEqual(relationEvidenceBefore.expectedDestinationPairs);
});

test('single Web landing is authoritative, survives F5, and leaves no source copy', async ({ page }) => {
  test.setTimeout(120_000);
  const label = '单节点搬移验收';
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await holdRightTarget(page, '测试入口');
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
  await expect.poll(() => page.evaluate(async ({ expectedLabel, expectedPath }) => {
    const payload = await fetch('/__spatial/api/state').then((response) => response.json());
    return payload.knowledge.nodes.some((node) => (
      node.label === expectedLabel && node.path === expectedPath
    ));
  }, { expectedLabel: label, expectedPath: sourcePath }), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(({ expectedLabel, expectedPath }) => (
    window.spatialLab.exportKnowledge().nodes.some((node) => (
      node.label === expectedLabel && node.path === expectedPath
    ))
  ), { expectedLabel: label, expectedPath: sourcePath }), { timeout: 30_000 }).toBe(true);
  const source = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((entry) => entry.label === label);
  expect(source).toBeTruthy();
  await page.keyboard.down('Control');
  await page.mouse.click(source.clientX, source.clientY, { button: 'right' });
  await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().transactionActive)).toBe(true);

  await page.mouse.click(48, 360, { button: 'right' });
  await page.waitForTimeout(430);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(sourcePath);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await holdRightTarget(page, '批量目标');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().phase)).toBe('idle');
  await page.waitForTimeout(550);
  const targetPath = await page.evaluate(() => window.spatialLab.state().path);

  const { projectionSignal, workspaceResponsePromise } = observeWorkspaceCommit(page);
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  const [workspaceResponse, signal] = await Promise.all([workspaceResponsePromise, projectionSignal]);
  const workspacePayload = await workspaceResponse.json();
  expect({ status: workspaceResponse.status(), ok: workspacePayload.ok, changed: workspacePayload.result?.changed })
    .toEqual({ status: 200, ok: true, changed: true });
  expect(['persisted', 'pending']).toContain(signal.type);
  expect(signal.detail.operation.kind).toBe('node-land');

  const readAuthoritative = () => page.evaluate(async ({ expectedLabel, expectedSource, expectedTarget }) => {
    const payload = await fetch('/__spatial/api/state').then((response) => response.json());
    const matching = payload.knowledge.nodes.filter(({ label }) => label === expectedLabel);
    return {
      total: matching.length,
      source: matching.filter(({ path }) => path === expectedSource).length,
      target: matching.filter(({ path }) => path === expectedTarget).length
    };
  }, { expectedLabel: label, expectedSource: sourcePath, expectedTarget: targetPath });
  await expect.poll(readAuthoritative, { timeout: 30_000 })
    .toEqual({ total: 1, source: 0, target: 1 });

  await page.reload();
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('批量目标'))).toBe(true);
  await holdRightTarget(page, '批量目标');
  await waitForViewToSettle(page);
  await expect.poll(() => page.evaluate((expected) => (
    window.spatialLab.state().visibleNodeDescriptors.filter(({ label: actual }) => actual === expected).length
  ), label)).toBe(1);

  await page.mouse.click(48, 360, { button: 'right' });
  await page.waitForTimeout(430);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('测试入口'))).toBe(true);
  await holdRightTarget(page, '测试入口');
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
    await holdRightTarget(page, portal);
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
    await holdRightTarget(page, portal);
    await waitForViewToSettle(page, { allowTransaction: true });
  }
  const targetPath = await page.evaluate(() => window.spatialLab.state().path);

  const { projectionSignal, workspaceResponsePromise } = observeWorkspaceCommit(page);
  await page.keyboard.down('Control');
  await page.mouse.click(48, 360, { button: 'right' });
  await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  const [workspaceResponse, signal] = await Promise.all([workspaceResponsePromise, projectionSignal]);
  const workspacePayload = await workspaceResponse.json();
  expect({ status: workspaceResponse.status(), ok: workspacePayload.ok, changed: workspacePayload.result?.changed })
    .toEqual({ status: 200, ok: true, changed: true });
  expect(['persisted', 'pending']).toContain(signal.type);
  expect(signal.detail.operation.kind).toBe('node-land');

  expect(workspaceRequests.filter(({ operation }) => operation?.kind === 'node-land')).toHaveLength(1);
  const readAuthoritative = () => page.evaluate(async ({ expectedLabel, expectedSource, expectedTarget }) => {
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
  await expect.poll(readAuthoritative, { timeout: 30_000 }).toMatchObject({
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
    await holdRightTarget(page, portal);
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('work'))).toBe(true);
  await page.keyboard.press('Home');
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await holdRightTarget(page, portal);
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
    await holdRightTarget(page, portal);
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
  await holdRightTarget(page, '回滚work');
  await waitForViewToSettle(page, { allowTransaction: true });
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚test'))).toBe(true);
  await holdRightTarget(page, '回滚test');
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
    await holdRightTarget(page, portal);
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(true);

  await page.reload();
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  for (const portal of ['🧊manage', '工务']) {
    expect(await page.evaluate((expected) => window.spatialLab.selectByLabel(expected), portal)).toBe(true);
    await holdRightTarget(page, portal);
    await waitForViewToSettle(page);
  }
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚work'))).toBe(true);
  await holdRightTarget(page, '回滚work');
  await waitForViewToSettle(page);
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('回滚test'))).toBe(true);
  await holdRightTarget(page, '回滚test');
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
    window.__mainCanvasEllipseCalls = 0;
    window.__backdropBlits = [];
    const ellipseCallsByCanvas = new WeakMap();
    const sourceIds = new WeakMap();
    let nextSourceId = 1;
    const ellipse = CanvasRenderingContext2D.prototype.ellipse;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.ellipse = function countedEllipse(...args) {
      const targetCanvas = this.canvas;
      if (targetCanvas?.id === 'spaceCanvas') {
        window.__mainCanvasEllipseCalls += 1;
      } else if (targetCanvas instanceof HTMLCanvasElement) {
        ellipseCallsByCanvas.set(targetCanvas, (ellipseCallsByCanvas.get(targetCanvas) || 0) + 1);
      }
      return ellipse.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = function countedDrawImage(...args) {
      const [source, x, y, width, height] = args;
      if (
        this.canvas?.id === 'spaceCanvas'
        && source instanceof HTMLCanvasElement
        && x === 0
        && y === 0
        && width === this.canvas.clientWidth
        && height === this.canvas.clientHeight
        && source.width === this.canvas.width
        && source.height === this.canvas.height
      ) {
        if (!sourceIds.has(source)) sourceIds.set(source, nextSourceId++);
        window.__backdropBlits.push({
          sourceId: sourceIds.get(source),
          sourceEllipseCalls: ellipseCallsByCanvas.get(source) || 0
        });
      }
      return drawImage.apply(this, args);
    };
  });
  await openIsolatedWorld(page);
  await enterAtomFile(page);
  await page.evaluate(() => {
    window.__mainCanvasEllipseCalls = 0;
    window.__backdropBlits = [];
  });

  await page.waitForTimeout(2000);

  const drawCounts = await page.evaluate(() => ({
    mainCanvasEllipses: window.__mainCanvasEllipseCalls,
    backdropBlits: window.__backdropBlits
  }));
  expect(drawCounts.backdropBlits.length).toBeGreaterThan(1);
  expect(new Set(drawCounts.backdropBlits.map(({ sourceId }) => sourceId)).size).toBe(1);
  expect(new Set(drawCounts.backdropBlits.map(({ sourceEllipseCalls }) => sourceEllipseCalls)).size).toBe(1);
});

async function openAModeFixture(page) {
  const parentPath = `root/${hashText('a-parent-id').toString(36)}`;
  const innerPath = `${parentPath}/${hashText('a-inner-id').toString(36)}`;
  const leafPath = `${innerPath}/${hashText('a-leaf-id').toString(36)}`;
  const peerPath = `${parentPath}/${hashText('a-inner-peer-id').toString(36)}`;
  const peerLeafPath = `${peerPath}/${hashText('a-peer-leaf-id').toString(36)}`;
  const knowledge = {
    revision: 1,
    nodes: [
      { id: 'a-parent-id', key: 'root::a-parent-id', path: 'root', atomPath: '父团', label: '父团', detail: '', hasChildren: true },
      { id: 'a-outside-id', key: 'root::a-outside-id', path: 'root', atomPath: '团外旁侧', label: '团外旁侧', detail: '', hasChildren: false },
      { id: 'a-inner-id', key: `${parentPath}::a-inner-id`, path: parentPath, atomPath: '父团/内层团', label: '内层团', detail: '', hasChildren: true },
      { id: 'a-inner-peer-id', key: `${parentPath}::a-inner-peer-id`, path: parentPath, atomPath: '父团/内层旁侧', label: '内层旁侧', detail: '', hasChildren: true },
      { id: 'a-leaf-id', key: `${innerPath}::a-leaf-id`, path: innerPath, atomPath: '父团/内层团/叶子', label: '叶子', detail: '', hasChildren: true },
      { id: 'a-seed-id', key: `${leafPath}::a-seed-id`, path: leafPath, atomPath: '父团/内层团/叶子/种子', label: '种子', detail: '', hasChildren: false },
      { id: 'a-peer-leaf-id', key: `${peerPath}::a-peer-leaf-id`, path: peerPath, atomPath: '父团/内层旁侧/旁侧叶子', label: '旁侧叶子', detail: '', hasChildren: false }
    ],
    edges: []
  };
  await page.route('**/__spatial/api/state?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || 'root';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, scope: { path }, knowledge }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.spatialLab?.state().interactionTargets.some(({ label }) => label === '父团'));
  return { parentPath, innerPath, leafPath, peerPath, peerLeafPath };
}

async function rightClickTarget(page, label, count) {
  const target = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((candidate) => candidate.label === label);
  expect(target).toBeTruthy();
  if (count === 2) {
    await page.mouse.dblclick(target.clientX, target.clientY, { button: 'right', delay: 40 });
    return target;
  }
  await page.mouse.click(target.clientX, target.clientY, { button: 'right' });
  return target;
}

async function holdRightTarget(page, label, holdMs = 440, release = true) {
  const target = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((candidate) => candidate.label === label);
  expect(target).toBeTruthy();
  await page.mouse.move(target.clientX, target.clientY);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(holdMs);
  if (release) await page.mouse.up({ button: 'right' });
  return target;
}

async function rightDoubleClickWithMicroMove(page, x, y) {
  const currentTime = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(currentTime + 60_000);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.clock.runFor(40);
  await page.mouse.move(x + 1, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
}

test('A single right-click cuts inward without hiding outside context', async ({ page }) => {
  test.setTimeout(90_000);
  await openAModeFixture(page);
  await rightClickTarget(page, '父团', 1);
  await page.waitForTimeout(430);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toEqual(expect.arrayContaining(['内层团', '团外旁侧']));
  expect(await page.evaluate(() => window.spatialLab.state().path)).toBe('root');
});

test('A sustained right press immerses once before release and release adds no ordinary navigation', async ({ page }) => {
  test.setTimeout(90_000);
  const { parentPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团', 440, false);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toContain(parentPath);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toContain('内层团');
  expect(labels).not.toContain('团外旁侧');
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  expect(await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)))
    .not.toContain('叶子');
});

test('A sustained right press keeps the entered domain shell visibly inside the viewport', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 2514, height: 1316 });
  const { parentPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团', 440);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  await page.waitForTimeout(500);

  const shell = (await page.evaluate(() => window.spatialLab.state().clusterRegions))
    .find(({ path }) => path === parentPath);
  expect(shell).toBeTruthy();
  const viewport = page.viewportSize();
  const safeMargin = 24;
  const minimumRecognizableRadius = Math.min(viewport.width, viewport.height) * 0.3;
  expect(shell.x - shell.radius).toBeGreaterThanOrEqual(safeMargin);
  expect(shell.y - shell.radius).toBeGreaterThanOrEqual(safeMargin);
  expect(shell.x + shell.radius).toBeLessThanOrEqual(viewport.width - safeMargin);
  expect(shell.y + shell.radius).toBeLessThanOrEqual(viewport.height - safeMargin);
  expect(shell.radius).toBeGreaterThanOrEqual(minimumRecognizableRadius);
  expect(Math.abs(shell.x - viewport.width / 2)).toBeLessThanOrEqual(viewport.width * 0.08);
  expect(Math.abs(shell.y - viewport.height / 2)).toBeLessThanOrEqual(viewport.height * 0.08);
});

test('PageDown keeps the right-held current shell centred like a middle-click frame', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 2514, height: 1316 });
  const { parentPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团', 440);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(550);

  const shell = (await page.evaluate(() => window.spatialLab.state().clusterRegions))
    .find(({ path }) => path === parentPath);
  const viewport = page.viewportSize();
  expect(shell).toBeTruthy();
  expect(Math.abs(shell.x - viewport.width / 2)).toBeLessThanOrEqual(viewport.width * 0.08);
  expect(Math.abs(shell.y - viewport.height / 2)).toBeLessThanOrEqual(viewport.height * 0.08);
});

test('repeated PageDown continues one layer deeper inside the same crosshair shell', async ({ page }) => {
  test.setTimeout(90_000);
  const { parentPath, innerPath, leafPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团', 440);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);

  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toContain(innerPath);
  await page.waitForTimeout(550);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toContain(leafPath);
});

test('vertical shortcuts stay inside the deepest Graph shell under the crosshair', async ({ page }) => {
  test.setTimeout(90_000);
  const { parentPath, innerPath } = await openAModeFixture(page);
  await rightClickTarget(page, '父团', 1);
  await page.waitForTimeout(430);
  const parentShell = (await page.evaluate(() => window.spatialLab.state().clusterRegions))
    .find(({ path }) => path === parentPath);
  expect(parentShell).toBeTruthy();
  await page.mouse.move(parentShell.clientX, parentShell.clientY);

  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toContain(innerPath);
  expect(await page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual(
    expect.arrayContaining(['root', parentPath, innerPath])
  );

  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).not.toContain(innerPath);
  expect(await page.evaluate(() => window.spatialLab.state().clusterPaths)).toEqual(
    expect.arrayContaining(['root', parentPath])
  );

  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths)).toContain(innerPath);
  expect(await page.locator('#spaceCanvas').evaluate((canvas) => getComputedStyle(canvas).cursor)).toBe('none');
});

test('PageDown from parent-shell blank expands both sibling child shells together', async ({ page }) => {
  test.setTimeout(90_000);
  const { parentPath, innerPath, peerPath } = await openAModeFixture(page);
  await rightClickTarget(page, '父团', 1);
  await page.waitForTimeout(430);
  const parentShell = (await page.evaluate(() => window.spatialLab.state().clusterRegions))
    .find(({ path }) => path === parentPath);
  expect(parentShell).toBeTruthy();
  await page.mouse.move(parentShell.clientX + parentShell.radius * 0.72, parentShell.clientY);

  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths))
    .toEqual(expect.arrayContaining([innerPath, peerPath]));
});

test('ordinary nested blank right double-click collapses only its direct inner group', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date('2026-09-06T00:00:00Z') });
  const { parentPath, innerPath } = await openAModeFixture(page);
  await rightClickTarget(page, '父团', 1);
  await page.waitForTimeout(430);
  await rightClickTarget(page, '内层团', 1);
  await page.waitForTimeout(430);
  const innerCarrier = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find(({ label }) => label === '内层团');
  expect(innerCarrier).toBeTruthy();
  const blankPoint = {
    x: innerCarrier.clientX + innerCarrier.radius * 0.9,
    y: innerCarrier.clientY
  };

  await rightDoubleClickWithMicroMove(page, blankPoint.x, blankPoint.y);
  await page.waitForTimeout(450);

  const clusterPaths = await page.evaluate(() => window.spatialLab.state().clusterPaths);
  expect(clusterPaths).toContain(parentPath);
  expect(clusterPaths).not.toContain(innerPath);
});

test('A right double-click never promotes to immersion', async ({ page }) => {
  test.setTimeout(90_000);
  await openAModeFixture(page);
  await rightClickTarget(page, '父团', 2);
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => window.spatialLab.state().path)).toBe('root');
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toEqual(expect.arrayContaining(['内层团', '团外旁侧']));
});

test('A pending right hold cancels on drag, pointer cancellation, and modifier change', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date('2026-09-06T00:00:00Z') });
  await openAModeFixture(page);
  const currentTime = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(currentTime + 60_000);
  const target = (await page.evaluate(() => window.spatialLab.state().interactionTargets))
    .find((candidate) => candidate.label === '父团');
  expect(target).toBeTruthy();

  await page.mouse.move(target.clientX, target.clientY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(target.clientX + 12, target.clientY);
  await page.clock.runFor(421);
  await page.mouse.up({ button: 'right' });
  expect(await page.evaluate(() => window.spatialLab.state().path), 'drag cancellation').toBe('root');

  await page.mouse.move(target.clientX, target.clientY);
  await page.evaluate(() => {
    const canvas = document.querySelector('#spaceCanvas');
    canvas.addEventListener('pointerdown', (event) => { canvas.dataset.testPointerId = String(event.pointerId); }, { once: true });
  });
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const canvas = document.querySelector('#spaceCanvas');
    canvas.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: Number(canvas.dataset.testPointerId),
      button: 2,
      clientX: 0,
      clientY: 0
    }));
  });
  await page.clock.runFor(421);
  await page.mouse.up({ button: 'right' });
  expect(await page.evaluate(() => window.spatialLab.state().path), 'pointer cancellation').toBe('root');

  await page.mouse.move(target.clientX, target.clientY);
  await page.mouse.down({ button: 'right' });
  await page.keyboard.down('Control');
  await page.clock.runFor(421);
  await page.keyboard.up('Control');
  await page.mouse.up({ button: 'right' });

  expect(await page.evaluate(() => window.spatialLab.state().path), 'modifier cancellation').toBe('root');
  expect(await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label)))
    .not.toContain('内层团');
});

test('blank right double-click returns only one level non-immersively', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date('2026-09-06T00:00:00Z') });
  const { parentPath, innerPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  await holdRightTarget(page, '内层团');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(innerPath);
  await rightDoubleClickWithMicroMove(page, 48, 360);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toContain('内层旁侧');
});

test('ordinary inward click naturally leaves immersion and keeps the owner context', async ({ page }) => {
  test.setTimeout(90_000);
  const { parentPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  await rightClickTarget(page, '内层团', 1);
  await page.waitForTimeout(430);
  expect(await page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).toEqual(expect.arrayContaining(['叶子', '内层旁侧']));
});

test('A key does not become an immersion exit shortcut', async ({ page }) => {
  test.setTimeout(90_000);
  const { parentPath } = await openAModeFixture(page);
  await holdRightTarget(page, '父团');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path), { timeout: 15_000 }).toBe(parentPath);
  await page.keyboard.press('KeyA');
  expect(await page.evaluate(() => window.spatialLab.state().path)).toBe(parentPath);
  const labels = await page.evaluate(() => window.spatialLab.state().visibleNodeDescriptors.map(({ label }) => label));
  expect(labels).not.toContain('团外旁侧');
});
