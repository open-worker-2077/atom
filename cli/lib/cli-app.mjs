import path from 'node:path';
import readline from 'node:readline/promises';

import { probeKnowledge } from './probe.mjs';
import { createQueryBudget, QueryBudgetError, queryBudgetFile } from './query-budget.mjs';
import { listenSpatialServer, projectRoot } from './server.mjs';
import { createBossStore } from './boss-store.mjs';
import { SpatialStoreError, createStore } from './store.mjs';
import { VERSION } from './version.mjs';

const READ_METHODS = new Set([
  'field.get',
  'view.get',
  'node.list',
  'node.get',
  'edge.list',
  'search',
  'probe'
]);

const PROBE_DIRECTIONS = ['down', 'up', 'vertical', 'forward', 'backward', 'level', 'all'];

function parse(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split('=', 2);
    if (['json', 'help', 'version', 'recursive'].includes(rawName)) {
      options[rawName] = inline === undefined ? true : inline !== 'false';
      continue;
    }
    const next = inline === undefined ? argv[index + 1] : inline;
    if (next === undefined || (inline === undefined && next.startsWith('--'))) {
      throw new SpatialStoreError('INVALID_ARGUMENT', `--${rawName} 需要一个值`);
    }
    options[rawName] = next;
    if (inline === undefined) index += 1;
  }
  return { positional, options };
}

function help(version = VERSION) {
  return `spatial ${version}\n\n` +
    `用法:\n` +
    `  spatial init|doctor|serve [--store 文件] [--port 4783]\n` +
    `  spatial boss init|list|create <bossId> [--boss-dir 目录] [--name 名称]\n` +
    `  spatial boss undo|redo <bossId> [--boss-dir 目录]\n` +
    `  spatial boss restore <bossId> <versionId> [--side before|after]\n` +
    `  spatial probe [关键词] [--dir down|up|vertical|forward|backward|level|all] [--steps 数字]\n` +
    `  spatial confirm <确认编号> y|n\n` +
    `  spatial field get [--scope current|all] [--path 域径]\n` +
    `  spatial view get\n` +
    `  spatial node list|get|create|update|land|delete ...\n` +
    `  spatial node land <节点键> --path <目标域径> --x <数值> --y <数值> --z <数值>\n` +
    `  spatial edge list|create|delete ...\n` +
    `  spatial search <关键词>\n\n` +
    `节点键格式: <域径>::<节点 ID>。所有新节点都是可进入的隧洞球。`;
}

function storePath(options, env) {
  return path.resolve(options.store || env.SPATIAL_STORE || path.join(projectRoot, 'data', 'knowledge.json'));
}

function bossDirectory(options, env) {
  return path.resolve(options['boss-dir'] || env.SPATIAL_BOSS_DIR || path.join(projectRoot, 'data', 'boss-data'));
}

function serialize(value, compact) {
  return `${JSON.stringify(value, null, compact ? 0 : 2)}\n`;
}

function methodFrom(parsed) {
  const [group, action] = parsed.positional;
  if (group === 'probe') return ['probe', {
    query: parsed.positional.slice(1).join(' '),
    direction: parsed.options.dir,
    steps: parsed.options.steps
  }];
  if (group === 'field' && action === 'get') return ['field.get', { scope: parsed.options.scope, path: parsed.options.path }];
  if (group === 'view' && action === 'get') return ['view.get', {}];
  if (group === 'node' && action === 'list') return ['node.list', { scope: parsed.options.scope, path: parsed.options.path }];
  if (group === 'node' && action === 'get') return ['node.get', { key: parsed.positional[2] }];
  if (group === 'node' && action === 'create') return ['node.create', {
    path: parsed.options.path || 'root',
    id: parsed.options.id,
    nodeId: parsed.options.id,
    leaderId: parsed.options.leader,
    label: parsed.options.name || parsed.options.label,
    detail: parsed.options.detail || ''
  }];
  if (group === 'node' && action === 'update') return ['node.update', {
    key: parsed.positional[2],
    leaderId: parsed.options.leader,
    label: parsed.options.name || parsed.options.label,
    detail: parsed.options.detail
  }];
  if (group === 'node' && action === 'land') return ['node.land', {
    key: parsed.positional[2],
    path: parsed.options.path,
    position: { x: parsed.options.x, y: parsed.options.y, z: parsed.options.z }
  }];
  if (group === 'node' && action === 'delete') return ['node.delete', {
    key: parsed.positional[2],
    recursive: parsed.options.recursive === true
  }];
  if (group === 'edge' && action === 'list') return ['edge.list', { scope: parsed.options.scope, path: parsed.options.path }];
  if (group === 'edge' && action === 'create') return ['edge.create', {
    from: parsed.positional[2],
    to: parsed.positional[3],
    label: parsed.options.label
  }];
  if (group === 'edge' && action === 'delete') return ['edge.delete', { id: parsed.positional[2] }];
  if (group === 'search') return ['search', { query: parsed.positional.slice(1).join(' '), limit: parsed.options.limit }];
  throw new SpatialStoreError('INVALID_COMMAND', '无法识别命令；运行 spatial --help 查看用法');
}

