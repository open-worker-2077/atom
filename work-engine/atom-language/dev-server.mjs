#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAtomLanguageReceiver } from './receiver.mjs';

export const DEFAULT_ATOM_LANGUAGE_DEV_HOST = '127.0.0.1';
export const DEFAULT_ATOM_LANGUAGE_DEV_PORT = 4794;
export const DEFAULT_ATOM_LANGUAGE_DEV_MAX_BODY_BYTES = 64 * 1024;

const RESERVED_SERVICE_PORTS = new Set([4783, 4784]);

const DEBUG_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atom Language P0 调试器</title>
  <style>
    body { max-width: 880px; margin: 2rem auto; padding: 0 1rem; font: 16px/1.5 system-ui, sans-serif; }
    textarea, pre { box-sizing: border-box; width: 100%; min-height: 12rem; padding: .75rem; }
    button { margin: .75rem 0; padding: .55rem 1rem; }
    pre { overflow: auto; background: #f5f5f5; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Atom Language P0 调试器</h1>
  <textarea id="source">explore {
  "thing": "石器工坊",
  "situation$full",
  "contain$latitude+2"
}</textarea>
  <button id="parse" type="button">解析</button>
  <pre id="result" aria-live="polite">等待输入。</pre>
  <script>
    const source = document.querySelector('#source');
    const result = document.querySelector('#result');
    document.querySelector('#parse').addEventListener('click', async () => {
      result.textContent = '解析中…';
      try {
        const response = await fetch('/parse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: source.value })
        });
        result.textContent = JSON.stringify(await response.json(), null, 2);
      } catch (error) {
        result.textContent = String(error);
      }
    });
  </script>
