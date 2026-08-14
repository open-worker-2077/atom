function architectureError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

const components = [
  {
    id: 'world-kernel',
    owns: ['atom-semantics', 'program-source'],
    dependsOn: [],
    allowedDependencies: []
  },
  {
    id: 'world-runtime',
    owns: ['world-revision', 'runtime-results'],
    dependsOn: ['world-kernel'],
    allowedDependencies: ['world-kernel']
  },
  {
    id: 'projections',
    owns: ['graph-projection', 'spatial-projection'],
    dependsOn: ['world-kernel', 'world-runtime'],
    allowedDependencies: ['world-kernel', 'world-runtime']
  },
  {
    id: 'spatial-experience',
    owns: ['view-state'],
    dependsOn: ['projections'],
    allowedDependencies: ['projections']
  },
  {
    id: 'adapters',
    owns: [],
    dependsOn: ['world-kernel', 'world-runtime', 'projections', 'spatial-experience'],
    allowedDependencies: ['world-kernel', 'world-runtime', 'projections', 'spatial-experience']
  },
  {
    id: 'operations',
    owns: [],
    dependsOn: ['world-runtime', 'spatial-experience'],
    allowedDependencies: ['world-runtime', 'spatial-experience']
  }
];

export const ATOM_SYSTEM_ARCHITECTURE = Object.freeze({
  contract: 'atom.system-architecture',
  version: 1,
  components: components.map((component) => Object.freeze({
    ...component,
    owns: Object.freeze([...component.owns]),
    dependsOn: Object.freeze([...component.dependsOn]),
    allowedDependencies: Object.freeze([...component.allowedDependencies])
  }))
});

export function validateArchitectureManifest(manifest) {
  if (!manifest || manifest.contract !== 'atom.system-architecture' || manifest.version !== 1) {
    throw architectureError('INVALID_ARCHITECTURE_CONTRACT', 'Architecture manifest must use atom.system-architecture v1');
  }
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
    throw architectureError('INVALID_ARCHITECTURE_COMPONENTS', 'Architecture manifest requires components');
  }

  const componentIds = new Set();
  const factOwners = new Map();
  for (const component of manifest.components) {
    if (!component || typeof component.id !== 'string' || !component.id.trim() || componentIds.has(component.id)) {
      throw architectureError('INVALID_ARCHITECTURE_COMPONENT', 'Component ids must be unique non-empty strings');
    }
    componentIds.add(component.id);
    if (!Array.isArray(component.owns) || !Array.isArray(component.dependsOn)
      || !Array.isArray(component.allowedDependencies)) {
      throw architectureError('INVALID_ARCHITECTURE_COMPONENT', `Component ${component.id} has an invalid contract`);
    }
    for (const fact of component.owns) {
      if (factOwners.has(fact)) {
        throw architectureError('DUPLICATE_FACT_OWNER', `Fact ${fact} has multiple owners`, {
          fact,
          owners: [factOwners.get(fact), component.id]
        });
      }
      factOwners.set(fact, component.id);
    }
    for (const dependency of component.dependsOn) {
      if (!component.allowedDependencies.includes(dependency)) {
        throw architectureError(
          'FORBIDDEN_ARCHITECTURE_DEPENDENCY',
          `${component.id} cannot depend on ${dependency}`,
          { component: component.id, dependency }
        );
      }
    }
  }

  for (const component of manifest.components) {
    for (const dependency of component.dependsOn) {
      if (!componentIds.has(dependency)) {
        throw architectureError('UNKNOWN_ARCHITECTURE_DEPENDENCY', `${component.id} depends on unknown ${dependency}`);
      }
    }
  }

  return { ok: true, components: componentIds.size, facts: factOwners.size };
}
