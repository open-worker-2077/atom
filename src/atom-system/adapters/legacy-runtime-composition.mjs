import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createStore } from '../../../cli/lib/store.mjs';
import { recordAtomFeedback } from '../../../work-engine/atom-language/feedback-log.mjs';
import { projectAtomGraphWithPaths } from '../../../work-engine/atom-language/graph-4d-projection.mjs';
import { createProgramRuntimeScheduler } from '../../../work-engine/atom-language/program-runtime.mjs';
import { resolveAgentContext } from '../../../work-engine/atom-language/cli.mjs';
import { parseAtomKey } from '../../../work-engine/atom-language/key-parser.mjs';
import { WORLD_OUTSIDE_NAME } from '../../../work-engine/atom-language/world-root.mjs';
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

export function createLegacyHumanStatusTranslator({ graphFile, projectGraph = projectAtomGraphWithPaths }) {
  if (typeof graphFile !== 'string' || !graphFile) {
    throw problem('INVALID_GRAPH_FILE', 'Human status translator requires graphFile');
  }
  return Object.freeze({
    async translate({ key, atomPath: requestedAtomPath, detail }) {
      const rawGraphDocument = JSON.parse(await fs.readFile(graphFile, 'utf8'));
      const { atomPathByKey } = await projectGraph(rawGraphDocument);
      const projectedPath = typeof requestedAtomPath === 'string' ? requestedAtomPath.trim() : '';
      const atomPath = atomPathByKey.get(String(key || '').trim())
        ?? (projectedPath ? projectedPath : '');
      const normalizedDetail = detail.trim();
      if (!atomPath.endsWith('/状态') || !normalizedDetail || normalizedDetail.length > 200
        || normalizedDetail.includes('.rep.')) {
        throw problem(
          'INVALID_HUMAN_STATUS_REQUEST',
          'Human Web entry only updates an Atom 状态 detail'
        );
      }
      return `transform {"thing":${JSON.stringify(atomPath)},${JSON.stringify(`situation.rep.${normalizedDetail}`)}}`;
    }
  });
}

