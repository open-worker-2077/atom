import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import * as graph from '../work-engine/atom-language/graph-server.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function guarded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('test deadline'), { code: 'TEST_DEADLINE' })), 400);
  })]); } finally { clearTimeout(timer); }
}
async function fixture(t, { hangBackup = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-graph-shutdown-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const contextFile = path.join(directory, 'atom.json');
  await fs.writeFile(contextFile, JSON.stringify([{ thing: 'Root', situation: 'old', slot: [], strut: [] }]));
  const release = deferred(), entered = deferred();
  const calls = [];
  let signal;
  const worldService = { beginClose: () => calls.push('gate'), closeSaves: async options => {
    calls.push({ saveDeadline: options?.deadline });
  } };
  let flushes = 0;
  const running = await graph.startAtomGraphServer({ host: '127.0.0.1', port: 0,
    contextFile, graphFile: path.join(directory, 'graph.json'), storeFile: path.join(directory, 'knowledge.json'),
    shutdownTimeoutMs: 30, worldService,
    backupTrigger: { start() {}, close: () => calls.push('backup-close'), flush: async () => {
      flushes += 1; calls.push('backup-flush'); if (hangBackup && flushes > 1) await release.promise;
    } },
    interactionRuntime: {
      initialize: async () => ({ initialization: { ok: true } }),
      execute: async (_, lifecycle) => { signal = lifecycle.signal; entered.resolve(); await release.promise; return { ok: true }; },
      updateHumanStatus: async () => ({}), updateHumanWorkspace: async () => ({}), recover: async () => ({}),
      close: async () => calls.push('runtime-close')
    } });
  t.after(async () => { release.resolve(); await running.close().catch(() => {}); running.server.closeAllConnections(); });
  return { running, calls, release, entered, get signal() { return signal; } };
}

test('graph shutdown configuration defaults to 30 seconds and rejects unbounded values', () => {
  assert.equal(graph.parseAtomGraphServerArgs([]).shutdownTimeoutMs, 30000);
  assert.equal(graph.parseAtomGraphServerArgs(['--shutdown-timeout-ms', '25']).shutdownTimeoutMs, 25);
  for (const value of ['0', '-1', 'Infinity', '1.5', 'invalid']) {
    assert.throws(() => graph.parseAtomGraphServerArgs([`--shutdown-timeout-ms=${value}`]), { code: 'INVALID_WORLD_SHUTDOWN_TIMEOUT' });
  }
});

test('graph closes admission and starts saving before a hung interaction drain, then cancels owned requests', async (t) => {
  const f = await fixture(t);
  const request = fetch(`${f.running.url}/__atom/api/command`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'explore {}', interaction: { id: 'hung', agent: { ref: 'ref', path: 'Root' } } }) });
  request.catch(() => {});
  await f.entered.promise;
  const started = Date.now();
  const closing = f.running.close();
  assert.strictEqual(f.running.close(), closing);
  await assert.rejects(guarded(closing), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  assert.equal(f.calls[1], 'gate');
  assert.ok(f.calls.some(call => call.saveDeadline >= started && call.saveDeadline <= started + 35));
  assert.equal(f.signal.aborted, true);
  assert.equal(f.signal.reason.code, 'WORLD_SAVE_CLOSE_TIMEOUT');
  assert.equal(f.running.server.listening, false);
  await guarded(f.running.drainAtomInteractions());
  f.release.resolve();
  await request.catch(() => {});
});

test('backup shares the same deadline and cannot hang successful world-save shutdown', async (t) => {
  const f = await fixture(t, { hangBackup: true });
  await assert.rejects(guarded(f.running.close()), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
  assert.ok(f.calls.findIndex(call => call.saveDeadline) < f.calls.lastIndexOf('backup-flush'));
  assert.equal(f.calls.at(-1), 'backup-close');
});

for (const fails of [false, true]) {
  test(`actual CLI entry binds both orderly signals to one close (${fails ? 'failed' : 'saved'})`, async () => {
    const processLike = new EventEmitter();
    const output = [];
    processLike.stdout = processLike.stderr = { write: value => output.push(value) };
    const exits = [];
    processLike.exit = code => { exits.push(code); processLike.exitCode = code; };
    const completion = deferred();
    let closes = 0;
    await graph.runAtomGraphServerCli({ argv: [], processLike,
      startServer: async () => ({ close: async () => {
        closes += 1; await completion.promise;
        if (fails) throw Object.assign(new Error('unsaved'), { code: 'WORLD_SAVE_CLOSE_TIMEOUT' });
      } }) });
    processLike.emit('SIGINT'); processLike.emit('SIGTERM');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1);
    completion.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(processLike.exitCode ?? 0, fails ? 1 : 0);
    assert.deepEqual(exits, fails ? [1] : []);
    assert.equal(output.join('').includes('WORLD_SAVE_CLOSE_TIMEOUT'), fails);
  });
}
