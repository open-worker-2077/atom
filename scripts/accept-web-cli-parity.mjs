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

export async function waitForPublishedProjection(world, expectedRevision, { timeoutMs = 15_000 } = {}) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const status = world.interactionRuntime.projectionStatus();
    if (status?.status === 'published' && status.expectedRevision === expectedRevision) {
      const health = await fetch(`${world.url}/__spatial/api/health`).then(response => response.json());
      assert.equal(health.atomProjection.status, 'published');
      assert.equal(health.atomProjection.expectedRevision, expectedRevision);
      return { ...status, knowledgeRevision: health.revision };
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`projection did not publish exact revision ${expectedRevision}: ${JSON.stringify(world.interactionRuntime.projectionStatus())}`);
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

export function verifyImportedProjection(knowledge, revision, expected) {
  assert.equal(knowledge?.revision, revision, 'browser must import the exact published revision');
  const nodes = knowledge.nodes ?? [];
  let checkedFacts = 0;
  for (const [atomPath, detail] of Object.entries(expected.present ?? {})) {
    const node = nodes.find(node => node.atomPath === atomPath);
    assert.ok(node, `browser is missing ${atomPath}`);
    if (detail !== null) assert.equal(node.detail, detail, `browser body mismatch at ${atomPath}`);
    checkedFacts += 1;
  }
  for (const atomPath of expected.absent ?? []) {
    assert.ok(!nodes.some(node => node.atomPath === atomPath), `browser retained deleted/moved ${atomPath}`);
    checkedFacts += 1;
  }
  if (expected.noRelations) {
    assert.deepEqual(knowledge.edges, [], 'browser retained a deleted relation edge');
    assert.deepEqual(knowledge.strutClauses, [], 'browser retained a deleted relation clause');
    checkedFacts += 1;
  }
  return checkedFacts;
}

async function verifyBrowserReload(page, world, revision, checkpoint, expected) {
  const startedAt = performance.now();
  const publication = await waitForPublishedProjection(world, revision);
  await page.reload(); await ready(page);
  await page.waitForFunction(revision => window.spatialLab.state().phase === 'idle'
    && document.body.dataset.spatialScopeState === 'loaded'
    && window.__parityMappers[0].revision === revision, publication.knowledgeRevision);
  // F5 restores authoritative facts, not necessarily an independently saved
  // transient camera/domain path. Reach the known domain through real gestures.
  while (await page.evaluate(() => window.spatialLab.state().path !== 'root')) {
    await page.mouse.click(48, 360, { button: 'right' });
    await page.waitForTimeout(550);
  }
  await enter(page, 'atom.json'); await enter(page, AGENT);
  let sourceScopeProof;
  if (checkpoint === 'moved-body') {
    await enter(page, '源域');
    await page.waitForFunction(() => document.body.dataset.spatialScopeState === 'loaded');
    const sourceKnowledge = await page.evaluate(() => window.__parityMappers[0].knowledge);
    const sourceExpected = { present: { '验收入口/源域/源参照': null }, absent: ['验收入口/源域/已改名'] };
    // The positive witness is asserted first, so absence cannot pass merely
    // because the source domain was never loaded after F5.
    const checkedFacts = verifyImportedProjection(sourceKnowledge, publication.knowledgeRevision, sourceExpected);
    sourceScopeProof = { importedRevision: sourceKnowledge.revision,
      presentWitness: sourceKnowledge.nodes.find(node => node.atomPath === '验收入口/源域/源参照').atomPath,
      absentPaths: sourceExpected.absent, checkedFacts };
    await page.mouse.click(48, 360, { button: 'right' });
    await page.waitForTimeout(550);
  }
  await enter(page, '目标域');
  await page.waitForFunction(() => document.body.dataset.spatialScopeState === 'loaded');
  const imported = await page.evaluate(() => window.__parityMappers[0].knowledge);
  return { checkpoint, publication, importedRevision: imported.revision,
    ...(sourceScopeProof ? { sourceScopeProof } : {}),
    checkedFacts: verifyImportedProjection(imported, publication.knowledgeRevision, expected), expected,
    evidenceWallMs: performance.now() - startedAt };
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
  const feedback = await page.evaluate(async () => {
    const start = performance.now();
    window.spatialLab.dispatch('confirmEdit');
    const status = document.querySelector('#saveStatus');
    if (status.hidden || status.dataset.state !== 'saving') throw new Error('save feedback absent');
    const feedbackDomMs = performance.now() - start;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const style = getComputedStyle(status), bounds = status.getBoundingClientRect();
    if (status.hidden || style.display === 'none' || style.visibility === 'hidden'
      || bounds.width <= 0 || bounds.height <= 0) throw new Error('save feedback not visible at next paint frame');
    return { feedbackDomMs, feedbackNextPaintMs: performance.now() - start,
      feedbackNextPaintState: status.dataset.state };
  });
  assert.ok(feedback.feedbackDomMs <= 100, `save feedback ${feedback.feedbackDomMs}ms exceeds 100ms`);
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
  records.push({ operation, source: request.source, feedbackMs: feedback.feedbackDomMs, ...feedback, uiMapMs,
    revisionAfter: payload.result.revisionAfter,
    webSharedCommandMs: webRecord.sharedCommandMs, cliSharedCommandMs: cliRecord.sharedCommandMs });
  await page.waitForFunction(() => document.body.dataset.spatialBridge === 'connected'
    && ['loaded', 'loaded-empty'].includes(document.body.dataset.spatialScopeState)
    && !window.spatialLab.state().transactionActive);
  // The source receipt may truthfully retain a pending badge after publication.
  // Observe the imported authoritative revision instead of treating that badge as a second receipt.
  await page.waitForFunction(revision => window.__parityMappers[0].revision > revision, previousRevision);
  await page.waitForTimeout(550);
}

