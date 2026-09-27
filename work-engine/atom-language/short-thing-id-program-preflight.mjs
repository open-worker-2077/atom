import { createHash } from 'node:crypto';

import { parseAtomKey } from './key-parser.mjs';
import { createProgramRefBindingUpdate } from './program-ref-binding-ledger.mjs';
import { inspectProgramReferenceSites } from './program-reference-runtime.mjs';

const hash = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;

function migrationField(atom, baseKey, identityContract) {
  const matches = Object.entries(atom ?? {}).map(([key, value]) => ({
    value, parsed: parseAtomKey(key, { descriptionSymbolWarnings: false, identityContract })
  })).filter(({ parsed }) => parsed.baseKey === baseKey);
  if (matches.length !== 1 || matches[0].parsed.errors.length) {
    throw Object.assign(new Error(`Migration requires one valid ${baseKey} axis`), {
      code: 'INVALID_THING_IDENTITY_MIGRATION_SOURCE'
    });
  }
  return matches[0];
}

function programRecords(facts) {
  const records = [];
  function visit(atom, parentPath = [], archived = false) {
    let contract = 'legacy-22-migration';
    let thing;
    try { thing = migrationField(atom, 'thing', contract); }
    catch {
      contract = 'short';
      thing = migrationField(atom, 'thing', contract);
    }
    const path = [...parentPath, thing.value];
    const types = new Set(thing.parsed.types.map(({ raw }) => raw));
    const inactive = archived || (types.has('backup') && types.has('default'));
    if (types.has('program')) records.push({
      programThingId: thing.parsed.identity,
      programPath: path.join('/'), inactive,
      source: migrationField(atom, 'situation', contract).value
    });
    for (const child of migrationField(atom, 'slot', contract).value) visit(child, path, inactive);
  }
  for (const atom of facts) visit(atom);
  return records;
}

// Legacy worlds may predate binding receipts. Only an active Program proven to
// have zero reference sites can acquire an empty binding during the same cold
// migration transaction. Archived Programs stay unbound and inactive.
export async function prepareShortThingIdProgramBindings({
  facts, bindings, inspectProgram = inspectProgramReferenceSites
}) {
  const replacements = bindings?.entries?.().map(([, binding]) => binding) ?? [];
  const boundIds = new Set(replacements.map(({ programThingId }) => programThingId));
  for (const entry of programRecords(facts)) {
    if (entry.inactive || boundIds.has(entry.programThingId)) continue;
    const inspected = await inspectProgram({ source: entry.source, programPath: entry.programPath });
    if (inspected.sourceHash !== hash(entry.source) || inspected.sites.length !== 0) {
      throw Object.assign(new Error('Active legacy Program requires verified reference bindings'), {
        code: 'PROGRAM_REF_BINDING_MISSING',
        details: { programPath: entry.programPath, referenceSiteCount: inspected.sites.length }
      });
    }
    replacements.push({ programThingId: entry.programThingId, sourceHash: inspected.sourceHash, sites: [] });
    boundIds.add(entry.programThingId);
  }
  return createProgramRefBindingUpdate({ replacements });
}
