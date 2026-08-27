function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

import { parseAtomKey } from './key-parser.mjs';
import { validateProgramFunctionDelegation } from './program-function-registry.mjs';

function parts(value) {
  return typeof value === 'string' ? value.split('/').filter(Boolean) : [];
}

function parent(value) {
  const valueParts = parts(value);
  return valueParts.length > 1 ? valueParts.slice(0, -1).join('/') : null;
}

function isBelow(root, target) {
  return target.startsWith(`${root}/`);
}

export function normalizeAgentLabels(labels = []) {
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string' || !label)) {
    throw problem('INVALID_AGENT_LABELS', 'agent.labels must be an array of non-empty strings');
  }
  let jurisdiction = 0;
  const business = new Set();
  for (const label of labels) {
    if (/^\^+$/u.test(label)) {
      jurisdiction = Math.max(jurisdiction, label.length);
    } else if (label.includes('^')) {
      throw problem('INVALID_AGENT_LABEL', 'Caret jurisdiction labels cannot be mixed with business labels');
    } else {
      business.add(label);
    }
  }
  return { jurisdiction, business: [...business].sort() };
}

export function validateDelegatedLabels({ creator = [], child = [] }) {
  const creatorLabels = normalizeAgentLabels(creator);
  const childLabels = normalizeAgentLabels(child);
  if (childLabels.jurisdiction > creatorLabels.jurisdiction) {
    throw problem(
      'AGENT_JURISDICTION_ESCALATION',
      'A child Agent cannot receive more caret jurisdiction than its creator'
    );
  }
  return childLabels;
}

export function validateAgentDelegation({ creator, child }) {
  if (!creator || !child || !creator.functionScopes || !child.functionScopes) {
    throw problem('INVALID_AGENT_DELEGATION', 'Agent delegation requires creator and child security contexts');
  }
  const creatorLabels = normalizeAgentLabels(creator.labels ?? []);
  const childLabels = validateDelegatedLabels({ creator: creator.labels, child: child.labels });
  if (creatorLabels.jurisdiction === 0) {
    const held = new Set(creatorLabels.business);
    if (childLabels.business.some((label) => !held.has(label))) {
      throw problem('AGENT_LABEL_DELEGATION_DENIED', 'Only a caret holder may define a new business label');
    }
  }
  const delegatedFunctions = validateProgramFunctionDelegation({
    creator: creator.functionScopes,
    child: child.functionScopes
  });
  return {
    labels: [
      ...(childLabels.jurisdiction ? ['^'.repeat(childLabels.jurisdiction)] : []),
      ...childLabels.business
    ],
    functionScopes: {
      groups: delegatedFunctions.groups,
      names: delegatedFunctions.names
    },
    functions: delegatedFunctions.functions
  };
}

function hasLabels(held, required) {
  const normalized = normalizeAgentLabels(held);
  const business = new Set(normalized.business);
  return required.every((label) => (/^\^+$/u.test(label)
    ? normalized.jurisdiction >= label.length
    : business.has(label)));
}

function fixedWindowAllows(agentPath, targetPath, operation, windowLifecycle = null) {
  const agentParent = parent(agentPath);
  if (operation === 'transform') {
    if (windowLifecycle?.action === 'recycle') {
      return targetPath === agentPath || isBelow(agentPath, targetPath);
    }
    if (windowLifecycle?.action === 'move') {
      const destinationPath = windowLifecycle.destinationPath;
      const agentName = parts(agentPath).at(-1);
      const futurePath = typeof destinationPath === 'string' && destinationPath
        ? `${destinationPath}/${agentName}`
        : null;
      return targetPath === agentPath
        || isBelow(agentPath, targetPath)
        || (typeof destinationPath === 'string'
          && fixedWindowAllows(agentPath, destinationPath, 'explore')
          && (targetPath === destinationPath
            || targetPath === futurePath
            || (futurePath && isBelow(futurePath, targetPath))));
    }
    return isBelow(agentPath, targetPath);
  }
  return targetPath === agentPath
    || isBelow(agentPath, targetPath)
    || targetPath === agentParent
    || (agentParent !== null && parent(targetPath) === agentParent);
}

export function authorizeWindowGraphPath({
  agentPath, targetPath, operation, locks = [], labels = [], capabilities = [],
  windowLifecycle = null
}) {
  if (!['explore', 'transform'].includes(operation)) {
    throw problem('INVALID_GRAPH_LOCK_ACTION', 'Graph lock action must be explore or transform');
  }
  if (agentPath && !fixedWindowAllows(agentPath, targetPath, operation, windowLifecycle)) {
    return { decision: 'deny', code: 'WINDOW_ACCESS_DENIED', lockKind: 'agent-window' };
  }
  const heldCapabilities = new Set(capabilities);
  const permits = (lock) => Array.isArray(lock.allowCapabilities)
    ? lock.allowCapabilities.some((capability) => heldCapabilities.has(capability))
    : hasLabels(labels, lock.labels ?? []);
  const denial = (lock) => ({
    decision: 'deny',
    code: lock.denialCode ?? 'GRAPH_LOCK_DENIED',
    lockKind: lock.lockKind ?? lock.kind,
    lockPath: lock.path
  });
  const applicable = locks.filter((lock) => (
    Array.isArray(lock.actions) && lock.actions.includes(operation)
  ));
  const containLocks = applicable.filter((lock) => lock.kind === 'contain'
    && (targetPath === lock.path || isBelow(lock.path, targetPath)));
  for (const lock of containLocks) {
    if (!permits(lock)) return denial(lock);
  }
  const nodeLocks = applicable.filter((lock) => lock.kind === 'node' && lock.path === targetPath);
  for (const lock of nodeLocks) {
    if (!permits(lock)) return denial(lock);
  }
  return { decision: 'allow', matchedLocks: [...containLocks, ...nodeLocks] };
}

export function registerCurrentProgramAsAgent(atoms, programPath) {
  const next = structuredClone(atoms);
  let registered = false;
  function visit(items, parentParts = []) {
    for (const atom of items ?? []) {
      const thingEntry = Object.entries(atom).find(([key]) => (
        parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === 'thing'
      ));
      if (!thingEntry) continue;
      const [rawKey, value] = thingEntry;
      const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
      const path = [...parentParts, value].join('/');
      if (path === programPath) {
        const types = new Set(parsed.types.map((type) => type.raw));
        if (!types.has('program')) {
          throw problem('AGENT_REGISTRATION_PROGRAM_REQUIRED', 'agent() may register only its current Program node');
        }
        types.add('agent');
        const nextKey = `thing${[...types].map((type) => `@${type}`).join('')}${
          parsed.descriptionPresent ? `#${parsed.description}` : ''
        }`;
        if (nextKey !== rawKey) {
          delete atom[rawKey];
          atom[nextKey] = value;
        }
        registered = true;
      }
      const contain = Object.entries(atom).find(([key]) => (
        parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === 'contain'
      ))?.[1];
      if (Array.isArray(contain)) visit(contain, [...parentParts, value]);
    }
  }
  visit(next);
  if (!registered) throw problem('AGENT_REGISTRATION_PROGRAM_NOT_FOUND', 'Current Program node was not found');
  return next;
}
