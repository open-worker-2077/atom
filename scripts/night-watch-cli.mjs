import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runNightWatch } from './night-watch-runner.mjs';
import { nightWatchCaseCatalog } from './night-watch-case-catalog.mjs';

const manifest = JSON.parse(await fs.readFile(new URL('./night-watch-manifest.json', import.meta.url), 'utf8'));
if (!process.argv.includes('--dry-run')) {
  throw new Error('Night-watch live mode requires an explicit authority receipt and live adapters');
}
const result = await runNightWatch({ manifest, catalog: nightWatchCaseCatalog, dryRun: true });
process.stdout.write(`${JSON.stringify(result.report)}\n`);
