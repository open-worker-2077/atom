function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function validTypePredicate(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  if (keys.length === 0 || keys.some((key) => !['all', 'any', 'none'].includes(key))) return false;
  const positive = new Set();
  for (const key of keys) {
    const types = value[key];
    if (!Array.isArray(types) || types.length === 0
      || types.some((type) => typeof type !== 'string' || !type)
      || new Set(types).size !== types.length) return false;
    if (key !== 'none') types.forEach((type) => positive.add(type));
  }
  return !(value.none ?? []).some((type) => positive.has(type));
}

function validAllowedWindows(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || !['paths', 'types', 'relation'].includes(keys[0])) return false;
  if (keys[0] === 'types') return validTypePredicate(value.types);
  if (keys[0] === 'relation') return value.relation === 'target_within_window_parent';
  return Array.isArray(value.paths) && value.paths.length > 0
    && value.paths.every((item) => typeof item === 'string' && item.includes('/'))
    && new Set(value.paths).size === value.paths.length;
}

function validAllowedPrograms(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && Array.isArray(value.paths) && value.paths.length > 0
    && value.paths.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value.paths).size === value.paths.length;
}

function validWhen(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !['target_types', 'actions'].includes(key))) return false;
  if (value.target_types !== undefined && !validTypePredicate(value.target_types)) return false;
  return value.actions === undefined || (
    Array.isArray(value.actions) && value.actions.length > 0
    && value.actions.every((action) => ['explore', 'transform'].includes(action))
    && new Set(value.actions).size === value.actions.length
  );
}

export function validateRequestDrivenLockSnapshot(value) {
  const supportedFields = new Set(['thing', 'situation', 'contain', 'support', 'messages']);
  if (value && typeof value === 'object'
    && (Object.hasOwn(value, 'windowSelfLocks') || Object.hasOwn(value, 'windowSelfLockAgents'))) {
    throw problem(
      'RETIRED_WINDOW_SELF_LOCK_SNAPSHOT',
      'Legacy window self-lock snapshots require one-time migration to agentRegistrations'
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || !Array.isArray(value.locks)
    || (value.agentRegistrations !== undefined && (!Array.isArray(value.agentRegistrations)
      || value.agentRegistrations.some((entry) => !entry || typeof entry !== 'object'
        || typeof entry.agentPath !== 'string' || !entry.agentPath
        || !Array.isArray(entry.labels)
        || entry.labels.some((label) => typeof label !== 'string' || !label)
        || !Array.isArray(entry.functions) || entry.functions.length === 0
        || entry.functions.some((name) => typeof name !== 'string' || !name))))
    || value.locks.some((lock) => !lock || typeof lock !== 'object' || Array.isArray(lock)
      || typeof lock.sourceProgramPath !== 'string' || !lock.sourceProgramPath
      || !Array.isArray(lock.targets?.paths) || lock.targets.paths.length === 0
      || lock.targets.paths.some((item) => typeof item !== 'string' || !item)
      || new Set(lock.targets.paths).size !== lock.targets.paths.length
      || (lock.targets.scope !== undefined && lock.targets.scope !== 'subtree')
      || !['write', 'read_write'].includes(lock.mode)
      || !Array.isArray(lock.fields) || lock.fields.length === 0
      || lock.fields.some((field) => !supportedFields.has(field))
      || !lock.protect || typeof lock.protect.atom !== 'boolean'
      || typeof lock.protect.messages !== 'boolean'
      || (lock.allowed_windows !== undefined && !validAllowedWindows(lock.allowed_windows))
      || (lock.allowed_programs !== undefined && !validAllowedPrograms(lock.allowed_programs))
      || (lock.when !== undefined && !validWhen(lock.when))
      || lock.refresh?.policy !== 'on_request')) {
    throw problem('INVALID_REQUEST_DRIVEN_LOCK_SNAPSHOT', 'Stored request-driven lock snapshot is invalid');
  }
  return structuredClone(value);
}
