import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createLegacyRuntimeComposition,
  createLegacyHumanStatusTranslator,
  createLegacyHumanWorkspaceTranslator
} from '../src/atom-system/adapters/legacy-runtime-composition.mjs';
import { createRuntimeCliExecutor } from '../src/atom-system/adapters/runtime-cli-executor.mjs';

test('maintenance CLI requests enter through the same interaction runtime contract', async () => {
  const intents = [];
  const execute = createRuntimeCliExecutor({
    interactionRuntime: { execute: async (intent) => { intents.push(intent); return { ok: true }; } },
    randomId: () => 'generated-correlation'
  });

  assert.deepEqual(await execute({
    source: 'atom',
    interaction: { agent: { path: 'Root/Maintainer' } },
    history: [{ source: 'explore {}' }]
  }), { ok: true });
  assert.deepEqual(intents, [{
    source: 'atom',
    correlationId: 'generated-correlation',
    agentPath: 'Root/Maintainer',
    history: [{ source: 'explore {}' }]
  }]);
});

test('legacy composition binds world, Program, projection and spatial publication behind one runtime', async () => {
  const calls = [];
  const programScheduler = { id: 'scheduler' };
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler,
    worldService: {
      executeLegacy: async (request) => {
        calls.push(['world', { ...request, programScheduler: request.programScheduler?.id }]);
        return { ok: true, revisionAfter: 'rev-2', lockState: { active: true } };
      }
    },
    projectionOrchestrator: {
      projectCurrent: async (request) => {
        calls.push(['project', request]);
        return { sourceRevision: request.expectedRevision, graph: {}, spatial: { nodes: [] } };
      }
    },
    spatialPublisher: {
      publish: async (knowledge) => calls.push(['spatial', knowledge])
    },
    graphPublisher: {
      publish: async (graph) => calls.push(['graph', graph])
    },
    feedbackRecorder: async (request) => ({ ok: true, request }),
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath }),
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  await runtime.execute({
    source: 'transform {}',
    correlationId: 'interaction-1',
    agentPath: 'Root/Sol'
  });

  assert.deepEqual(calls, [
    ['world', {
      source: 'transform {}',
      interaction: { id: 'interaction-1', agent: { ref: 'resolved', path: 'Root/Sol' } },
      history: [],
      contextFile: 'atom.json',
      projectionFile: 'graph.json',
      programScheduler: 'scheduler'
    }],
    ['project', { expectedRevision: 'rev-2', lockState: { active: true } }],
    ['graph', {}],
    ['spatial', { nodes: [] }]
  ]);
});

