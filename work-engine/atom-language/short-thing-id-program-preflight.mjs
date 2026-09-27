import { createHash } from 'node:crypto';

import { collectDefaultBackupBoundary } from './default-backup-boundary.mjs';
import { createProgramRefBindingUpdate } from './program-ref-binding-ledger.mjs';
import { inspectProgramReferenceSites } from './program-reference-runtime.mjs';
import { storedField } from './slot-graph-semantics.mjs';

const hash = (source) => `sha256:${createHash('sha256').update(source).digest('hex')}`;

// Legacy worlds may predate binding receipts. Only an active Program proven to
// have zero reference sites can acquire an empty binding during the same cold
// migration transaction. Archived Programs stay unbound and inactive.
export async function prepareShortThingIdProgramBindings({
  facts, bindings, inspectProgram = inspectProgramReferenceSites
}) {
  const replacements = bindings?.entries?.().map(([, binding]) => binding) ?? [];
  const boundIds = new Set(replacements.map(({ programThingId }) => programThingId));
  const boundary = collectDefaultBackupBoundary(facts);
  for (const entry of boundary.entriesByPath.values()) {
    if (entry.inactive || !storedField(entry.atom, 'thing')?.parsed.types
      .some(({ raw }) => raw === 'program') || boundIds.has(entry.identity)) continue;
    const source = storedField(entry.atom, 'situation')?.value ?? '';
    const inspected = await inspectProgram({ source, programPath: entry.path });
    if (inspected.sourceHash !== hash(source) || inspected.sites.length !== 0) {
      throw Object.assign(new Error('Active legacy Program requires verified reference bindings'), {
        code: 'PROGRAM_REF_BINDING_MISSING',
        details: { programPath: entry.path, referenceSiteCount: inspected.sites.length }
      });
    }
    replacements.push({ programThingId: entry.identity, sourceHash: inspected.sourceHash, sites: [] });
    boundIds.add(entry.identity);
  }
  return createProgramRefBindingUpdate({ replacements });
}
