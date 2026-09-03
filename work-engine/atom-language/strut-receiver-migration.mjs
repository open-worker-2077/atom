import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectAtomContext } from './context-store.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-strut-trigger-migration.py');

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

function recordsOf(facts) {
  const records = [];
  function visit(atoms, parentPath = [], archived = false) {
    for (const atom of atoms ?? []) {
      const fields = fieldsOf(atom);
      const thing = fields.get('thing');
      if (typeof thing?.value !== 'string' || !thing.value) continue;
      const types = new Set(thing.parsed.types.map(({ raw }) => raw));
      const insideArchive = archived || (types.has('backup') && types.has('default'));
      const parts = [...parentPath, thing.value];
      records.push({
        atom, fields, name: thing.value, parts, path: parts.join('/'),
        parentPath: parentPath.join('/'), archived: insideArchive,
        isProgram: types.has('program')
      });
      visit(fields.get('slot')?.value, parts, insideArchive);
    }
  }
  visit(facts);
  return records;
}

function resolveSelector(records, selector, owner) {
  let matches = [];
  if (selector === '.') matches = records.filter(({ path: candidate }) => candidate === owner.path);
  else if (selector.startsWith('./')) {
    const expected = owner.parentPath ? `${owner.parentPath}/${selector.slice(2)}` : selector.slice(2);
    matches = records.filter(({ path: candidate }) => candidate === expected);
  } else if (selector.includes('/')) {
    matches = records.filter(({ path: candidate }) => (
      candidate === selector || candidate.endsWith(`/${selector}`)
    ));
  } else {
    const sibling = owner.parentPath ? `${owner.parentPath}/${selector}` : selector;
    const siblingMatch = records.find(({ path: candidate }) => candidate === sibling);
    matches = siblingMatch ? [siblingMatch] : records.filter(({ name }) => name === selector);
  }
  if (matches.length !== 1) {
    throw problem('STRUT_RECEIVER_MIGRATION_SELECTOR_UNRESOLVED',
      `Strut migration selector must resolve exactly once: ${selector}`, {
        ownerPath: owner.path, selector, matches: matches.map(({ path: candidate }) => candidate)
      });
  }
  return matches[0];
}

