#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';

export const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const stats = values => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
const fact = (thing, situation = '', slot = []) => ({ thing, situation, slot, strut: [] });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const AGENT = '验收入口';

export async function createParityWorlds({ unrelatedThings = 12_500, observeExecutionStages = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-web-cli-parity-'));
  const initial = [{ 'thing@program': AGENT,
    situation: 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","transform"]}})',
    slot: [fact('源域', '', [fact('源参照')]), fact('目标域', '', [fact('关系目标')]), fact('采样节点'),
      { 'thing@backup@default': '备份', situation: '', slot: [], strut: [] }], strut: [] },
  fact('无关域', '', Array.from({ length: unrelatedThings }, (_, i) => fact(`节点${i}`)))];
  const running = [];
  async function start(name, facts) {
    const root = path.join(directory, name);
    await fs.mkdir(root);
    const contextFile = path.join(root, 'atom.json');
    const graphFile = path.join(root, 'graph.json');
    await fs.writeFile(contextFile, JSON.stringify(facts));
    const observations = new Map();
    const base = createLegacyWorldService({ memoryAuthoritative: true, publishLegacyProjection: false,
      execute: async request => {
        const record = observations.get(request.interaction.id);
        if (record) {
          record.executor += 1;
          record.preEngineMs = performance.now() - record.startedAt;
        }
        const receiver = createAtomLanguageReceiver({ onStage: ({ stage }) => { if (record) record[stage] += 1; } });
        return executeAtomLanguage({ ...request,
          ...(observeExecutionStages ? { onExecutionStage: event => { if (record) (record.stages ??= []).push(event); } } : {}),
          commitWorld: async transition => {
            const receipt = await request.commitWorld(transition);
            if (record && record.commitReturnedMs === undefined) record.commitReturnedMs = performance.now() - record.startedAt;
            return receipt;
          }, receiver: { receive(source) {
          const parsed = receiver.receive(source);
          if (record) record.parsed = parsed;
          return parsed;
        } } });
      } });
    const worldService = { ...base, executeLegacy: async request => {
      // Keep counts across any same-ID re-entry; a retry must not erase an
      // earlier parse/execute and make a duplicate chain look like one pass.
      const record = observations.get(request.interaction.id)
        ?? { source: request.source, parser: 0, validator: 0, executor: 0, sharedCommandMs: null };
      observations.set(request.interaction.id, record);
      let settle;
      record.settled = new Promise(resolve => { settle = resolve; });
      const started = performance.now();
      record.startedAt = started;
      const finish = () => { record.sharedCommandMs ??= performance.now() - started; };
      try {
        return await base.executeLegacy({ ...request, onCommitted: async result => {
          finish();
          await request.onCommitted?.(result);
        } });
      } finally { finish(); settle(); }
    } };
    const server = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile,
      storeFile: path.join(root, 'knowledge.json'), backupRepository: '', worldService,
      projectionDelayMs: 4_000, memoryAuthoritative: true });
    running.push(server);
    return { ...server, observations, worldService,
      facts: async () => (await base.readCommittedVersion({ contextFile, projectionFile: graphFile })).facts };
  }
  try {
    const web = await start('web', initial);
    // Copy the kernel-issued identity baseline, never generate fake identity fields.
    const cli = await start('cli', await web.facts());
    return { directory, web, cli, unrelatedThings, close: async () => {
      for (const server of running.reverse()) await server.close();
      // Evidence and isolated facts remain recoverable in this temporary directory.
    } };
  } catch (error) { for (const server of running.reverse()) await server.close(); throw error; }
}

async function replay(cli, source, id) {
  return executeAtomCommandEndpoint({ source, interaction: { id, agentSelector: AGENT, agent: { path: AGENT } } },
    `${cli.url}/__atom/api/command`);
}

function onePass(record) {
  assert.ok(record, 'missing shared-command observation');
  assert.deepEqual([record.parser, record.validator, record.executor], [1, 1, 1], record.source);
  assert.ok(Number.isFinite(record.sharedCommandMs));
}