export async function runBrowserParity({ page, worlds, measurePerformance = true }) {
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
          observed.knowledge = knowledge;
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
  const refreshProofs = [];
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
  const movedFacts = { present: { '验收入口/目标域/已改名': body, '验收入口/目标域/关系目标': null },
    absent: ['验收入口/源域/已改名'] };
  refreshProofs.push(await verifyBrowserReload(page, worlds.web, records.at(-1).revisionAfter, 'moved-body', movedFacts));
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
  refreshProofs.push(await verifyBrowserReload(page, worlds.web, records.at(-1).revisionAfter, 'relation-deleted',
    { ...movedFacts, noRelations: true }));
  await select(page, '已改名'); await page.evaluate(() => { window.spatialLab.dispatch('editNode'); window.spatialLab.dispatch('deleteEdit'); });
  await commit(page, worlds, 'node-delete', records);
  const deletedFacts = { present: { '验收入口/目标域/关系目标': null },
    absent: ['验收入口/目标域/已改名', '验收入口/源域/已改名'], noRelations: true };
  refreshProofs.push(await verifyBrowserReload(page, worlds.web, records.at(-1).revisionAfter, 'thing-deleted', deletedFacts));
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
  const journeyReport = { operations: records.map(r => r.operation), sameFacts: true, records, failures, sevenStepJourneyMs, refreshProofs,
    journeyProtocol: 'raw wall time includes seven real edits and moved-body/relation-deleted/thing-deleted F5 evidence checkpoints',
    feedbackProtocol: 'feedbackMs/feedbackDomMs are synchronous DOM saving state; feedbackNextPaintMs checks visible bounds/style after two requestAnimationFrame callbacks (frame proxy, not a compositor timestamp)' };
  await fs.writeFile(path.join(worlds.directory, 'journey-report.json'), JSON.stringify(journeyReport, null, 2));
  const performanceReport = measurePerformance ? await runPerformanceSamples({ page, worlds }) : {};
  const finalRevision = performanceReport.projectionProofs?.at(-1)?.web.expectedRevision ?? records.at(-1).revisionAfter;
  refreshProofs.push(await verifyBrowserReload(page, worlds.web, finalRevision, 'final', deletedFacts));
  assert.equal(hash(semanticFacts(await worlds.web.facts())), hash(semanticFacts(await worlds.cli.facts())));
  await fs.writeFile(path.join(worlds.directory, 'journey-report.json'), JSON.stringify(journeyReport, null, 2));
  return { ...journeyReport,
    ...performanceReport, acceptanceWallMs: performance.now() - journeyStartedAt, retainedEvidenceDirectory: worlds.directory };
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
  const projectionProofs = [];
  for (let i = 0; i < 35; i += 1) {
    const id = crypto.randomUUID();
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
    // Both real runtimes must publish this pair's exact source revisions, not
    // merely a newer numeric browser revision or a completed durable save.
    const projectionDrainStartedAt = performance.now();
    const [webProjection, cliProjection] = await Promise.all([
      [worlds.web, web.result.result.revisionAfter], [worlds.cli, cli.revisionAfter]
    ].map(async ([world, revision]) => ({
      publication: await waitForPublishedProjection(world, revision),
      drainMs: performance.now() - projectionDrainStartedAt
    })));
    const dualProjectionDrainMs = performance.now() - projectionDrainStartedAt;
    const importDrainStartedAt = performance.now();
    await page.waitForFunction(revision => window.__parityMappers[0].revision === revision
      && document.body.dataset.spatialKnowledge === 'authoritative'
      && document.body.dataset.spatialBridge === 'connected'
      && ['loaded', 'loaded-empty'].includes(document.body.dataset.spatialScopeState)
      && window.spatialLab.state().phase === 'idle'
      && !window.spatialLab.state().transactionActive, webProjection.publication.knowledgeRevision);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const webImportDrainMs = performance.now() - importDrainStartedAt;
    projectionProofs.push({ pair: i, interactionId: id, source: mapped.source,
      web: webProjection.publication, cli: cliProjection.publication,
      browserImportedRevision: await page.evaluate(() => window.__parityMappers[0].revision) });
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
      webDrainMs, cliDrainMs, webSaveDrainMs, cliSaveDrainMs,
      webProjectionDrainMs: webProjection.drainMs, cliProjectionDrainMs: cliProjection.drainMs,
      dualProjectionDrainMs, webImportDrainMs,
      sampleDrainMs: webDrainMs + cliDrainMs + webSaveDrainMs + cliSaveDrainMs + dualProjectionDrainMs + webImportDrainMs,
      resourceTransferMs: web.transferMs,
      networkEnvelopeMs: Math.max(0, web.transferMs - wr.sharedCommandMs) + web.serializeMs + web.parseMs,
      browserSchedulingMs: Math.max(0, web.roundTripMs - web.transferMs - web.parseMs) });
    await fs.writeFile(path.join(worlds.directory, 'sample-progress.json'), JSON.stringify({
      completedPairs: i + 1, measurements: samples, projectionProofs, elapsedBatchMs: performance.now() - batchStartedAt
    }, null, 2));
  }
  const timings = Object.fromEntries(Object.keys(samples[0]).map(key => [key, stats(samples.map(row => row[key]))]));
  const report = { samples: samples.length, unrelatedThings: worlds.unrelatedThings, timings, measurements: samples, projectionProofs,
    sampleProtocol: '5 warmups then 30 samples; alternating CLI-first/Web-first; real subsequent calls, independent saves, both exact command revisions published by their runtimes, and exact Web projection/SSE import plus idle/render frames drain outside command clocks; rendering and SSE stay active',
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

export async function publicSmoke(endpoint) {
  const url = new URL(endpoint);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    const blockedMutations = [], actualMutations = [];
    page.on('response', response => {
      const request = response.request();
      if (!['GET', 'HEAD'].includes(request.method())) actualMutations.push({ method: request.method(), url: request.url() });
    });
    await page.route('**/*', route => {
      const request = route.request();
      if (['GET', 'HEAD'].includes(request.method())) return route.continue();
      blockedMutations.push({ method: request.method(), url: request.url() });
      return route.abort('blockedbyclient');
    });
    const health = await fetch(new URL('/__spatial/api/health', url)).then(r => r.json());
    assert.equal(health.ok, true); assert.equal(health.atomWorkspace, true);
    await page.goto(url.href); await ready(page);
    const snapshot = async () => {
      const observed = await page.evaluate(async () => {
        const health = await fetch('/__spatial/api/health').then(response => response.json());
        const state = await fetch('/__spatial/api/state?path=root').then(response => response.json());
        const fingerprints = [...document.querySelectorAll('script[src],link[href]')]
          .map(element => new URL(element.src || element.href).searchParams.get('v'))
          .filter(value => value?.startsWith('sha256-'));
        return { health, knowledge: state.knowledge, fingerprints: [...new Set(fingerprints)] };
      });
      assert.equal(observed.health.ok, true);
      assert.ok(observed.knowledge?.nodes?.length > 0, 'smoke requires known authoritative read-only state');
      assert.equal(observed.knowledge.revision, observed.health.revision);
      assert.equal(observed.fingerprints.length, 1, 'served assets must identify one precise build');
      return { healthRevision: observed.health.revision, projection: observed.health.atomProjection,
        buildFingerprint: observed.fingerprints[0], stateHash: hash(observed.knowledge) };
    };
    const before = await snapshot();
    await page.reload(); await ready(page);
    const after = await snapshot();
    assert.deepEqual(after, before, 'F5 must preserve served build, health revision and known read-only state');
    const asset = await fetch(new URL('/vendor/atom-spatial-scene.bundle.js', url));
    assert.equal(asset.status, 200);
    assert.deepEqual(actualMutations, [], 'read-only smoke observed an actual mutation response');
    return { mode: 'public-smoke-read-only', health, f5: { before, after }, blockedMutations, actualMutations,
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
