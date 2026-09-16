export function isTypedDefaultBackupTypes(types) {
  const names = types instanceof Set
    ? types
    : new Set((types ?? []).map((type) => typeof type === 'string' ? type : type?.name));
  return names.has('backup') && names.has('default');
}

export function isInsideDefaultBackupPath(atomPath, inactiveAtomPaths) {
  return typeof atomPath === 'string' && inactiveAtomPaths?.has(atomPath);
}