// Compare the actual four axes while ignoring kernel-issued identity spelling.
function semanticFacts(facts) {
  const visit = atoms => atoms.map(atom => {
    const thingKey = Object.keys(atom).find(key => key.split(/[@&#]/u)[0] === 'thing');
    return { thing: atom[thingKey], types: thingKey.replace(/&[^@&#]+/gu, ''),
      situation: atom.situation, slot: visit(atom.slot ?? []), strut: atom.strut ?? [] };
  });
  return visit(facts);
}

function atPath(facts, selector) {
  return selector.split('/').reduce((parent, name) => parent?.slot?.find(atom =>
    Object.entries(atom).some(([key, value]) => key.split(/[@&#]/u)[0] === 'thing' && value === name)), { slot: facts });
}

async function ready(page) {
  await page.waitForFunction(() => document.body.dataset.spatialBridge === 'connected' && window.spatialLab?.state().visibleNodes > 0);
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
}

async function enter(page, label) {
  console.log(`parity: enter ${label}`);
  await page.waitForFunction(label => window.spatialLab.state().interactionTargets.some(t => t.label === label), label);
  const target = await page.evaluate(label => window.spatialLab.state().interactionTargets.find(t => t.label === label), label);
  await page.mouse.move(target.clientX, target.clientY);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(440);
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(() => window.spatialLab.state().phase === 'idle');
  await page.waitForTimeout(550);
}

async function select(page, label) {
  await page.evaluate(() => window.spatialLab.refitCurrentDomain({ path: window.spatialLab.state().path, reason: 'parity-next-visible-action' }));
  await page.waitForTimeout(550);
  assert.equal(await page.evaluate(label => window.spatialLab.selectByLabel(label), label), true, label);
}

async function ctrlBlank(page, button = 'right') {
  const point = await page.evaluate(() => {
    const state = window.spatialLab.state();
    const shell = state.clusterRegions.find(region => region.path === state.path);
    const envelope = shell?.envelope;
    const canvas = document.querySelector('#spaceCanvas');
    const rect = canvas.getBoundingClientRect();
    function contains(x, y) {
      if (!envelope) return true;
      if (envelope.kind === 'circle') return Math.hypot(x - envelope.x, y - envelope.y) <= envelope.radius;
      let inside = false;
      const points = envelope.points || [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
    const bounds = envelope?.bounds ?? { left: rect.width * 0.2, right: rect.width * 0.8, top: rect.height * 0.25, bottom: rect.height * 0.75 };
    const targets = state.interactionTargets.filter(t => !t.clusterShellProxy).concat(state.strutClauseTargets);
    const points = [];
    for (let y = bounds.top + 40; y < bounds.bottom - 40; y += 8) for (let x = bounds.left + 40; x < bounds.right - 40; x += 8) {
      if (![[x - 32, y - 32], [x + 32, y + 32]].every(([a, b]) => contains(a, b))) continue;
      if (document.elementFromPoint(rect.left + x, rect.top + y) !== canvas) continue;
      const clearance = Math.min(...targets.map(t => Math.hypot(x - t.x, y - t.y) - (t.radius + 12) * 1.14));
      if (clearance > 0) points.push({ x: rect.left + x, y: rect.top + y,
        score: envelope ? clearance : -Math.hypot(x - rect.width / 2, y - rect.height / 2) });
    }
    return points.sort((a, b) => b.score - a.score)[0];
  });
  assert.ok(point, 'current scope has no unambiguous editable blank');
  await page.keyboard.down('Control'); await page.mouse.click(point.x, point.y, { button }); await page.keyboard.up('Control');
}

async function commit(page, worlds, operation, records) {
  console.log(`parity: commit ${operation}`);
  const previousRevision = await page.evaluate(() => window.__parityMappers[0].revision);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/__atom/api/web-command'));
  responsePromise.catch(() => {});
  // Measure in the browser's clock at the actual save intent, not Playwright transport time.
  const feedbackMs = await page.evaluate(() => {
    const start = performance.now();
    window.spatialLab.dispatch('confirmEdit');
    const status = document.querySelector('#saveStatus');
    if (status.hidden || status.dataset.state !== 'saving') throw new Error('save feedback absent');
    return performance.now() - start;
  });
  assert.ok(feedbackMs <= 100, `save feedback ${feedbackMs}ms exceeds 100ms`);
  const response = await responsePromise;
  const payload = await response.json();
  assert.equal(payload.result?.ok, true, JSON.stringify(payload));
  const request = response.request().postDataJSON();
  const markers = { 'node-create': /^transform new /u, 'node-edit': /situation\.rep\./u,
    rename: /thing\.ren\./u, 'node-land': /thing\.mov\./u, 'edge-create': /strut\.add\./u,
    'edge-delete': /strut\.dsc\./u, 'node-delete': /thing\.dsc\./u };
  assert.match(request.source, markers[operation], `wrong UI operation for ${operation}`);
  assert.deepEqual(Object.keys(request).sort(), ['interaction', 'source']);
  const id = `cli-${request.interaction.id}`;
  const cliResult = await replay(worlds.cli, request.source, id);
  assert.equal(cliResult.ok, true, JSON.stringify(cliResult));
  const webRecord = worlds.web.observations.get(request.interaction.id);
  const cliRecord = worlds.cli.observations.get(id);
  onePass(webRecord); onePass(cliRecord);
  assert.deepEqual(webRecord.parsed, cliRecord.parsed);
  const uiMapMs = await page.evaluate(() => window.__parityMappers[0].compileMs.at(-1));
  records.push({ operation, source: request.source, feedbackMs, uiMapMs,
    webSharedCommandMs: webRecord.sharedCommandMs, cliSharedCommandMs: cliRecord.sharedCommandMs });
  await page.waitForFunction(() => document.body.dataset.spatialBridge === 'connected'
    && ['loaded', 'loaded-empty'].includes(document.body.dataset.spatialScopeState)
    && !window.spatialLab.state().transactionActive);
  // The source receipt may truthfully retain a pending badge after publication.
  // Observe the imported authoritative revision instead of treating that badge as a second receipt.
  await page.waitForFunction(revision => window.__parityMappers[0].revision > revision, previousRevision);
  await page.waitForTimeout(550);
}

export async function runBrowserParity({ page, worlds }) {
  const journeyStartedAt = performance.now();
  page.setDefaultTimeout(15_000);
  await page.addInitScript(() => {
    window.__parityMappers = [];
    let scene;
    Object.defineProperty(window, 'AtomSpatialScene', { configurable: true, get: () => scene, set(value) {
      scene = Object.freeze({ ...value, createBrowserCommandMapper() {
        const mapper = value.createBrowserCommandMapper();
        const observed = { imports: 0, revision: -1, compileMs: [] };
        window.__parityMappers.push(observed);
        return Object.freeze({ replaceKnowledge(knowledge) {
          const result = mapper.replaceKnowledge(knowledge);
          observed.imports += 1; observed.revision = knowledge?.revision ?? observed.revision;
          return result;
        }, compile(operation) {
          const start = performance.now();
          try { return mapper.compile(operation); }
          finally { observed.compileMs.push(performance.now() - start); }
        } });
      } });
    } });
  });
  const records = [];
  console.log('parity: worlds ready, opening browser');
  await page.goto(worlds.web.url);
  await ready(page);
  await enter(page, 'atom.json'); await enter(page, AGENT); await enter(page, '源域');
  if (await page.evaluate(() => window.spatialLab.state().clusterFieldOpen)) {
    await page.evaluate(() => window.spatialLab.dispatch('toggleClusterField'));
    await page.waitForTimeout(550);
  }
  await page.mouse.move(800, 500);
  await page.evaluate(() => window.spatialLab.dispatch('createNode'));
  await page.locator('#nodeNameEditor').fill('新节点');
  await commit(page, worlds, 'node-create', records);
  await select(page, '新节点'); await page.evaluate(() => window.spatialLab.dispatch('editNode'));
  const body = '中文 "引号" \\ 路径\n换行与 .ren.命令标记';
  await page.locator('#nodeDetailEditorMount .cm-content').fill(body);
  await commit(page, worlds, 'node-edit', records);
  assert.equal(atPath(await worlds.web.facts(), '验收入口/源域/新节点').situation, body);
  assert.equal(atPath(await worlds.cli.facts(), '验收入口/源域/新节点').situation, body);
  await select(page, '新节点'); await page.evaluate(() => window.spatialLab.dispatch('editNode'));
  await page.locator('#nodeNameEditor').fill('已改名');
  await commit(page, worlds, 'rename', records);
  await select(page, '已改名'); await page.evaluate(() => window.spatialLab.dispatch('editEdge'));
  await page.mouse.click(48, 360, { button: 'right' }); await page.waitForTimeout(550);
  await enter(page, '目标域');
  await ctrlBlank(page);
  await commit(page, worlds, 'node-land', records);
  await page.evaluate(() => {
    if (window.spatialLab.state().clusterFieldOpen) window.spatialLab.dispatch('toggleClusterField');
    window.spatialLab.refitCurrentDomain({ path: window.spatialLab.state().path, reason: 'parity-relation-view' });
  });
  await page.waitForTimeout(550);
  await select(page, '已改名'); await page.evaluate(() => window.spatialLab.dispatch('editEdge'));
  await select(page, '关系目标'); await page.evaluate(() => window.spatialLab.dispatch('editEdge'));
  await commit(page, worlds, 'edge-create', records);
  await page.waitForFunction(() => window.spatialLab.state().strutClauseTargets.length > 0);
  const relation = await page.evaluate(() => {
    const state = window.spatialLab.state();
    return state.strutClauseTargets.find(t => state.interactionTargets.filter(n => !n.clusterShellProxy)
      .every(n => Math.hypot(t.x - n.x, t.y - n.y) > n.radius * 1.15));
  });
  assert.ok(relation, 'relationship must have a visible pointer target');
  await page.keyboard.down('Control'); await page.mouse.click(relation.clientX, relation.clientY, { button: 'right' }); await page.keyboard.up('Control');
  await page.evaluate(() => window.spatialLab.dispatch('deleteEdit'));
  await commit(page, worlds, 'edge-delete', records);
  await select(page, '已改名'); await page.evaluate(() => { window.spatialLab.dispatch('editNode'); window.spatialLab.dispatch('deleteEdit'); });
  await commit(page, worlds, 'node-delete', records);
  const sevenStepJourneyMs = performance.now() - journeyStartedAt;
  const webFacts = semanticFacts(await worlds.web.facts());
  const cliFacts = semanticFacts(await worlds.cli.facts());
  assert.deepEqual(webFacts, cliFacts);
  const failures = [];
  for (const [source, expectedCode] of [
    ['transform {"thing":"验收入口/目标域/关系目标","strut.dsc.":{"thing":"验收入口/源域/源参照"}}', 'STRUT_RELATION_NOT_FOUND'],
    ['transform {"thing":"不存在","situation.rep.失败"}', 'ATOM_NOT_FOUND'],
    ['transform [{"thing":"验收入口/目标域/关系目标","strut.add.":{"thing":"验收入口/源域/源参照"}},{"thing":"验收入口/目标域/关系目标","strut.add.":{"thing":"验收入口/源域/源参照"}}]', 'DUPLICATE_STRUT_RELATION']
  ]) {
    const before = [hash(await worlds.web.facts()), hash(await worlds.cli.facts())];
    const id = crypto.randomUUID();
    const web = await page.evaluate(async ({ source, id }) => (await fetch('/__atom/api/web-command', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source, interaction: { id } })
    })).json(), { source, id });
    const cli = await replay(worlds.cli, source, `cli-${id}`);
    assert.equal(web.result.ok, false); assert.equal(cli.ok, false);
    assert.equal(web.result.errors[0].code, expectedCode);
    assert.equal(cli.errors[0].code, expectedCode);
    const webRecord = worlds.web.observations.get(id), cliRecord = worlds.cli.observations.get(`cli-${id}`);
    onePass(webRecord); onePass(cliRecord);
    assert.deepEqual(webRecord.parsed, cliRecord.parsed);
    assert.deepEqual([hash(await worlds.web.facts()), hash(await worlds.cli.facts())], before);
    failures.push({ code: cli.errors[0].code, unchangedHashes: before });
  }
  const journeyReport = { operations: records.map(r => r.operation), sameFacts: true, records, failures, sevenStepJourneyMs };
  await fs.writeFile(path.join(worlds.directory, 'journey-report.json'), JSON.stringify(journeyReport, null, 2));
  const performanceReport = await runPerformanceSamples({ page, worlds });
  await page.reload(); await ready(page);
  assert.equal(hash(semanticFacts(await worlds.web.facts())), hash(semanticFacts(await worlds.cli.facts())));
  return { ...journeyReport,
    ...performanceReport, retainedEvidenceDirectory: worlds.directory };
}

export async function runPerformanceSamples({ page, worlds }) {
  const batchStartedAt = performance.now();
  await page.evaluate(() => {
    const mapper = window.AtomSpatialScene.createBrowserCommandMapper();
    mapper.replaceKnowledge({ nodes: Array.from({ length: 12_500 }, (_, i) => ({ atomPath: `无关域/节点${i}`, id: `noise-${i}`, path: 'noise' }))
      .concat({ atomPath: '验收入口/采样节点', id: 'sample', path: 'root' }), edges: [] });
    window.__parityMapper = mapper;
  });
  const samples = [];
  for (let i = 0; i < 35; i += 1) {
    const id = crypto.randomUUID();
    const previousRevision = await page.evaluate(() => window.__parityMappers[0].revision);
    const mapped = await page.evaluate(i => {
      const started = performance.now();
      const { source } = window.__parityMapper.compile({ kind: 'node-edit', node: { atomPath: '验收入口/采样节点' },
        draft: { label: '采样节点', description: `采样${i}`, atomTypes: [] } });
      return { source, uiMapMs: performance.now() - started };
    }, i);
    // The twins share one Node process. Drain each real call after its early
    // source receipt, outside all command clocks, so subsequent work cannot
    // contaminate the other world's sample. Alternate order to avoid bias.
    let cli, cliDrainMs, webDrainMs, cliSaveDrainMs, webSaveDrainMs;
    const runCli = async () => {
      cli = await replay(worlds.cli, mapped.source, `cli-${id}`);
      const drainStartedAt = performance.now();
      await worlds.cli.observations.get(`cli-${id}`).settled;
      cliDrainMs = performance.now() - drainStartedAt;
      const saveStartedAt = performance.now();
      await worlds.cli.worldService.flushSaves();
      cliSaveDrainMs = performance.now() - saveStartedAt;
    };
    if (i % 2 === 0) await runCli();
    const web = await page.evaluate(async ({ source, id }) => {
      const serializeStart = performance.now();
      const requestBody = JSON.stringify({ source, interaction: { id } });
      const serializeMs = performance.now() - serializeStart;
      const send = performance.now();
      const response = await fetch('/__atom/api/web-command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: requestBody });
      const responseBody = await response.text();
      const parseStart = performance.now();
      const result = JSON.parse(responseBody);
      const parseMs = performance.now() - parseStart;
      const resource = performance.getEntriesByName(new URL('/__atom/api/web-command', location.href).href).at(-1);
      return { roundTripMs: performance.now() - send, result,
        transferMs: resource ? resource.responseEnd - resource.startTime : null, serializeMs, parseMs };
    }, { source: mapped.source, id });
    assert.equal(web.result.result?.ok, true, JSON.stringify(web.result));
    const drainStartedAt = performance.now();
    await worlds.web.observations.get(id).settled;
    webDrainMs = performance.now() - drainStartedAt;
    const saveStartedAt = performance.now();
    await worlds.web.worldService.flushSaves();
    webSaveDrainMs = performance.now() - saveStartedAt;
    if (i % 2 === 1) await runCli();
    assert.equal(cli.ok, true, JSON.stringify(cli));
    // The HTTP receipt and durable save do not imply that the authoritative
    // projection/SSE import has finished. Keep rendering and SSE active, but
    // drain the current pair's import before beginning the next independent pair.
    const projectionDrainStartedAt = performance.now();
    await page.waitForFunction(revision => window.__parityMappers[0].revision > revision
      && document.body.dataset.spatialKnowledge === 'authoritative'
      && document.body.dataset.spatialBridge === 'connected'
      && ['loaded', 'loaded-empty'].includes(document.body.dataset.spatialScopeState)
      && window.spatialLab.state().phase === 'idle'
      && !window.spatialLab.state().transactionActive, previousRevision);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const webProjectionDrainMs = performance.now() - projectionDrainStartedAt;
    const wr = worlds.web.observations.get(id), cr = worlds.cli.observations.get(`cli-${id}`);
    onePass(wr); onePass(cr); assert.deepEqual(wr.parsed, cr.parsed);
    assert.ok(Number.isFinite(web.transferMs), 'each request requires its browser ResourceTiming transfer sample');
    if (i >= 5) samples.push({ uiMapMs: mapped.uiMapMs, roundTripMs: web.roundTripMs,
      webSharedCommandMs: wr.sharedCommandMs, cliSharedCommandMs: cr.sharedCommandMs,
      webPreEngineMs: wr.preEngineMs, cliPreEngineMs: cr.preEngineMs,
      webEngineToCommitMs: wr.sharedCommandMs - wr.preEngineMs,
      cliEngineToCommitMs: cr.sharedCommandMs - cr.preEngineMs,
      webReceiptAssemblyMs: wr.sharedCommandMs - wr.commitReturnedMs,
      cliReceiptAssemblyMs: cr.sharedCommandMs - cr.commitReturnedMs,
      webDrainMs, cliDrainMs, webSaveDrainMs, cliSaveDrainMs, webProjectionDrainMs,
      sampleDrainMs: webDrainMs + cliDrainMs + webSaveDrainMs + cliSaveDrainMs + webProjectionDrainMs,
      resourceTransferMs: web.transferMs,
      networkEnvelopeMs: Math.max(0, web.transferMs - wr.sharedCommandMs) + web.serializeMs + web.parseMs,
      browserSchedulingMs: Math.max(0, web.roundTripMs - web.transferMs - web.parseMs) });
    await fs.writeFile(path.join(worlds.directory, 'sample-progress.json'), JSON.stringify({
      completedPairs: i + 1, measurements: samples, elapsedBatchMs: performance.now() - batchStartedAt
    }, null, 2));
  }
  const timings = Object.fromEntries(Object.keys(samples[0]).map(key => [key, stats(samples.map(row => row[key]))]));
  const report = { samples: samples.length, unrelatedThings: worlds.unrelatedThings, timings, measurements: samples,
    sampleProtocol: '5 warmups then 30 samples; alternating CLI-first/Web-first; real subsequent calls, independent saves, and each pair\'s authoritative Web projection/SSE import plus idle/render frames drain outside command clocks; rendering and SSE stay active',
    sampleBatchWallMs: performance.now() - batchStartedAt };
  // Retain raw samples even when an assertion fails; a failed budget must be
  // diagnosable without repeating the workload merely to recover its data.
  await fs.writeFile(path.join(worlds.directory, 'performance-report.json'), JSON.stringify(report, null, 2));
  assert.ok(timings.uiMapMs.p95 <= 5, JSON.stringify(timings));
  assert.ok(timings.webSharedCommandMs.p95 <= timings.cliSharedCommandMs.p95 * 1.10 + 5, JSON.stringify(timings));
  assert.ok(timings.networkEnvelopeMs.p95 <= 50, JSON.stringify(timings));
  assert.ok(timings.roundTripMs.p95 < 1_000, JSON.stringify(timings));
  return report;
}

async function publicSmoke(endpoint) {
  const url = new URL(endpoint);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const health = await fetch(new URL('/__spatial/api/health', url)).then(r => r.json());
    assert.equal(health.ok, true); assert.equal(health.atomWorkspace, true);
    await page.goto(url.href); await ready(page);
    await page.reload(); await ready(page);
    const asset = await fetch(new URL('/vendor/atom-spatial-scene.bundle.js', url));
    assert.equal(asset.status, 200);
    return { mode: 'public-smoke-read-only', health, f5: true,
      browserAssetStatus: asset.status, restartAndBackup: 'requires deployment controller evidence' };
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--public-smoke')) {
    const endpoint = args[args.indexOf('--endpoint') + 1];
    assert.ok(args.includes('--endpoint') && endpoint, '--endpoint is required');
    console.log(JSON.stringify(await publicSmoke(endpoint), null, 2));
  } else {
    const { chromium } = await import('@playwright/test');
    const worlds = await createParityWorlds();
    const browser = await chromium.launch({ headless: true });
    try { console.log(JSON.stringify(await runBrowserParity({ page: await browser.newPage({ viewport: { width: 1440, height: 960 } }), worlds }), null, 2)); }
    finally { await browser.close(); await worlds.close(); }
  }
}
