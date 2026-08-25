import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runAtomCli, runAtomSession } from '../work-engine/atom-language/cli.mjs';
import { issueAgentSession, loadAgentSession } from '../work-engine/atom-language/world-laws/sessions.mjs';
import { issueWorldAgentSession } from '../work-engine/atom-language/admin.mjs';

const SIGNING_KEY = 'test-only-signing-key-with-at-least-32-bytes';

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function output() {
  let text = '';
  return {
    stream: { isTTY: false, write: (chunk) => { text += chunk; } },
    text: () => text
  };
}

test('session tokens are opaque, hashed at rest, expiring, and bind allowed windows', async (t) => {
  const sessionsDirectory = await temp(t);
  const issued = await issueAgentSession({
    sessionsDirectory,
    signingKey: SIGNING_KEY,
    windows: ['Work Agent', 'Review Agent'],
    keys: [{ id: 'work-key', grade: 2, actions: ['read', 'write'] }],
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });

  assert.match(issued.token, /^[A-Za-z0-9_-]{40,}$/u);
  const files = await fs.readdir(sessionsDirectory);
  assert.equal(files.some((name) => name.includes(issued.token)), false);
  const loaded = await loadAgentSession({ sessionsDirectory, token: issued.token, signingKey: SIGNING_KEY });
  assert.deepEqual(loaded.windows, ['Work Agent', 'Review Agent']);
  assert.equal(loaded.keys[0].grade, 2);

  const sessionFile = path.join(sessionsDirectory, files[0]);
  const forged = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
  forged.windows.push('Personal Agent');
  await fs.writeFile(sessionFile, JSON.stringify(forged));
  await assert.rejects(
    loadAgentSession({ sessionsDirectory, token: issued.token, signingKey: SIGNING_KEY }),
    { code: 'INVALID_AGENT_SESSION' }
  );
});

test('daily CLI requires one @agent origin and rejects retired session/window flags', async (t) => {
  const directory = await temp(t);
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    { 'thing@agent': 'Work Agent', detail: '', children: [], partners: [] }
  ]));
  const stdout = output();
  const stderr = output();

  let code = await runAtomCli(['atom'], {
    requireAgent: true, defaultContextFile: contextFile, defaultProjectionFile: projectionFile,
    stdout: stdout.stream, stderr: stderr.stream, stdin: { isTTY: false }
  });
  assert.equal(code, 4);
  assert.match(stderr.text(), /AGENT_REQUIRED/u);

  code = await runAtomCli(['--session', 'retired', '--window', 'Work Agent', 'atom'], {
    requireAgent: true, defaultContextFile: contextFile, defaultProjectionFile: projectionFile,
    stdout: stdout.stream, stderr: stderr.stream, stdin: { isTTY: false }
  });
  assert.equal(code, 4);
  assert.match(stderr.text(), /LEGACY_AGENT_ENTRY_OPTION/u);
});

test('interactive prompt keeps the selected @agent origin without a window-switch command', async () => {
  const stdin = new PassThrough();
  stdin.isTTY = false;
  const stdout = output();
  const stderr = output();
  const calls = [];
  stdin.end('atom\n');

  const code = await runAtomSession({
    stdin, stdout: stdout.stream, stderr: stderr.stream, terminal: false,
    interaction: { agent: { ref: 'revision-local-ref', path: 'Workspace/Work Agent' } },
    execute: async (options) => {
      calls.push(options.interaction.agent.path);
      return {
        ok: true, command: 'atom', atomCount: 1,
        warnings: [], errors: [], changed: false
      };
    }
  });

  assert.equal(code, 0);
  assert.deepEqual(calls, ['Workspace/Work Agent', 'Workspace/Work Agent']);
  assert.match(stdout.text(), /atom\[Workspace\/Work Agent\]>/u);
  assert.equal(stderr.text(), '');
});

test('maintenance session issuance accepts only exact unique @agent windows', async (t) => {
  const directory = await temp(t);
  const contextFile = path.join(directory, 'atom.json');
  const sessionsDirectory = path.join(directory, 'sessions');
  await fs.writeFile(contextFile, `${JSON.stringify([
    { 'thing@agent': 'Work Agent', situation: '', contain: [], support: [] },
    { thing: 'Not Agent', situation: '', contain: [], support: [] }
  ])}\n`);

  const issued = await issueWorldAgentSession({
    contextFile, sessionsDirectory, windows: ['Work Agent'], signingKey: SIGNING_KEY
  });
  assert.ok(issued.token);
  await assert.rejects(
    issueWorldAgentSession({ contextFile, sessionsDirectory, windows: ['Not Agent'], signingKey: SIGNING_KEY }),
    { code: 'WINDOW_AGENT_NOT_FOUND' }
  );
});
