import {
  applyViewIntent,
  commitViewIntent,
  createLegacySceneSnapshot,
  sceneEntityIdForItem,
  viewFactsFromLegacyState
} from './adapters/browser-scene-adapter.mjs';
import { createEntityIndex } from './spatial-experience/entity-index.mjs';
import { reduceInteraction } from './spatial-experience/interaction-reducer.mjs';
import { createSceneSnapshot } from './spatial-experience/scene-snapshot.mjs';

globalThis.AtomSpatialScene = Object.freeze({
  applyViewIntent,
  commitViewIntent,
  createLegacySceneSnapshot,
  sceneEntityIdForItem,
  viewFactsFromLegacyState,
  createEntityIndex,
  reduceInteraction,
  createSceneSnapshot
});
