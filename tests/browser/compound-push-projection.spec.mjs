import { test, expect } from '@playwright/test';

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function node(id, graphPath, x, y) {
  return {
    id,
    key: `root::${id}`,
    path: 'root',
    atomPath: graphPath,
    graphPath,
    label: id,
    detail: '',
    hasChildren: false,
    position: { x, y, z: 0 }
  };
}

test('A-mode strut endpoints attach to the final visible node boundaries', async ({ page }) => {
  const carrierPath = `root/${hashText('carrier').toString(36)}`;
  const knowledge = {
    revision: 63,
    nodes: [
      {
        ...node('carrier', 'Flow', 0, 0),
        path: 'root',
        key: 'root::carrier',
        label: '载体',
        hasChildren: true
      },
      {
        ...node('A', 'Flow/A', -3, 0),
        path: carrierPath,
        key: `${carrierPath}::A`,
        label: '起点'
      },
      {
        ...node('B', 'Flow/B', 3, 0),
        path: carrierPath,
        key: `${carrierPath}::B`,
        label: '终点'
      }
    ],
    edges: [],
    strutClauses: [{
      id: 'strut:Flow/A:0',
      antecedentPaths: ['Flow/A'],
      dependencyPaths: ['Flow/A'],
      root: { kind: 'thing', targetPath: 'Flow/A', exprPath: [], implicit: true },
      then: [{ kind: 'thing', targetPath: 'Flow/B', thenOrdinal: 0 }],
      evaluation: { status: 'true', decision: true }
    }]
  };
  await page.route('**/__spatial/api/state*', async (route) => {
    const requestUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        scope: { path: requestUrl.searchParams.get('path') || 'root' },
        knowledge
      })
    });
  });

  await page.goto('/');
  await page.waitForFunction(() => (
    window.spatialLab
    && document.body.dataset.spatialBridge === 'connected'
    && window.spatialLab.state().visibleNodeDescriptors.some(({ label }) => label === '载体')
  ));
  expect(await page.evaluate(() => window.spatialLab.selectByLabel('载体'))).toBe(true);
  await page.keyboard.press('a');
  await page.evaluate(() => window.spatialLab.dispatch('applyViewMode'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterFieldOpen)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().strutGeometry)).toHaveLength(1);

  const geometry = await page.evaluate(() => {
    const state = window.spatialLab.state();
    const targets = new Map(state.interactionTargets.map((target) => [target.label, target]));
    return {
      segment: state.strutGeometry[0].segments[0],
      start: targets.get('起点'),
      end: targets.get('终点')
    };
  });
  expect(geometry.start).toBeTruthy();
  expect(geometry.end).toBeTruthy();
  expect(Math.hypot(
    geometry.segment.from.x - geometry.start.x,
    geometry.segment.from.y - geometry.start.y
  )).toBeCloseTo(geometry.start.radius, 0);
  expect(Math.hypot(
    geometry.segment.to.x - geometry.end.x,
    geometry.segment.to.y - geometry.end.y
  )).toBeCloseTo(geometry.end.radius, 0);
});

