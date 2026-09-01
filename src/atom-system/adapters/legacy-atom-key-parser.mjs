import { parseAtomKey } from '../../../work-engine/atom-language/key-parser.mjs';

export function parseLegacyPersistentAtomKey(rawKey) {
  return parseAtomKey(rawKey, {
    allowRetiredAgentKey: true,
    descriptionSymbolWarnings: false
  });
}
