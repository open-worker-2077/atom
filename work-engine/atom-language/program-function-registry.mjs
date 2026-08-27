import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ATOM_RUNTIME_CONTRACT } from './runtime-contract.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function validateProgramFunctionRegistry(value) {
  const hierarchy = value?.functionScopeHierarchy;
  if (value?.contract !== 'atom-program-function-registry'
    || value?.version !== 5
    || value?.runtimeContract !== ATOM_RUNTIME_CONTRACT
    || !Array.isArray(value.types)
    || !Array.isArray(value.functionFamilies)
    || !Array.isArray(value.functions)
    || hierarchy?.groupField !== 'functionFamilies[].id'
    || hierarchy?.parentField !== 'functionFamilies[].parent'
    || hierarchy?.rootWhenParentOmitted !== true
    || hierarchy?.functionMembership !== 'single-family'
    || hierarchy?.groupEffectiveMembership !== 'self-and-descendants') {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function registry has an invalid public contract');
  }
  const families = new Set();
  const familyIds = new Set();
  const kernelFamilies = new Set();
  for (const item of value.functionFamilies) {
    if (!['kernel', 'application'].includes(item?.layer)
      || typeof item?.id !== 'string' || !item.id
      || typeof item?.label !== 'string' || !item.label) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function family is invalid');
    }
    const key = `${item.layer}:${item.id}`;
    if (families.has(key) || familyIds.has(item.id)
      || (item.parent !== undefined && (typeof item.parent !== 'string' || !item.parent))) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Duplicate Program function family: ${key}`);
    }
    families.add(key);
    familyIds.add(item.id);
    if (item.layer === 'kernel') kernelFamilies.add(item.id);
  }
  const parentByFamily = new Map(value.functionFamilies.map((item) => [item.id, item.parent ?? null]));
  for (const [family, parent] of parentByFamily) {
    if (parent !== null && !parentByFamily.has(parent)) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Unknown parent Program function family: ${family}`);
    }
    const visited = new Set([family]);
    let cursor = parent;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Cyclic Program function family: ${family}`);
      }
      visited.add(cursor);
      cursor = parentByFamily.get(cursor) ?? null;
    }
  }
  if (kernelFamilies.size !== 3
    || !kernelFamilies.has('graph')
    || !kernelFamilies.has('form')
    || !kernelFamilies.has('program')) {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Kernel function families must be graph, form, and program');
  }
  const names = new Set();
  for (const item of value.functions) {
    if (typeof item?.name !== 'string' || !item.name || names.has(item.name)
      || !families.has(`${item.layer}:${item.family}`)
      || !['atom', 'public'].includes(item.scope)
      || Object.hasOwn(item, 'category')
      || Object.hasOwn(item, 'effectiveConstraints')) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Invalid or duplicate Program function: ${item?.name ?? ''}`);
    }
    names.add(item.name);
  }
  const executableTypes = value.types.filter((item) => item?.executable === true);
  if (executableTypes.length !== 1
    || executableTypes[0].id !== 'program'
    || executableTypes[0].layer !== 'kernel') {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program must be the only executable kernel type');
  }
  return structuredClone(value);
}

function loadRegistry() {
  const file = fileURLToPath(new URL('./program-function-registry.json', import.meta.url));
  return validateProgramFunctionRegistry(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const REGISTRY = loadRegistry();

export function programFunctionRegistry() {
  return structuredClone(REGISTRY);
}

function normalizeProgramFunctionSelection(selection, registry) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || !Array.isArray(selection.groups) || !Array.isArray(selection.names)
    || Object.keys(selection).some((key) => !['groups', 'names'].includes(key))) {
    throw problem('INVALID_PROGRAM_FUNCTION_SELECTION', 'functions requires groups and names arrays');
  }
  const groups = new Set(registry.functionFamilies.map((family) => family.id));
  for (const group of selection.groups) {
    if (typeof group !== 'string' || !groups.has(group)) {
      throw problem('UNKNOWN_PROGRAM_FUNCTION_GROUP', `Unknown Program function group: ${group}`);
    }
  }
  const knownNames = new Set(registry.functions.map((entry) => entry.name));
  for (const name of selection.names) {
    if (typeof name !== 'string' || !knownNames.has(name)) {
      throw problem('UNKNOWN_PROGRAM_FUNCTION', `Unknown Program function: ${name}`);
    }
  }
  return {
    groups: [...new Set(selection.groups)].sort(),
    names: [...new Set(selection.names)].sort()
  };
}

function familyIsWithin(registry, family, ancestor) {
  const parentByFamily = new Map(registry.functionFamilies.map((entry) => [
    entry.id, entry.parent ?? null
  ]));
  let cursor = family;
  while (cursor !== null) {
    if (cursor === ancestor) return true;
    cursor = parentByFamily.get(cursor) ?? null;
  }
  return false;
}

export function expandProgramFunctionSelection(selection, registry = REGISTRY) {
  const normalizedRegistry = registry === REGISTRY
    ? REGISTRY
    : validateProgramFunctionRegistry(registry);
  const normalized = normalizeProgramFunctionSelection(selection, normalizedRegistry);
  return [...new Set([
    ...normalizedRegistry.functions
      .filter((entry) => normalized.groups.some((group) => (
        familyIsWithin(normalizedRegistry, entry.family, group)
      )))
      .map((entry) => entry.name),
    ...normalized.names
  ])].sort();
}

export function validateProgramFunctionDelegation({ creator, child, registry = REGISTRY }) {
  const normalizedRegistry = registry === REGISTRY
    ? REGISTRY
    : validateProgramFunctionRegistry(registry);
  const creatorScopes = normalizeProgramFunctionSelection(creator, normalizedRegistry);
  const childScopes = normalizeProgramFunctionSelection(child, normalizedRegistry);
  const creatorNames = new Set(creatorScopes.names);
  const functionByName = new Map(normalizedRegistry.functions.map((entry) => [entry.name, entry]));
  const groupAllowed = (group) => creatorScopes.groups.some((held) => (
    familyIsWithin(normalizedRegistry, group, held)
  ));
  const nameAllowed = (name) => creatorNames.has(name)
    || creatorScopes.groups.some((held) => (
      familyIsWithin(normalizedRegistry, functionByName.get(name).family, held)
    ));
  if (childScopes.groups.some((group) => !groupAllowed(group))
    || childScopes.names.some((name) => !nameAllowed(name))) {
    throw problem(
      'PROGRAM_FUNCTION_DELEGATION_DENIED',
      'Child Agent function scopes must be the same scope or descendants of creator scopes'
    );
  }
  return {
    ...childScopes,
    functions: expandProgramFunctionSelection(childScopes, normalizedRegistry)
  };
}
