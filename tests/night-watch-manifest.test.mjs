import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nightWatchCaseCatalog } from '../scripts/night-watch-case-catalog.mjs';

const manifestModuleUrl = new URL('../scripts/night-watch-manifest.mjs', import.meta.url);
const manifestPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/night-watch-manifest.json'
);

const REQUIRED_CAPABILITIES = [
  'health',
  'web-entry',
  'mobile-entry',
  'agent',
  'program',
  'explore-transform',
  'authorization-locks',
  'jump',
  'shortcut',
  'slot-body',
  'work-order',
  'restart',
  'persistence-read-back'
];

function completeCatalog() {
  return structuredClone(nightWatchCaseCatalog);
}

function completeManifest() {
  return {
    contract: 'atom.night-watch-manifest',
    version: 1,
    caseCatalog: { contract: 'atom.night-watch-case-catalog', version: 1 },
    steps: REQUIRED_CAPABILITIES.map((capability, index) => {
      const testCaseId = nightWatchCaseCatalog.coverage[capability].requiredCaseIds[0];
      const mappedCase = nightWatchCaseCatalog.cases.find((entry) => entry.id === testCaseId);
      return {
        id: `step-${index + 1}`,
        capability,
        dependsOn: index === 0 ? [] : [`step-${index}`],
        mutationClass: 'none',
        commandKind: 'adapter',
        timeoutMilliseconds: 1000,
        evidencePolicy: 'redacted-summary',
        issueNodeId: mappedCase.issueNodeId,
        testCaseId
      };
    })
  };
}

async function loadValidator() {
  return import(manifestModuleUrl);
}

test('night-watch manifest accepts one complete dependency-ordered capability journey', async () => {
  const { validateNightWatchManifest } = await loadValidator();

  const validated = validateNightWatchManifest(completeManifest(), completeCatalog());

  assert.deepEqual(validated.steps.map((step) => step.capability), REQUIRED_CAPABILITIES);
});

test('the shipped night-watch manifest is complete and has bounded redacted execution metadata', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  const catalog = (await import(new URL('../scripts/night-watch-case-catalog.mjs', import.meta.url))).nightWatchCaseCatalog;
  const validated = validateNightWatchManifest(manifest, catalog);

  assert.equal(validated.contract, 'atom.night-watch-manifest');
  assert.equal(validated.version, 1);
  assert.equal(validated.steps.every((step) => (
    typeof step.mutationClass === 'string'
      && typeof step.commandKind === 'string'
      && Number.isInteger(step.timeoutMilliseconds)
      && step.timeoutMilliseconds > 0
      && step.evidencePolicy === 'redacted-summary'
  )), true);
});

test('night-watch manifest fails closed without a complete external scenario catalog', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const manifest = completeManifest();
  assert.throws(() => validateNightWatchManifest(manifest), (error) => error.code === 'NIGHT_WATCH_CASE_CATALOG_REQUIRED');
  const missingCategory = completeCatalog();
  missingCategory.coverage.jump.requiredCaseIds = [];
  assert.throws(() => validateNightWatchManifest(manifest, missingCategory), (error) => error.code === 'NIGHT_WATCH_SCENARIO_CATEGORY_MISSING');
  const brokenCase = completeCatalog();
  delete brokenCase.cases[0].actions;
  assert.throws(() => validateNightWatchManifest(manifest, brokenCase), (error) => error.code === 'NIGHT_WATCH_CASE_CONTRACT_INVALID');
  const unlinkedCase = completeCatalog();
  delete unlinkedCase.cases[0].issueNodeId;
  assert.throws(() => validateNightWatchManifest(manifest, unlinkedCase), (error) => error.code === 'NIGHT_WATCH_CASE_ISSUE_REF_INVALID');
});

test('night-watch manifest rejects duplicate stable scenario case ids', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const duplicateCase = completeCatalog();
  duplicateCase.cases[1].id = duplicateCase.cases[0].id;

  assert.throws(
    () => validateNightWatchManifest(completeManifest(), duplicateCase),
    (error) => error.code === 'NIGHT_WATCH_CASE_ID_DUPLICATE'
  );
});

test('night-watch manifest rejects a journey that omits one required capability', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const manifest = completeManifest();
  manifest.steps = manifest.steps.filter(({ capability }) => capability !== 'restart');

  assert.throws(
    () => validateNightWatchManifest(manifest, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_CAPABILITY_MISSING'
      && error.details.capability === 'restart'
  );
});

test('night-watch manifest rejects steps without bounded execution metadata', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const manifest = completeManifest();
  delete manifest.steps[0].timeoutMilliseconds;

  assert.throws(
    () => validateNightWatchManifest(manifest, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_TIMEOUT_INVALID'
      && error.details.id === 'step-1'
  );
});

test('night-watch manifest rejects a live step without its exact catalog mapping', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const manifest = completeManifest();
  delete manifest.steps[0].issueNodeId;

  assert.throws(
    () => validateNightWatchManifest(manifest, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_STEP_EVIDENCE_MAPPING_INVALID'
      && error.details.id === 'step-1'
  );
});

test('night-watch manifest rejects duplicate step ids and undeclared dependencies', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const duplicate = completeManifest();
  duplicate.steps[1].id = duplicate.steps[0].id;
  assert.throws(
    () => validateNightWatchManifest(duplicate, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_STEP_ID_DUPLICATE'
  );

  const unknownDependency = completeManifest();
  unknownDependency.steps[0].dependsOn = ['not-a-step'];
  assert.throws(
    () => validateNightWatchManifest(unknownDependency, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_DEPENDENCY_UNKNOWN'
      && error.details.dependency === 'not-a-step'
  );
});

test('night-watch manifest rejects dependency order violations and cycles', async () => {
  const { validateNightWatchManifest } = await loadValidator();
  const outOfOrder = completeManifest();
  outOfOrder.steps[0].dependsOn = ['step-2'];
  outOfOrder.steps[1].dependsOn = [];
  assert.throws(
    () => validateNightWatchManifest(outOfOrder, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_DEPENDENCY_ORDER'
  );

  const cycle = completeManifest();
  cycle.steps[0].dependsOn = ['step-2'];
  cycle.steps[1].dependsOn = ['step-1'];
  assert.throws(
    () => validateNightWatchManifest(cycle, completeCatalog()),
    (error) => error.code === 'NIGHT_WATCH_DEPENDENCY_CYCLE'
  );
});