function configuredInteger(env, name, fallback) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function createBudget(file, env) {
  return createQueryBudget({
    file: queryBudgetFile(file),
    windowMs: configuredInteger(env, 'SPATIAL_QUERY_WINDOW_MS', 10_000),
    maxNodes: configuredInteger(env, 'SPATIAL_QUERY_MAX_NODES', 100),
    maxCharacters: configuredInteger(env, 'SPATIAL_QUERY_MAX_CHARS', 100_000)
  });
}

function resultNodeCount(method, result) {
  if (method === 'probe') return Number(result?.stats?.nodeCount) || 0;
  if (method === 'field.get' || method === 'node.list') return Array.isArray(result?.nodes) ? result.nodes.length : 0;
  if (method === 'node.get') return result?.node ? 1 : 0;
  if (method === 'search') return Array.isArray(result?.results) ? result.results.length : 0;
  return 0;
}

function usageFor(method, result, compact) {
  const payload = { ok: true, result };
  const output = serialize(payload, compact);
  return { payload, output, nodes: resultNodeCount(method, result), characters: output.length };
}

function probeAlternatives(knowledge, params, compact, windowUsage) {
  const maximumStep = Number(params.steps ?? 0);
  const steps = Number.isSafeInteger(maximumStep) && maximumStep >= 0 ? maximumStep : 0;
  const alternatives = [];
  for (const direction of PROBE_DIRECTIONS) {
    for (let step = 0; step <= steps; step += 1) {
      const result = probeKnowledge(knowledge, { query: params.query, direction, steps: step });
      const measured = usageFor('probe', result, compact);
      const next = { nodes: measured.nodes, characters: measured.characters };
      alternatives.push({
        direction,
        steps: step,
        next,
        projected: {
          nodes: windowUsage.nodes + next.nodes,
          characters: windowUsage.characters + next.characters
        }
      });
    }
  }
  return alternatives;
}

async function askDecision(io) {
  const terminal = readline.createInterface({ input: io.stdin, output: io.stderr });
  try {
    while (true) {
      const answer = (await terminal.question('查询超过短时预算，仍然返回全部结果？[y/N] ')).trim().toLocaleLowerCase('en-US');
      if (answer === 'y' || answer === 'n' || answer === '') return answer === 'y' ? 'y' : 'n';
    }
  } finally {
    terminal.close();
  }
}

async function executeConfirmed(store, budget, resolution, io, compactFallback) {
  if (!resolution.confirmed) {
    io.stdout.write(serialize({ ok: true, cancelled: true }, compactFallback));
    return 0;
  }
  const request = resolution.request;
  if (!request || !READ_METHODS.has(request.method)) {
    throw new QueryBudgetError('INVALID_CONFIRMATION_REQUEST', 'Confirmation does not slot a safe read query');
  }
  const result = await store.execute(request.method, request.params || {});
  const measured = usageFor(request.method, result, request.compact === true);
  await budget.commitConfirmed(measured);
  io.stdout.write(measured.output);
  return 0;
}