test('one explicit N-to-H plus H-to-M composition keeps the real hub and two clause identities without Atom writes', async ({ page }) => {
  test.setTimeout(60_000);
  const mutatingRequests = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutatingRequests.push({ method: request.method(), url: request.url() });
    }
  });
  const fanInClause = {
    id: 'strut:Flow/H:0',
    antecedentPaths: ['Flow/A', 'Flow/B'],
    dependencyPaths: ['Flow/A', 'Flow/B', 'Flow/Gate'],
    root: {
      kind: 'and', exprPath: [], children: [
        { kind: 'thing', targetPath: 'Flow/A', exprPath: [0] },
        { kind: 'thing', targetPath: 'Flow/B', exprPath: [1] },
        { kind: 'program', targetPath: 'Flow/Gate', exprPath: [2] }
      ]
    },
    then: [{ kind: 'thing', targetPath: 'Flow/H', thenOrdinal: 0 }],
    evaluation: { status: 'true', decision: true }
  };
  const fanOutClause = {
    id: 'strut:Flow/H:1',
    antecedentPaths: ['Flow/H'],
    dependencyPaths: ['Flow/H'],
    root: { kind: 'thing', targetPath: 'Flow/H', exprPath: [], implicit: true },
    then: [
      { kind: 'thing', targetPath: 'Flow/Y', thenOrdinal: 0 },
      { kind: 'thing', targetPath: 'Flow/Z', thenOrdinal: 1 }
    ],
    evaluation: { status: 'true', decision: true }
  };
  const hiddenClause = {
    ...fanInClause,
    id: 'strut:Flow/A:1',
    antecedentPaths: ['Flow/A', 'Flow/Hidden'],
    dependencyPaths: ['Flow/A', 'Flow/Hidden'],
    root: {
      kind: 'and', exprPath: [], children: [
        { kind: 'thing', targetPath: 'Flow/A', exprPath: [0] },
        { kind: 'thing', targetPath: 'Flow/Hidden', exprPath: [1] }
      ]
    }
  };
  const knowledge = {
    revision: 62,
    nodes: [
      node('A', 'Flow/A', -4, -2),
      node('B', 'Flow/B', -4, 2),
      node('Gate', 'Flow/Gate', -1, 4),
      node('H', 'Flow/H', 0, 0),
      node('Y', 'Flow/Y', 4, -2),
      node('Z', 'Flow/Z', 4, 2)
    ],
    edges: [],
    strutClauses: [fanInClause, fanOutClause, hiddenClause]
  };
  await page.route('**/__spatial/api/state*', async (route) => {
    const requestUrl = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        scope: { path: requestUrl.searchParams.get('path') || 'root' },
        knowledge
      })
    });
  });

  await page.goto('/');
  await page.waitForFunction(() => (
    window.spatialLab
    && document.body.dataset.spatialBridge === 'connected'
  ));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().strutGeometry)).toHaveLength(2);
  const geometries = await page.evaluate(() => window.spatialLab.state().strutGeometry);
  expect(geometries.map(({ id, kind }) => ({ id, kind }))).toEqual([
    { id: 'strut:Flow/H:0', kind: 'fan-in' },
    { id: 'strut:Flow/H:1', kind: 'fan-out' }
  ]);
  expect(geometries[0].junctions.map(({ role, ratio }) => ({ role, ratio }))).toEqual([
    { role: 'merge', ratio: 0.5 }
  ]);
  expect(geometries[1].junctions.map(({ role, ratio }) => ({ role, ratio }))).toEqual([
    { role: 'split', ratio: 0.5 }
  ]);
  expect(geometries.every((geometry) => geometry.segments.some(({ fromPath, toPath }) => (
    fromPath === 'Flow/H' || toPath === 'Flow/H'
  )))).toBe(true);
  expect(geometries.flatMap(({ segments }) => segments).some(({ fromPath, toPath }) => (
    fromPath === 'Flow/Gate' || toPath === 'Flow/Gate'
  ))).toBe(false);

  if (await page.locator('#helpPanel').isVisible()) {
    await page.locator('[data-close="help"]').click();
  }
  const hub = await page.evaluate(() => (
    window.spatialLab.state().interactionTargets.find(({ label }) => label === 'H')
  ));
  expect(hub).toBeTruthy();
  await page.mouse.click(hub.clientX, hub.clientY, { button: 'middle' });
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().selected)).toBe('H');
  await page.getByRole('button', { name: '全域', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().strutGeometry)).toHaveLength(2);
  expect(await page.evaluate(() => ({
    geometryIds: window.spatialLab.state().strutGeometry.map(({ id }) => id),
    targetClauseIds: [...new Set(
      window.spatialLab.state().strutClauseTargets.map(({ clauseId }) => clauseId)
    )]
  }))).toEqual({
    geometryIds: ['strut:Flow/H:0', 'strut:Flow/H:1'],
    targetClauseIds: ['strut:Flow/H:0', 'strut:Flow/H:1']
  });
  const target = await page.evaluate(() => (
    window.spatialLab.state().strutClauseTargets
      .filter(({ clauseId, segmentRole }) => (
        clauseId === 'strut:Flow/H:0' && segmentRole === 'trunk'
      ))[2]
  ));
  expect(target).toBeTruthy();
  await page.mouse.click(target.clientX, target.clientY);
  await expect.poll(() => page.evaluate(() => (
    window.spatialLab.state().selectedStrutClause
  ))).toBe('strut:Flow/H:0');
  expect(mutatingRequests.filter(({ url }) => (
    new URL(url).pathname !== '/__spatial/api/view'
  ))).toEqual([]);
});
