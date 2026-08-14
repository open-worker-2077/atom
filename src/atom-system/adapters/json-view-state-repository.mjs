import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createViewStateDocument,
  validateViewStateDocument
} from '../spatial-experience/view-state-repository.mjs';

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export function createViewStateRepository({ file, worldId }) {
  async function read() {
    return validateViewStateDocument(JSON.parse(await fs.readFile(file, 'utf8')), worldId);
  }

  async function write(view, options = {}) {
    const document = createViewStateDocument({
      worldId,
      revision: options.revision ?? 1,
      view
    });
    await atomicWrite(file, document);
    return read();
  }

  return Object.freeze({ file: path.resolve(file), worldId, read, write });
}
