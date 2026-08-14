function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function immutableEntity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || typeof raw.id !== 'string' || !raw.id
    || typeof raw.atomRef !== 'string' || !raw.atomRef
    || !['node', 'cluster', 'domain'].includes(raw.kind)
    || typeof raw.label !== 'string'
    || typeof raw.detail !== 'string'
    || !Array.isArray(raw.hierarchyAddress)
    || raw.hierarchyAddress.length === 0
    || raw.hierarchyAddress.some((part) => typeof part !== 'string' || !part)) {
    throw problem('INVALID_SCENE_ENTITY', 'Scene entity requires identity, content and hierarchy address');
  }
  const capabilities = {
    read: raw.capabilities?.read !== false,
    write: raw.capabilities?.write !== false
  };
  return Object.freeze({
    ...structuredClone(raw),
    hierarchyAddress: Object.freeze([...raw.hierarchyAddress]),
    capabilities: Object.freeze(capabilities)
  });
}

export function createEntityIndex(rawEntities) {
  if (!Array.isArray(rawEntities)) {
    throw problem('INVALID_SCENE_ENTITIES', 'Scene entities must be an array');
  }
  const entities = [];
  const ids = new Map();
  const atomRefs = new Map();
  for (const raw of rawEntities) {
    const entity = immutableEntity(raw);
    if (ids.has(entity.id)) {
      throw problem('DUPLICATE_SCENE_ENTITY_ID', `Scene entity id ${entity.id} is duplicated`);
    }
    ids.set(entity.id, entity);
    if (!atomRefs.has(entity.atomRef)) atomRefs.set(entity.atomRef, []);
    atomRefs.get(entity.atomRef).push(entity);
    entities.push(entity);
  }

  return Object.freeze({
    entities: Object.freeze(entities),
    byId(id) { return ids.get(id) ?? null; },
    byAtomRef(ref) { return Object.freeze([...(atomRefs.get(ref) ?? [])]); }
  });
}
