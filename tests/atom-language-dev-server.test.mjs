import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ATOM_LANGUAGE_DEV_HOST,
  DEFAULT_ATOM_LANGUAGE_DEV_PORT,
  createAtomLanguageDevServer,
  parseAtomLanguageDevServerArgs,
  startAtomLanguageDevServer
} from '../work-engine/atom-language/dev-server.mjs';

async function withServer(t, options = {}) {
  const running = await startAtomLanguageDevServer({
    host: '127.0.0.1',
    port: 0,
    ...options
  });
  t.after(() => running.close());
  return running;
}

test('parser debug defaults are isolated from both 4783 and the 4784 Graph service', () => {
  assert.equal(DEFAULT_ATOM_LANGUAGE_DEV_HOST, '127.0.0.1');
  assert.equal(DEFAULT_ATOM_LANGUAGE_DEV_PORT, 4794);
  assert.notEqual(DEFAULT_ATOM_LANGUAGE_DEV_PORT, 4783);
  assert.notEqual(DEFAULT_ATOM_LANGUAGE_DEV_PORT, 4784);
  assert.equal(createAtomLanguageDevServer().listening, false);
});

test('GET / serves a compact Chinese parser page and GET /health identifies P0', async (t) => {
  const running = await withServer(t);

  const page = await fetch(`${running.url}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html; charset=utf-8$/);
  const html = await page.text();
  assert.match(html, /Atom Language P0/);
  assert.match(html, /<textarea\b/);
  assert.match(html, /解析/);
  assert.match(html, /fetch\(['"]\/parse['"]/);

  const health = await fetch(`${running.url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'atom-language-p0'
  });
});

test('POST /parse returns normalized success and structured semantic errors', async (t) => {
  const running = await withServer(t);

  const successResponse = await fetch(`${running.url}/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: 'explore {"name":"石器工坊","detail$full"}'
    })
  });
  assert.equal(successResponse.status, 200);
  const success = await successResponse.json();
  assert.equal(success.ok, true);
  assert.equal(success.result.command, 'explore');
  assert.equal(success.result.items[0].fields[1].valuePresent, false);
  assert.equal(success.result.items[0].fields[1].actions[0].name, 'full');

  const semanticResponse = await fetch(`${running.url}/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'explore {"detail$invent"}' })
  });
  assert.equal(semanticResponse.status, 200);
  const semantic = await semanticResponse.json();
  assert.equal(semantic.ok, false);
  assert.equal(semantic.result.ok, false);
  assert.equal(semantic.result.errors[0].code, 'UNKNOWN_ACTION');
});

test('POST /parse validates JSON, source, and request body size', async (t) => {
  const running = await withServer(t, { maxBodyBytes: 64 });

  const malformed = await fetch(`${running.url}/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"source":'
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST_JSON');

  const missingSource = await fetch(`${running.url}/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 3 })
  });
  assert.equal(missingSource.status, 400);
  assert.equal((await missingSource.json()).error.code, 'INVALID_ATOM_LANGUAGE_SOURCE');

  const oversized = await fetch(`${running.url}/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: `explore {"detail":"${'x'.repeat(100)}"}` })
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, 'REQUEST_BODY_TOO_LARGE');
});

test('script arguments keep the parser debug service away from 4783 and 4784', () => {
  assert.deepEqual(parseAtomLanguageDevServerArgs([
    '--host', '127.0.0.2', '--port=5790'
  ]), {
    host: '127.0.0.2',
    port: 5790,
    help: false
  });
  assert.deepEqual(parseAtomLanguageDevServerArgs([]), {
    host: DEFAULT_ATOM_LANGUAGE_DEV_HOST,
    port: DEFAULT_ATOM_LANGUAGE_DEV_PORT,
    help: false
  });
  assert.throws(
    () => parseAtomLanguageDevServerArgs(['--port', '4783']),
    (error) => error.code === 'RESERVED_DEV_SERVER_PORT'
  );
  assert.throws(
    () => parseAtomLanguageDevServerArgs(['--port', '4784']),
    (error) => error.code === 'RESERVED_DEV_SERVER_PORT'
  );
});