function spatialChildPath(node) {
  let hash = 2166136261;
  for (const character of String(node.id || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${node.path || 'root'}/${(hash >>> 0).toString(36)}`;
}

export function createLegacyHumanWorkspaceTranslator({ graphFile, projectGraph = projectAtomGraphWithPaths }) {
  return Object.freeze({
    async translate({ operation }) {
      const rawGraphDocument = JSON.parse(await fs.readFile(graphFile, 'utf8'));
      const { knowledge, atomPathByKey } = await projectGraph(rawGraphDocument);
      const atomPathForKey = (key) => atomPathByKey.get(String(key || '').trim()) ?? '';
      const containerPath = (spatialPath) => {
        if (spatialPath === 'root') return '';
        const parent = knowledge.nodes.find((node) => (
          spatialChildPath(node) === spatialPath
        ));
        const rootNodes = knowledge.nodes.filter((node) => node.path === 'root');
        const syntheticRoot = rootNodes.length === 1 && rootNodes[0] === parent && !atomPathByKey.has(parent.key);
        if (syntheticRoot) return '';
        const path = parent ? atomPathByKey.get(parent.key) : '';
        if (!path) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Web node target does not map to one Atom container');
        }
        return path;
      };
      const graphByPath = new Map();
      const axisEntry = (node, axis) => Object.entries(node ?? {}).find(([rawKey]) => (
        parseAtomKey(rawKey, { descriptionSymbolWarnings: false }).baseKey === axis
      ));
      const visit = (node, parentPath = '') => {
        const thing = axisEntry(node, 'thing')?.[1];
        if (typeof thing !== 'string' || !thing) return;
        const path = parentPath ? `${parentPath}/${thing}` : thing;
        graphByPath.set(path, node);
        for (const child of axisEntry(node, 'contain')?.[1] ?? []) visit(child, path);
      };
      for (const child of axisEntry(rawGraphDocument.graph, 'contain')?.[1] ?? []) visit(child);
      const resolveSupportPath = (sourcePath, selector) => {
        if (graphByPath.has(selector)) return selector;
        const sibling = `${sourcePath.split('/').slice(0, -1).join('/')}/${selector}`.replace(/^\//u, '');
        if (graphByPath.has(sibling)) return sibling;
        const named = [...graphByPath.keys()].filter((path) => path.split('/').at(-1) === selector);
        return named.length === 1 ? named[0] : '';
      };
      const requireAtomPath = (key, node = null) => {
        const projectedPath = typeof node?.atomPath === 'string' ? node.atomPath.trim() : '';
        const path = atomPathForKey(key) || (graphByPath.has(projectedPath) ? projectedPath : '');
        if (!path) throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Web edit target does not map to one Atom');
        return path;
      };
      const replaceSupport = (sourcePath, support) => (
        `transform ${JSON.stringify({ thing: sourcePath, 'support.rep.': support })}`
      );
      const landingTransform = (landing) => {
        const destinationPath = containerPath(landing.target?.path);
        const legacyNode = landing.sourceNode ?? landing.draft;
        const projectedSourcePath = typeof legacyNode?.atomPath === 'string' ? legacyNode.atomPath.trim() : '';
        const sourcePath = atomPathForKey(landing.source?.key)
          || (graphByPath.has(projectedSourcePath) ? projectedSourcePath : '');
        if (!sourcePath) {
          const label = legacyNode?.label?.trim();
          const detail = (legacyNode?.description ?? legacyNode?.detail ?? '').trim();
          const type = legacyNode?.atomTypes?.[0]?.trim() ?? '';
          if (!label || label.includes('/') || label.length > 200) {
            throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Legacy Web node requires a valid Atom name before landing');
          }
          if (type && (!/^[\p{L}\p{N}_-]+$/u.test(type) || type.length > 80)) {
            throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Legacy Web node requires one safe @type name');
          }
          return { new: { [`thing${type ? `@${type}` : ''}`]: `${destinationPath}/${label}`, situation: detail, contain: [], support: [] } };
        }
        return { [`thing.mov.${destinationPath || WORLD_OUTSIDE_NAME}`]: sourcePath };
      };

      if (operation?.kind === 'node-create' && typeof operation.path === 'string') {
        const label = operation.draft?.label?.trim();
        const detail = operation.draft?.description?.trim() ?? '';
        const type = operation.draft?.atomTypes?.[0]?.trim() ?? '';
        if (!label || label.includes('/') || label.length > 200) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'New Atom requires a non-empty name without slash');
        }
        if (type && (!/^[\p{L}\p{N}_-]+$/u.test(type) || type.length > 80)) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Atom type requires one safe @type name');
        }
        const parentAtomPath = containerPath(operation.path);
        const thing = parentAtomPath ? `${parentAtomPath}/${label}` : label;
        return `transform new ${JSON.stringify({ [`thing${type ? `@${type}` : ''}`]: thing, situation: detail, contain: [], support: [] })}`;
      }

      if (operation?.kind === 'node-edit') {
        const path = requireAtomPath(operation.nodeKey, operation.node);
        if (operation.status === 'delete') {
          return `transform {${JSON.stringify('thing.dsc.')}:${JSON.stringify(path)}}`;
        }
        const label = operation.draft?.label?.trim();
        const detail = operation.draft?.description?.trim() ?? '';
        const hasTypeDraft = operation.atomTypesChanged === true;
        const type = operation.draft?.atomTypes?.[0]?.trim() ?? '';
        if (!label || label.includes('/') || label.length > 200) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Edited Atom requires a non-empty name without slash');
        }
        if (type && (!/^[\p{L}\p{N}_-]+$/u.test(type) || type.length > 80)) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Atom type requires one safe @type name');
        }
        const currentName = path.split('/').at(-1);
        const thingCommand = `thing${hasTypeDraft ? `.typ.${type}` : ''}${label === currentName ? '' : `.ren.${label}`}`;
        const thingField = `${JSON.stringify(thingCommand)}:${JSON.stringify(path)}`;
        return `transform {${thingField},${JSON.stringify(`situation.rep.${detail}`)}}`;
      }

      if (operation?.kind === 'node-land') {
        const command = landingTransform(operation);
        if (command.new) return `transform new ${JSON.stringify(command.new)}`;
        return `transform ${JSON.stringify(command)}`;
      }

      if (operation?.kind === 'node-land-batch') {
        const landings = Array.isArray(operation.landings) ? operation.landings : [];
        if (landings.length < 2) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Batch landing requires at least two nodes');
        }
        const commands = landings.map(landingTransform);
        if (commands.some((command) => command.new)) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Batch landing requires existing Atom nodes');
        }
        return `transform ${JSON.stringify(commands)}`;
      }

      if (operation?.kind === 'edge-create') {
        const sourcePath = requireAtomPath(operation.source?.key, operation.source);
        const targetPath = requireAtomPath(operation.target?.key, operation.target);
        const source = graphByPath.get(sourcePath);
        const support = structuredClone(axisEntry(source, 'support')?.[1] ?? []);
        const outbound = support.find((rule) => (
          rule?.['if@current'] === true && !Object.hasOwn(rule, 'if') && Array.isArray(rule.then)
        ));
        if (outbound) {
          if (outbound.then.some((selector) => resolveSupportPath(sourcePath, selector?.thing) === targetPath)) {
            throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Web cannot duplicate one directed Atom support relation');
          }
          outbound.then.push({ thing: targetPath });
        } else {
          support.push({ 'if@current': true, then: [{ thing: targetPath }] });
        }
        return replaceSupport(sourcePath, support);
      }

      if (operation?.kind === 'edge-edit') {
        const sourcePath = requireAtomPath(operation.edge?.from?.key, operation.edge?.from);
        const targetPath = requireAtomPath(operation.edge?.to?.key, operation.edge?.to);
        const source = graphByPath.get(sourcePath);
        const support = structuredClone(axisEntry(source, 'support')?.[1] ?? []);
        const matching = support.flatMap((rule, ruleIndex) => (
          rule?.['if@current'] === true && !Object.hasOwn(rule, 'if') && Array.isArray(rule.then)
            ? rule.then.map((selector, thenIndex) => ({ rule, ruleIndex, selector, thenIndex }))
            : []
        )).filter(({ selector }) => resolveSupportPath(sourcePath, selector.thing) === targetPath);
        if (matching.length !== 1) {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Web relation edit requires one exact directed Atom relation');
        }
        if (operation.status === 'delete') {
          matching[0].rule.then.splice(matching[0].thenIndex, 1);
          if (matching[0].rule.then.length === 0) support.splice(matching[0].ruleIndex, 1);
        }
        else if (operation.edge?.label && operation.edge.label !== 'support') {
          throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Atom support relation label is fixed');
        }
        return replaceSupport(sourcePath, support);
      }

      throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Unsupported Human Web workspace operation');
    }
  });
}

export function createLegacyRuntimeComposition(options) {
  const {
    contextFile,
    graphFile,
    storeFile,
    worldService = createLegacyWorldService(),
    projectionOrchestrator = null,
    diagnostics = null,
    programScheduler = createProgramRuntimeScheduler({ diagnosticRecorder: diagnostics }),
    graphPublisher = defaultGraphPublisher(graphFile),
    spatialPublisher = defaultSpatialPublisher(storeFile),
    feedbackRecorder = recordAtomFeedback,
    agentResolver = resolveAgentContext,
    humanStatusTranslator = createLegacyHumanStatusTranslator({ graphFile }),
    humanWorkspaceTranslator = createLegacyHumanWorkspaceTranslator({ graphFile })
  } = options ?? {};
  const activeProjectionOrchestrator = projectionOrchestrator
    ?? createLegacyProjectionOrchestrator({ contextFile, programScheduler });

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

  return createInteractionRuntime({
    world: {
      execute: ({ programRuntime, ...request }) => worldService.executeLegacy({
        ...request,
        contextFile,
        projectionFile: graphFile,
        programScheduler: programRuntime
      })
    },
    projections,
    feedback: {
      submit: (request) => feedbackRecorder({ ...request, contextFile })
    },
    agents: {
      resolve: async (agentPath) => agentResolver(contextFile, agentPath, {
        compatibilityManifest: typeof worldService.compatibilityManifest === 'function'
          ? await worldService.compatibilityManifest({
            contextFile,
            projectionFile: graphFile
          })
          : null
      })
    },
    humanStatus: humanStatusTranslator,
    humanWorkspace: humanWorkspaceTranslator,
    programRuntime: programScheduler,
    diagnostics
  });
}
