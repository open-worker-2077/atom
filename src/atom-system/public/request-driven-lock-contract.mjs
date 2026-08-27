function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function validateRequestDrivenLockSnapshot(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 2
    && value.contract === 'atom.request-driven-security-retired'
    && value.version === 1) {
    return structuredClone(value);
  }
  if (value && typeof value === 'object'
    && (Object.hasOwn(value, 'windowSelfLocks') || Object.hasOwn(value, 'windowSelfLockAgents'))) {
    throw problem(
      'RETIRED_WINDOW_SELF_LOCK_SNAPSHOT',
      'Legacy window self-lock snapshots require one-time retirement before Program-source reconstruction'
    );
  }
  if (value && typeof value === 'object' && Object.hasOwn(value, 'agentRegistrations')) {
    throw problem(
      'RETIRED_AGENT_REGISTRATION_SNAPSHOT',
      'Agent registrations are reconstructed from literal @program@agent declarations'
    );
  }
  if (value && typeof value === 'object' && Object.hasOwn(value, 'locks')) {
    throw problem(
      'RETIRED_REQUEST_DRIVEN_LOCK_SNAPSHOT',
      'Request-driven locks are reconstructed from literal lock() declarations in Atom Programs'
    );
  }
  throw problem('INVALID_REQUEST_DRIVEN_LOCK_SNAPSHOT', 'Stored request-driven lock snapshot is invalid');
}
