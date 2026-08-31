import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_ROOTS = Object.freeze([
  '.agents/skills/superpowers',
  '.codex/skills/superpowers',
  '.openspec',
  'openspec',
  'plans',
  'requirements',
  'roadmap',
  'skills/superpowers',
  'specs',
  'docs'
]);
const ACTIVE_SUPERPOWERS_PREFIXES = Object.freeze([
  'docs/superpowers/specs/',
  'docs/superpowers/plans/'
]);
const HISTORY_PREFIX = 'docs/history/';
const PARALLEL_SPEC_PREFIXES = Object.freeze([
  'specs/',
  'docs/specs/',
  'requirements/',
  'docs/requirements/'
]);
const PARALLEL_PLAN_PREFIXES = Object.freeze([
  'plans/',
  'roadmap/',
  'docs/plans/',
  'docs/roadmap/'
]);
const SUPERPOWERS_SHADOW_PREFIXES = Object.freeze([
  '.agents/skills/superpowers/',
  '.codex/skills/superpowers/',
  'skills/superpowers/'
]);
const PARALLEL_STATUS = /(?:^|[-_])(handoff|night[-_]?watch|requirements?[-_]?ledger|development[-_]?status|delivery[-_]?status|blocker[-_]?status|acceptance[-_]?status)(?:[-_.]|$)/i;

function normalizedPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

export function classifyDevelopmentControlViolation(relativePath) {
  const candidate = normalizedPath(relativePath);
  if (candidate.startsWith(HISTORY_PREFIX)) return null;
  if (ACTIVE_SUPERPOWERS_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return null;
  if (candidate === '.openspec' || candidate.startsWith('.openspec/') ||
      candidate === 'openspec' || candidate.startsWith('openspec/')) {
    return Object.freeze({ path: candidate, category: 'retired-openspec' });
  }
  if (SUPERPOWERS_SHADOW_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
    return Object.freeze({ path: candidate, category: 'superpowers-shadow' });
  }
  if (PARALLEL_SPEC_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
    return Object.freeze({ path: candidate, category: 'parallel-spec' });
  }
  if (PARALLEL_PLAN_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
    return Object.freeze({ path: candidate, category: 'parallel-plan' });
  }
  if ((!candidate.includes('/') || candidate.startsWith('docs/')) &&
      PARALLEL_STATUS.test(path.posix.basename(candidate))) {
    return Object.freeze({ path: candidate, category: 'parallel-status' });
  }
  return null;
}

async function walk(root, relativeDirectory) {
  const absolute = path.join(root, ...relativeDirectory.split('/'));
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory + '/' + entry.name;
    if (entry.isDirectory()) found.push(...await walk(root, relativePath));
    else if (entry.isFile() || entry.isSymbolicLink()) found.push(relativePath);
  }
  return found;
}

export async function findDevelopmentControlViolations(root) {
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  const paths = rootEntries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name);
  for (const scanRoot of SCAN_ROOTS) paths.push(...await walk(root, scanRoot));
  return paths
    .map(classifyDevelopmentControlViolation)
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const found = await findDevelopmentControlViolations(root);
  if (found.length === 0) return;
  process.stderr.write([
    'Official Superpowers specs and plans are Atom development-control artifacts.',
    'Retired or parallel control paths remain in active discovery:',
    ...found.map((entry) => '- [' + entry.category + '] ' + entry.path)
  ].join('\n') + '\n');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
