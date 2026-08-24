import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ATOM_RUNTIME_CONTRACT } from './runtime-contract.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function validateProgramFunctionRegistry(value) {
  if (value?.contract !== 'atom-program-function-registry'
    || value?.version !== 3
    || value?.runtimeContract !== ATOM_RUNTIME_CONTRACT
    || !Array.isArray(value.types)
    || !Array.isArray(value.functionFamilies)
    || !Array.isArray(value.functions)) {
    throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function registry has an invalid public contract');
  }
  const families = new Set();
  const kernelFamilies = new Set();
  for (const item of value.functionFamilies) {
    if (!['kernel', 'application'].includes(item?.layer)
      || typeof item?.id !== 'string' || !item.id
      || typeof item?.label !== 'string' || !item.label) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', 'Program function family is invalid');
    }
    const key = `${item.layer}:${item.id}`;
    if (families.has(key)) {
      throw problem('INVALID_PROGRAM_FUNCTION_REGISTRY', `Duplicate Program function family: ${key}`);
    }
    families.add(key);
    if (item.layer === 'kernel') kernelFamilies.add(item.id);
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
