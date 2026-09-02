import crypto from 'node:crypto';

import { parseAtomKey } from './key-parser.mjs';
import { projectAtomContext } from './context-store.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function fieldsOf(atom) {
  const fields = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (!parsed.errors.length && !fields.has(parsed.baseKey)) {
      fields.set(parsed.baseKey, { rawKey, value, parsed });
    }
  }
  return fields;
}

function programIndex(facts) {
  const programs = [];
  function visit(records, parentPath = [], archived = false) {
    for (const atom of records ?? []) {
      const fields = fieldsOf(atom);
      const thing = fields.get('thing');
      const name = thing?.value;
      if (typeof name !== 'string' || !name) continue;
      const types = new Set(thing.parsed.types.map(({ raw }) => raw));
      const insideArchive = archived || (types.has('backup') && types.has('default'));
      const path = [...parentPath, name];
      if (!insideArchive && types.has('program')) {
        const source = fields.get('situation')?.value;
        if (typeof source !== 'string' || !source.trim()) {
          throw problem('INLINE_STRUT_MIGRATION_PROGRAM_SOURCE_REQUIRED',
            `推支引用的 Program 必须具有非空 situation 源码：${path.join('/')}`);
        }
        programs.push({ name, path: path.join('/'), source });
      }
      visit(fields.get('slot')?.value, path, insideArchive);
    }
  }
  visit(facts);
  return programs;
}

function resolveProgram(programs, selector, ownerPath) {
  let matches;
  if (selector.startsWith('./')) {
    const sibling = `${ownerPath.slice(0, -1).join('/')}/${selector.slice(2)}`;
    matches = programs.filter((program) => program.path === sibling);
  } else if (selector.includes('/')) {
    matches = programs.filter((program) => program.path === selector
      || program.path.endsWith(`/${selector}`));
  } else {
    matches = programs.filter((program) => program.name === selector);
  }
  if (matches.length !== 1) {
    throw problem('INLINE_STRUT_MIGRATION_PROGRAM_UNRESOLVED',
      `旧推支 Program 必须唯一解析：${selector}`,
      { ownerPath: ownerPath.join('/'), selector, matches: matches.map(({ path }) => path) });
  }
  return matches[0];
}

function rewritePredicate(value, context) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => rewritePredicate(entry, {
      ...context, expressionPath: `${context.expressionPath}[${index}]`
    }));
  }
  if (!value || typeof value !== 'object') return structuredClone(value);
  if (Object.hasOwn(value, 'thing@program')) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || typeof value['thing@program'] !== 'string') {
      throw problem('INLINE_STRUT_MIGRATION_AMBIGUOUS_PREDICATE',
        '旧推支 Program 叶必须是仅含 thing@program 的对象', {
          ownerPath: context.ownerPath.join('/'), expressionPath: context.expressionPath
        });
    }
    const program = resolveProgram(context.programs, value['thing@program'], context.ownerPath);
    context.migrated.push({
      ownerPath: context.ownerPath.join('/'),
      expressionPath: context.expressionPath,
      sourceProgramPath: program.path
    });
    return { program: program.source };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    rewritePredicate(child, { ...context, expressionPath: `${context.expressionPath}.${key}` })
  ]));
}

function rewriteFacts(sourceFacts, programs) {
  const migrated = [];
  function visit(records, parentPath = [], archived = false) {
    return (records ?? []).map((atom) => {
      const target = structuredClone(atom);
      const fields = fieldsOf(target);
      const thing = fields.get('thing');
      const name = thing?.value;
      if (typeof name !== 'string' || !name) return target;
      const types = new Set(thing.parsed.types.map(({ raw }) => raw));
      const insideArchive = archived || (types.has('backup') && types.has('default'));
      const ownerPath = [...parentPath, name];
      const strut = fields.get('strut');
      if (!insideArchive && Array.isArray(strut?.value)) {
        target[strut.rawKey] = strut.value.map((clause, clauseIndex) => {
          const rewritten = structuredClone(clause);
          if (Object.hasOwn(rewritten, 'if')) {
            rewritten.if = rewritePredicate(rewritten.if, {
              programs, migrated, ownerPath, expressionPath: `strut[${clauseIndex}].if`
            });
          }
          return rewritten;
        });
      }
      const slot = fields.get('slot');
      if (Array.isArray(slot?.value)) {
        target[slot.rawKey] = visit(slot.value, ownerPath, insideArchive);
      }
      return target;
    });
  }
  return { facts: visit(sourceFacts), migrated };
}

export function planInlineStrutMigration(sourceFacts) {
  if (!Array.isArray(sourceFacts)) {
    throw problem('INLINE_STRUT_MIGRATION_WORLD_REQUIRED', 'Atom 世界事实必须是数组');
  }
  const programs = programIndex(sourceFacts);
  const { facts, migrated } = rewriteFacts(sourceFacts, programs);
  projectAtomContext(facts);
  const expectedRevision = revisionOfWorldFacts(sourceFacts);
  const nextRevision = revisionOfWorldFacts(facts);
  const migrationId = `inline-strut-${crypto.createHash('sha256')
    .update(`${expectedRevision}\0${nextRevision}`)
    .digest('hex').slice(0, 20)}`;
  return Object.freeze({
    contract: 'atom.inline-strut-migration-plan',
    version: 1,
    migrationId,
    expectedRevision,
    nextRevision,
    facts,
    summary: Object.freeze({ migratedPredicates: migrated.length }),
    migrated: Object.freeze(migrated.map(Object.freeze))
  });
}