</body>
</html>
`;

function problem(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  response.end(body);
}

function sendHtml(response) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(DEBUG_PAGE),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(DEBUG_PAGE);
}

function validateMaxBodyBytes(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw problem(
      'INVALID_MAX_BODY_BYTES',
      'maxBodyBytes 必须是正安全整数'
    );
  }
  return value;
}

function readBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      request.resume();
      reject(problem(
        'REQUEST_BODY_TOO_LARGE',
        `请求体不得超过 ${maxBodyBytes} 字节`,
        413
      ));
      return;
    }

    const chunks = [];
    let byteLength = 0;
    let settled = false;
    request.on('data', (chunk) => {
      if (settled) return;
      byteLength += chunk.length;
      if (byteLength > maxBodyBytes) {
        settled = true;
        chunks.length = 0;
        reject(problem(
          'REQUEST_BODY_TOO_LARGE',
          `请求体不得超过 ${maxBodyBytes} 字节`,
          413
        ));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, byteLength).toString('utf8'));
    });
    request.on('aborted', () => {
      if (settled) return;
      settled = true;
      reject(problem('REQUEST_ABORTED', '请求在读取完成前中断'));
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(problem(
        'REQUEST_READ_ERROR',
        `无法读取请求体：${error.message}`
      ));
    });
  });
}

function parseRequestDocument(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw problem('INVALID_REQUEST_JSON', '请求体必须是严格 JSON');
  }
  if (typeof document?.source !== 'string') {
    throw problem(
      'INVALID_ATOM_LANGUAGE_SOURCE',
      '请求体必须包含字符串 source'
    );
  }
  return document;
}

function pathnameOf(request) {
  try {
    return new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    throw problem('INVALID_REQUEST_TARGET', '请求路径无效');
  }
}

async function handleRequest(request, response, context) {
  const pathname = pathnameOf(request);
  if (request.method === 'GET' && pathname === '/') {
    sendHtml(response);
    return;
  }
  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, {
      ok: true,
      service: 'atom-language-p0'
    });
    return;
  }
  if (request.method === 'POST' && pathname === '/parse') {
    try {
      const text = await readBody(request, context.maxBodyBytes);
      const document = parseRequestDocument(text);
      const result = context.receiver.receive(document.source);
      sendJson(response, 200, { ok: result.ok, result });
    } catch (error) {
      sendJson(response, error.statusCode ?? 400, {
        ok: false,
        error: {
          code: error.code ?? 'ATOM_LANGUAGE_DEV_REQUEST_ERROR',
          message: error.message
        }
      });
    }
    return;
  }
  if (pathname === '/' || pathname === '/health' || pathname === '/parse') {
    sendJson(response, 405, {
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: '此调试端点不支持该 HTTP 方法'
      }
    }, { allow: pathname === '/parse' ? 'POST' : 'GET' });
    return;
  }
  sendJson(response, 404, {
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: '未找到调试端点'
    }
  });
}

export function createAtomLanguageDevServer(options = {}) {
  const receiver = options.receiver
    ?? createAtomLanguageReceiver(options.receiverOptions);
  if (!receiver || typeof receiver.receive !== 'function') {
    throw problem(
      'INVALID_ATOM_LANGUAGE_RECEIVER',
      'receiver 必须提供 receive(source) 方法'
    );
  }
  const maxBodyBytes = validateMaxBodyBytes(
    options.maxBodyBytes ?? DEFAULT_ATOM_LANGUAGE_DEV_MAX_BODY_BYTES
  );
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, { receiver, maxBodyBytes })
      .catch((error) => {
        if (response.headersSent) {
          response.destroy(error);
          return;
        }
        sendJson(response, 500, {
          ok: false,
          error: {
            code: error.code ?? 'ATOM_LANGUAGE_DEV_SERVER_ERROR',
            message: error.message
          }
        });
      });
  });
  return server;
}

function validateHost(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw problem('INVALID_DEV_SERVER_HOST', 'host 必须是非空字符串');
  }
  return value.trim();
}

function validatePort(value) {
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw problem(
      'INVALID_DEV_SERVER_PORT',
      'port 必须是 0 到 65535 之间的整数'
    );
  }
  if (RESERVED_SERVICE_PORTS.has(port)) {
    throw problem(
      'RESERVED_DEV_SERVER_PORT',
      '解析调试服务不得占用现有 4783 或 Atom Graph 4784'
    );
  }
  return port;
}

export function parseAtomLanguageDevServerArgs(argv = []) {
  let host = DEFAULT_ATOM_LANGUAGE_DEV_HOST;
  let port = DEFAULT_ATOM_LANGUAGE_DEV_PORT;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--host' || argument.startsWith('--host=')) {
      const inline = argument.startsWith('--host=')
        ? argument.slice('--host='.length)
        : null;
      const value = inline ?? argv[index + 1];
      if (inline === null) index += 1;
      host = validateHost(value);
      continue;
    }
    if (argument === '--port' || argument.startsWith('--port=')) {
      const inline = argument.startsWith('--port=')
        ? argument.slice('--port='.length)
        : null;
      const value = inline ?? argv[index + 1];
      if (inline === null) index += 1;
      port = validatePort(value);
      continue;
    }
    throw problem(
      'UNKNOWN_DEV_SERVER_OPTION',
      `未知调试服务参数：${argument}`
    );
  }
  return { host: validateHost(host), port: validatePort(port), help };
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

export async function startAtomLanguageDevServer(options = {}) {
  const host = validateHost(
    options.host ?? DEFAULT_ATOM_LANGUAGE_DEV_HOST
  );
  const port = validatePort(
    options.port ?? DEFAULT_ATOM_LANGUAGE_DEV_PORT
  );
  const server = options.server ?? createAtomLanguageDevServer(options);
  if (!server || typeof server.listen !== 'function') {
    throw problem(
      'INVALID_DEV_HTTP_SERVER',
      'server 必须是可监听的 HTTP server'
    );
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host, port });
  });

  const address = server.address();
  const actualHost = typeof address === 'object' && address
    ? address.address
    : host;
  const actualPort = typeof address === 'object' && address
    ? address.port
    : port;
  return Object.freeze({
    server,
    host: actualHost,
    port: actualPort,
    url: `http://${displayHost(actualHost)}:${actualPort}`,
    close: () => closeServer(server)
  });
}

function help() {
  return [
    'Atom Language P0 本地调试服务',
    '',
    `  node dev-server.mjs [--host ${DEFAULT_ATOM_LANGUAGE_DEV_HOST}] [--port ${DEFAULT_ATOM_LANGUAGE_DEV_PORT}]`,
    '',
    '只提供 /、/health 和 /parse；不会读写 atom.json 或 world.json。'
  ].join('\n');
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentFile = path.resolve(fileURLToPath(import.meta.url));
if (invokedFile === currentFile) {
  try {
    const options = parseAtomLanguageDevServerArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${help()}\n`);
    } else {
      const running = await startAtomLanguageDevServer(options);
      process.stdout.write(`Atom Language P0 调试服务：${running.url}\n`);
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: error.code ?? 'ATOM_LANGUAGE_DEV_SERVER_ERROR',
        message: error.message
      }
    })}\n`);
    process.exitCode = 1;
  }
}
