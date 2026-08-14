import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const serviceUrl = new URL('../src/atom-system/public/world-service.mjs', import.meta.url);
const adapterUrl = new URL('../src/atom-system/adapters/legacy-engine-adapter.mjs', import.meta.url);
const engineUrl = new URL('../work-engine/atom-language/engine.mjs', import.meta.url);
const cliUrl = new URL('../work-engine/atom-language/cli.mjs', import.meta.url);

test('World Service owns the temporary legacy interaction seam without changing receipts', async () => {
  const { createWorldService } = await import(serviceUrl);
  const calls = [];
  const receipt = { ok: true, command: 'explore', revisionBefore: 4, revisionAfter: 4 };
  const service = createWorldService({
    executeLegacyInteraction: async (request) => {
      calls.push(request);
      return receipt;
    }
  });

  const request = {
    source: 'explore {"name":"推进流总控"}',
    contextFile: 'atom.json',
    projectionFile: 'graph.json',
    interaction: { id: 'interaction-1', agent: { path: '推进流总控' } }
  };
  assert.equal(await service.executeLegacy(request), receipt);
  assert.deepEqual(calls, [request]);
  assert.throws(
    () => service.executeLegacy({ ...request, source: '' }),
    (error) => error.code === 'INVALID_WORLD_INTERACTION_SOURCE'
  );
});

test('the compatibility adapter exposes engine behavior only through World Service', async () => {
  const { createLegacyWorldService } = await import(adapterUrl);
  const calls = [];
  const service = createLegacyWorldService({
    execute: async (request) => {
      calls.push(request);
      return { ok: true, marker: 'legacy-engine' };
    }
  });

  const result = await service.executeLegacy({ source: 'atom' });
  assert.deepEqual(result, { ok: true, marker: 'legacy-engine' });
  assert.deepEqual(calls, [{ source: 'atom' }]);
});

test('World Service exposes transaction and rollback capabilities without leaking repositories', async () => {
  const { createWorldService } = await import(serviceUrl);
  const calls = [];
  const coordinator = {
    execute: async (request) => { calls.push(['command', request]); return { status: 'committed' }; },
    rollback: async (request) => { calls.push(['rollback', request]); return { status: 'committed' }; }
  };
  const service = createWorldService({ commitCoordinator: coordinator });
  const transition = () => ({ facts: [] });

  assert.deepEqual(await service.command({ command: { commandId: 'cmd' }, transition }), { status: 'committed' });
  assert.deepEqual(await service.rollback({ targetCommandId: 'cmd', command: { commandId: 'undo' } }), { status: 'committed' });
  assert.deepEqual(calls, [
    ['command', { command: { commandId: 'cmd' }, transition }],
    ['rollback', { targetCommandId: 'cmd', command: { commandId: 'undo' } }]
  ]);
  assert.equal(Object.hasOwn(service, 'repository'), false);
  assert.throws(() => service.executeLegacy({ source: 'atom' }), (error) => error.code === 'WORLD_CAPABILITY_UNAVAILABLE');
});

test('World Service uses the application command pipeline when projections are configured', async () => {
  const { createWorldService } = await import(serviceUrl);
  const calls = [];
  const service = createWorldService({
    commandPipeline: {
      execute: async (request) => { calls.push(['pipeline', request]); return { projectionStatus: 'published' }; },
      recoverProjection: async (request) => { calls.push(['recover', request]); return { sourceRevision: request.expectedRevision }; }
    },
    commitCoordinator: {
      rollback: async (request) => { calls.push(['rollback', request]); return { status: 'committed' }; }
    }
  });

  assert.deepEqual(await service.command({ command: { commandId: 'cmd' } }), { projectionStatus: 'published' });
  assert.deepEqual(await service.recoverProjection({ expectedRevision: 'rev-2' }), { sourceRevision: 'rev-2' });
  assert.deepEqual(calls, [
    ['pipeline', { command: { commandId: 'cmd' } }],
    ['recover', { expectedRevision: 'rev-2' }]
  ]);
});

test('legacy engine writes are inverted through one transactional persistence port', async () => {
  const { createLegacyWorldService } = await import(adapterUrl);
  const commits = [];
  const service = createLegacyWorldService({
    transactionProvider: () => ({
      recover: async () => ({ recovered: 0 }),
      commit: async (request) => {
        commits.push(request);
        return { afterRevision: request.nextRevision };
      }
    }),
    execute: async (request) => {
      assert.equal(typeof request.commitWorld, 'function');
      await request.commitWorld({
        expectedRevision: 'rev-1',
        nextRevision: 'rev-2',
        facts: [{ name: 'committed' }]
      });
      return { ok: true, revisionAfter: 'rev-2' };
    }
  });

  const result = await service.executeLegacy({
    source: 'transform {}',
    contextFile: 'atom.json',
    projectionFile: 'graph.json',
    interaction: { id: 'interaction-1' }
  });

  assert.equal(result.revisionAfter, 'rev-2');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].correlationId, 'interaction-1');
  assert.equal(commits[0].expectedRevision, 'rev-1');
  assert.deepEqual(commits[0].facts, [{ name: 'committed' }]);
});

