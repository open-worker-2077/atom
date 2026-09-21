import fs from 'node:fs/promises';

import { createTransactionalWorldPersistence } from '../../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';
import {
  createProgramRefBindingUpdate,
  rebuildProgramRefBindings
} from '../../work-engine/atom-language/program-ref-binding-ledger.mjs';
import { inspectProgramReferenceSites } from '../../work-engine/atom-language/program-reference-runtime.mjs';
import {
  ensureThingIdentities,
  storedField,
  walkAtoms
} from '../../work-engine/atom-language/slot-graph-semantics.mjs';
import {
  planThingIdAllocation,
  thingIdentityAllocatorUpdate
} from '../../work-engine/atom-language/thing-id-allocator.mjs';

function resolveTarget(records, selector) {
  const matches = records.filter(record => {
    const path = record.path.join('/');
    return path === selector || path.endsWith(`/${selector}`);
  });
  return matches.length === 1
    ? storedField(matches[0].atom, 'thing')?.parsed.identity ?? null
    : null;
}

export async function seedBoundWorld({
  contextFile, projectionFile, facts, returnDetails = false, publishLegacyProjection = false
}) {
  const seededFacts = structuredClone(facts);
  const recordsBefore = walkAtoms(seededFacts);
  const missing = recordsBefore.filter(({ atom }) => !storedField(atom, 'thing')?.parsed.identity);
  const allocation = planThingIdAllocation({ watermark: '000', count: missing.length });
  ensureThingIdentities(seededFacts, { identities: allocation.ids });
  const records = walkAtoms(seededFacts);
  const replacements = [];
  for (const record of records) {
    const thing = storedField(record.atom, 'thing');
    if (!thing?.parsed.types.some(type => type.raw === 'program')) continue;
    const source = storedField(record.atom, 'situation')?.value ?? '';
    if (!source.trim()) continue;
    const inspected = await inspectProgramReferenceSites({ source });
    replacements.push({
      programThingId: thing.parsed.identity,
      sourceHash: inspected.sourceHash,
      sites: inspected.sites.map(site => {
        const targetThingId = resolveTarget(records, site.selector);
        if (!targetThingId) {
          throw Object.assign(new Error(`Test Program reference is unresolved: ${site.selector}`), {
            code: 'TEST_PROGRAM_REFERENCE_UNRESOLVED'
          });
        }
        return { fingerprint: site.fingerprint, role: site.role, targetThingId };
      })
    });
  }
  await fs.writeFile(contextFile, '[]\n', 'utf8');
  const persistence = createTransactionalWorldPersistence({
    contextFile,
    projectionFile,
    publishLegacyProjection
  });
  const programRefBindingUpdate = createProgramRefBindingUpdate({ replacements });
  await persistence.commit({
    correlationId: 'seed-bound-world',
    expectedRevision: revisionOfWorldFacts([]),
    nextRevision: revisionOfWorldFacts(seededFacts),
    facts: seededFacts,
    programRefBindings: programRefBindingUpdate,
    ...(allocation.ids.length > 0 ? {
      thingIdentityAllocator: thingIdentityAllocatorUpdate({
        previousWatermark: '000',
        ids: allocation.ids
      })
    } : {})
  });
  if (!returnDetails) return seededFacts;
  return {
    facts: seededFacts,
    thingIdentityWatermark: allocation.nextWatermark,
    programRefBindings: rebuildProgramRefBindings([{ receipt: { result: {
      programRefBindings: programRefBindingUpdate
    } } }])
  };
}
