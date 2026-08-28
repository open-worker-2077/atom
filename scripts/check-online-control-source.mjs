import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTROL_ROOTS = Object.freeze(['openspec', 'docs', 'plans']);
const DURABLE_DOC_PREFIXES = Object.freeze([
  'docs/adr/',
  'docs/architecture/',
  'docs/operations/',
  'docs/releases/'
]);

export const RETIRED_CONTROL_CATEGORIES = Object.freeze([
  Object.freeze({
    id: 'development-plan-or-roadmap',
    description: 'local development plans and roadmap queues',
    matches: (relativePath) =>
      relativePath.startsWith('plans/') ||
      relativePath.startsWith('docs/plans/') ||
      relativePath.startsWith('docs/superpowers/plans/') ||
      relativePath.startsWith('docs/roadmap/') ||
      (relativePath.startsWith('docs/') &&
        !DURABLE_DOC_PREFIXES.some((prefix) => relativePath.startsWith(prefix)) &&
        /-plan\.(?:md|mdx)$/i.test(relativePath))
  }),
  Object.freeze({
    id: 'handoff-watch-ledger-status',
    description: 'local handoff, watch, ledger, blocker, or acceptance status files',
    matches: (relativePath) => {
      const basename = path.posix.basename(relativePath);
      return /(?:^|[-_])(handoff|night[-_]?watch|requirements?[-_]?ledger|development[-_]?status|delivery[-_]?status|blocker[-_]?status|acceptance[-_]?status)(?:[-_.]|$)/i.test(basename);
    }
  })
]);

async function walkFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, ...relativeDirectory.split('/'));
  let entries;
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walkFiles(root, relativePath));
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(relativePath);
  }
  return files;
}

export function classifyRetiredControlPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!CONTROL_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) return null;
  const category = RETIRED_CONTROL_CATEGORIES.find(({ matches }) => matches(normalized));
  return category ? { path: normalized, category: category.id } : null;
}

export async function findRetiredControlFiles(root) {
  const files = [];
  for (const controlRoot of CONTROL_ROOTS) files.push(...await walkFiles(root, controlRoot));
  return files
    .map(classifyRetiredControlPath)
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const found = await findRetiredControlFiles(root);
  if (found.length === 0) return;
  process.stderr.write([
    'GitHub Issues/Project is the sole Atom development control source.',
    'Retired local control categories must not exist in active discovery paths:',
    ...found.map(({ path: relativePath, category }) => `- [${category}] ${relativePath}`),
    'Restore requirements, status, blockers, or acceptance boundaries in GitHub instead of recreating local plans, roadmaps, handoffs, watch files, ledgers, or status files.'
  ].join('\n') + '\n');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
