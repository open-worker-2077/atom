import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import {
  materializeGraphJson,
  parseGraphJson
} from '../work-engine/atom-language/graph-json.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-receipt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    contextFile: path.join(directory, 'atom.json'),
    projectionFile: path.join(directory, 'graph.json')
  };
}

async function run(files, source, options = {}) {
  let stdout = '';
  let stderr = '';
  const args = [
    ...(options.json ? ['--json'] : []),
    '--context',
    files.contextFile,
    '--projection',
    files.projectionFile,
    ...source
  ];
  const code = await runAtomCli(args, {
    execute: executeAtomLanguage,
    stdin: { isTTY: false },
    stdout: {
      isTTY: false,
      write(value) {
        stdout += value;
      }
    },
    stderr: {
      write(value) {
        stderr += value;
      }
    }
  });
  return { code, stdout, stderr };
}

test('Transform receipt keeps only the minimal Graph outline and never echoes long data', async (t) => {
  const files = await fixture(t);
  const detail = `正文${'很长'.repeat(3000)}`;
  const created = await run(files, [
    'transform',
    'new',
    JSON.stringify({
      thing: '长正文',
      situation: detail,
      contain: [],
      support: []
    })
  ]);

  assert.equal(created.code, 0, created.stderr);
  assert.equal(created.stdout.includes(detail), false);
  assert.equal(created.stdout.includes('"situation"'), false);
  assert.equal(created.stdout.includes('"contain"'), false);
  assert.equal(created.stdout.includes('"support"'), false);
  assert.deepEqual(
    materializeGraphJson(parseGraphJson(created.stdout)),
    { 'thing~created': '长正文' }
  );
});

test('--json is a compatibility alias for the same Graph-JSON result, not a machine envelope', async (t) => {
  const files = await fixture(t);
  await run(files, [
    'transform',
    'new',
    '{"thing":"目标","situation":"正文","contain":[],"support":[]}'
  ]);
  const source = ['transform', '{"thing":"目标","situation.rep.正文"}'];
  const ordinary = await run(files, source);
  const json = await run(files, source, { json: true });

  assert.equal(ordinary.code, 0, ordinary.stderr);
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.stdout, ordinary.stdout);
  assert.equal(json.stdout.includes('"ok"'), false);
  assert.equal(json.stdout.includes('"result"'), false);
  assert.deepEqual(
    materializeGraphJson(parseGraphJson(json.stdout)),
    { 'thing~unchanged': '目标' }
  );
});

test('failed Transform emits no success receipt', async (t) => {
  const files = await fixture(t);
  await run(files, [
    'transform',
    'new',
    '{"thing":"目标","situation":"正文","contain":[],"support":[]}'
  ]);
  const failed = await run(files, [
    'transform',
    '{"thing":"目标","situation.rep.新片段":"不存在的旧片段"}'
  ]);

  assert.equal(failed.code, 4);
  assert.equal(failed.stdout, '');
  assert.match(failed.stderr, /DETAIL_FRAGMENT_NOT_FOUND/u);
  assert.doesNotMatch(failed.stderr, /~created|~updated|~unchanged/u);
});

test('--json does not restore a machine envelope for CLI argument errors', async () => {
  async function invoke(args) {
    let stdout = '';
    let stderr = '';
    const code = await runAtomCli(args, {
      stdin: { isTTY: false },
      stdout: { isTTY: false, write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } }
    });
    return { code, stdout, stderr };
  }

  const ordinary = await invoke(['--unknown']);
  const json = await invoke(['--json', '--unknown']);

  assert.equal(json.code, ordinary.code);
  assert.equal(json.stdout, '');
  assert.equal(json.stderr, ordinary.stderr);
  assert.doesNotMatch(json.stderr, /"ok"|"result"|"receipt"/u);
});
