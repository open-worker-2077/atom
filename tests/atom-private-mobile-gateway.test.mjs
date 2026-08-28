import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import { startPrivateMobileGateway } from '../src/atom-system/adapters/private-mobile-gateway.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method ?? 'GET',
      headers: options.headers ?? {}
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.once('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fixture(t, gatewayOptions = {}) {
  const received = [];
  const target = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8')
      });
      if (req.url === '/__spatial/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        res.end('data: {"revision":2}\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
  });
  const targetAddress = await listen(target);
  t.after(() => close(target));
  const gateway = await startPrivateMobileGateway({
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    port: 0,
    allowedLogins: ['worker@example.com'],
    ...gatewayOptions
  });
  t.after(() => gateway.close());
  return { gateway, received };
}

test('explicit source-address authorization admits only the approved tailnet peer', async (t) => {
  const { gateway } = await fixture(t, {
    allowedLogins: undefined,
    allowedRemoteAddresses: ['127.0.0.1']
  });

  const response = await request(`${gateway.url}/hello?from=direct-tailnet`);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, path: '/hello?from=direct-tailnet' });
});

test('source-address authorization does not trust a caller-supplied identity header', async (t) => {
  const { gateway } = await fixture(t, {
    allowedLogins: undefined,
    allowedRemoteAddresses: ['100.64.0.2']
  });

  const response = await request(`${gateway.url}/`, {
    headers: { 'Tailscale-User-Login': 'worker@example.com' }
  });
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.body).error.code, 'TAILSCALE_DEVICE_DENIED');
});

test('private gateway refuses wildcard or ordinary network bind addresses', async () => {
  const attempt = startPrivateMobileGateway({
    host: '0.0.0.0',
    port: 0,
    targetUrl: 'http://127.0.0.1:4784',
    allowedRemoteAddresses: ['100.64.0.2']
  }).then(async (gateway) => {
    await gateway.close();
    return gateway;
  });

  await assert.rejects(attempt, /loopback or a Tailscale IPv4 address/u);
});

test('gateway CLI starts an explicit source-address listener without a login header', async (t) => {
  const target = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  const targetAddress = await listen(target);
  t.after(() => close(target));

  const child = spawn(process.execPath, [
    'work-engine/atom-language/private-mobile-gateway.mjs',
    '--host', '127.0.0.1',
    '--allowed-source', '127.0.0.1',
    '--target', `http://127.0.0.1:${targetAddress.port}`,
    '--port', '0'
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());

  let errorText = '';
  child.stderr.on('data', (chunk) => { errorText += chunk.toString('utf8'); });
  const [chunk] = await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => {
      assert.fail(`gateway CLI exited before readiness (code ${code}): ${errorText}`);
    })
  ]);
  const ready = JSON.parse(chunk.toString('utf8').trim());
  const response = await request(`http://${ready.host}:${ready.port}/`);
  assert.equal(response.status, 200);
});

test('private mobile gateway binds only to loopback and denies missing Tailscale identity', async (t) => {
  const { gateway } = await fixture(t);
  assert.equal(gateway.host, '127.0.0.1');
  assert.equal(gateway.server.address().address, '127.0.0.1');

  const response = await request(`${gateway.url}/`);
  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body).error.code, 'TAILSCALE_IDENTITY_REQUIRED');
});

test('private mobile gateway rejects a Tailscale identity outside the explicit allowlist', async (t) => {
  const { gateway } = await fixture(t);
  const response = await request(`${gateway.url}/`, {
    headers: { 'Tailscale-User-Login': 'other@example.com' }
  });
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.body).error.code, 'TAILSCALE_IDENTITY_DENIED');
});

test('approved identity reaches the target without forwarding trusted proxy headers', async (t) => {
  const { gateway, received } = await fixture(t);
  const response = await request(`${gateway.url}/hello?from=phone`, {
    headers: {
      'Tailscale-User-Login': ' WORKER@example.com ',
      'Tailscale-User-Name': 'Worker',
      'Tailscale-User-Profile-Pic': 'https://example.invalid/me.png'
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, path: '/hello?from=phone' });
  assert.equal(received.length, 1);
  assert.equal(received[0].headers['tailscale-user-login'], undefined);
  assert.equal(received[0].headers['tailscale-user-name'], undefined);
  assert.equal(received[0].headers['tailscale-user-profile-pic'], undefined);
});

test('approved POST body and SSE response stream through the same gateway boundary', async (t) => {
  const { gateway, received } = await fixture(t);
  const headers = { 'Tailscale-User-Login': 'worker@example.com' };
  const payload = JSON.stringify({ operation: 'test' });
  const posted = await request(`${gateway.url}/__atom/api/workspace-edit`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    body: payload
  });
  const events = await request(`${gateway.url}/__spatial/api/events`, { headers });

  assert.equal(posted.status, 200);
  assert.equal(received[0].body, payload);
  assert.equal(events.status, 200);
  assert.match(events.headers['content-type'], /^text\/event-stream/u);
  assert.equal(events.body, 'data: {"revision":2}\n\n');
});

test('an initial browser navigation waits in the same tab when Atom is temporarily unavailable', async (t) => {
  const unavailableTarget = http.createServer();
  const targetAddress = await listen(unavailableTarget);
  await close(unavailableTarget);
  const gateway = await startPrivateMobileGateway({
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    port: 0,
    allowedLogins: ['worker@example.com']
  });
  t.after(() => gateway.close());

  const response = await request(`${gateway.url}/`, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'Tailscale-User-Login': 'worker@example.com'
    }
  });

  assert.equal(response.status, 503);
  assert.match(response.headers['content-type'], /^text\/html/u);
  assert.equal(response.headers['retry-after'], '2');
  assert.match(response.body, /http-equiv="refresh" content="2"/u);
  assert.match(response.body, /Atom.*reconnect/iu);
});

test('an unavailable Atom API still returns the structured gateway error', async (t) => {
  const unavailableTarget = http.createServer();
  const targetAddress = await listen(unavailableTarget);
  await close(unavailableTarget);
  const gateway = await startPrivateMobileGateway({
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    port: 0,
    allowedLogins: ['worker@example.com']
  });
  t.after(() => gateway.close());

  const response = await request(`${gateway.url}/__atom/api/command`, {
    headers: {
      accept: 'application/json',
      'Tailscale-User-Login': 'worker@example.com'
    }
  });

  assert.equal(response.status, 502);
  assert.equal(JSON.parse(response.body).error.code, 'ATOM_PRIVATE_UPSTREAM_UNAVAILABLE');
});
