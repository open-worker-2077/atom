import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createViewStateDocument,
  validateViewStateDocument
} from '../spatial-experience/view-state-repository.mjs';

// Facades for the same normalized file share a queue; this is not an OS writer lock.
const writesByFile = new Map();

function serialize(file, operation) {
  const key = process.platform === 'win32' ? file.toLowerCase() : file;
  const current = (writesByFile.get(key) ?? Promise.resolve()).then(operation);
  const settled = current.catch(() => {});
  writesByFile.set(key, settled);
  settled.then(() => { if (writesByFile.get(key) === settled) writesByFile.delete(key); });
  return current;
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  // A failed write/rename keeps its temporary for recovery; success consumes it.
  await fs.rename(temporary, file);
}

export function createViewStateRepository({ file, worldId }) {
  file = path.resolve(file);
  async function read() {
    return validateViewStateDocument(JSON.parse(await fs.readFile(file, 'utf8')), worldId);
  }

  async function write(view, options = {}) {
    const snapshot = structuredClone(view);
    const expectedRevision = options.expectedRevision;
    const compare = Object.hasOwn(options, 'expectedRevision');
    const legacyRevision = options.revision ?? 1;
    return serialize(file, async () => {
      let revision = legacyRevision;
      if (compare) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw Object.assign(new Error('Expected revision must be a non-negative integer'), { code: 'INVALID_VIEW_STATE_REVISION' });
        }
        let current = null;
        try { current = await read(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if ((current?.revision ?? 0) !== expectedRevision) {
          throw Object.assign(new Error('View state changed since it was read'), { code: 'VIEW_STATE_CONFLICT' });
        }
        revision = expectedRevision + 1;
      }
      const document = createViewStateDocument({ worldId, revision, view: snapshot });
      await atomicWrite(file, document);
      return document;
    });
  }

  return Object.freeze({ file: path.resolve(file), worldId, read, write });
}
