#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createSpatialServer,
  projectRoot
} from '../../cli/lib/server.mjs';
import { createLegacyWorldService } from '../../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createLegacyRuntimeComposition } from '../../src/atom-system/adapters/legacy-runtime-composition.mjs';
import { createAtomRuntimeBackupTrigger } from '../../src/atom-system/operations/atom-runtime-backup-trigger.mjs';
import { resolveAtomRuntime } from './runtime-config.mjs';
import { createProgramRuntimeScheduler } from './program-runtime.mjs';
import { ATOM_RUNTIME_CONTRACT } from './runtime-contract.mjs';

export const DEFAULT_ATOM_GRAPH_HOST = '127.0.0.1';
export const DEFAULT_ATOM_GRAPH_PORT = 4784;

const RESERVED_SPATIAL_PORT = 4783;
const runtime = resolveAtomRuntime();
const defaultFiles = Object.freeze({
  contextFile: runtime.contextFile,
  graphFile: runtime.graphFile,
  storeFile: runtime.storeFile
});

function problem(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function validateHost(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw problem('INVALID_ATOM_GRAPH_HOST', 'Atom Graph host 必须是非空字符串');
  }
  return value.trim();
}

function validatePort(value) {
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw problem(
      'INVALID_ATOM_GRAPH_PORT',
      'Atom Graph port 必须是 0 到 65535 之间的整数'
    );
  }
  if (port === RESERVED_SPATIAL_PORT) {
    throw problem(
      'RESERVED_ATOM_GRAPH_PORT',
      'Atom Graph 核查服务不得占用现有 4783 服务端口'
    );
  }
  return port;
}

function resolveJsonPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw problem(
      'INVALID_ATOM_GRAPH_PATH',
      `${label}必须是非空 JSON 文件路径`
    );
  }
  const file = path.resolve(value.trim());
  if (path.extname(file).toLowerCase() !== '.json') {
    throw problem(
      'INVALID_ATOM_GRAPH_PATH',
      `${label}必须使用 .json 文件`,
      { file }
    );
  }
  return file;
}

function pathIdentity(file) {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function validateDistinctPaths({ contextFile, graphFile, storeFile }) {
  const entries = [
    ['contextFile', contextFile],
    ['graphFile', graphFile],
    ['storeFile', storeFile]
  ];
  const seen = new Map();
  for (const [label, file] of entries) {
    const identity = pathIdentity(file);
    if (seen.has(identity)) {
      throw problem(
        'ATOM_GRAPH_PATH_COLLISION',
        'Atom context、Graph 投影和 Spatial store 必须使用三个不同文件',
        {
          first: seen.get(identity),
          second: label,
          file
        }
      );
    }
    seen.set(identity, label);
  }
}

function resolveConfiguration(options = {}) {
  const configuration = {
    host: validateHost(options.host ?? DEFAULT_ATOM_GRAPH_HOST),
    port: validatePort(options.port ?? DEFAULT_ATOM_GRAPH_PORT),
    contextFile: resolveJsonPath(
      options.contextFile ?? defaultFiles.contextFile,
      'Atom context 文件'
    ),
    graphFile: resolveJsonPath(
      options.graphFile ?? defaultFiles.graphFile,
      'Graph 投影文件'
    ),
    storeFile: resolveJsonPath(
      options.storeFile ?? defaultFiles.storeFile,
      'Spatial store 文件'
    )
  };
  validateDistinctPaths(configuration);
  return configuration;
}

function optionValue(argv, index, name) {
  const argument = argv[index];
  if (argument.startsWith(`${name}=`)) {
    return { value: argument.slice(name.length + 1), consumed: 0 };
  }
  return { value: argv[index + 1], consumed: 1 };
}

export function parseAtomGraphServerArgs(argv = []) {
  const options = {};
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--host' || argument.startsWith('--host=')) {
      const parsed = optionValue(argv, index, '--host');
      options.host = parsed.value;
      index += parsed.consumed;
      continue;
    }
    if (argument === '--port' || argument.startsWith('--port=')) {
      const parsed = optionValue(argv, index, '--port');
      options.port = parsed.value;
      index += parsed.consumed;
      continue;
    }
    if (argument === '--context' || argument.startsWith('--context=')) {
      const parsed = optionValue(argv, index, '--context');
      options.contextFile = parsed.value;
      index += parsed.consumed;
      continue;
    }
    if (argument === '--graph' || argument.startsWith('--graph=')) {
      const parsed = optionValue(argv, index, '--graph');
      options.graphFile = parsed.value;
      index += parsed.consumed;
      continue;
    }
    if (argument === '--store' || argument.startsWith('--store=')) {
      const parsed = optionValue(argv, index, '--store');
      options.storeFile = parsed.value;
      index += parsed.consumed;
      continue;
    }
    throw problem(
      'UNKNOWN_ATOM_GRAPH_OPTION',
      `未知 Atom Graph 服务参数：${argument}`
    );
  }
  return { ...resolveConfiguration(options), help };
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function displayHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

