import { projectAtomContext } from './context-store.mjs';
import {
  atomTypes,
  fieldValue,
  replaceStoredField,
  walkAtoms
} from './slot-graph-semantics.mjs';
import { readVisibleSlotPlans } from './slot-body-plan-runtime.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const HEADER_PREFIX = 'PRINT_PLAN = json_parse(';
const MAIN_LINE = 'def main(arguments):';
const CURRENT_RETURN = '    return slot_body({"action":"print","name":arguments["name"]})';

function problem(path, reason) {
  return Object.assign(new Error(`Generated print Program is not an exact migration source: ${path}`), {
    code: 'GENERATED_SLOT_PRINT_MIGRATION_SOURCE_AMBIGUOUS',
    details: { path, reason }
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parsedHeader(line, path) {
  if (!line.startsWith(HEADER_PREFIX) || !line.endsWith(')')) {
    throw problem(path, 'header');
  }
  const literal = line.slice(HEADER_PREFIX.length, -1);
  let wrapper;
  let plan;
  try {
    wrapper = JSON.parse(literal);
    if (!wrapper || Array.isArray(wrapper) || typeof wrapper !== 'object'
      || Object.keys(wrapper).length !== 1 || typeof wrapper.text !== 'string'
      || JSON.stringify(wrapper) !== literal) throw new Error('non-canonical-wrapper');
    plan = JSON.parse(wrapper.text);
    if (JSON.stringify(plan) !== wrapper.text) throw new Error('non-canonical-plan');
  } catch {
    throw problem(path, 'header');
  }
  return plan;
}

function generatedSource(source, currentPlan, layoutBodyPath, path) {
  if (typeof source !== 'string' || !source.startsWith('PRINT_PLAN =')) return null;
  const lines = source.split('\n');
  if (lines.length !== 3 || lines[1] !== MAIN_LINE) throw problem(path, 'template');
  const embeddedPlan = parsedHeader(lines[0], path);
  if (stableStringify(embeddedPlan) !== stableStringify(currentPlan)) {
    throw problem(path, 'revision-plan');
  }
  if (typeof embeddedPlan?.body !== 'string' || typeof embeddedPlan?.revision !== 'string') {
    throw problem(path, 'revision-plan');
  }
  const current = [lines[0], MAIN_LINE, CURRENT_RETURN].join('\n');
  if (source === current) return { status: 'current' };
  const historical = new Set([embeddedPlan.body, layoutBodyPath].map((body) => [
    lines[0],
    MAIN_LINE,
    `    return slot_body({"action":"print","body":${JSON.stringify(body)},"name":arguments["name"]})`
  ].join('\n')));
  if (!historical.has(source)) throw problem(path, 'template');
  return { status: 'historical', source: current };
}

function defaultBackupPaths(facts) {
  return walkAtoms(facts)
    .filter(({ atom }) => {
      const types = atomTypes(atom);
      return types.includes('backup') && types.includes('default');
    })
    .map(({ path }) => path.join('/'));
}

function insideDefaultBackup(path, roots) {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

export function planGeneratedSlotPrintMigration(sourceFacts) {
  if (!Array.isArray(sourceFacts)) {
    const error = new Error('Generated slot print migration requires Atom world facts');
    error.code = 'GENERATED_SLOT_PRINT_MIGRATION_WORLD_REQUIRED';
    throw error;
  }
  const expectedRevision = revisionOfWorldFacts(sourceFacts);
  const facts = structuredClone(sourceFacts);
  const backupPaths = defaultBackupPaths(facts);
  const migrated = [];

  for (const { layout, plan } of readVisibleSlotPlans(facts)) {
    if (insideDefaultBackup(layout.bodyPath, backupPaths)) continue;
    const programPath = layout.printPath;
    const match = generatedSource(
      fieldValue(layout.print, 'situation'),
      plan,
      layout.bodyPath,
      programPath
    );
    if (match?.status !== 'historical') continue;
    replaceStoredField(layout.print, 'situation', match.source);
    migrated.push(Object.freeze({
      bodyPath: layout.bodyPath,
      programPath,
      planRevision: plan.revision
    }));
  }

  projectAtomContext(facts);
  const changedPaths = Object.freeze(migrated.map(({ programPath }) => programPath).sort());
  const nextRevision = revisionOfWorldFacts(facts);
  return Object.freeze({
    facts,
    expectedRevision,
    nextRevision,
    changedPaths,
    migrated: Object.freeze(migrated),
    summary: Object.freeze({ migratedPrograms: migrated.length })
  });
}
