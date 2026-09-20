import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createStore } from '../../../cli/lib/store.mjs';
import { recordAtomFeedback } from '../../../work-engine/atom-language/feedback-log.mjs';
import { createProgramRuntimeScheduler } from '../../../work-engine/atom-language/program-runtime.mjs';
import { resolveAgentContext } from '../../../work-engine/atom-language/cli.mjs';
import { createInteractionRuntime } from '../public/interaction-runtime.mjs';
import { createLegacyWorldService } from './legacy-engine-adapter.mjs';
import { createLegacyProjectionOrchestrator } from './legacy-projection-orchestrator.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

async function publishProjectionStage(projection, publisher, value) {
  try {
    return await publisher.publish(value);
  } catch (error) {
    throw problem(
      'PROJECTION_CACHE_PUBLISH_FAILED',
      `Disposable ${projection} projection could not be published`,
      { projection, cause: error.code ?? error.name }
    );
  }
}

function defaultSpatialPublisher(storeFile) {
  if (!storeFile) {
    throw problem('INVALID_SPATIAL_PUBLISHER', 'Legacy runtime composition requires storeFile or spatialPublisher');
  }
  const store = createStore(storeFile);
  return Object.freeze({
    publish: (knowledge) => store.execute('knowledge.replace', { knowledge })
  });
}