export function createAtomGraphHandlers(interactionRuntime) {
  if (typeof interactionRuntime?.execute !== 'function'
    || typeof interactionRuntime?.updateHumanStatus !== 'function'
    || typeof interactionRuntime?.updateHumanWorkspace !== 'function'
    || typeof interactionRuntime?.recover !== 'function') {
    throw problem('INVALID_INTERACTION_RUNTIME', 'Atom Graph handlers require one interaction runtime');
  }
  return Object.freeze({
    async atomCommand(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.source !== 'string') {
        throw problem('INVALID_ATOM_COMMAND_REQUEST', 'Atom command endpoint requires source and optional interaction.agent');
      }
      const agent = payload.interaction?.agent;
      if (!agent || typeof agent.ref !== 'string' || typeof agent.path !== 'string') {
        throw problem('AGENT_REQUIRED', 'Atom command endpoint requires a revision-local @agent origin');
      }
      const result = await interactionRuntime.execute({
        source: payload.source,
        correlationId: payload.interaction?.id ?? crypto.randomUUID(),
        agentPath: agent.path,
        history: Array.isArray(payload.history) ? payload.history : []
      });
      return { ...result, runtimeContract: ATOM_RUNTIME_CONTRACT };
    },
    async atomHumanStatus(payload) {
      if (!payload || typeof payload.key !== 'string' || typeof payload.detail !== 'string') {
        throw problem('INVALID_HUMAN_STATUS_REQUEST', 'Human status requires a projected node key and detail');
      }
      return interactionRuntime.updateHumanStatus({
        key: payload.key,
        detail: payload.detail,
        correlationId: payload.interactionId ?? crypto.randomUUID()
      });
    },
    async atomWorkspaceEdit(payload) {
      if (!payload?.operation || typeof payload.operation !== 'object') {
        throw problem('INVALID_HUMAN_WORKSPACE_REQUEST', 'Human workspace edit requires an operation');
      }
      return interactionRuntime.updateHumanWorkspace({
        operation: payload.operation,
        correlationId: payload.interactionId ?? crypto.randomUUID()
      });
    },
    async atomProjectionRecover(payload) {
      if (!payload || typeof payload.expectedRevision !== 'string' || !payload.expectedRevision.trim()) {
        throw problem('INVALID_WORLD_REVISION', 'Projection recovery requires expectedRevision');
      }
      return interactionRuntime.recover({ expectedRevision: payload.expectedRevision.trim() });
    }
  });
}