function analyzePrograms(programs, python) {
  if (!programs.length) return [];
  const child = spawnSync(python ?? 'python', ['-I', '-X', 'utf8', tool], {
    input: JSON.stringify({ programs }), encoding: 'utf8', windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (child.error || child.status !== 0) {
    let remote = null;
    try { remote = JSON.parse(child.stderr.trim()); } catch { /* use generic error */ }
    throw problem(remote?.code ?? 'STRUT_RECEIVER_MIGRATION_AST_FAILED',
      remote?.message ?? 'Strut receiver Program AST preflight failed', {
        ...(remote?.details ?? {}), cause: child.error?.code ?? child.status
      });
  }
  try {
    return JSON.parse(child.stdout).programs;
  } catch (error) {
    throw problem('STRUT_RECEIVER_MIGRATION_AST_FAILED', 'Strut receiver AST tool returned invalid JSON', {
      cause: error.message
    });
  }
}

function rewriteFacts(sourceFacts, subscriptions, rewrittenPrograms) {
  const matched = new Set();
  let rewrittenConsequents = 0;
  function receiversFor(targetPath) {
    return subscriptions.get(targetPath) ?? [];
  }
  function visit(atoms, sourceRecords, parentPath = [], archived = false) {
    return (atoms ?? []).map((atom) => {
      const target = structuredClone(atom);
      const sourceFields = fieldsOf(atom);
      const targetFields = fieldsOf(target);
      const thing = sourceFields.get('thing');
      if (typeof thing?.value !== 'string' || !thing.value) return target;
      const types = new Set(thing.parsed.types.map(({ raw }) => raw));
      const insideArchive = archived || (types.has('backup') && types.has('default'));
      const ownerPath = [...parentPath, thing.value].join('/');
      const owner = sourceRecords.find(({ path: candidate }) => candidate === ownerPath);
      if (!insideArchive && owner?.isProgram && rewrittenPrograms.has(ownerPath)) {
        target[targetFields.get('situation').rawKey] = rewrittenPrograms.get(ownerPath);
      }
      const strut = sourceFields.get('strut');
      if (!insideArchive && owner && Array.isArray(strut?.value)) {
        target[targetFields.get('strut').rawKey] = strut.value.map((clause) => {
          const next = structuredClone(clause);
          const endpoints = [];
          for (const endpoint of next.then ?? []) {
            const key = Object.hasOwn(endpoint ?? {}, 'thing@program') ? 'thing@program' : 'thing';
            const selector = endpoint?.[key];
            if (typeof selector !== 'string') {
              endpoints.push(endpoint);
              continue;
            }
            const resolved = resolveSelector(sourceRecords, selector, owner);
            const receivers = receiversFor(resolved.path);
            if (!receivers.length) {
              endpoints.push(endpoint);
              continue;
            }
            for (const receiver of receivers) {
              endpoints.push({ 'thing@program': receiver.path });
              matched.add(`${receiver.path}\0${resolved.path}`);
              rewrittenConsequents += 1;
            }
          }
          if (next['then@current'] === true) {
            const receivers = receiversFor(owner.path);
            if (receivers.length) {
              delete next['then@current'];
              for (const receiver of receivers) {
                endpoints.push({ 'thing@program': receiver.path });
                matched.add(`${receiver.path}\0${owner.path}`);
                rewrittenConsequents += 1;
              }
            }
          }
          if (endpoints.length || Object.hasOwn(next, 'then')) next.then = endpoints;
          return next;
        });
      }
      const slot = sourceFields.get('slot');
      if (Array.isArray(slot?.value)) {
        target[targetFields.get('slot').rawKey] = visit(slot.value, sourceRecords,
          [...parentPath, thing.value], insideArchive);
      }
      return target;
    });
  }
  return { facts: visit(sourceFacts, recordsOf(sourceFacts)), matched, rewrittenConsequents };
}

export function planStrutReceiverMigration(sourceFacts, options = {}) {
  if (!Array.isArray(sourceFacts)) {
    throw problem('STRUT_RECEIVER_MIGRATION_WORLD_REQUIRED', 'Atom world facts must be an array');
  }
  const records = recordsOf(sourceFacts);
  const activePrograms = records.filter(({ archived, isProgram }) => !archived && isProgram);
  const analyses = analyzePrograms(activePrograms.map(({ path: programPath, fields }) => ({
    path: programPath, source: fields.get('situation')?.value ?? ''
  })), options.python);
  const subscriptions = new Map();
  const rewrittenPrograms = new Map();
  const legacy = [];
  for (const analysis of analyses.filter(({ status }) => status === 'legacy')) {
    const program = records.find(({ path: candidate }) => candidate === analysis.path);
    rewrittenPrograms.set(program.path, analysis.source);
    for (const selector of analysis.nodes) {
      const target = resolveSelector(records, selector, program);
      if (!subscriptions.has(target.path)) subscriptions.set(target.path, []);
      subscriptions.get(target.path).push(program);
      legacy.push({ programPath: program.path, nodePath: target.path, entrypoint: analysis.entrypoint });
    }
  }
  for (const receivers of subscriptions.values()) {
    receivers.sort((left, right) => left.path.localeCompare(right.path));
  }
  const { facts, matched, rewrittenConsequents } = rewriteFacts(
    sourceFacts, subscriptions, rewrittenPrograms
  );
  for (const entry of legacy) {
    if (!matched.has(`${entry.programPath}\0${entry.nodePath}`)) {
      throw problem('STRUT_RECEIVER_MIGRATION_CONSEQUENT_REQUIRED',
        'Every legacy Strut subscription must match an actual Graph consequent', entry);
    }
  }
  projectAtomContext(facts);
  const expectedRevision = revisionOfWorldFacts(sourceFacts);
  const nextRevision = revisionOfWorldFacts(facts);
  const migrationId = `strut-receiver-${crypto.createHash('sha256')
    .update(`${expectedRevision}\0${nextRevision}`).digest('hex').slice(0, 20)}`;
  return Object.freeze({
    contract: 'atom.strut-receiver-migration-plan', version: 1,
    migrationId, expectedRevision, nextRevision, facts,
    summary: Object.freeze({
      migratedPrograms: rewrittenPrograms.size,
      migratedSubscriptions: legacy.length,
      rewrittenConsequents
    }),
    migrated: Object.freeze(legacy.map(Object.freeze))
  });
}
