import fs from 'node:fs/promises';
import path from 'node:path';

const PRODUCTION_DIRECTORIES = Object.freeze(['src', 'work-engine', 'cli']);

const REGISTERED_ENTRIES = new Set([
  'cli/spatial.mjs',
  'work-engine/atom-language/admin-cli.mjs',
  'work-engine/atom-language/cli.mjs',
  'work-engine/atom-language/dev-server.mjs',
  'work-engine/atom-language/global-cli.mjs',
  'work-engine/atom-language/graph-server.mjs'
]);

const APPROVED_LEGACY_ENGINE_IMPORTERS = new Set([
  'src/atom-system/adapters/legacy-engine-adapter.mjs'
]);

const APPROVED_WORLD_FACT_WRITERS = new Set([
  'work-engine/atom-language/context-store.mjs'
]);

const TEMPORARY_DEBT = new Map();

function normalized(file) {
  return file.replaceAll('\\', '/');
}

async function sourceFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.gitnexus') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.(?:mjs|js)$/u.test(entry.name)) files.push(absolute);
    }
  }
  for (const directory of PRODUCTION_DIRECTORIES) await visit(path.join(root, directory));
  return files.sort((left, right) => left.localeCompare(right));
}

function importsOf(source) {
  const imports = [];
  const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()(['"])([^'"]+)\1/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[2]);
  return imports;
}

function engineImport(importer, specifier) {
  if (!specifier.startsWith('.')) return false;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return target === 'work-engine/atom-language/engine.mjs';
}

function finding(code, file, details = {}) {
  return { code, file, ...details };
}

function classify(findings) {
  const violations = [];
  const debt = [];
  for (const item of findings) {
    const reason = TEMPORARY_DEBT.get(`${item.code}:${item.file}`);
    if (reason) debt.push({ ...item, reason });
    else violations.push(item);
  }
  const order = (left, right) => left.file.localeCompare(right.file) || left.code.localeCompare(right.code);
  return { violations: violations.sort(order), debt: debt.sort(order) };
}

export async function auditProductionArchitecture(root) {
  const files = await sourceFiles(root);
  const findings = [];
  let dependencies = 0;

  for (const absolute of files) {
    const file = normalized(path.relative(root, absolute));
    const source = await fs.readFile(absolute, 'utf8');
    const imports = importsOf(source);
    dependencies += imports.length;

    if (source.startsWith('#!/usr/bin/env node') && !REGISTERED_ENTRIES.has(file)) {
      findings.push(finding('UNREGISTERED_PRODUCTION_ENTRY', file));
    }
    if (/\bwriteAtomContext\s*\(/u.test(source) && !APPROVED_WORLD_FACT_WRITERS.has(file)) {
      findings.push(finding('WORLD_FACT_WRITE_BYPASS', file));
    }
    if (imports.some((specifier) => engineImport(file, specifier))
      && !APPROVED_LEGACY_ENGINE_IMPORTERS.has(file)) {
      findings.push(finding('LEGACY_ENGINE_IMPORT_BYPASS', file));
    }
  }

  const classified = classify(findings);
  return Object.freeze({
    files: files.length,
    dependencies,
    violations: Object.freeze(classified.violations),
    debt: Object.freeze(classified.debt)
  });
}