test('legacy composition identifies the disposable projection stage without exposing a file path', async () => {
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    worldService: {
      executeLegacy: async () => ({ ok: true, revisionAfter: 'rev-2', lockState: {} })
    },
    projectionOrchestrator: {
      projectCurrent: async () => ({ sourceRevision: 'rev-2', graph: {}, spatial: { nodes: [] } })
    },
    graphPublisher: {
      publish: async () => {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
    },
    spatialPublisher: { publish: async () => assert.fail('must stop at the failed Graph cache') },
    feedbackRecorder: async () => ({ ok: true }),
    agentResolver: async () => null,
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({ source: 'transform {}', correlationId: 'projection-stage' });

  assert.equal(result.ok, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.deepEqual(result.projectionFailure, { projection: 'graph', cause: 'EPERM' });
  assert.equal(JSON.stringify(result).includes('graph.json'), false);
});

test('legacy composition routes feedback through the configured recorder with world paths', async () => {
  const calls = [];
  const runtime = createLegacyRuntimeComposition({
    contextFile: 'atom.json',
    graphFile: 'graph.json',
    programScheduler: {},
    worldService: { executeLegacy: async () => assert.fail('feedback must not mutate world') },
    projectionOrchestrator: { projectCurrent: async () => assert.fail('feedback must not publish') },
    spatialPublisher: { publish: async () => assert.fail('feedback must not publish') },
    graphPublisher: { publish: async () => assert.fail('feedback must not publish') },
    feedbackRecorder: async (request) => {
      calls.push(request);
      return { ok: true, submission: { id: 'feedback-1' } };
    },
    agentResolver: async (_file, agentPath) => ({ ref: 'resolved', path: agentPath }),
    humanStatusTranslator: { translate: async () => 'transform {}' }
  });

  const result = await runtime.execute({
    source: 'submit {"type":"bug","detail":"broken"}',
    correlationId: 'interaction-2',
    agentPath: 'Root/Sol',
    history: []
  });

  assert.equal(result.submission.id, 'feedback-1');
  assert.equal(calls[0].contextFile, 'atom.json');
  assert.deepEqual(calls[0].interaction, {
    id: 'interaction-2',
    agent: { ref: 'resolved', path: 'Root/Sol' }
  });
});

test('human status translator accepts only projected 状态 nodes and returns one transform intent', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-status-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const translator = createLegacyHumanStatusTranslator({
    graphFile,
    projectGraph: async () => ({ atomPathByKey: new Map([['node-key', 'Root/状态']]) })
  });

  assert.equal(
    await translator.translate({ key: 'node-key', detail: '进行中' }),
    'transform {"name":"Root/状态","detail.rep.进行中"}'
  );
  assert.equal(
    await translator.translate({ key: 'stale-node-key', atomPath: 'Root/状态', detail: '已完成' }),
    'transform {"name":"Root/状态","detail.rep.已完成"}'
  );
  await assert.rejects(
    translator.translate({ key: 'missing', detail: '进行中' }),
    (error) => error.code === 'INVALID_HUMAN_STATUS_REQUEST'
  );
});

test('human workspace translator treats the single synthetic root domain as the top-level Atom container', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-workspace-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const rootDomain = {
    id: 'synthetic-root', key: 'root::synthetic-root', path: 'root', atomPath: '',
    label: 'atom.json', hasChildren: true
  };
  let hash = 2166136261;
  for (const character of rootDomain.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const rootDomainPath = `root/${(hash >>> 0).toString(36)}`;
  const translator = createLegacyHumanWorkspaceTranslator({
    graphFile,
    projectGraph: async () => ({
      knowledge: { nodes: [rootDomain], edges: [] },
      atomPathByKey: new Map()
    })
  });

  assert.equal(
    await translator.translate({
      operation: {
        kind: 'node-create', path: rootDomainPath,
        draft: { label: 'Top-level from Web', description: 'saved' }
      }
    }),
    'transform new {"name":"Top-level from Web","detail":"saved","children":[],"partners":[]}'
  );
});

test('human workspace translator emits one atomic Transform for a batch landing', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-human-batch-landing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const graphFile = path.join(directory, 'graph.json');
  await fs.writeFile(graphFile, '{}\n', 'utf8');
  const targetNode = { id: 'target', key: 'root::target', path: 'root', label: '目标域' };
  let hash = 2166136261;
  for (const character of targetNode.id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const targetSpatialPath = `root/${(hash >>> 0).toString(36)}`;
  const translator = createLegacyHumanWorkspaceTranslator({
    graphFile,
    projectGraph: async () => ({
      knowledge: { nodes: [targetNode], edges: [] },
      atomPathByKey: new Map([
        ['root::a', '来源甲'],
        ['root::b', '来源乙'],
        [targetNode.key, '目标域']
      ])
    })
  });

  assert.equal(
    await translator.translate({
      operation: {
        kind: 'node-land-batch',
        landings: [
          { source: { key: 'root::a' }, target: { path: targetSpatialPath } },
          { source: { key: 'root::b' }, target: { path: targetSpatialPath } }
        ]
      }
    }),
    'transform [{"name.mov.目标域":"来源甲"},{"name.mov.目标域":"来源乙"}]'
  );
});
