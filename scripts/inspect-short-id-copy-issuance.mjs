import path from 'node:path';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { rebuildThingIdWatermark } from '../work-engine/atom-language/thing-id-allocator.mjs';

const contextFile = path.resolve(process.argv[2] ?? '');
if (path.basename(contextFile) !== 'atom.json') throw new Error('Expected an isolated atom.json path');
const directory = path.dirname(contextFile);
const persistence = createTransactionalWorldPersistence({
  contextFile,
  projectionFile: path.join(directory, 'graph.json'),
  journalFile: path.join(directory, 'atom.transactions.json'),
  publishLegacyProjection: false
});
const metadata = await persistence.readInternalMetadataState();
const allocations = metadata.receipts.flatMap(entry => {
  const update = entry?.receipt?.result?.thingIdentityAllocator;
  return update ? [update] : [];
});
console.log(JSON.stringify({
  receiptCount: metadata.receipts.length,
  allocatorWatermark: rebuildThingIdWatermark(metadata.receipts),
  allocations: allocations.slice(-3).map(({ previousWatermark, nextWatermark, issued }) => ({
    previousWatermark, nextWatermark, issuedCount: issued.length,
    firstIssued: issued[0], lastIssued: issued.at(-1)
  }))
}));
