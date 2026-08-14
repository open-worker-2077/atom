import { WORLD_OUTSIDE_NAME } from './world-root.mjs';

export function matchesExactSelector(pathParts, name, selector) {
  if (typeof selector !== 'string' || !selector) return false;
  if (!selector.includes('/')) return name === selector;
  const selectorParts = selector.split('/');
  if (selectorParts[0] === WORLD_OUTSIDE_NAME) {
    const worldPath = selectorParts.slice(1);
    return worldPath.length === pathParts.length && worldPath.every((part, index) => (
      pathParts[index] === part
    ));
  }
  if (selectorParts.length > pathParts.length) return false;
  return selectorParts.every((part, index) => (
    pathParts[pathParts.length - selectorParts.length + index] === part
  ));
}
