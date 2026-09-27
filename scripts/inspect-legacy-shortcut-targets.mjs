import fs from 'node:fs/promises';

import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

const facts = JSON.parse(await fs.readFile(resolveAtomRuntime().contextFile, 'utf8'));
const cases = [];

function field(atom, baseKey) {
  return Object.entries(atom).map(([key, value]) => ({
    value, parsed: parseAtomKey(key, {
      descriptionSymbolWarnings: false, identityContract: 'legacy-22-migration'
    })
  })).find(({ parsed }) => parsed.baseKey === baseKey);
}

function walk(atom, parentPath = [], archived = false) {
  const thing = field(atom, 'thing');
  const path = [...parentPath, thing.value];
  const types = new Set(thing.parsed.types.map(type => type.raw));
  const inactive = archived || (types.has('backup') && types.has('default'));
  if (types.has('shortcut')) {
    const metadata = JSON.parse(field(atom, 'situation').value);
    if (!metadata?.target?.identity) cases.push({
      path: path.join('/'), inactive, state: metadata?.target?.state,
      targetPath: metadata?.target?.path ?? null
    });
  }
  for (const child of field(atom, 'slot')?.value ?? []) walk(child, path, inactive);
}

for (const atom of facts) walk(atom);
console.log(JSON.stringify({
  count: cases.length,
  active: cases.filter(item => !item.inactive).length,
  archived: cases.filter(item => item.inactive).length,
  states: Object.fromEntries([...new Set(cases.map(item => item.state))]
    .map(state => [state, cases.filter(item => item.state === state).length])),
  samples: cases.slice(0, 30)
}));
