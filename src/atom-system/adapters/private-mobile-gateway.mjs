import http from 'node:http';

const LOOPBACK_HOST = '127.0.0.1';
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT']);
const STRIPPED_REQUEST_HEADERS = new Set([
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'tailscale-user-login',
  'tailscale-user-name',
  'tailscale-user-profile-pic',
  'tailscale-app-capabilities'
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function gatewayProblem(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ code, message, statusCode, details });
}

function writeProblem(response, problem) {
  const body = JSON.stringify({
    ok: false,
    error: {
      code: problem.code,
      message: problem.message,
      ...(Object.keys(problem.details || {}).length ? { details: problem.details } : {})
    }
  });
  response.writeHead(problem.statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

function acceptsHtmlNavigation(request) {
  if (request.method !== 'GET') return false;
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.toLowerCase().includes('text/html');
}

function writeRecoveryPage(response) {
  const body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="refresh" content="2">
  <title>Atom reconnecting</title>
  <style>
    html,body{height:100%;margin:0;background:#0d0f11;color:#f4f6f8;font:18px system-ui,sans-serif}
    body{display:grid;place-items:center;text-align:center}.status{opacity:.86}.detail{margin-top:.75rem;font-size:.82rem;opacity:.58}
  </style>
</head>
<body><main><div class="status">Atom 正在重新连接…</div><div class="detail">本标签页会自动恢复</div></main></body>
</html>`;
  response.writeHead(503, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'retry-after': '2'
  });
  response.end(body);
}

function canonicalLogin(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function allowedLoginSet(values) {
  const result = new Set(
    (Array.isArray(values) ? values : [])
      .map(canonicalLogin)
      .filter(Boolean)
  );
  if (!result.size) {
    throw new Error('Private mobile gateway requires at least one allowed Tailscale login');
  }
  return result;
}

function canonicalRemoteAddress(value) {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

function allowedRemoteAddressSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map(canonicalRemoteAddress)
      .filter(Boolean)
  );
}

function isTailscaleIpv4(value) {
  const parts = value.split('.').map((part) => Number(part));
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100
    && parts[1] >= 64
    && parts[1] <= 127;
}

function privateBindHost(value) {
  const host = typeof value === 'string' ? value.trim().toLowerCase() : LOOPBACK_HOST;
  if (host === LOOPBACK_HOST || isTailscaleIpv4(host)) return host;
  throw new Error('Private mobile gateway host must be loopback or a Tailscale IPv4 address');
}

function loopbackTarget(value) {
  const target = new URL(value || 'http://127.0.0.1:4784');
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('Private mobile gateway target must be a loopback HTTP service');
  }
  return target;
}

function requestLogin(request) {
  const value = request.headers['tailscale-user-login'];
  if (Array.isArray(value)) return '';
  return canonicalLogin(value);
}

function sanitizedHeaders(headers, stripped) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => (
      value !== undefined && !stripped.has(name.toLowerCase())
    ))
  );
}

function targetRequestUrl(requestUrl, target) {
  const incoming = new URL(requestUrl || '/', 'http://gateway.invalid');
  return new URL(`${incoming.pathname}${incoming.search}`, target);
}

export async function startPrivateMobileGateway(options = {}) {
  const allowedRemoteAddresses = allowedRemoteAddressSet(options.allowedRemoteAddresses);
  const allowedLogins = allowedRemoteAddresses.size ? null : allowedLoginSet(options.allowedLogins);
  const target = loopbackTarget(options.targetUrl);
  const host = privateBindHost(options.host);
  if (host !== LOOPBACK_HOST && !allowedRemoteAddresses.size) {
    throw new Error('A Tailscale-bound private gateway requires an explicit allowed remote address');
  }
  const port = Number(options.port ?? 4785);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Private mobile gateway port must be an integer between 0 and 65535');
  }

  const server = http.createServer((request, response) => {
    if (allowedRemoteAddresses.size) {
      const remoteAddress = canonicalRemoteAddress(request.socket.remoteAddress);
      if (!allowedRemoteAddresses.has(remoteAddress)) {
        writeProblem(response, gatewayProblem(
          'TAILSCALE_DEVICE_DENIED',
          'This Tailscale device is not allowed to access Atom',
          403
        ));
        return;
      }
    } else {
      const login = requestLogin(request);
      if (!login) {
        writeProblem(response, gatewayProblem(
          'TAILSCALE_IDENTITY_REQUIRED',
          'Private Atom access requires a Tailscale Serve identity',
          401
        ));
        return;
      }
      if (!allowedLogins.has(login)) {
        writeProblem(response, gatewayProblem(
          'TAILSCALE_IDENTITY_DENIED',
          'This Tailscale identity is not allowed to access Atom',
          403
        ));
        return;
      }
    }
    if (!ALLOWED_METHODS.has(request.method || '')) {
      writeProblem(response, gatewayProblem(
        'PRIVATE_GATEWAY_METHOD_NOT_ALLOWED',
        'The private Atom gateway accepts GET, HEAD, POST and PUT only',
        405
      ));
      return;
    }

    const upstream = http.request(targetRequestUrl(request.url, target), {
      method: request.method,
      headers: {
        ...sanitizedHeaders(request.headers, STRIPPED_REQUEST_HEADERS),
        host: target.host
      }
    }, (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode || 502,
        sanitizedHeaders(upstreamResponse.headers, STRIPPED_RESPONSE_HEADERS)
      );
      upstreamResponse.pipe(response);
    });

    upstream.once('error', (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (acceptsHtmlNavigation(request)) {
        writeRecoveryPage(response);
        return;
      }
      writeProblem(response, gatewayProblem(
        'ATOM_PRIVATE_UPSTREAM_UNAVAILABLE',
        'The local Atom service is unavailable',
        502
      ));
    });
    request.once('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return Object.freeze({
    server,
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    targetUrl: target.href,
    close() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
}
