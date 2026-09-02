import { atomTypes, walkAtoms } from './slot-graph-semantics.mjs';

function pathKey(path) {
  return path.join('/');
}

function hasPathPrefix(path, prefix) {
  return prefix.every((part, index) => path[index] === part);
}

function sourceProgram(matches, sourceProgramPath) {
  return matches.find((match) => (
    pathKey(match.path) === sourceProgramPath && atomTypes(match.atom).includes('program')
  )) ?? null;
}

function sourceNotFound(sourceProgramPath) {
  return Object.assign(
    new Error(`Slot signal source Program no longer exists: ${sourceProgramPath}`),
    { code: 'SLOT_SIGNAL_SOURCE_NOT_FOUND' }
  );
}

export function resolveSlotSignalDeliveries(atoms, effects, { revision, createId }) {
  const matches = walkAtoms(atoms);
  const deliveries = [];
  for (const effect of effects) {
    const source = sourceProgram(matches, effect.sourceProgramPath);
    if (!source) throw sourceNotFound(effect.sourceProgramPath);
    const parentPath = source.path.slice(0, -1);
    const recipients = effect.to === 'up'
      ? matches.filter((candidate) => pathKey(candidate.path) === pathKey(parentPath))
      : matches.filter((candidate) => (
        candidate.path.length === source.path.length + 1
        && hasPathPrefix(candidate.path, source.path)
      ));
    const from = effect.to === 'up' ? 'down' : 'up';
    for (const recipient of recipients) {
      deliveries.push({
        mode: 'slot',
        id: createId(),
        revision,
        sourcePath: effect.sourceProgramPath,
        recipientPath: pathKey(recipient.path),
        from,
        labels: Object.freeze([...effect.labels])
      });
    }
  }
  return deliveries;
}
