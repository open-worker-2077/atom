import { createLegacyWorldService } from '../../src/atom-system/adapters/legacy-engine-adapter.mjs';

const worldService = createLegacyWorldService();

export function executeAtomLanguage(request) {
  return worldService.executeLegacy(request);
}
