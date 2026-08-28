import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ATOM_RUNTIME_CONTRACT } from './runtime-contract.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function loadRegistry() {
  const file = fileURLToPath(new URL('./work-order-registry.json', import.meta.url));
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const template = value?.templates?.[0];
  const version = template?.versions?.[0];
  if (value?.contract !== 'atom-work-order-registry'
    || value?.version !== 1
    || value?.runtimeContract !== ATOM_RUNTIME_CONTRACT
    || template?.id !== 'work-order'
    || template?.latest !== '1'
    || version?.version !== '1'
    || !Array.isArray(version.actions)
    || new Set(version.actions.map((action) => action.id)).size !== version.actions.length) {
    throw problem('INVALID_WORK_ORDER_REGISTRY', 'Work-order registry has an invalid public contract');
  }
  return value;
}

const REGISTRY = loadRegistry();

export function workOrderRegistry() {
  return structuredClone(REGISTRY);
}
