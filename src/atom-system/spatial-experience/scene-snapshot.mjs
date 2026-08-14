function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function isPrefix(prefix, address) {
  return prefix.length <= address.length && prefix.every((part, index) => part === address[index]);
}

function hierarchyLevel(focus, entity) {
  if (!focus || !isPrefix(focus.hierarchyAddress, entity.hierarchyAddress)) return null;
  return entity.hierarchyAddress.length - focus.hierarchyAddress.length + 1;
}

function boundedDepth(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

export function createSceneSnapshot({ index, viewState }) {
  if (!index?.entities || typeof index.byId !== 'function') {
    throw problem('INVALID_ENTITY_INDEX', 'Scene snapshot requires an entity index');
  }
  if (!viewState || typeof viewState !== 'object' || Array.isArray(viewState)) {
    throw problem('INVALID_VIEW_STATE', 'Scene snapshot requires view state');
  }
  const visibleIds = new Set(Array.isArray(viewState.visibleIds) ? viewState.visibleIds : []);
  const focus = index.byId(viewState.middleFocusId);
  const labelDepth = boundedDepth(viewState.labelDepth, 3);
  const detailDepth = boundedDepth(viewState.detailDepth, 3);
  const detailModes = viewState.detailModeById ?? {};
  const sceneEntities = [];
  const sceneById = new Map();

  for (const entity of index.entities) {
    const visible = visibleIds.has(entity.id);
    const level = hierarchyLevel(focus, entity);
    const readable = entity.capabilities.read;
    const detailMode = detailModes[entity.id] ?? entity.detailMode ?? 'floating';
    const sceneEntity = Object.freeze({
      identity: Object.freeze({ entityId: entity.id, atomRef: entity.atomRef, kind: entity.kind }),
      visible,
      hierarchyLevel: level,
      label: readable ? entity.label : '',
      emphasis: Object.freeze({
        selected: visible && entity.id === viewState.selectedId,
        focused: visible && entity.id === viewState.focusedId,
        label: visible && level !== null && level <= labelDepth,
        detail: visible && level !== null && level <= detailDepth
      }),
      detailPresentation: visible && readable
        ? Object.freeze({ mode: detailMode, text: entity.detail })
        : null,
      capabilities: entity.capabilities
    });
    sceneEntities.push(sceneEntity);
    sceneById.set(entity.id, sceneEntity);
  }

  return Object.freeze({
    contract: 'atom.scene-snapshot',
    version: 1,
    mode: viewState.mode,
    entities: Object.freeze(sceneEntities),
    visibleCount: sceneEntities.reduce((count, entity) => count + Number(entity.visible), 0),
    byId(id) { return sceneById.get(id) ?? null; }
  });
}
