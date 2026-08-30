import { test, expect } from '@playwright/test';

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

test('one visible N-to-M clause renders branches around a selectable shared trunk without Atom writes', async ({ page }) => {
  test.setTimeout(60_000);
  const mutatingRequests = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      mutatingRequests.push({ method: request.method(), url: request.url() });
    }
  });
  const visibleClause = {
    id: 'support:Flow/A:0',
    antecedentPaths: ['Flow/A', 'Flow/B'],
    dependencyPaths: ['Flow/A', 'Flow/B', 'Flow/Gate'],
    root: {
      kind: 'and', exprPath: [], children: [
        { kind: 'thing', targetPath: 'Flow/A', exprPath: [0] },
        { kind: 'thing', targetPath: 'Flow/B', exprPath: [1] },
        { kind: 'program', targetPath: 'Flow/Gate', exprPath: [2] }
      ]
    },
    then: [
      { kind: 'thing', targetPath: 'Flow/Y', thenOrdinal: 0 },
      { kind: 'thing', targetPath: 'Flow/Z', thenOrdinal: 1 }
    ],
    evaluation: { status: 'true', decision: true }
  };
  const hiddenClause = {
    ...visibleClause,
    id: 'support:Flow/A:1',
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
      node('Y', 'Flow/Y', 4, -2),
      node('Z', 'Flow/Z', 4, 2)
    ],
    edges: [],
    supportClauses: [visibleClause, hiddenClause]
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
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().supportGeometry)).toHaveLength(1);
  const [geometry] = await page.evaluate(() => window.spatialLab.state().supportGeometry);
  const trunk = geometry.segments.find(({ role }) => role === 'trunk');

  expect(geometry.id).toBe('support:Flow/A:0');
  expect(geometry.kind).toBe('many-to-many');
  expect(geometry.junctions.map(({ role, ratio }) => ({ role, ratio }))).toEqual([
    { role: 'merge', ratio: 0.5 },
    { role: 'split', ratio: 0.5 }
  ]);
  expect(geometry.segments.map(({ role }) => role)).toEqual([
    'antecedent', 'antecedent', 'trunk', 'consequent', 'consequent'
  ]);
  expect(geometry.segments.some(({ fromPath, toPath }) => (
    fromPath === 'Flow/Gate' || toPath === 'Flow/Gate'
  ))).toBe(false);
  expect(Math.hypot(trunk.to.x - trunk.from.x, trunk.to.y - trunk.from.y)).toBeGreaterThan(1);

  if (await page.locator('#helpPanel').isVisible()) {
    await page.locator('[data-close="help"]').click();
  }
  const target = await page.evaluate(() => (
    window.spatialLab.state().supportClauseTargets
      .filter(({ clauseId, segmentRole }) => (
        clauseId === 'support:Flow/A:0' && segmentRole === 'trunk'
      ))[2]
  ));
  expect(target).toBeTruthy();
  await page.mouse.click(target.clientX, target.clientY);
  await expect.poll(() => page.evaluate(() => (
    window.spatialLab.state().selectedSupportClause
  ))).toBe('support:Flow/A:0');
  expect(mutatingRequests).toEqual([]);
});