export async function runSpatialCli(argv, overrides = {}) {
  const io = {
    env: overrides.env || process.env,
    stdin: overrides.stdin || process.stdin,
    stdout: overrides.stdout || process.stdout,
    stderr: overrides.stderr || process.stderr,
    interactive: overrides.interactive ?? Boolean(process.stdin.isTTY)
  };
  try {
    const parsed = parse(argv);
    if (parsed.options.version || parsed.positional[0] === 'version') {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (parsed.options.help || parsed.positional.length === 0) {
      io.stdout.write(`${help()}\n`);
      return 0;
    }
    const file = storePath(parsed.options, io.env);
    const bossDir = bossDirectory(parsed.options, io.env);
    if (parsed.positional[0] === 'boss') {
      const bossStore = createBossStore(bossDir);
      await bossStore.init();
      const action = parsed.positional[1];
      if (action === 'init') {
        io.stdout.write(serialize({ ok: true, bossDirectory: bossDir, catalog: await bossStore.readCatalog() }, parsed.options.json));
        return 0;
      }
      if (action === 'list') {
        io.stdout.write(serialize({ ok: true, bosses: (await bossStore.readCatalog()).bosses }, parsed.options.json));
        return 0;
      }
      if (action === 'create') {
        const result = await bossStore.createBoss({
          bossId: parsed.positional[2],
          label: parsed.options.name || parsed.options.label
        });
        io.stdout.write(serialize({ ok: true, result }, parsed.options.json));
        return 0;
      }
      if (action === 'undo' || action === 'redo') {
        const result = await bossStore[action](parsed.positional[2]);
        io.stdout.write(serialize({ ok: true, result }, parsed.options.json));
        return 0;
      }
      if (action === 'restore') {
        const result = await bossStore.restoreHistory(
          parsed.positional[2],
          parsed.positional[3],
          parsed.options.side || 'before'
        );
        io.stdout.write(serialize({ ok: true, result }, parsed.options.json));
        return 0;
      }
      throw new SpatialStoreError('INVALID_COMMAND', 'boss 命令支持 init、list、create、undo、redo、restore');
    }

    if (parsed.options.boss) {
      const bossStore = createBossStore(bossDir);
      await bossStore.init();
      const [method, params] = methodFrom(parsed);
      const result = await bossStore.execute(parsed.options.boss, method, params);
      io.stdout.write(serialize({ ok: true, result }, parsed.options.json));
      return 0;
    }

    const store = createStore(file);
    if (parsed.positional[0] === 'init') {
      const knowledge = await store.init();
      io.stdout.write(serialize({ ok: true, store: file, revision: knowledge.revision }, parsed.options.json));
      return 0;
    }
    if (parsed.positional[0] === 'doctor') {
      const knowledge = await store.init();
      io.stdout.write(serialize({ ok: true, version: VERSION, node: process.version, store: file, revision: knowledge.revision }, parsed.options.json));
      return 0;
    }
    if (parsed.positional[0] === 'serve') {
      const instance = await listenSpatialServer({
        root: projectRoot,
        storeFile: file,
        bossDirectory: parsed.options['boss-dir'] ? bossDir : undefined,
        backupRepository: io.env.WORLD_MODELING_BOSS_BACKUP_REPO,
        backupBranch: io.env.WORLD_MODELING_BOSS_BACKUP_BRANCH || 'main',
        backupDelayMs: io.env.WORLD_MODELING_BOSS_BACKUP_DELAY_MS,
        port: parsed.options.port,
        host: parsed.options.host
      });
      io.stdout.write(serialize({ ok: true, url: instance.url, store: instance.storeFile, pid: process.pid }, parsed.options.json));
      return 0;
    }

    await store.init();
    const budget = createBudget(file, io.env);
    if (parsed.positional[0] === 'confirm') {
      const id = parsed.positional[1];
      const decision = parsed.positional[2];
      const resolution = await budget.takePending(id, decision);
      return executeConfirmed(store, budget, resolution, io, parsed.options.json === true);
    }

    const [method, params] = methodFrom(parsed);
    const result = await store.execute(method, params);
    const compact = parsed.options.json === true;
    if (!READ_METHODS.has(method)) {
      io.stdout.write(serialize({ ok: true, result }, compact));
      return 0;
    }

    const measured = usageFor(method, result, compact);
    const request = { method, params, compact };
    const report = await budget.gate({ nodes: measured.nodes, characters: measured.characters, request });
    if (report.allowed) {
      io.stdout.write(measured.output);
      return 0;
    }

    if (io.interactive && !compact) {
      const decision = await askDecision(io);
      const resolution = await budget.takePending(report.confirmationId, decision);
      if (resolution.confirmed) {
        await budget.commitConfirmed(measured);
        io.stdout.write(measured.output);
        return 0;
      }
      io.stdout.write(serialize({ ok: true, cancelled: true }, compact));
      return 0;
    }

    const details = {
      confirmationId: report.confirmationId,
      window: report.window,
      next: report.next,
      projected: report.projected,
      limits: report.limits,
      confirmationCommand: `spatial confirm ${report.confirmationId} y --store "${file}" --json`
    };
    if (method === 'probe') details.alternatives = probeAlternatives(await store.read(), params, compact, report.window);
    throw new QueryBudgetError(
      'QUERY_BUDGET_CONFIRMATION_REQUIRED',
      '查询超过短时预算；回复 y 返回全部结果，回复 n 取消',
      details
    );
  } catch (error) {
    const payload = {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message,
        details: error.details || {}
      }
    };
    io.stderr.write(serialize(payload, true));
    if (error instanceof QueryBudgetError) return 5;
    if (error instanceof SpatialStoreError) return 4;
    return 1;
  }
}
