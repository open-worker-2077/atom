import { createLegacyWorldService } from '../../src/atom-system/adapters/legacy-engine-adapter.mjs';

const worldService = createLegacyWorldService();

export function executeAtomLanguage(request) {
  return worldService.executeLegacy({ programMode: 'reconcile', ...request });
}

export async function readCommittedAtomLanguageFacts(request) {
  const snapshot = await worldService.readCommittedSnapshot(request);
  return snapshot?.facts ?? [];
}
