import { reduceInteraction } from '../spatial-experience/interaction-reducer.mjs';
import { createEntityIndex } from '../spatial-experience/entity-index.mjs';
import { createSceneSnapshot } from '../spatial-experience/scene-snapshot.mjs';

function pathParts(value) {
  return String(value ?? '').split('/').filter(Boolean);
}

function within(path, root) {
  return Boolean(path && root && (path === root || path.startsWith(`${root}/`)));
}

function nodeOwnerPath(item) {
  return item?.ownerPath ?? item?.node?.__clusterOwnerPath ?? item?.node?.workspacePath ?? '';
}

function nodeKey(item) {
  const ownerPath = nodeOwnerPath(item);
  return item?.node && ownerPath ? `${ownerPath}::${item.node.id}` : '';
}

export function sceneEntityIdForItem(item) {
  if (item?.kind === 'domain') {
    const path = item.path ?? item.cluster?.path ?? '';
    return path ? `domain:${path}` : '';
  }
  const key = nodeKey(item);
  return key ? `node:${key}` : '';
}

function hierarchyAddress(item, focus) {
  const kind = item.kind === 'domain' ? 'domain' : 'node';
  const identity = sceneEntityIdForItem(item);
  const ownerPath = kind === 'domain'
    ? item.ownerPath ?? item.cluster?.parentPath ?? ''
    : nodeOwnerPath(item);
  const itemPath = kind === 'domain' ? item.path ?? item.cluster?.path ?? '' : '';

  if (focus?.kind === 'node') {
    if (kind === 'node' && nodeKey(item) === focus.anchorKey) return ['@focus'];
    const root = focus.descendantPath;
    if (!within(ownerPath, root)) return ['@outside', identity];
    const relative = pathParts(ownerPath).slice(pathParts(root).length);
    return ['@focus', ...relative, `@${kind}:${identity}`];
  }
  return kind === 'domain'
    ? pathParts(itemPath)
    : [...pathParts(ownerPath), `@node:${identity}`];
}

function rawEntity(item, focus) {
  const domain = item.kind === 'domain';
  const node = item.node;
  const id = sceneEntityIdForItem(item);
  return {
    id,
    atomRef: domain ? `path:${item.path ?? item.cluster?.path}` : `path:${nodeKey(item)}`,
    kind: domain ? 'domain' : 'node',
    label: String(domain ? item.label ?? item.cluster?.label ?? '' : item.label ?? node?.label ?? ''),
    detail: String(domain
      ? item.detail ?? item.cluster?.description ?? ''
      : node?.description ?? node?.detail ?? ''),
    hierarchyAddress: hierarchyAddress(item, focus),
    detailMode: node?.detailMode ?? (node?.surfaceVisible ? 'surface' : 'floating'),
    capabilities: {
      read: node?.capabilities?.read !== false,
      write: node?.capabilities?.write !== false
    }
  };
}

export function createLegacySceneSnapshot({
  rendered = [],
  clusters = [],
  focus = null,
  settings = {},
  selected = null,
  focused = null,
  viewMode = 'nested'
}) {
  const items = [
    ...clusters.map((cluster) => ({
      kind: 'domain',
      path: cluster.path,
      ownerPath: cluster.parentPath,
      cluster,
      label: cluster.label,
      detail: cluster.description
    })),
    ...rendered.filter((item) => item?.kind === 'node' && item.node && !item.clusterShellProxy)
  ];
  const unique = new Map();
  for (const item of items) {
    const id = sceneEntityIdForItem(item);
    if (id && !unique.has(id)) unique.set(id, item);
  }
  let focusId = focus?.kind === 'domain'
    ? `domain:${focus.path}`
    : focus?.kind === 'node' ? `node:${focus.anchorKey}` : null;
  if (focusId && !unique.has(focusId)) {
    const synthetic = focus.kind === 'domain'
      ? { kind: 'domain', path: focus.path, ownerPath: pathParts(focus.path).slice(0, -1).join('/'), label: '', detail: '' }
      : {
          kind: 'node',
          ownerPath: focus.anchorKey.slice(0, focus.anchorKey.lastIndexOf('::')),
          node: { id: focus.anchorKey.slice(focus.anchorKey.lastIndexOf('::') + 2), label: '', description: '' }
        };
    unique.set(focusId, synthetic);
  }
  const entities = [...unique.values()].map((item) => rawEntity(item, focus));
  const selectedIds = entities
    .filter((entity) => selected && entity.kind === 'node' && entity.id.endsWith(`::${selected.id}`))
    .map(({ id }) => id);
  const focusedIds = entities
    .filter((entity) => focused && entity.kind === 'node' && entity.id.endsWith(`::${focused.id}`))
    .map(({ id }) => id);
  return createSceneSnapshot({
    index: createEntityIndex(entities),
    viewState: {
      mode: viewMode,
      visibleIds: entities.map(({ id }) => id),
      selectedId: selectedIds[0] ?? null,
      focusedId: focusedIds[0] ?? null,
      middleFocusId: focusId,
      labelDepth: settings.middleLabelDepth,
      detailDepth: settings.middleDetailDepth ?? settings.middleLabelDepth,
      detailModeById: {}
    }
  });
}

function projectionEntries(value) {
  if (!(value instanceof Map)) return {};
  return Object.fromEntries([...value.entries()].map(([path, descriptor]) => [
    path,
    descriptor?.projectionMode ?? descriptor?.mode ?? 'hierarchy'
  ]));
}

export function viewFactsFromLegacyState(state) {
  return {
    mode: state.viewMode,
    visibleIds: [],
    branchProjections: projectionEntries(state.expandedClusterDomains),
    selectedId: state.selected?.id ?? null,
    focusedId: state.focused?.id ?? null,
    middleFocusId: null,
    labelDepth: state.demo?.settings?.middleLabelDepth ?? 3,
    detailDepth: state.demo?.settings?.middleDetailDepth ?? 3,
    detailModeById: {}
  };
}

export function applyViewIntent(state, intent) {
  return reduceInteraction(viewFactsFromLegacyState(state), intent);
}

export function commitViewIntent(state, intent) {
  const next = applyViewIntent(state, intent);
  if (intent.type === 'set-view-mode') state.viewMode = next.mode;
  if (intent.type === 'append-view') {
    state.expandedClusterDomains.set(intent.targetId, intent.descriptor);
  } else if (intent.type === 'remove-view') {
    for (const path of [...state.expandedClusterDomains.keys()]) {
      if (path === intent.targetId || path.startsWith(`${intent.targetId}/`)) {
        state.expandedClusterDomains.delete(path);
      }
    }
  } else if (intent.type === 'clear-views') {
    state.expandedClusterDomains.clear();
  } else if (intent.type === 'replace-views') {
    state.expandedClusterDomains.clear();
    for (const descriptor of intent.descriptors ?? []) {
      state.expandedClusterDomains.set(descriptor.path, descriptor);
    }
  }
  return next;
}
