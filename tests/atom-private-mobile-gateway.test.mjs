import assert from 'node:assert/strict';
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

async function fixture(t) {
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
  const gateway = await startPrivateMobileGateway({
    targetUrl: `http://127.0.0.1:${targetAddress.port}`,
    port: 0,
    allowedLogins: ['worker@example.com']
  });
  t.after(async () => {
    await gateway.close();
    await close(target);
  });
  return { gateway, received };
}

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
