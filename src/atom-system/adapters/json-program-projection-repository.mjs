import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function validateProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1
    || typeof value.worldKey !== 'string' || !value.worldKey
    || typeof value.programSetKey !== 'string' || !value.programSetKey
    || typeof value.contextDependent !== 'boolean'
    || (value.scopePath !== null && typeof value.scopePath !== 'string')
    || (value.contextDependent && !value.scopePath)
    || !Array.isArray(value.locks)
    || !Array.isArray(value.choices)
    || (value.readSetVersion !== undefined && value.readSetVersion !== 1)
    || (value.exploreReadPaths !== undefined && (
      !Array.isArray(value.exploreReadPaths)
      || value.exploreReadPaths.some((entry) => typeof entry !== 'string' || !entry.trim())
      || new Set(value.exploreReadPaths).size !== value.exploreReadPaths.length
    ))
    || !Array.isArray(value.failures)
    || value.failures.length > 0) {
    throw problem(
      'INVALID_PROGRAM_PROJECTION',
      'Stored Program projection does not match the supported contract'
    );
  }
  return value;
}

export function createJsonProgramProjectionRepository({ file }) {
  if (typeof file !== 'string' || !file.trim()) {
    throw problem('INVALID_PROGRAM_PROJECTION_PATH', 'Program projection requires one file path');
  }
  const projectionFile = path.resolve(file);

  async function load() {
    try {
      return validateProjection(JSON.parse(await fs.readFile(projectionFile, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function save(projection) {
    const value = validateProjection(structuredClone(projection));
    const text = `${JSON.stringify(value, null, 2)}\n`;
    await fs.mkdir(path.dirname(projectionFile), { recursive: true });
    const temporary = `${projectionFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx');
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.rename(temporary, projectionFile);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        await fs.copyFile(temporary, projectionFile);
        await fs.unlink(temporary);
      }
      return value;
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  return Object.freeze({ file: projectionFile, load, save });
}
