import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import presentationModel from '../spatial-demo-model.js';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createViewStateRepository } from '../src/atom-system/adapters/json-view-state-repository.mjs';
import { startPrivateMobileGateway } from '../src/atom-system/adapters/private-mobile-gateway.mjs';

const endpoint = '/__spatial/api/presentation-settings';

async function graphFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-presentation-settings-'));
  const options = { contextFile: path.join(directory, 'atom.json'),
    graphFile: path.join(directory, 'graph.json'), storeFile: path.join(directory, 'knowledge.json'),
    host: '127.0.0.1', port: 0 };
  await fs.writeFile(options.contextFile, JSON.stringify([{ thing: 'Fixture', situation: '', slot: [], strut: [] }]));
  const instance = await startAtomGraphServer(options);
  t.after(() => { instance.server.closeAllConnections(); return instance.close(); });
  return { directory, options, instance, url: instance.url,
    file: path.join(directory, 'presentation-settings.json') };
}

test('presentation settings public GET exposes uninitialized state without scanning world facts', async (t) => {
  const fixture = await graphFixture(t);
  const response = await fetch(fixture.url + endpoint);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, revision: 0, initialized: false, settings: null });
  await assert.rejects(fs.access(fixture.file), { code: 'ENOENT' });
});

async function serviceFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-presentation-service-'));
  const file = path.join(directory, 'presentation-settings.json');
  const { createPresentationSettingsService } = await import('../src/atom-system/spatial-experience/presentation-settings-service.mjs');
  const create = (target = file, worldId = 'primary') => createPresentationSettingsService({
    repository: createViewStateRepository({ file: target, worldId }),
    normalizeSettings: presentationModel.normalizeSettings
  });
  return { directory, file, create, service: create() };
}

test('presentation service preserves host settings across restart, rejects stale snapshots, and saves explicit zero', async () => {
  const { service, create, file } = await serviceFixture();
  assert.deepEqual(await service.read(), { revision: 0, initialized: false, settings: null });
  await assert.rejects(service.update({ expectedRevision: 0, patch: { nestedTunnelPercent: 0 } }),
    { code: 'PRESENTATION_SETTINGS_BOOTSTRAP_REQUIRED' });
  const seed = await service.update({ expectedRevision: 0, bootstrap: true,
    patch: { nestedTunnelPercent: 55, nestedTunnelInteriorPercent: 35 } });
  assert.equal(seed.revision, 1);
  assert.equal(seed.settings.nestedTunnelPercent, 55);
  assert.deepEqual(await create().read(), seed);
  await assert.rejects(service.update({ expectedRevision: 0, patch: { nestedTunnelPercent: 0 } }),
    { code: 'PRESENTATION_SETTINGS_CONFLICT' });
  const saved = await service.update({ expectedRevision: 1, patch: { nestedTunnelPercent: 0 } });
  assert.equal(saved.revision, 2);
  assert.equal(saved.settings.nestedTunnelPercent, 0);
  assert.equal(saved.settings.nestedTunnelInteriorPercent, 35);
  const document = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(document.contract, 'atom.view-state');
  assert.deepEqual(Object.keys(document.view), ['presentationSettings']);
});

test('presentation service reads the prior complete field set by filling new projection controls without writing', async () => {
  const { service, file } = await serviceFixture();
  const legacySettings = { ...presentationModel.normalizeSettings({
    nestedTunnelPercent: 0,
    otherDetailBrightnessPercent: 0,
    defaultDetailMode: 'surface'
  }) };
  delete legacySettings.secondaryNavigationDelayMs;
  delete legacySettings.layoutYawDegrees;
  delete legacySettings.layoutPitchDegrees;
  delete legacySettings.branchSpreadDegrees;
  const repository = createViewStateRepository({ file, worldId: 'primary' });
  await repository.write({ presentationSettings: legacySettings }, { revision: 7 });
  const before = await fs.readFile(file, 'utf8');

  const result = await service.read();

  assert.equal(result.revision, 7);
  assert.equal(result.settings.secondaryNavigationDelayMs, 420);
  assert.equal(result.settings.layoutYawDegrees, 0);
  assert.equal(result.settings.layoutPitchDegrees, 90);
  assert.equal(result.settings.branchSpreadDegrees, 55);
  assert.equal(result.settings.nestedTunnelPercent, 0);
  assert.equal(result.settings.otherDetailBrightnessPercent, 0);
  assert.equal(result.settings.defaultDetailMode, 'surface');
  assert.equal(await fs.readFile(file, 'utf8'), before);

  const updated = await service.update({ expectedRevision: 7, patch: { nestedTunnelPercent: 44 } });
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(updated.revision, 8);
  assert.equal(updated.settings.secondaryNavigationDelayMs, 420);
  assert.equal(updated.settings.otherDetailBrightnessPercent, 0);
  assert.equal(saved.view.presentationSettings.secondaryNavigationDelayMs, 420);
  assert.deepEqual(Object.keys(saved.view.presentationSettings).sort(),
    Object.keys(presentationModel.normalizeSettings({})).sort());
});