export async function startAtomGraphServer(options = {}) {
  const configuration = resolveConfiguration(options);
  const backupRepository = options.backupRepository ?? process.env.ATOM_RUNTIME_BACKUP_REPO;
  const backupTriggerFactory = options.backupTriggerFactory ?? createAtomRuntimeBackupTrigger;
  const backupTrigger = options.backupTrigger ?? (backupRepository ? backupTriggerFactory({
    worldDirectory: path.dirname(configuration.contextFile),
    backupRepository,
    branch: options.backupBranch ?? process.env.ATOM_RUNTIME_BACKUP_BRANCH ?? 'runtime-data',
    delayMs: options.backupDelayMs ?? process.env.ATOM_RUNTIME_BACKUP_DELAY_MS
  }) : null);
  const programScheduler = options.programScheduler ?? createProgramRuntimeScheduler();
  const worldService = options.worldService ?? createLegacyWorldService({
    onAuthoritativeWrite: () => backupTrigger?.schedule()
  });
  const interactionRuntime = options.interactionRuntime ?? createLegacyRuntimeComposition({
    contextFile: configuration.contextFile,
    graphFile: configuration.graphFile,
    storeFile: configuration.storeFile,
    programScheduler,
    worldService,
    ...(options.projectionOrchestrator ? { projectionOrchestrator: options.projectionOrchestrator } : {})
  });
  const handlers = createAtomGraphHandlers(interactionRuntime);

  const initialized = await interactionRuntime.initialize({
    correlationId: options.startupCorrelationId ?? crypto.randomUUID()
  });
  const initialization = initialized.initialization;
  if (!initialization.ok) {
    throw problem(
      'ATOM_GRAPH_INITIALIZATION_FAILED',
      'Atom context 或 Graph 投影初始化失败',
      { errors: initialization.errors ?? [] }
    );
  }

  const instance = await createSpatialServer({
    root: options.root ?? projectRoot,
    storeFile: configuration.storeFile,
    graphFile: configuration.graphFile,
    atomProjectionReadOnly: true,
    atomCommand: handlers.atomCommand,
    atomHumanStatus: handlers.atomHumanStatus,
    atomWorkspaceEdit: handlers.atomWorkspaceEdit,
    atomProjectionRecover: handlers.atomProjectionRecover
  });
  backupTrigger?.start();
  instance.server.once('close', () => backupTrigger?.close());
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      instance.server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      instance.server.off('error', onError);
      resolve();
    };
    instance.server.once('error', onError);
    instance.server.once('listening', onListening);
    instance.server.listen({
      host: configuration.host,
      port: configuration.port
    });
  });

  const address = instance.server.address();
  const host = typeof address === 'object' && address
    ? address.address
    : configuration.host;
  const port = typeof address === 'object' && address
    ? address.port
    : configuration.port;
  return Object.freeze({
    ...instance,
    host,
    port,
    url: `http://${displayHost(host)}:${port}`,
    contextFile: configuration.contextFile,
    graphFile: configuration.graphFile,
    storeFile: configuration.storeFile,
    initialization,
    interactionRuntime,
    programScheduler,
    backupTrigger,
    close: () => closeServer(instance.server)
  });
}

function help() {
  return [
    'Atom Graph 核查服务（复用完整 Spatial Graph UI）',
    '',
    `  node graph-server.mjs [--host ${DEFAULT_ATOM_GRAPH_HOST}] [--port ${DEFAULT_ATOM_GRAPH_PORT}]`,
    '    [--context atom.json] [--graph graph.json] [--store knowledge.json]',
    '',
    `默认目录：${defaultLiveDirectory}`,
    '4783 为现有服务保留，不能由本服务占用。'
  ].join('\n');
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentFile = path.resolve(fileURLToPath(import.meta.url));
if (invokedFile === currentFile) {
  try {
    const options = parseAtomGraphServerArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${help()}\n`);
    } else {
      const running = await startAtomGraphServer(options);
      process.stdout.write(`Atom Graph 核查服务：${running.url}\n`);
      process.stdout.write(`Atom context：${running.contextFile}\n`);
      process.stdout.write(`Graph projection：${running.graphFile}\n`);
      process.stdout.write(`Spatial store：${running.storeFile}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: error.code ?? 'ATOM_GRAPH_SERVER_ERROR',
        message: error.message,
        details: error.details ?? {}
      }
    })}\n`);
    process.exitCode = 1;
  }
}
