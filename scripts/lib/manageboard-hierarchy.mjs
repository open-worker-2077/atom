import { createHash } from 'node:crypto';

function text(value, fallback) {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function groupId(prefix, bossId, ...parts) {
  const fingerprint = createHash('sha256')
    .update([bossId, ...parts].join('\u001f'))
    .digest('hex')
    .slice(0, 16);
  return `group-${prefix}-${fingerprint}`;
}

export function hierarchyFor(record) {
  const administration = text(record.administration, '未分配 administration');
  const development = text(record.development, '未分配 development');
  const administrationId = groupId('administration', record.bossId, administration);
  const developmentId = groupId(
    'development',
    record.bossId,
    administration,
    development
  );
  return {
    administration: {
      id: administrationId,
      label: administration
    },
    development: {
      id: developmentId,
      label: development,
      leaderId: administrationId
    },
    nodeLeaderId: developmentId
  };
}

export function hierarchyGroups(records) {
  const administrations = new Map();
  const developments = new Map();
  const assignments = new Map();
  for (const record of records) {
    const hierarchy = hierarchyFor(record);
    administrations.set(hierarchy.administration.id, hierarchy.administration);
    developments.set(hierarchy.development.id, hierarchy.development);
    assignments.set(record.recordId, hierarchy.nodeLeaderId);
  }
  return {
    administrations: [...administrations.values()],
    developments: [...developments.values()],
    assignments
  };
}
