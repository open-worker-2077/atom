import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recordAtomFeedback } from '../work-engine/atom-language/feedback-log.mjs';

test('submit records category, detail, time, agent origin, and bounded CLI history', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-feedback-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const result = await recordAtomFeedback({
    source: 'submit {"type":"bug","detail":"冻结后提示不清楚"}',
    contextFile,
    interaction: { agent: { path: '推进流总控' } },
    history: [{ source: 'explore {"name":"定向"}', ok: true }],
    now: () => new Date('2026-08-10T10:00:00.000Z')
  });
  assert.equal(result.ok, true);
  assert.equal(result.command, 'submit');
  const lines = (await fs.readFile(path.join(directory, 'submissions.jsonl'), 'utf8')).trim().split('\n');
  const record = JSON.parse(lines[0]);
  assert.equal(record.type, 'bug');
  assert.equal(record.detail, '冻结后提示不清楚');
  assert.equal(record.agentPath, '推进流总控');
  assert.equal(record.submittedAt, '2026-08-10T10:00:00.000Z');
  assert.deepEqual(record.history, [{ source: 'explore {"name":"定向"}', ok: true }]);
});

test('submit rejects unknown categories and missing descriptions', async () => {
  await assert.rejects(
    recordAtomFeedback({ source: 'submit {"type":"other","detail":"x"}', contextFile: 'atom.json', interaction: { agent: { path: 'A' } } }),
    { code: 'INVALID_FEEDBACK_TYPE' }
  );
  await assert.rejects(
    recordAtomFeedback({ source: 'submit {"type":"bug","detail":""}', contextFile: 'atom.json', interaction: { agent: { path: 'A' } } }),
    { code: 'INVALID_FEEDBACK_DETAIL' }
  );
});
