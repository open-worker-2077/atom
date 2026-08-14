import fs from 'node:fs/promises';
import path from 'node:path';

const ALLOWED = Object.freeze({
  entry: new Set(['adapters', 'spatial-experience']),
  public: new Set(['public']),
  'world-kernel': new Set(['world-kernel', 'public']),
  'world-runtime': new Set(['world-runtime', 'world-kernel', 'public']),
  projections: new Set(['projections', 'world-runtime', 'world-kernel', 'public']),
  'spatial-experience': new Set(['spatial-experience', 'public']),
  adapters: new Set([
    'adapters', 'world-runtime', 'world-kernel', 'projections', 'spatial-experience', 'public',
    'legacy-external'
  ]),
  operations: new Set(['operations', 'world-runtime', 'world-kernel', 'spatial-experience', 'public'])
});

function componentOf(file) {
  const normalized = file.replaceAll('\\', '/');
  return normalized.includes('/') ? normalized.split('/')[0] : 'entry';
}

function dependencyComponent(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file.replaceAll('\\', '/')), specifier));
  if (normalized.startsWith('../')) return 'legacy-external';
  return componentOf(normalized);
}

export function auditDependencyRecords(records) {
  const violations = [];
  let dependencies = 0;
  for (const record of records) {
    const from = componentOf(record.file);
    const allowed = ALLOWED[from] ?? new Set();
    for (const dependency of record.imports) {
      const to = dependencyComponent(record.file, dependency);
      if (!to) continue;
      dependencies += 1;
      if (!allowed.has(to)) violations.push({ file: record.file, from, dependency, to });
    }
  }
  return { files: records.length, dependencies, violations };
}

async function moduleFiles(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

function importsOf(source) {
  const imports = [];
  const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()(['"])([^'"]+)\1/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[2]);
  return imports;
}

export async function auditAtomSystemDependencies(root) {
  const files = await moduleFiles(root);
  const records = await Promise.all(files.map(async (file) => ({
    file: path.relative(root, file).replaceAll('\\', '/'),
    imports: importsOf(await fs.readFile(file, 'utf8'))
  })));
  return auditDependencyRecords(records);
}
