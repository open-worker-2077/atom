import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runAtomSession } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

test('one pasted block executes every complete multiline Atom command in order', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-session-paste-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const seeded = await executeAtomLanguage({
    source: 'transform new {"thing":"石器工坊","situation#工坊简介":"旧正文","contain":[],"support":[]}',
    contextFile,
    projectionFile
  });
  assert.equal(seeded.ok, true);

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = '';
  let errors = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  stderr.on('data', (chunk) => {
    errors += chunk.toString('utf8');
  });

  const session = runAtomSession({
    stdin,
    stdout,
    stderr,
    terminal: false,
    contextFile,
    projectionFile,
    execute: executeAtomLanguage
  });
  stdin.end(`atom

explore {
  "thing": "石器工坊",
  "situation$full"
}

transform {
  "thing": "石器工坊",
  "situation.rep.更新后的正文"
}
`);

  const code = await session;
  assert.equal(code, 0, errors);
  assert.match(output, /Atom Language 已就绪/u);
  assert.match(output, /\{\n  "atom~count1"\n\}/u);
  assert.match(
    output,
    /\{\n  "thing": "石器工坊",\n  "situation#工坊简介": "旧正文",\n  "boundary~preview":/u
  );
  assert.match(
    output,
    /\{\n  "thing~updated": "石器工坊"\n\}/u
  );
  assert.doesNotMatch(output, /当前 1 个 Atom|简介：|正文：|已更新：/u);
  assert.doesNotMatch(
    output,
    /revisionBefore|revisionAfter|contextFile|projectionFile|"ok":|"result":/u
  );
  assert.doesNotMatch(errors, /UNKNOWN_ATOM_LANGUAGE_COMMAND/u);

  const explored = await executeAtomLanguage({
    source: 'explore {"thing":"石器工坊","situation$full"}',
    contextFile,
    projectionFile
  });
  assert.equal(explored.ok, true);
  assert.match(JSON.stringify(explored), /更新后的正文/u);
});

test('pasted CLI transcript strips prompts and does not redispatch its Graph-JSON receipt', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdout.isTTY = true;
  stdout.columns = 120;
  const sources = [];
  let output = '';
  let errors = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  stderr.on('data', (chunk) => {
    errors += chunk.toString('utf8');
  });

  const execute = async ({ source }) => {
    sources.push(source);
    if (source === 'atom') {
      return {
        ok: true,
        language: 'atom',
        command: 'atom',
        atomCount: 3,
        warnings: [],
        errors: []
      };
    }
    return {
      ok: false,
      language: 'atom',
      command: null,
      warnings: [],
      errors: [{
        code: 'UNKNOWN_ATOM_LANGUAGE_COMMAND',
        message: '当前只识别 Atom Language 命令'
      }]
    };
  };

  const session = runAtomSession({
    stdin,
    stdout,
    stderr,
    terminal: true,
    execute
  });
  stdin.end(`atom> atom
{
  "atom~count3"
}
  `);

  const code = await session;
  assert.deepEqual(sources, ['atom', 'atom']);
  assert.equal(code, 0, errors);
  assert.match(output, /"atom~count3"/u);
  assert.doesNotMatch(errors, /UNKNOWN_ATOM_LANGUAGE_COMMAND/u);
});

test('Ctrl+C exits the interactive session without an Atom control command', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdout.isTTY = true;
  stdout.columns = 120;
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });

  const session = runAtomSession({
    stdin,
    stdout,
    stderr,
    terminal: true,
    execute: async () => ({
      ok: true,
      language: 'atom',
      command: 'atom',
      contextFile: 'test-atom.json',
      projectionFile: 'test-graph.json',
      warnings: [],
      errors: []
    })
  });
  setTimeout(() => stdin.write('\x03'), 10);
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      stdin.end();
      resolve('timeout');
    }, 500);
  });

  const outcome = await Promise.race([session, timeout]);
  clearTimeout(timeoutId);
  assert.equal(outcome, 0);
  assert.match(output, /Ctrl\+C 退出/u);
  assert.doesNotMatch(output, /\.exit|exit \/ quit/u);
});
