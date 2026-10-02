import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startAtomGraphServer } from '../../work-engine/atom-language/graph-server.mjs';
import { createLegacyWorldService } from '../../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createStore } from '../../cli/lib/store.mjs';

test('real CLI receipt returns while Web update and subsequent work are blocked, then the open page refreshes', async ({ page }) => {
  test.setTimeout(120_000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-cli-web-refresh-'));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  await fs.writeFile(contextFile, JSON.stringify([{ 'thing@program': '验收入口',
    situation: 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","transform"]}})',
    slot: [{ thing: '目标', situation: '原正文', slot: [], strut: [] }], strut: [] }]));
  const base = createLegacyWorldService({ memoryAuthoritative: true, publishLegacyProjection: false });
  const program = Promise.withResolvers();
  const web = Promise.withResolvers();
  const updateStarted = Promise.withResolvers();
  const store = createStore(storeFile);
  let programFinished = false;
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0,
    contextFile, graphFile, storeFile, memoryAuthoritative: true, backupRepository: '',
    worldService: { ...base, executeLegacy: (request) => base.executeLegacy({ ...request,
      onCommitted: async (result) => {
        await request.onCommitted?.(result);
        if (request.source.includes('新正文')) { await program.promise; programFinished = true; }
      }
    }) },
    spatialPublisher: { publish: async (knowledge) => {
      if (knowledge.nodes.some(({ detail }) => detail === '新正文')) {
        updateStarted.resolve();
        await web.promise;
      }
      return store.execute('knowledge.replace', { knowledge });
    } }
  });
  try {
    await page.goto(running.url);
    await page.waitForFunction(() => document.body.dataset.spatialBridge === 'connected');
    for (const label of ['atom.json', '验收入口']) {
      await expect.poll(() => page.evaluate((label) => window.spatialLab.selectByLabel(label), label)).toBe(true);
      const before = await page.evaluate(() => window.spatialLab.state().path);
      await page.evaluate(() => window.spatialLab.dispatch('applyImmersiveInwardView'));
      await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).not.toBe(before);
      await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state', 'loaded');
    }
    const child = promisify(execFile)(process.execPath, [
      path.resolve('work-engine/atom-language/cli.mjs'), '--endpoint', `${running.url}/__atom/api/command`,
      '--agent', '验收入口', 'transform', '{"thing":"验收入口/目标","situation.rep.新正文"}'
    ], { cwd: path.resolve('.'), timeout: 15_000 });
    const result = await child;
    expect(JSON.parse(result.stdout)).toEqual({ 'thing~updated': '目标' });
    await updateStarted.promise;
    expect(programFinished).toBe(false);
    expect(await page.evaluate(() => window.spatialLab.exportKnowledge().nodes
      .find(({ atomPath }) => atomPath === '验收入口/目标')?.detail)).toBe('原正文');
    web.resolve();
    await expect.poll(() => page.evaluate(() => window.spatialLab.exportKnowledge().nodes
      .find(({ atomPath }) => atomPath === '验收入口/目标')?.detail)).toBe('新正文');
    expect(programFinished).toBe(false);
  } finally {
    web.resolve(); program.resolve();
    await page.close();
    await running.close();
    // Keep the isolated world recoverable; never copy it into tracked files.
  }
});
