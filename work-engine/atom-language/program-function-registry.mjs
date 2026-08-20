import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ATOM_RUNTIME_CONTRACT } from './runtime-contract.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function pathKey(parts) {
  return JSON.stringify(parts);
}

export function validateProgramFunctionRegistry(value) {
  if (value?.contract !== 'atom-program-function-registry'
    || value?.version !== 1
    || value?.runtimeContract !== ATOM_RUNTIME_CONTRACT
    || !Array.isArray(value.scopeKinds)
    || !Array.isArray(value.types)
    || !Array.isArray(value.categories)
    || !Array.isArray(value.publicScopes)
    || !Array.isArray(value.functions)) {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function registry has an invalid public contract');
  }
  const scopeKinds = new Set(value.scopeKinds.map((item) => item?.id));
  if (scopeKinds.size !== 2 || !scopeKinds.has('atom') || !scopeKinds.has('public')) {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function registry scope kinds must be atom and public');
  }
  const categories = new Set();
  for (const item of value.categories) {
    if (!['kernel', 'application'].includes(item?.layer)
      || typeof item?.id !== 'string' || !item.id
      || typeof item?.label !== 'string' || !item.label) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function registry category is invalid');
    }
    const key = `${item.layer}:${item.id}`;
    if (categories.has(key)) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Duplicate Program function category: ${key}`);
    }
    categories.add(key);
  }
  const publicScopes = new Map();
  for (const scope of value.publicScopes) {
    if (!Array.isArray(scope?.path)
      || scope.path.some((part) => typeof part !== 'string' || !part)
      || !Array.isArray(scope?.constraints)
      || scope.constraints.some((item) => typeof item !== 'string' || !item)) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program public scope is invalid');
    }
    const key = pathKey(scope.path);
    if (publicScopes.has(key)) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Duplicate Program public scope: ${key}`);
    }
    publicScopes.set(key, scope.constraints);
  }
  const names = new Set();
  const functions = value.functions.map((item) => {
    if (typeof item?.name !== 'string' || !item.name || names.has(item.name)
      || !categories.has(`${item.layer}:${item.category}`)
      || item.scope?.kind !== 'public'
      || !Array.isArray(item.scope.path)
      || item.scope.path.length !== 2
      || item.scope.path[0] !== item.layer
      || item.scope.path[1] !== item.category) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Invalid or duplicate Program function: ${item?.name ?? ''}`);
    }
    names.add(item.name);
    const effectiveConstraints = [];
    for (let length = 0; length <= item.scope.path.length; length += 1) {
      const inherited = publicScopes.get(pathKey(item.scope.path.slice(0, length)));
      if (!inherited) {
        throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Missing public scope prefix for ${item.name}`);
      }
      for (const constraint of inherited) {
        if (!effectiveConstraints.includes(constraint)) effectiveConstraints.push(constraint);
      }
    }
    return { ...item, effectiveConstraints };
  });
  const executableTypes = value.types.filter((item) => item?.executable === true);
  if (executableTypes.length !== 1
    || executableTypes[0].id !== 'program'
    || executableTypes[0].layer !== 'kernel') {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program must be the only executable kernel type');
  }
  return { ...value, functions };
}

function loadRegistry() {
  const file = fileURLToPath(new URL('./program-function-registry.json', import.meta.url));
  return validateProgramFunctionRegistry(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const REGISTRY = loadRegistry();

export function programFunctionRegistry() {
  return structuredClone(REGISTRY);
}
