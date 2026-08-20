import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBossStore } from './boss-store.mjs';
import { createBossBackupTrigger } from './boss-backup-trigger.mjs';
import { SpatialStoreError, createStore } from './store.mjs';
import { VERSION } from './version.mjs';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  response.end(`${JSON.stringify(value)}\n`);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new SpatialStoreError('REQUEST_TOO_LARGE', '请求体过大');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export async function createSpatialServer(options = {}) {
  const root = path.resolve(options.root || projectRoot);
  const storeFile = path.resolve(options.storeFile || path.join(root, 'data', 'knowledge.json'));
  const graphFile = options.graphFile ? path.resolve(options.graphFile) : null;
  const bossDirectory = options.bossDirectory ? path.resolve(options.bossDirectory) : null;
  const bossStore = bossDirectory ? createBossStore(bossDirectory) : null;
  const store = bossStore || createStore(storeFile);
  await store.init();
  const backupTrigger = bossStore && options.backupRepository
    ? createBossBackupTrigger({
        bossDirectory,
        backupRepository: options.backupRepository,
        branch: options.backupBranch,
        delayMs: options.backupDelayMs
      })
    : null;
  backupTrigger?.start();
  let atomInteractionTail = Promise.resolve();
  const knowledgeSubscribers = new Set();
  const mutatingSpatialMethods = new Set([
    'knowledge.replace', 'node.create', 'node.update', 'node.delete', 'node.land',
    'edge.create', 'edge.update', 'edge.delete'
  ]);

  function publishKnowledgeChange(knowledge) {
    const message = `data: ${JSON.stringify({ revision: knowledge.revision })}\n\n`;
    for (const subscriber of [...knowledgeSubscribers]) {
      try {
        subscriber.write(message);
      } catch {
        knowledgeSubscribers.delete(subscriber);
      }
    }
  }

  function enqueueAtomInteraction(operation) {
    const current = atomInteractionTail.then(operation, operation);
    atomInteractionTail = current.then(() => undefined, () => undefined);
    return current;
  }

  async function readKnowledge() {
    return bossStore ? (await bossStore.readAll()).knowledge : store.read();
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
          'access-control-allow-headers': 'content-type'
        });
        return response.end();
      }
      if (url.pathname === '/__spatial/api/health') {
        const knowledge = await readKnowledge();
        return json(response, 200, {
          ok: true,
          version: VERSION,
          revision: knowledge.revision,
          mode: bossStore ? 'boss' : 'single',
          atomWorkspace: typeof options.atomWorkspaceEdit === 'function',
          store: bossStore ? bossDirectory : store.file,
          ...(graphFile ? { graphFile } : {})
        });
      }
      if (url.pathname === '/__spatial/api/events' && request.method === 'GET') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive'
        });
        response.write(': connected\n\n');
        knowledgeSubscribers.add(response);
        request.on('close', () => knowledgeSubscribers.delete(response));
        return;
      }
      if (
        graphFile
        && url.pathname === '/__spatial/api/graph'
        && request.method === 'GET'
      ) {
        return json(response, 200, JSON.parse(await fs.readFile(graphFile, 'utf8')));
      }
      if (url.pathname === '/__spatial/api/state' && request.method === 'GET') {
        return json(response, 200, { ok: true, knowledge: await readKnowledge() });
      }
      if (url.pathname === '/__atom/api/work-order-registry' && request.method === 'GET') {
        if (typeof options.atomWorkOrderRegistry !== 'function') {
          return json(response, 404, {
            ok: false,
            error: { code: 'ATOM_WORK_ORDER_REGISTRY_UNAVAILABLE' }
          });
        }
        return json(response, 200, {
          ok: true,
          result: await options.atomWorkOrderRegistry()
        });
      }
      if (url.pathname === '/__spatial/api/state' && request.method === 'PUT') {
        if (options.atomProjectionReadOnly === true) {
          return json(response, 409, {
            ok: false,
            error: {
              code: 'ATOM_PROJECTION_READ_ONLY',
              message: 'Atom projections are rebuilt from atom.json; submit a semantic Atom workspace edit instead'
            }
          });
        }
        const payload = await body(request);
        if (bossStore) {
          const knowledge = await bossStore.replaceAll(payload.knowledge, {
            confirmedRecursiveDeleteNodeIds: payload.confirmedRecursiveDeleteNodeIds
          });
          publishKnowledgeChange(knowledge);
          return json(response, 200, { ok: true, result: { knowledge, revision: knowledge.revision } });
        }
        const result = await store.execute('knowledge.replace', payload);
        publishKnowledgeChange(result.knowledge);
        return json(response, 200, { ok: true, result });
      }
      if (url.pathname === '/__spatial/api/view' && request.method === 'PUT') {
        const payload = await body(request);
        if (bossStore) {
          if (!payload.bossId) return json(response, 200, { ok: true, result: { skipped: true } });
          return json(response, 200, {
            ok: true,
            result: await bossStore.execute(payload.bossId, 'view.update', payload)
          });
        }
        return json(response, 200, { ok: true, result: await store.execute('view.update', payload) });
      }
      if (url.pathname === '/__spatial/api/command' && request.method === 'POST') {
        const payload = await body(request);
        if (bossStore) {
          if (!payload.bossId) throw new SpatialStoreError('BOSS_REQUIRED', 'Boss 模式命令必须指定 bossId');
          return json(response, 200, {
            ok: true,
            result: await bossStore.execute(payload.bossId, payload.method, payload.params || {})
          });
        }
        const result = await store.execute(payload.method, payload.params || {});
        if (mutatingSpatialMethods.has(payload.method)) publishKnowledgeChange(await readKnowledge());
        return json(response, 200, { ok: true, result });
      }
      if (url.pathname === '/__atom/api/command' && request.method === 'POST') {
        if (typeof options.atomCommand !== 'function') {
          return json(response, 404, { ok: false, error: { code: 'ATOM_COMMAND_UNAVAILABLE' } });
        }
        const payload = await body(request);
        const result = await enqueueAtomInteraction(async () => {
          const commandResult = await options.atomCommand(payload);
          if (graphFile) {
            const document = JSON.parse(await fs.readFile(graphFile, 'utf8'));
            if (options.projectAtomKnowledge) {
              await store.execute('knowledge.replace', {
                knowledge: await options.projectAtomKnowledge(document, commandResult)
              });
            }
          }
          return commandResult;
        });
        publishKnowledgeChange(await readKnowledge());
        return json(response, 200, { ok: true, result });
      }
      if (url.pathname === '/__atom/api/human-status' && request.method === 'POST') {
        if (typeof options.atomHumanStatus !== 'function') {
          return json(response, 404, { ok: false, error: { code: 'ATOM_HUMAN_STATUS_UNAVAILABLE' } });
        }
        const payload = await body(request);
        const result = await enqueueAtomInteraction(async () => {
          const commandResult = await options.atomHumanStatus(payload);
          if (graphFile) {
            const document = JSON.parse(await fs.readFile(graphFile, 'utf8'));
            if (options.projectAtomKnowledge) {
              await store.execute('knowledge.replace', {
                knowledge: await options.projectAtomKnowledge(document, commandResult)
              });
            }
          }
          return commandResult;
        });
        const knowledge = await readKnowledge();
        publishKnowledgeChange(knowledge);
        return json(response, 200, { ok: true, result, knowledge });
      }
      if (url.pathname === '/__atom/api/workspace-edit' && request.method === 'POST') {
        if (typeof options.atomWorkspaceEdit !== 'function') {
          return json(response, 404, { ok: false, error: { code: 'ATOM_WORKSPACE_EDIT_UNAVAILABLE' } });
        }
        const payload = await body(request);
        const result = await enqueueAtomInteraction(() => options.atomWorkspaceEdit(payload));
        const knowledge = await readKnowledge();
        publishKnowledgeChange(knowledge);
        return json(response, 200, { ok: true, result, knowledge });
      }
      if (url.pathname === '/__atom/api/recover-projection' && request.method === 'POST') {
        const remoteAddress = request.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)) {
          return json(response, 403, { ok: false, error: { code: 'LOCAL_MAINTENANCE_REQUIRED' } });
        }
        if (typeof options.atomProjectionRecover !== 'function') {
          return json(response, 404, { ok: false, error: { code: 'ATOM_PROJECTION_RECOVERY_UNAVAILABLE' } });
        }
        const payload = await body(request);
        const result = await enqueueAtomInteraction(() => options.atomProjectionRecover(payload));
        return json(response, 200, { ok: true, result });
      }
      if (bossStore && url.pathname === '/__spatial/api/boss/undo' && request.method === 'POST') {
        const payload = await body(request);
        const result = await bossStore.undo(payload.bossId);
        return json(response, 200, { ok: true, result, knowledge: await readKnowledge() });
      }
      if (bossStore && url.pathname === '/__spatial/api/boss/redo' && request.method === 'POST') {
        const payload = await body(request);
        const result = await bossStore.redo(payload.bossId);
        return json(response, 200, { ok: true, result, knowledge: await readKnowledge() });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^[/\\]+/, '');
      const file = path.resolve(root, relative);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) return json(response, 403, { ok: false, error: { code: 'PATH_FORBIDDEN' } });
      const content = await fs.readFile(file);
      response.writeHead(200, {
        'content-type': MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
        'cache-control': 'no-cache'
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const notFound = error.code === 'ENOENT';
      json(response, notFound ? 404 : 400, {
        ok: false,
        error: {
          code: notFound ? 'NOT_FOUND' : (error.code || 'INTERNAL_ERROR'),
          message: error.message,
          details: error.details || {}
        }
      });
    }
  });
  server.once('close', () => backupTrigger?.close());

  return {
    server,
    store,
    bossStore,
    backupTrigger,
    root,
    storeFile: bossStore ? bossDirectory : storeFile,
    graphFile,
    mode: bossStore ? 'boss' : 'single'
  };
}

export async function listenSpatialServer(options = {}) {
  const instance = await createSpatialServer(options);
  const host = options.host || '127.0.0.1';
  const port = Number(options.port) || 4783;
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(port, host, resolve);
  });
  return { ...instance, host, port, url: `http://${host}:${port}/` };
}
