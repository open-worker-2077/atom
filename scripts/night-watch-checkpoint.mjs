import fs from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'night-watch-checkpoints.jsonl';

function checkpointError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function valid(record) {
  return record && Number.isInteger(record.manifestVersion) && record.manifestVersion > 0
    && typeof record.agent === 'string' && record.agent
    && typeof record.lastAcceptedStepId === 'string' && record.lastAcceptedStepId
    && typeof record.coordinate === 'string' && record.coordinate;
}

export async function appendNightWatchCheckpoint({ directory, ...record }) {
  if (!valid(record)) throw checkpointError('NIGHT_WATCH_CHECKPOINT_INVALID', 'Night-watch checkpoint is invalid');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, FILE_NAME);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return file;
}

export async function resumeNightWatchCheckpoint({ directory, manifestVersion, agent, validateCoordinate }) {
  const file = path.join(directory, FILE_NAME);
  const entries = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  const checkpoint = entries.at(-1);
  if (!checkpoint || checkpoint.manifestVersion !== manifestVersion) {
    throw checkpointError('NIGHT_WATCH_RESUME_MANIFEST_MISMATCH', 'Night-watch checkpoint manifest does not match');
  }
  if (checkpoint.agent !== agent) throw checkpointError('NIGHT_WATCH_RESUME_AGENT_MISMATCH', 'Night-watch checkpoint Agent does not match');
  if (typeof validateCoordinate !== 'function' || !(await validateCoordinate(checkpoint.coordinate))) {
    throw checkpointError('NIGHT_WATCH_RESUME_PREREQUISITE_FAILED', 'Night-watch checkpoint prerequisite does not revalidate');
  }
  return checkpoint;
}
