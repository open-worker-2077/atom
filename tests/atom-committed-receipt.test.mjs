import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createInteractionRuntime } from '../src/atom-system/public/interaction-runtime.mjs';

test('durable write returns its complete receipt before postcommit Program projection settles', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-committed-receipt-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, '[]\n');
  const scheduler = createProgramRuntimeScheduler();
  const refresh = scheduler.refresh.bind(scheduler);
  let committed = false;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let entered;
  const settling = new Promise(resolve => { entered = resolve; });
  scheduler.refresh = async (...args) => {
    if (committed) {
      entered();
      await blocked;
    }
    return refresh(...args);
  };
  const service = createLegacyWorldService({
    publishLegacyProjection: false,
    execute: request => executeAtomLanguage({
      ...request,
      commitWorld: async transition => {
        const receipt = await request.commitWorld(transition);
        committed = true;
        return receipt;
      }
    })
  });
  const initialized = await service.executeLegacy({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'project', interaction: { id: 'initialize' }
  });
  assert.equal(initialized.ok, true);
  const unused = async () => { throw new Error('unexpected unrelated capability'); };
  const runtime = createInteractionRuntime({
    world: { execute: request => service.executeLegacy({
      ...request, contextFile, projectionFile, programScheduler: scheduler
    }) },
    projections: { publish: unused, recover: unused },
    feedback: { submit: unused }, agents: { resolve: unused },
    humanStatus: { translate: unused }
  });
  let receipt;
  let notifications = 0;
  const operation = runtime.execute({
    source: 'transform new {"thing":"Root","situation":"saved","slot":[],"strut":[]}',
    correlationId: 'durable-before-projection'
  }, {
    publish: false,
    onCommitted: result => { receipt = result; notifications += 1; }
  });
  try {
    await Promise.race([
      settling,
      operation.then(result => { throw new Error(`projection not reached: ${JSON.stringify(result)}`); })
    ]);
    assert.equal(JSON.parse(await fs.readFile(contextFile, 'utf8'))[0].situation, 'saved');
    assert.equal(receipt?.ok, true, 'a committed write must not wait for disposable projection to acknowledge success');
    assert.equal(receipt.changed, true);
    assert.equal(receipt.command, 'transform');
    assert.ok(receipt.revisionAfter);
    assert.ok(receipt.result, 'acknowledgement preserves the command result, not just a commit flag');
  } finally {
    release();
    await operation;
  }
  assert.equal(notifications, 1, 'early and final paths must not deliver duplicate acknowledgements');
});