test('the command engine cannot mutate world facts without a commit capability', async (t) => {
  const { executeAtomLanguage } = await import(engineUrl);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-engine-no-write-port-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');

  await assert.rejects(
    executeAtomLanguage({
      source: 'transform new {"name":"Root","detail":"","children":[],"partners":[]}',
      contextFile,
      projectionFile,
      interaction: { id: 'interaction-without-commit-port' }
    }),
    (error) => error.code === 'WORLD_COMMIT_CAPABILITY_REQUIRED'
  );

  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), []);
  await assert.rejects(fs.access(projectionFile), { code: 'ENOENT' });
});

test('the CLI cannot execute commands without an explicit application capability', async () => {
  const { runAtomCli } = await import(cliUrl);
  let stderr = '';
  const code = await runAtomCli(['atom'], {
    stdin: { isTTY: false },
    stdout: { isTTY: false, write() {} },
    stderr: { write(value) { stderr += value; } },
    defaultContextFile: 'atom.json',
    defaultProjectionFile: 'graph.json'
  });

  assert.equal(code, 4);
  assert.match(stderr, /ATOM_EXECUTION_CAPABILITY_REQUIRED/u);
});

test('real legacy transform advances atom facts through the durable transaction journal', async (t) => {
  const { createLegacyWorldService } = await import(adapterUrl);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-service-transaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const service = createLegacyWorldService();

  const result = await service.executeLegacy({
    source: 'transform new {"name":"Root","detail":"","children":[],"partners":[]}',
    contextFile,
    projectionFile,
    interaction: { id: 'interaction-real-1' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')).map(({ name }) => name), ['Root']);
  const journal = JSON.parse(await fs.readFile(path.join(directory, 'atom.transactions.json'), 'utf8'));
  assert.equal(journal.prepared.length, 0);
  assert.equal(journal.receipts.length, 1);
  assert.equal(journal.receipts[0].receipt.afterRevision, `sha256:${result.revisionAfter}`);
});

test('transactional persistence rollback restores facts and rebuilds the Graph projection', async (t) => {
  const { createTransactionalWorldPersistence } = await import(
    new URL('../src/atom-system/adapters/transactional-world-persistence.mjs', import.meta.url)
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-persistence-rollback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile });

  const facts = [{ name: 'temporary', detail: 'must disappear', children: [], partners: [] }];
  const committed = await persistence.commit({
    correlationId: 'rollback-rehearsal',
    expectedRevision: 'sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    nextRevision: 'sha256:d93ecab5abd57c622a7fedad102c91cddb9993c7edf8dbedaced0fc02762547d',
    facts
  });

  const rolledBack = await persistence.rollback({
    targetCommandId: committed.commandId,
    correlationId: 'rollback-rehearsal-undo',
    expectedRevision: committed.afterRevision
  });

  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), []);
  assert.deepEqual(JSON.parse(await fs.readFile(projectionFile, 'utf8')).graph.children, []);
  assert.equal(rolledBack.afterRevision, committed.beforeRevision);
  const journal = JSON.parse(await fs.readFile(path.join(directory, 'atom.transactions.json'), 'utf8'));
  assert.equal(journal.receipts.length, 2);
  assert.equal(journal.receipts[1].receipt.result.restoredCommandId, committed.commandId);
});

test('ordinary world commits cannot silently erase an existing agent registration', async (t) => {
  const { createTransactionalWorldPersistence } = await import(
    new URL('../src/atom-system/adapters/transactional-world-persistence.mjs', import.meta.url)
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-registration-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const initial = [{ 'name@agent': '测试Agent', detail: '', children: [], partners: [] }];
  await fs.writeFile(contextFile, `${JSON.stringify(initial)}\n`, 'utf8');
  const persistence = createTransactionalWorldPersistence({ contextFile, projectionFile });
  const beforeRevision = `sha256:${crypto.createHash('sha256').update(JSON.stringify(initial)).digest('hex')}`;
  const withoutAgent = [];
  const nextRevision = `sha256:${crypto.createHash('sha256').update(JSON.stringify(withoutAgent)).digest('hex')}`;

  await assert.rejects(
    persistence.commit({
      correlationId: 'unrelated-write',
      expectedRevision: beforeRevision,
      nextRevision,
      facts: withoutAgent,
      source: 'transform {"name":"Other","detail.rep.changed"}'
    }),
    (error) => error.code === 'AGENT_REGISTRATION_LOSS'
  );
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), initial);
});
