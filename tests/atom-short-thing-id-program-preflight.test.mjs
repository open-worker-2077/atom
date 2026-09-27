import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createProgramRefBindingUpdate } from '../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { prepareShortThingIdProgramBindings } from '../work-engine/atom-language/short-thing-id-program-preflight.mjs';

const ids = ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB',
  'CCCCCCCCCCCCCCCCCCCCCC', 'DDDDDDDDDDDDDDDDDDDDDD'];
const hash = source => `sha256:${createHash('sha256').update(source).digest('hex')}`;
const atom = (id, name, types = [], source = '', slot = []) => ({
  [`thing${types.map(type => `@${type}`).join('')}&id=${id}`]: name,
  situation: source, slot, strut: []
});

function facts() {
  return [atom(ids[0], 'Root', [], '', [
    atom(ids[1], '🧊managegraph', ['agent', 'program'], 'print("ready")'),
    atom(ids[2], 'Backup', ['backup', 'default'], '', [
      atom(ids[3], 'Old Program', ['program'], 'transform({"thing":ref("Gone")})')
    ])
  ])];
}

test('preflight verifies an active zero-reference Program and leaves archived Programs unbound', async () => {
  const calls = [];
  const result = await prepareShortThingIdProgramBindings({
    facts: facts(), bindings: createProgramRefBindingUpdate(),
    inspectProgram: async ({ source, programPath }) => {
      calls.push(programPath);
      return { sourceHash: hash(source), sites: [] };
    }
  });
  assert.deepEqual(calls, ['Root/🧊managegraph']);
  assert.deepEqual(result.replacements, [{
    programThingId: ids[1], sourceHash: hash('print("ready")'), sites: []
  }]);
});

test('preflight refuses an unbound active Program with a reference site or mismatched source', async () => {
  for (const inspected of [
    { sourceHash: hash('print("ready")'), sites: [{ fingerprint: 'site', role: 'ref' }] },
    { sourceHash: hash('different'), sites: [] }
  ]) {
    await assert.rejects(prepareShortThingIdProgramBindings({
      facts: facts(), bindings: createProgramRefBindingUpdate(),
      inspectProgram: async () => inspected
    }), { code: 'PROGRAM_REF_BINDING_MISSING' });
  }
});
