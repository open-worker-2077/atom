export const NIGHT_WATCH_MANIFEST_CONTRACT = 'atom.night-watch-manifest';
export const NIGHT_WATCH_MANIFEST_VERSION = 1;

export const REQUIRED_NIGHT_WATCH_CAPABILITIES = Object.freeze([
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
]);

const MUTATION_CLASSES = new Set(['none', 'read', 'write', 'restart']);
const COMMAND_KINDS = new Set(['adapter', 'browser', 'cli']);
const EVIDENCE_POLICIES = new Set(['redacted-summary']);

function manifestError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requireNonEmptyString(value, code, field, details = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw manifestError(code, `${field} must be a non-empty string`, details);
  }
  return value;
}

export function validateNightWatchManifest(manifest, catalog) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw manifestError('NIGHT_WATCH_MANIFEST_INVALID', 'Night-watch manifest must be an object');
  }
  if (manifest.contract !== NIGHT_WATCH_MANIFEST_CONTRACT
    || manifest.version !== NIGHT_WATCH_MANIFEST_VERSION) {
    throw manifestError('NIGHT_WATCH_MANIFEST_VERSION_INVALID', 'Night-watch manifest contract or version is invalid');
  }
  if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
    throw manifestError('NIGHT_WATCH_STEPS_INVALID', 'Night-watch manifest requires steps');
  }
  if (!manifest.caseCatalog || manifest.caseCatalog.contract !== 'atom.night-watch-case-catalog' || manifest.caseCatalog.version !== 1) {
    throw manifestError('NIGHT_WATCH_CASE_CATALOG_REQUIRED', 'Night-watch manifest must reference the external scenario catalog');
  }
  if (!catalog || catalog.contract !== manifest.caseCatalog.contract || catalog.version !== manifest.caseCatalog.version || !Array.isArray(catalog.cases)) {
    throw manifestError('NIGHT_WATCH_CASE_CATALOG_REQUIRED', 'Night-watch caller must provide the referenced scenario catalog');
  }
  const catalogById = new Map();
  for (const entry of catalog.cases) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.capability !== 'string'
      || typeof entry.issueNodeId !== 'string' || !entry.issueNodeId || typeof entry.testCaseId !== 'string' || !entry.testCaseId) {
      throw manifestError('NIGHT_WATCH_CASE_ISSUE_REF_INVALID', 'Scenario case requires exact IssueNode and TestCase references');
    }
    for (const field of ['prerequisites', 'actions', 'expected', 'negative', 'readBack']) {
      if (!Array.isArray(entry[field]) || entry[field].length === 0 || entry.evidencePolicy !== 'redacted-summary') {
        throw manifestError('NIGHT_WATCH_CASE_CONTRACT_INVALID', 'Scenario case contract is incomplete', { id: entry.id, field });
      }
    }
    if (catalogById.has(entry.id)) {
      throw manifestError('NIGHT_WATCH_CASE_ID_DUPLICATE', 'Scenario catalog case ids must be unique', { id: entry.id });
    }
    catalogById.set(entry.id, entry);
  }

  const ids = new Set();
  const capabilities = new Set();
  const byId = new Map();
  manifest.steps.forEach((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw manifestError('NIGHT_WATCH_STEP_INVALID', 'Night-watch step must be an object', { index });
    }
    const id = requireNonEmptyString(step.id, 'NIGHT_WATCH_STEP_ID_INVALID', 'step id', { index });
    if (ids.has(id)) {
      throw manifestError('NIGHT_WATCH_STEP_ID_DUPLICATE', 'Night-watch step ids must be unique', { id });
    }
    const capability = requireNonEmptyString(
      step.capability,
      'NIGHT_WATCH_CAPABILITY_INVALID',
      'step capability',
      { id }
    );
    if (capabilities.has(capability)) {
      throw manifestError('NIGHT_WATCH_CAPABILITY_DUPLICATE', 'Night-watch capabilities must be unique', { capability });
    }
    if (!Array.isArray(step.dependsOn)) {
      throw manifestError('NIGHT_WATCH_DEPENDENCIES_INVALID', 'Night-watch step dependencies must be an array', { id });
    }
    if (!MUTATION_CLASSES.has(step.mutationClass)) {
      throw manifestError('NIGHT_WATCH_MUTATION_CLASS_INVALID', 'Night-watch step mutation class is invalid', {
        id,
        mutationClass: step.mutationClass
      });
    }
    if (!COMMAND_KINDS.has(step.commandKind)) {
      throw manifestError('NIGHT_WATCH_COMMAND_KIND_INVALID', 'Night-watch step command kind is invalid', {
        id,
        commandKind: step.commandKind
      });
    }
    if (!Number.isInteger(step.timeoutMilliseconds) || step.timeoutMilliseconds <= 0) {
      throw manifestError('NIGHT_WATCH_TIMEOUT_INVALID', 'Night-watch step timeout must be a positive integer', {
        id,
        timeoutMilliseconds: step.timeoutMilliseconds
      });
    }
    if (!EVIDENCE_POLICIES.has(step.evidencePolicy)) {
      throw manifestError('NIGHT_WATCH_EVIDENCE_POLICY_INVALID', 'Night-watch step evidence policy is invalid', {
        id,
        evidencePolicy: step.evidencePolicy
      });
    }
    const issueNodeId = requireNonEmptyString(
      step.issueNodeId,
      'NIGHT_WATCH_STEP_EVIDENCE_MAPPING_INVALID',
      'step IssueNode id',
      { id }
    );
    const testCaseId = requireNonEmptyString(
      step.testCaseId,
      'NIGHT_WATCH_STEP_EVIDENCE_MAPPING_INVALID',
      'step TestCase id',
      { id }
    );
    const mappedCase = catalogById.get(testCaseId);
    if (!mappedCase || mappedCase.capability !== capability || mappedCase.issueNodeId !== issueNodeId) {
      throw manifestError(
        'NIGHT_WATCH_STEP_EVIDENCE_MAPPING_INVALID',
        'Night-watch step must map to one exact scenario catalog IssueNode and TestCase',
        { id, issueNodeId, testCaseId, capability }
      );
    }
    ids.add(id);
    capabilities.add(capability);
    byId.set(id, { ...step, id, capability, issueNodeId, testCaseId, index });
  });

  for (const capability of REQUIRED_NIGHT_WATCH_CAPABILITIES) {
    if (!capabilities.has(capability)) {
      throw manifestError('NIGHT_WATCH_CAPABILITY_MISSING', 'Night-watch manifest omits a required capability', { capability });
    }
    const requiredCaseIds = catalog.coverage?.[capability]?.requiredCaseIds;
    if (!Array.isArray(requiredCaseIds) || !requiredCaseIds.length || requiredCaseIds.some((id) => catalogById.get(id)?.capability !== capability)) {
      throw manifestError('NIGHT_WATCH_SCENARIO_CATEGORY_MISSING', 'Scenario catalog omits a required explicit case', { capability });
    }
  }
  for (const capability of capabilities) {
    if (!REQUIRED_NIGHT_WATCH_CAPABILITIES.includes(capability)) {
      throw manifestError('NIGHT_WATCH_CAPABILITY_UNEXPECTED', 'Night-watch manifest contains an unexpected capability', { capability });
    }
  }

  for (const step of byId.values()) {
    const seenDependencies = new Set();
    for (const dependency of step.dependsOn) {
      requireNonEmptyString(
        dependency,
        'NIGHT_WATCH_DEPENDENCY_INVALID',
        'step dependency',
        { id: step.id }
      );
      if (seenDependencies.has(dependency)) {
        throw manifestError('NIGHT_WATCH_DEPENDENCY_DUPLICATE', 'Night-watch step dependencies must be unique', {
          id: step.id,
          dependency
        });
      }
      if (!byId.has(dependency)) {
        throw manifestError('NIGHT_WATCH_DEPENDENCY_UNKNOWN', 'Night-watch dependency is not declared', {
          id: step.id,
          dependency
        });
      }
      seenDependencies.add(dependency);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      throw manifestError('NIGHT_WATCH_DEPENDENCY_CYCLE', 'Night-watch dependencies slot a cycle', { id });
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);

  for (const step of byId.values()) {
    for (const dependency of step.dependsOn) {
      if (byId.get(dependency).index >= step.index) {
        throw manifestError('NIGHT_WATCH_DEPENDENCY_ORDER', 'Night-watch dependencies must precede their step', {
          id: step.id,
          dependency
        });
      }
    }
  }

  return structuredClone(manifest);
}