test('presentation service still rejects unknown, otherwise missing, and damaged saved fields', async () => {
  const { service, file } = await serviceFixture();
  const complete = { ...presentationModel.normalizeSettings({}) };
  const cases = [
    { ...complete, unknownField: 1 },
    Object.fromEntries(Object.entries(complete).filter(([key]) => key !== 'nestedTunnelPercent')),
    { ...complete, secondaryNavigationDelayMs: '420' }
  ];
  for (const settings of cases) {
    await createViewStateRepository({ file, worldId: 'primary' })
      .write({ presentationSettings: settings }, { revision: 3 });
    await assert.rejects(service.read(), { code: 'INVALID_PRESENTATION_SETTINGS_DOCUMENT' });
  }
});

test('presentation service two facades on normalized path allow only one CAS winner', async () => {
  const { service, create, file, directory } = await serviceFixture();
  const second = create(path.join(directory, '..', path.basename(directory), path.basename(file)));
  const results = await Promise.allSettled([service, second].map((entry, index) =>
    entry.update({ expectedRevision: 0, bootstrap: true, patch: { nestedTunnelPercent: 55 + index } })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PRESENTATION_SETTINGS_CONFLICT');
  const next = await Promise.allSettled([service, second].map((entry, index) =>
    entry.update({ expectedRevision: 1, patch: { nestedTunnelPercent: 35 + index } })));
  assert.equal(next.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await service.read()).revision, 2);
});

test('presentation service rejects invalid requests and preserves existing malformed or foreign documents', async () => {
  const { service, file, create } = await serviceFixture();
  for (const patch of [[], null, {}, { extra: 1 }, { nestedTunnelPercent: '55' },
    { nestedTunnelPercent: Infinity }, { helpVisible: 1 }, { defaultDetailMode: 'unknown' },
    { idleSeconds: false }, { lastIdleSeconds: null }]) {
    await assert.rejects(service.update({ expectedRevision: 0, bootstrap: true, patch }),
      { code: 'INVALID_PRESENTATION_SETTINGS' });
  }
  for (const expectedRevision of [-1, 0.5, '0', null, undefined]) {
    await assert.rejects(service.update({ expectedRevision, bootstrap: true, patch: { nestedTunnelPercent: 55 } }),
      { code: 'INVALID_PRESENTATION_SETTINGS' });
  }
  await assert.rejects(service.update({ expectedRevision: 0, bootstrap: 'yes', patch: { helpVisible: false } }),
    { code: 'INVALID_PRESENTATION_SETTINGS' });
  await assert.rejects(service.update({ expectedRevision: 0, bootstrap: true, path: 'other.json', patch: { helpVisible: false } }),
    { code: 'INVALID_PRESENTATION_SETTINGS' });
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  for (const value of ['{', JSON.stringify({ contract: 'other' }), JSON.stringify({
    contract: 'atom.view-state', version: 1, worldId: 'foreign', revision: 1, view: { presentationSettings: {} }
  }), JSON.stringify({ contract: 'atom.view-state', version: 1, worldId: 'primary', revision: 1, view: { camera: {} } })]) {
    await fs.writeFile(file, value);
    await assert.rejects(create().update({ expectedRevision: 0, bootstrap: true, patch: { nestedTunnelPercent: 55 } }));
    assert.equal(await fs.readFile(file, 'utf8'), value);
  }
});

test('presentation service shares model ranges and preserves nullable idle settings', async () => {
  const { service } = await serviceFixture();
  const result = await service.update({ expectedRevision: 0, bootstrap: true, patch: {
    nestedTunnelPercent: 155, zoomSpeedPercent: 1, middleLabelDepth: 4,
    idleSeconds: null, helpVisible: false, defaultDetailMode: 'surface'
  } });
  assert.equal(result.settings.nestedTunnelPercent, 100);
  assert.equal(result.settings.zoomSpeedPercent, 25);
  assert.equal(result.settings.middleDetailDepth, 4);
  assert.equal(result.settings.idleSeconds, null);
  assert.equal(result.settings.helpVisible, false);
  assert.equal(result.settings.defaultDetailMode, 'surface');
});

test('view repository optional CAS keeps legacy revisions and serializes facades', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-presentation-cas-'));
  const file = path.join(directory, 'view.json');
  const repository = createViewStateRepository({ file, worldId: 'primary' });
  assert.equal((await repository.write({ path: 'root' }, { revision: 7 })).revision, 7);
  const second = createViewStateRepository({ file: path.join(directory, '.', 'view.json'), worldId: 'primary' });
  const results = await Promise.allSettled([repository, second].map(entry =>
    entry.write({ path: 'root/child' }, { expectedRevision: 7 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VIEW_STATE_CONFLICT');
  assert.equal((await repository.read()).revision, 8);
  assert.equal((await repository.write({ path: 'root' })).revision, 1);
});

async function put(url, payload, headers = {}) {
  const response = await fetch(url + endpoint, { method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return { status: response.status, value: await response.json() };
}

test('presentation HTTP bootstrap requires actual loopback browser origin and rejects cross-site writes without files', async (t) => {
  const { url, file } = await graphFixture(t);
  const payload = { expectedRevision: 0, bootstrap: true, patch: { nestedTunnelPercent: 55 } };
  for (const headers of [{}, { origin: url }, { origin: 'null', 'sec-fetch-site': 'same-origin' },
    { origin: url, 'sec-fetch-site': 'cross-site' }, { origin: url, 'sec-fetch-site': 'same-site' },
    { origin: 'https://phone.example', 'sec-fetch-site': 'same-origin' }]) {
    assert.equal((await put(url, payload, headers)).status, 403);
    await assert.rejects(fs.access(file), { code: 'ENOENT' });
  }
  const seeded = await put(url, payload, { origin: url, 'sec-fetch-site': 'same-origin' });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.value.settings.nestedTunnelPercent, 55);
});

test('presentation HTTP gateway inheritance, conflicts, SSE and cold restart preserve world hashes', async (t) => {
  const { url, options, instance, file } = await graphFixture(t);
  const worldFiles = [options.contextFile, options.graphFile, options.storeFile,
    path.join(path.dirname(file), 'atom.transactions.json')];
  const hash = async () => Promise.all(worldFiles.map(async target => {
    try { return crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }));
  const before = await hash();
  const gateway = await startPrivateMobileGateway({ targetUrl: url, port: 0, allowedLogins: ['fixture@example.test'] });
  t.after(() => gateway.close());
  const controller = new AbortController();
  t.after(() => controller.abort());
  const eventResponse = await fetch(url + '/__spatial/api/events', { signal: controller.signal });
  const reader = eventResponse.body.getReader();
  await reader.read();
  const nextEvent = reader.read();
  nextEvent.catch(() => {});
  const result = await put(url, { expectedRevision: 0, bootstrap: true,
    patch: { nestedTunnelPercent: 55, nestedTunnelInteriorPercent: 35 } },
  { origin: url, 'sec-fetch-site': 'same-origin' });
  assert.equal(result.status, 200);
  const event = new TextDecoder().decode((await nextEvent).value);
  assert.equal(event, 'event: presentation-settings\ndata: {"revision":1}\n\n');
  controller.abort();
  await reader.cancel().catch(() => {});
  const phoneHeaders = { 'tailscale-user-login': 'fixture@example.test',
    origin: 'https://phone.example', 'sec-fetch-site': 'same-origin' };
  assert.equal((await fetch(gateway.url + endpoint)).status, 401);
  const phone = await (await fetch(gateway.url + endpoint, { headers: phoneHeaders })).json();
  assert.deepEqual(phone, result.value);
  const updated = await put(gateway.url, { expectedRevision: 1, patch: { nestedTunnelPercent: 0 } }, phoneHeaders);
  assert.equal(updated.status, 200);
  assert.equal(updated.value.revision, 2);
  assert.equal(updated.value.settings.nestedTunnelPercent, 0);
  const stale = await put(url, { expectedRevision: 1, patch: { nestedTunnelPercent: 99 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.value.error.code, 'PRESENTATION_SETTINGS_CONFLICT');
  assert.deepEqual(await hash(), before);
  await instance.close();
  const cold = await startAtomGraphServer(options);
  t.after(() => cold.close());
  assert.deepEqual(await (await fetch(cold.url + endpoint)).json(), updated.value);
});

test('presentation failed atomic rename retains old file and failed temporary without publishing revision', async (t) => {
  const { url, file } = await graphFixture(t);
  await put(url, { expectedRevision: 0, bootstrap: true, patch: { nestedTunnelPercent: 55 } },
    { origin: url, 'sec-fetch-site': 'same-origin' });
  const before = await fs.readFile(file, 'utf8');
  const originalRename = fs.rename;
  const rename = t.mock.method(fs, 'rename', async (source, target) => {
    if (target === file) throw Object.assign(new Error(`EIO: rename '${source}' -> '${target}'`), { code: 'EIO' });
    return originalRename(source, target);
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = await fetch(url + '/__spatial/api/events', { signal: controller.signal });
  const reader = events.body.getReader();
  await reader.read();
  let published = false;
  const pending = reader.read().then(result => { published = !result.done; }, () => {});
  const result = await put(url, { expectedRevision: 1, patch: { nestedTunnelPercent: 0 } });
  assert.equal(result.status, 500);
  assert.equal(result.value.ok, false);
  assert.equal(result.value.error.code, 'EIO');
  assert.equal(result.value.error.message.includes(file), false);
  assert.equal(result.value.error.message.includes('presentation-settings.json'), false);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal((await (await fetch(url + endpoint)).json()).revision, 1);
  assert.equal(published, false);
  controller.abort();
  await pending;
  const temporary = (await fs.readdir(path.dirname(file))).filter(name => name.startsWith('presentation-settings.json.') && name.endsWith('.tmp'));
  assert.equal(temporary.length, 1);
  rename.mock.restore();
  assert.equal((await put(url, { expectedRevision: 1, patch: { nestedTunnelPercent: 0 } })).status, 200);
});
