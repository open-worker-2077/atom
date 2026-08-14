import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorldCommandPipeline } from '../src/atom-system/operations/world-command-pipeline.mjs';

function receipt(afterRevision = 'rev-2') {
  return {
    contract: 'atom.world-receipt',
    version: 1,
    commandId: 'cmd-1',
    correlationId: 'interaction-1',
    beforeRevision: 'rev-1',
    afterRevision,
    status: 'committed',
    result: {}
  };
}

test('world command pipeline publishes projections from the exact committed revision', async () => {
  const calls = [];
  const pipeline = createWorldCommandPipeline({
    commitCoordinator: { execute: async () => receipt() },
    worldRepository: {
      read: async () => ({
        contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: 'rev-2', facts: []
      })
    },
    projectionPipeline: {
      rebuild: async (snapshot) => {
        calls.push(snapshot.revision);
        return { worldId: snapshot.worldId, sourceRevision: snapshot.revision, projections: ['graph', 'spatial'] };
      }
    }
  });

  const result = await pipeline.execute({ command: {}, transition: () => {} });

  assert.deepEqual(calls, ['rev-2']);
  assert.equal(result.receipt.afterRevision, 'rev-2');
  assert.equal(result.projection.sourceRevision, 'rev-2');
  assert.equal(result.projectionStatus, 'published');
});

test('projection failure reports a committed world and can be recovered without replaying the command', async () => {
  let commits = 0;
  let projectionAttempts = 0;
  const snapshot = {
    contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: 'rev-2', facts: []
  };
  const pipeline = createWorldCommandPipeline({
    commitCoordinator: {
      execute: async () => {
        commits += 1;
        return receipt();
      }
    },
    worldRepository: { read: async () => snapshot },
    projectionPipeline: {
      rebuild: async (value) => {
        projectionAttempts += 1;
        if (projectionAttempts === 1) throw Object.assign(new Error('projector unavailable'), { code: 'PROJECTOR_DOWN' });
        return { worldId: value.worldId, sourceRevision: value.revision, projections: ['graph'] };
      }
    }
  });

  await assert.rejects(
    pipeline.execute({ command: {}, transition: () => {} }),
    (error) => error.code === 'WORLD_COMMITTED_PROJECTION_PENDING'
      && error.details.receipt.afterRevision === 'rev-2'
  );

  const recovered = await pipeline.recoverProjection({ expectedRevision: 'rev-2' });
  assert.equal(commits, 1);
  assert.equal(projectionAttempts, 2);
  assert.equal(recovered.sourceRevision, 'rev-2');
});

test('projection recovery refuses to publish a different world revision', async () => {
  const pipeline = createWorldCommandPipeline({
    commitCoordinator: { execute: async () => receipt() },
    worldRepository: {
      read: async () => ({
        contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: 'rev-3', facts: []
      })
    },
    projectionPipeline: { rebuild: async () => assert.fail('must not project a mismatched revision') }
  });

  await assert.rejects(
    pipeline.recoverProjection({ expectedRevision: 'rev-2' }),
    (error) => error.code === 'WORLD_REVISION_CONFLICT'
  );
});