function defaultGraphPublisher(graphFile) {
  if (!graphFile) throw problem('INVALID_GRAPH_PUBLISHER', 'Legacy runtime composition requires graphFile');
  return Object.freeze({
    async publish(graph) {
      const text = `${JSON.stringify(graph, null, 2)}\n`;
      JSON.parse(text);
      await fs.mkdir(path.dirname(graphFile), { recursive: true });
      const temporary = `${graphFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx');
        try {
          await handle.writeFile(text, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await fs.rename(temporary, graphFile);
        } catch (error) {
          if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
          await fs.copyFile(temporary, graphFile);
          await fs.unlink(temporary);
        }
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return graphFile;
    }
  });
}

export function createLegacyRuntimeComposition(options) {
  const {
    contextFile,
    graphFile,
    storeFile,
    worldService: suppliedWorldService = null,
    projectionOrchestrator = null,
    diagnostics = null,
    onStage = null,
    projectionDelayMs = 4_000,
    programScheduler = createProgramRuntimeScheduler({ diagnosticRecorder: diagnostics }),
    graphPublisher = defaultGraphPublisher(graphFile),
    spatialPublisher = defaultSpatialPublisher(storeFile),
    feedbackRecorder = recordAtomFeedback,
    agentResolver = resolveAgentContext
  } = options ?? {};
  const worldService = suppliedWorldService ?? createLegacyWorldService({
    ...(typeof onStage === 'function' ? {
      onPersistenceStage: (stage) => onStage({
        stage: `world.${stage.stage}`,
        durationMs: stage.durationMs
      })
    } : {})
  });
  const committedVersionProvider = typeof worldService.readCommittedVersion === 'function'
    ? () => worldService.readCommittedVersion({ contextFile, projectionFile: graphFile })
    : typeof worldService.readCommittedSnapshot === 'function'
      ? () => worldService.readCommittedSnapshot({ contextFile, projectionFile: graphFile })
      : null;
  const activeProjectionOrchestrator = projectionOrchestrator
    ?? createLegacyProjectionOrchestrator({
      contextFile,
      programScheduler,
      committedSnapshotProvider: committedVersionProvider,
      compatibilityManifestProvider: typeof worldService.compatibilityManifest === 'function'
        ? () => worldService.compatibilityManifest({ contextFile, projectionFile: graphFile })
        : null
    });

  if (typeof contextFile !== 'string' || !contextFile || typeof graphFile !== 'string' || !graphFile) {
    throw problem('INVALID_RUNTIME_PATHS', 'Legacy runtime composition requires contextFile and graphFile');
  }
  if (typeof worldService?.executeLegacy !== 'function') {
    throw problem('INVALID_WORLD_SERVICE', 'Legacy runtime composition requires World Service');
  }
  if (typeof activeProjectionOrchestrator?.projectCurrent !== 'function') {
    throw problem('INVALID_PROJECTION_ORCHESTRATOR', 'Legacy runtime composition requires projection orchestrator');
  }
  if (typeof spatialPublisher?.publish !== 'function') {
    throw problem('INVALID_SPATIAL_PUBLISHER', 'Legacy runtime composition requires spatial publisher');
  }
  if (typeof graphPublisher?.publish !== 'function') {
    throw problem('INVALID_GRAPH_PUBLISHER', 'Legacy runtime composition requires Graph publisher');
  }

  async function projectAndPublish(request) {
    let projected;
    try {
      projected = await activeProjectionOrchestrator.projectCurrent(request);
    } catch (error) {
      if (error.code === 'STALE_WORLD_PROJECTION') {
        error.details = {
          ...(error.details ?? {}),
          projection: 'projector',
          cause: error.code
        };
        throw error;
      }
      throw problem(
        'PROJECTION_CACHE_PUBLISH_FAILED',
        'Disposable projection could not be derived from current world facts',
        { projection: 'projector', cause: error.code ?? error.name }
      );
    }
    await publishProjectionStage('graph', graphPublisher, projected.graph);
    await publishProjectionStage('spatial', spatialPublisher, projected.spatial);
    return projected;
  }

  const projections = Object.freeze({
    publish: projectAndPublish,
    recover: projectAndPublish
  });

  let resolutionAuthority = null;
  let resolutionAuthorityReady = false;
  const resolvedAgents = new Map();

  async function refreshResolutionAuthority() {
    if (typeof worldService.readCommittedVersion === 'function') {
      resolutionAuthority = await worldService.readCommittedVersion({
        contextFile,
        projectionFile: graphFile
      });
    } else if (typeof worldService.readCommittedSnapshot === 'function') {
      const snapshot = await worldService.readCommittedSnapshot({
        contextFile,
        projectionFile: graphFile
      });
      resolutionAuthority = snapshot ? structuredClone(snapshot) : null;
    } else {
      const compatibilityManifest = typeof worldService.compatibilityManifest === 'function'
        ? await worldService.compatibilityManifest({ contextFile, projectionFile: graphFile })
        : null;
      resolutionAuthority = compatibilityManifest
        ? { compatibilityManifest: structuredClone(compatibilityManifest) }
        : null;
    }
    resolutionAuthorityReady = true;
    resolvedAgents.clear();
    return resolutionAuthority;
  }

  async function currentResolutionAuthority() {
    if (!resolutionAuthorityReady) await refreshResolutionAuthority();
    return resolutionAuthority;
  }

  function resolutionKey(agentPath, authority) {
    const manifestHash = crypto.createHash('sha256')
      .update(JSON.stringify(authority?.compatibilityManifest ?? null))
      .digest('hex');
    const securityRevision = programScheduler?.agentSecurityWorldRevision ?? '';
    return `${agentPath}\0${authority?.revision ?? ''}\0${manifestHash}\0${securityRevision}`;
  }

  async function resolveAgent(agentPath) {
    const authority = await currentResolutionAuthority();
    const manifest = authority?.compatibilityManifest ?? null;
    const key = resolutionKey(agentPath, authority);
    const cached = resolvedAgents.get(key);
    if (cached) return structuredClone(cached);
    const resolved = await agentResolver(contextFile, agentPath, {
      ...(Array.isArray(authority?.facts) ? {
        committedSnapshot: typeof worldService.readCommittedVersion === 'function'
          ? authority : structuredClone(authority),
        ...(typeof worldService.readCommittedVersion === 'function' ? { committedVersion: authority } : {})
      } : {}),
      ...(manifest ? { compatibilityManifest: typeof worldService.readCommittedVersion === 'function'
        ? manifest : structuredClone(manifest) } : {}),
      ...(authority?.revision ? { worldRevision: authority.revision } : (
        manifest?.currentWorldRevision ? { worldRevision: manifest.currentWorldRevision } : {}
      ))
    });
    resolvedAgents.set(key, structuredClone(resolved));
    return resolved;
  }

  return createInteractionRuntime({
    world: {
      execute: async ({ programRuntime, ...request }) => {
        const result = await worldService.executeLegacy({
          ...request,
          contextFile,
          projectionFile: graphFile,
          programScheduler: programRuntime,
          ...(typeof request.onCommitted === 'function' ? {
            onCommitted: async (committed) => {
              resolutionAuthorityReady = false;
              const notification = await request.onCommitted(committed);
              // The source callback resolves the HTTP receipt, but the socket can
              // only flush on an event-loop turn. Yield before rebuilding the
              // large post-commit Agent authority snapshot.
              await new Promise((resolve) => setImmediate(resolve));
              await refreshResolutionAuthority();
              return notification;
            }
          } : {}),
          ...(diagnostics ? { diagnosticRecorder: diagnostics } : {})
        });
        if (!resolutionAuthorityReady || result?.changed === true) await refreshResolutionAuthority();
        return result;
      }
    },
    projections,
    feedback: {
      submit: (request) => feedbackRecorder({ ...request, contextFile })
    },
    agents: {
      resolve: resolveAgent
    },
    programRuntime: programScheduler,
    diagnostics,
    onStage,
    projectionDelayMs
  });
}
