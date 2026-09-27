import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const worldDirectory = path.resolve(process.argv[2] ?? '');
const backupDirectory = path.join(worldDirectory, 'migration-backups', 'thing-identity', 'copy-second');
const [before, after, identityMap] = await Promise.all([
  fs.readFile(path.join(backupDirectory, 'atom.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(worldDirectory, 'atom.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(backupDirectory, 'identity-map.json'), 'utf8').then(JSON.parse)
]);
const reverse = new Map(Object.entries(identityMap).map(([oldId, shortId]) => [shortId, oldId]));
assert.equal(reverse.size, Object.keys(identityMap).length, 'Identity map is not bijective');

function normalize(value, restoreIdentities) {
  if (Array.isArray(value)) return value.map(item => normalize(item, restoreIdentities));
  if (!value || typeof value !== 'object') return value;
  const shortcut = Object.keys(value).some(key => /^thing(?:@[^&#]+)*@shortcut(?:[&#]|$)/u.test(key));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    let normalizedKey = key;
    if (restoreIdentities && key.startsWith('thing') && key.includes('&id=')) {
      normalizedKey = key.replace(/&id=([^#]+)/u, (_, shortId) => {
        const oldId = reverse.get(shortId);
        assert.ok(oldId, `Unmapped short identity: ${shortId}`);
        return `&id=${oldId}`;
      });
    }
    if (shortcut && key === 'situation' && typeof child === 'string') {
      const metadata = JSON.parse(child);
      if (restoreIdentities && metadata?.target?.identity) {
        const oldId = reverse.get(metadata.target.identity);
        assert.ok(oldId, 'Unmapped Shortcut target');
        metadata.target.identity = oldId;
      }
      return [normalizedKey, metadata];
    }
    return [normalizedKey, normalize(child, restoreIdentities)];
  }));
}

const normalizedBefore = normalize(before, false);
const normalizedAfter = normalize(after, true);
const semanticEqual = JSON.stringify(normalizedBefore) === JSON.stringify(normalizedAfter);
const digest = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const result = {
  semanticEqual,
  thingCount: reverse.size,
  beforeSemanticHash: digest(normalizedBefore),
  afterSemanticHash: digest(normalizedAfter),
  identityMapBijective: true
};
console.log(JSON.stringify(result));
if (!semanticEqual) process.exitCode = 1;
