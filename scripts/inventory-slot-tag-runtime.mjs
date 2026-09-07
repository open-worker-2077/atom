import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

function fieldsOf(atom) {
  const fields = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (!parsed.errors.length && !fields.has(parsed.baseKey)) {
      fields.set(parsed.baseKey, { value, parsed });
    }
  }
  return fields;
}

function inlinePrograms(value, ownerPath, zone, rows) {
  if (Array.isArray(value)) {
    for (const entry of value) inlinePrograms(entry, ownerPath, zone, rows);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.program === 'string') {
    const kind = /\bslot_provide\s*\(/u.test(value.program)
      ? 'tag-line'
      : /\breturn\s+(?:True|False)\b/u.test(value.program)
        ? 'strict-bool-line'
        : 'unclassified-line';
    rows.push({ zone, kind, path: ownerPath });
  }
  for (const child of Object.values(value)) inlinePrograms(child, ownerPath, zone, rows);
}

export function inventorySlotTagRuntime(facts) {
  const rows = [];
  function visit(atoms, parent = [], archived = false) {
    for (const atom of atoms ?? []) {
      const fields = fieldsOf(atom);
      const thing = fields.get('thing');
      if (typeof thing?.value !== 'string' || !thing.value) continue;
      const types = new Set(thing.parsed.types.map(({ raw }) => raw));
      const insideArchive = archived || (types.has('backup') && types.has('default'));
      const atomPath = [...parent, thing.value];
      const zone = insideArchive ? 'backup' : 'active';
      const source = fields.get('situation')?.value;
      if (types.has('program') && typeof source === 'string') {
        const patterns = [
          ['legacy-provide', /\bslot\s*\(/u],
          ['legacy-receive', /\bsignal\s*\(|\btrigger\s*\(\s*['"]slot['"]/u],
          ['tag-provide', /\bslot_provide\s*\(/u],
          ['tag-receive', /\bslot_receive\s*\(/u]
        ];
        for (const [kind, pattern] of patterns) {
          if (pattern.test(source)) rows.push({ zone, kind, path: atomPath.join('/') });
        }
      }
      inlinePrograms(fields.get('strut')?.value, atomPath.join('/'), zone, rows);
      visit(fields.get('slot')?.value, atomPath, insideArchive);
    }
  }
  visit(facts);
  const summary = {};
  for (const { zone, kind } of rows) {
    const key = `${zone}:${kind}`;
    summary[key] = (summary[key] ?? 0) + 1;
  }
  return Object.freeze({
    summary: Object.freeze(summary),
    active: Object.freeze(rows.filter(({ zone }) => zone === 'active').map(Object.freeze)),
    backup: Object.freeze(rows.filter(({ zone }) => zone === 'backup').map(Object.freeze))
  });
}

async function main(argv) {
  const contextIndex = argv.indexOf('--context');
  const contextFile = contextIndex >= 0
    ? path.resolve(argv[contextIndex + 1])
    : resolveAtomRuntime().contextFile;
  const facts = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  process.stdout.write(`${JSON.stringify({ contextFile, ...inventorySlotTagRuntime(facts) }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
