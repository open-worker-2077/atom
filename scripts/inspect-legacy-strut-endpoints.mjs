import fs from 'node:fs/promises';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';
import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

const runtime = resolveAtomRuntime();
const facts = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
const results = [];
function inspect(value, path, inactive) {
  if (Array.isArray(value)) { for (const item of value) inspect(item, path, inactive); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const parsed = parseAtomKey(key, { descriptionSymbolWarnings: false, identityContract: 'legacy-22-migration' });
    if (parsed.baseKey === 'thing' && (parsed.errors.length || !parsed.identity))
      results.push({ path, inactive, key, selector: child });
    inspect(child, path, inactive);
  }
}
function walk(atom, path = [], inactive = false) {
  const thingKey = Object.keys(atom).find(key => key.startsWith('thing'));
  const types = new Set(parseAtomKey(thingKey, { descriptionSymbolWarnings: false, identityContract: 'legacy-22-migration' }).types.map(type => type.raw));
  const nextInactive = inactive || (types.has('backup') && types.has('default'));
  const nextPath = [...path, atom[thingKey]];
  const strutKey = Object.keys(atom).find(key => parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === 'strut');
  inspect(atom[strutKey] ?? [], nextPath.join('/'), nextInactive);
  const slotKey = Object.keys(atom).find(key => parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === 'slot');
  for (const child of atom[slotKey] ?? []) walk(child, nextPath, nextInactive);
}
for (const atom of facts) walk(atom);
console.log(JSON.stringify({ count: results.length, active: results.filter(r => !r.inactive).length, archived: results.filter(r => r.inactive).length, samples: results.slice(0, 30) }));
