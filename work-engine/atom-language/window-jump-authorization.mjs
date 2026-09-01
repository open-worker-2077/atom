import crypto from 'node:crypto';

export const WINDOW_JUMP_AUTHORIZATION_TYPE = 'jump-authorization';
export const WINDOW_JUMP_AUTHORIZATION_CONTRACT = 'atom.window-jump-authorization';

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function graphRecordGeneration(record) {
  return digest({
    path: record?.path ?? null,
    types: [...(record?.types ?? [])].sort(),
    detail: record?.detail ?? null
  });
}

export function issuerAuthorityGeneration(record, security) {
  return digest({
    record: graphRecordGeneration(record),
    labels: [...(security?.labels ?? [])].sort(),
    functionScopes: security?.functionScopes ?? null,
    functions: [...(security?.functions ?? [])].sort()
  });
}

export function createWindowJumpAuthorization({
  operationId, effect, issuerAgentPath, issuerSecurity, recordsByPath
}) {
  const window = recordsByPath.get(effect.windowPath);
  const source = recordsByPath.get(effect.sourcePath);
  const destination = recordsByPath.get(effect.destinationPath);
  const issuer = recordsByPath.get(issuerAgentPath);
  if (!window || !source || !destination || !issuer || !issuerSecurity
    || !source.path.startsWith(`${window.path}/`)) {
    throw Object.assign(new Error('Controlled jump authorization bindings are invalid'), {
      code: 'WINDOW_JUMP_AUTHORIZATION_INVALID'
    });
  }
  const payload = {
    contract: WINDOW_JUMP_AUTHORIZATION_CONTRACT,
    version: 1,
    operationId,
    windowPath: window.path,
    windowGeneration: graphRecordGeneration(window),
    sourcePath: source.path,
    sourceGeneration: graphRecordGeneration(source),
    destinationPath: destination.path,
    destinationGeneration: graphRecordGeneration(destination),
    issuerAgentPath,
    issuerProgramPath: effect.issuerProgramPath,
    issuerAuthorityGeneration: issuerAuthorityGeneration(issuer, issuerSecurity)
  };
  return {
    atom: {
      [`thing@${WINDOW_JUMP_AUTHORIZATION_TYPE}`]: `迁窗授权-${operationId}`,
      situation: JSON.stringify(payload),
      slot: [],
      strut: []
    },
    payload
  };
}

export function parseWindowJumpAuthorization(record) {
  if (!record?.types?.includes(WINDOW_JUMP_AUTHORIZATION_TYPE)) return null;
  let payload;
  try {
    payload = JSON.parse(record.detail);
  } catch {
    return null;
  }
  const keys = [
    'contract', 'version', 'operationId',
    'windowPath', 'windowGeneration', 'sourcePath', 'sourceGeneration',
    'destinationPath', 'destinationGeneration',
    'issuerAgentPath', 'issuerProgramPath', 'issuerAuthorityGeneration'
  ];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== keys.length
    || keys.some((key) => !Object.hasOwn(payload, key))
    || payload.contract !== WINDOW_JUMP_AUTHORIZATION_CONTRACT || payload.version !== 1
    || keys.slice(2).some((key) => typeof payload[key] !== 'string' || !payload[key])) {
    return null;
  }
  return payload;
}

export function validateWindowJumpAuthorization({ payload, windowPath, sourcePath,
  destinationPath, issuerSecurity, recordsByPath }) {
  const window = recordsByPath.get(windowPath);
  const source = recordsByPath.get(sourcePath);
  const destination = recordsByPath.get(destinationPath);
  const issuer = recordsByPath.get(payload?.issuerAgentPath);
  if (!payload || payload.windowPath !== windowPath || payload.sourcePath !== sourcePath
    || payload.destinationPath !== destinationPath || !window || !source || !destination
    || !issuer || !issuerSecurity
    || payload.windowGeneration !== graphRecordGeneration(window)
    || payload.sourceGeneration !== graphRecordGeneration(source)
    || payload.destinationGeneration !== graphRecordGeneration(destination)
    || payload.issuerAuthorityGeneration !== issuerAuthorityGeneration(issuer, issuerSecurity)) {
    throw Object.assign(new Error('Controlled jump authorization is stale or was altered'), {
      code: 'WINDOW_JUMP_AUTHORIZATION_INVALID'
    });
  }
  return payload;
}
