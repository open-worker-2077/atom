const VIEW_MODES = new Set(['peripheral', 'nested', 'hierarchy', 'immersive']);
const DETAIL_MODES = new Set(['name', 'surface', 'floating']);

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireTarget(intent) {
  if (typeof intent.targetId !== 'string' || !intent.targetId) {
    throw problem('INVALID_INTERACTION_TARGET', `${intent.type} requires targetId`);
  }
}

function requireProjectionMode(mode) {
  if (!VIEW_MODES.has(mode)) throw problem('INVALID_VIEW_MODE', `Unknown view mode ${mode}`);
  return mode;
}

export function reduceInteraction(rawState, intent) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    throw problem('INVALID_VIEW_STATE', 'View state must be an object');
  }
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    throw problem('INVALID_INTERACTION_INTENT', 'Interaction intent must be an object');
  }
  const state = structuredClone(rawState);
  state.branchProjections = { ...(state.branchProjections ?? {}) };
  state.detailModeById = { ...(state.detailModeById ?? {}) };

  switch (intent.type) {
    case 'set-view-mode':
      if (!VIEW_MODES.has(intent.mode)) throw problem('INVALID_VIEW_MODE', `Unknown view mode ${intent.mode}`);
      state.mode = intent.mode;
      break;
    case 'append-view':
      requireTarget(intent);
      state.branchProjections[intent.targetId] = requireProjectionMode(intent.mode ?? state.mode);
      break;
    case 'remove-view':
      requireTarget(intent);
      for (const targetId of Object.keys(state.branchProjections)) {
        if (targetId === intent.targetId || targetId.startsWith(`${intent.targetId}/`)) {
          delete state.branchProjections[targetId];
        }
      }
      break;
    case 'clear-views':
      state.branchProjections = {};
      break;
    case 'replace-views':
      if (!intent.projections || typeof intent.projections !== 'object' || Array.isArray(intent.projections)) {
        throw problem('INVALID_BRANCH_PROJECTIONS', 'replace-views requires a projection map');
      }
      state.branchProjections = Object.fromEntries(
        Object.entries(intent.projections).map(([targetId, mode]) => {
          if (!targetId) throw problem('INVALID_INTERACTION_TARGET', 'Projection target ids must be non-empty');
          return [targetId, requireProjectionMode(mode)];
        })
      );
      break;
    case 'focus-hierarchy':
      requireTarget(intent);
      state.middleFocusId = intent.targetId;
      break;
    case 'set-detail-mode':
      requireTarget(intent);
      if (!DETAIL_MODES.has(intent.mode)) throw problem('INVALID_DETAIL_MODE', `Unknown detail mode ${intent.mode}`);
      state.detailModeById[intent.targetId] = intent.mode;
      break;
    case 'select':
      requireTarget(intent);
      state.selectedId = intent.targetId;
      break;
    default:
      throw problem('UNKNOWN_INTERACTION_INTENT', `Unknown interaction intent ${intent.type}`);
  }
  return Object.freeze(state);
}
