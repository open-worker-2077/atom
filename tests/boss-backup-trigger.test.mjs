import assert from 'node:assert/strict';
import test from 'node:test';

import { createBossBackupTrigger } from '../cli/lib/boss-backup-trigger.mjs';

function fixture() {
  let listener = null;
  let scheduled = null;
  let runs = 0;
  const trigger = createBossBackupTrigger({
    bossDirectory: 'C:/boss-data',
    backupRepository: 'C:/boss-backup',
    delayMs: 250,
    watch(_directory, options, callback) {
      assert.equal(options.recursive, true);
      listener = callback;
      return { close() {} };
    },
    setTimer(callback) {
      scheduled = callback;
      return callback;
    },
    clearTimer(callback) {
      if (scheduled === callback) scheduled = null;
    },
    async runBackup() {
      runs += 1;
      return true;
    }
  });
  return {
    trigger,
    emit(filename) {
      listener('change', filename);
    },
    async flushTimer() {
      const callback = scheduled;
      scheduled = null;
      await callback();
    },
    runs: () => runs
  };
}

test('Boss JSON saves debounce into one automatic Git backup run', async () => {
  const subject = fixture();
  subject.trigger.start();
  subject.emit('bosses/individual.json');
  subject.emit('history/individual.history.json');
  subject.emit('catalog.json');

  assert.equal(subject.trigger.state.scheduled, true);
  await subject.flushTimer();
  assert.equal(subject.runs(), 1);
});

test('non-JSON changes do not schedule a backup and shutdown cancels pending work', () => {
  const subject = fixture();
  subject.trigger.start();
  subject.emit('catalog.json.tmp');
  subject.trigger.close();

  assert.deepEqual(subject.trigger.state, {
    running: false,
    pending: false,
    scheduled: false,
    closed: true
  });
});
