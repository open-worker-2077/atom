import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSpatialServer } from '../cli/lib/server.mjs';
import { createAtomGraphHandlers } from '../work-engine/atom-language/graph-server.mjs';

async function serverFor(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-web-cli-ingress-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const observed = [];
  const handlers = createAtomGraphHandlers({
    async execute(intent, options) {
      observed.push({
        intent: structuredClone(intent),
        options: {
          origin: options.origin,
          humanAuthority: options.humanAuthority,
          programMode: options.programMode
        }
      });
      return { ok: true, command: 'transform', changed: false };
    },
    async recover() {}
  });
  const instance = await createSpatialServer({
    storeFile: path.join(directory, 'knowledge.json'),
    atomCommand: handlers.atomCommand,
    atomWebCommand: handlers.atomWebCommand
  });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const origin = `http://127.0.0.1:${instance.server.address().port}`;
  const post = async (pathname, payload) => {
    const response = await fetch(`${origin}${pathname}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    return response.json();
  };
  return { observed, post };
}

test('Web text command receives server-fixed authority while ordinary CLI command still requires a real Agent', async (t) => {
  const { observed, post } = await serverFor(t);
  const web = await post('/__atom/api/web-command', {
    source: 'transform {"thing":"域/节点","situation.rep.新":"已更新"}',
    interaction: { id: 'web-1', agent: { ref: 'client', path: 'forged' }, agentSelector: 'forged' },
    humanAuthority: false,
    origin: 'cli',
    programMode: 'passive'
  });

  assert.equal(web.result.ok, true);
  assert.deepEqual(observed, [{
    intent: {
      source: 'transform {"thing":"域/节点","situation.rep.新":"已更新"}',
      correlationId: 'web-1',
      history: []
    },
    options: { origin: 'web', humanAuthority: true, programMode: 'reconcile' }
  }]);

  const cli = await post('/__atom/api/command', {
    source: 'transform {}', interaction: { id: 'cli-without-agent' }, humanAuthority: true, origin: 'web'
  });
  assert.equal(cli.ok, false);
  assert.equal(cli.error.code, 'AGENT_REQUIRED');
});

test('Web idempotency reuses same-origin commands and rejects a same id from the CLI origin', async (t) => {
  const { observed, post } = await serverFor(t);
  const source = 'transform {"thing":"域/节点","situation.rep.新":"已更新"}';
  const first = await post('/__atom/api/web-command', { source, interaction: { id: 'shared-id' } });
  const retry = await post('/__atom/api/web-command', {
    source,
    interaction: { id: 'shared-id', agent: { ref: 'ignored', path: 'ignored' } },
    origin: 'cli', humanAuthority: false
  });
  assert.equal(first.result.ok, true);
  assert.equal(retry.result.ok, true);
  assert.equal(observed.length, 1);

  const crossOrigin = await post('/__atom/api/command', {
    source,
    interaction: { id: 'shared-id', agent: { ref: 'real-agent', path: 'Root/Agent' } }
  });
  assert.equal(crossOrigin.ok, false);
  assert.equal(crossOrigin.error.code, 'ATOM_INTERACTION_ID_CONFLICT');
});
