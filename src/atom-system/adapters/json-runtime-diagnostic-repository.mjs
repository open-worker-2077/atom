import fs from 'node:fs/promises';

import { writeJsonAtomically } from './json-world-repository.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function validateState(value) {
  if (value?.version !== 1 || !Array.isArray(value.diagnostics)) {
    throw problem(
      'INVALID_RUNTIME_DIAGNOSTIC_FILE',
      'Runtime diagnostic file must slot version 1 diagnostics'
    );
  }
  return { version: 1, diagnostics: structuredClone(value.diagnostics) };
}

export function createJsonRuntimeDiagnosticRepository({ file }) {
  if (typeof file !== 'string' || !file.trim()) {
    throw problem('INVALID_RUNTIME_DIAGNOSTIC_FILE', 'Runtime diagnostic repository requires file');
  }

  async function read() {
    try {
      return validateState(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, diagnostics: [] };
      if (error.code === 'INVALID_RUNTIME_DIAGNOSTIC_FILE') throw error;
      throw problem(
        'RUNTIME_DIAGNOSTIC_READ_FAILED',
        'Cannot read runtime diagnostics',
        { cause: error.code ?? error.name }
      );
    }
  }

  async function write(value) {
    const state = validateState(value);
    try {
      await writeJsonAtomically(file, state);
    } catch (error) {
      throw problem(
        'RUNTIME_DIAGNOSTIC_WRITE_FAILED',
        'Cannot write runtime diagnostics',
        { cause: error.code ?? error.name }
      );
    }
  }

  return Object.freeze({ file, read, write });
}
