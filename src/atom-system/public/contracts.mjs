function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requireContract(value, contract) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.contract !== contract) {
    throw contractError('INVALID_CONTRACT', `Expected ${contract}`);
  }
  if (value.version !== 1) {
    throw contractError('INVALID_CONTRACT_VERSION', `${contract} requires version 1`);
  }
}

function requireText(value, code, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError(code, `${label} must be a non-empty string`);
  }
}

function requireRevision(value, label = 'revision') {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError('INVALID_WORLD_REVISION', `${label} must be a non-empty opaque token`);
  }
}

function immutableCopy(value) {
  return Object.freeze(structuredClone(value));
}

export function validateWorldCommandEnvelope(value) {
  requireContract(value, 'atom.world-command');
  requireText(value.commandId, 'INVALID_COMMAND_ID', 'commandId');
  requireText(value.correlationId, 'INVALID_CORRELATION_ID', 'correlationId');
  requireRevision(value.expectedRevision, 'expectedRevision');
  requireText(value.name, 'INVALID_COMMAND_NAME', 'name');
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw contractError('INVALID_COMMAND_PAYLOAD', 'payload must be an object');
  }
  return immutableCopy(value);
}

export function validateWorldReceipt(value) {
  requireContract(value, 'atom.world-receipt');
  requireText(value.commandId, 'INVALID_COMMAND_ID', 'commandId');
  requireText(value.correlationId, 'INVALID_CORRELATION_ID', 'correlationId');
  requireRevision(value.beforeRevision, 'beforeRevision');
  requireRevision(value.afterRevision, 'afterRevision');
  if (!['committed', 'rejected'].includes(value.status)) {
    throw contractError('INVALID_RECEIPT_STATUS', 'status must be committed or rejected');
  }
  const transitionIsValid = value.status === 'committed'
    ? value.afterRevision !== value.beforeRevision
    : value.afterRevision === value.beforeRevision;
  if (!transitionIsValid) {
    throw contractError('INVALID_REVISION_TRANSITION', 'receipt revisions do not match its status');
  }
  return immutableCopy(value);
}

export function validateWorldSnapshot(value) {
  requireContract(value, 'atom.world-snapshot');
  requireText(value.worldId, 'INVALID_WORLD_ID', 'worldId');
  requireRevision(value.revision);
  if (!Array.isArray(value.facts)) {
    throw contractError('INVALID_WORLD_FACTS', 'facts must be an array');
  }
  return immutableCopy(value);
}

export function validateProjectionEnvelope(value) {
  requireContract(value, 'atom.projection');
  requireText(value.projection, 'INVALID_PROJECTION_NAME', 'projection');
  requireText(value.worldId, 'INVALID_WORLD_ID', 'worldId');
  requireRevision(value.sourceRevision, 'sourceRevision');
  if (!Object.hasOwn(value, 'value')) {
    throw contractError('INVALID_PROJECTION_VALUE', 'projection value is required');
  }
  return immutableCopy(value);
}
