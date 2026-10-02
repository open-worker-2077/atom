// Identity replay needs ordered allocation/binding updates and migration barriers,
// never historical source bodies, compatibility manifests or Program outcomes.
export function identityReceiptMetadata(entry) {
  const result = {};
  for (const field of ['thingIdentityAllocator', 'programRefBindings',
    'thingIdentityMigration', 'thingIdentityMigrationRollback']) {
    if (Object.hasOwn(entry.receipt?.result ?? {}, field)) result[field] = entry.receipt.result[field];
  }
  return { commandId: entry.commandId, historyMode: entry.historyMode,
    receipt: { commandId: entry.receipt?.commandId, result } };
}
