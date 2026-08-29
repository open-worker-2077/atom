import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const checkpointModuleUrl = new URL('../scripts/night-watch-checkpoint.mjs', import.meta.url);

test('night-watch checkpoints append safely and resume only after prerequisites revalidate', async (t) => {
  const { appendNightWatchCheckpoint, resumeNightWatchCheckpoint } = await import(checkpointModuleUrl);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'night-watch-checkpoint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await appendNightWatchCheckpoint({ directory, manifestVersion: 1, agent: '🧊', lastAcceptedStepId: 'program', coordinate: 'test/run-1' });
  await appendNightWatchCheckpoint({ directory, manifestVersion: 1, agent: '🧊', lastAcceptedStepId: 'explore-transform', coordinate: 'test/run-1' });

  const resumed = await resumeNightWatchCheckpoint({
    directory, manifestVersion: 1, agent: '🧊', validateCoordinate: async (value) => value === 'test/run-1'
  });
  assert.equal(resumed.lastAcceptedStepId, 'explore-transform');
  await assert.rejects(
    resumeNightWatchCheckpoint({ directory, manifestVersion: 2, agent: '🧊', validateCoordinate: async () => true }),
    (error) => error.code === 'NIGHT_WATCH_RESUME_MANIFEST_MISMATCH'
  );
});
