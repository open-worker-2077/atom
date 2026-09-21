import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { executeExploreItem } from '../work-engine/atom-language/query-capability.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(id, thing, slot = []) {
  return { [`thing&id=${id}`]: thing, situation: '', slot, strut: [] };
}

const facts = [
  atom('001', 'Left', [atom('002', 'Target')]),
  atom('003', 'Right', [atom('004', 'Target')])
];

async function explore(source, accessController = {
  restricted: false,
  authorize: async () => ({ decision: 'allow' })
}) {
  const receiver = createAtomLanguageReceiver();
  const parsed = receiver.receive(`explore ${source}`);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  return executeExploreItem(facts, parsed.items[0], receiver.matcherRegistry, accessController);
}

test('Thing doorplates are absent by default and disclosed only for explicit or audit selectors', async () => {
  const ordinary = await explore('{"thing":"Left/Target"}');
  assert.equal(ordinary.ok, true);
  assert.equal(Object.hasOwn(ordinary.matches[0], 'identity'), false);

  const explicit = await explore('{"thing":"@002"}');
  assert.equal(explicit.ok, true);
  assert.equal(explicit.matches[0].identity, '@002');

  const audit = await explore('{"thing~identity":"Left/Target"}');
  assert.equal(audit.ok, true);
  assert.equal(audit.matches[0].identity, '@002');
});

test('authorized ambiguity may disclose candidate addresses but denied exact identity never leaks', async () => {
  const ambiguous = await explore('{"thing":"Target"}');
  assert.equal(ambiguous.ok, false);
  assert.deepEqual(ambiguous.errors[0].candidates, [
    { path: 'Left/Target', identity: '@002' },
    { path: 'Right/Target', identity: '@004' }
  ]);

  const denied = await explore('{"thing":"@002"}', {
    restricted: true,
    authorize: async (match) => match.path.join('/') === 'Left/Target'
      ? { decision: 'deny' }
      : { decision: 'allow' }
  });
  assert.equal(denied.ok, true);
  assert.equal(JSON.stringify(denied).includes('002'), false);
});

test('CLI emits identity~address only for an explicit identity request', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-id-disclosure-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify(facts));
  async function cli(selector) {
    let stdout = '';
    let stderr = '';
    const code = await runAtomCli([
      '--json', '--context', contextFile, '--projection', projectionFile,
      'explore', JSON.stringify({ thing: selector })
    ], {
      execute: executeAtomLanguage,
      stdin: { isTTY: false },
      stdout: { isTTY: false, write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } }
    });
    assert.equal(code, 0, stderr);
    return stdout;
  }
  assert.doesNotMatch(await cli('Left/Target'), /identity~address/u);
  assert.match(await cli('@002'), /"identity~address"\s*:\s*"@002"/u);
});
