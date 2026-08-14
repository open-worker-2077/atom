function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createViewStateDocument({ worldId, revision = 1, view }) {
  if (typeof worldId !== 'string' || !worldId) {
    throw problem('INVALID_VIEW_STATE_WORLD', 'View state requires a world id');
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw problem('INVALID_VIEW_STATE_REVISION', 'View state revision must be a non-negative integer');
  }
  if (view !== null && (!view || typeof view !== 'object' || Array.isArray(view))) {
    throw problem('INVALID_VIEW_STATE', 'View state must be an object or null');
  }
  return Object.freeze({
    contract: 'atom.view-state',
    version: 1,
    worldId,
    revision,
    view: structuredClone(view)
  });
}

export function validateViewStateDocument(value, worldId) {
  if (!value || value.contract !== 'atom.view-state' || value.version !== 1) {
    throw problem('INVALID_VIEW_STATE_DOCUMENT', 'Expected atom.view-state v1');
  }
  const document = createViewStateDocument(value);
  if (worldId && document.worldId !== worldId) {
    throw problem('VIEW_STATE_WORLD_MISMATCH', 'View state belongs to another world');
  }
  return document;
}
