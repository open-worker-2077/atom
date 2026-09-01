import crypto from 'node:crypto';

import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';

const PLAN_CONTRACT = 'atom.agent-program-migration-plan';
const RECEIPT_CONTRACT = 'atom.agent-program-migration-receipt';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function legacyAgentProgramSource(originalSituation) {
  return [
    `LEGACY_AGENT_SITUATION = ${JSON.stringify(String(originalSituation))}`,
    'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})'
  ].join('\n');
}

function parsePersistentKey(rawKey, location, parseLegacyPersistentAtomKey) {
  const parsed = parseLegacyPersistentAtomKey(rawKey);
  if (parsed.errors.length > 0 || parsed.actions.length > 0 || parsed.hints.length > 0) {
    throw problem(
      'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
      `Legacy Agent migration cannot classify a non-persistent Graph key at ${location}`,
      {
        location,
        rawKey,
        diagnostics: parsed.errors.map(({ code, message }) => ({ code, message }))
      }
    );
  }
  return parsed;
}

function keyFromMetadata(parsed, types) {
  return `${parsed.baseKey}${types.map((type) => `@${type}`).join('')}`
    + (parsed.descriptionPresent ? `#${parsed.description}` : '');
}

function uniqueField(entries, baseKey, location) {
  const matches = entries.filter(({ parsed }) => parsed.baseKey === baseKey);
  if (matches.length > 1) {
    throw problem(
      'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
      `Legacy Agent migration requires one ${baseKey} field at ${location}`,
      { location, baseKey, keys: matches.map(({ rawKey }) => rawKey) }
    );
  }
  return matches[0] ?? null;
}

function migrationIdFor({ expectedRevision, nextRevision, sourceFactsHash, nextFactsHash, summary }) {
  return `agent-program-${digest({
    expectedRevision,
    nextRevision,
    sourceFactsHash,
    nextFactsHash,
    summary
  }).slice('sha256:'.length, 'sha256:'.length + 20)}`;
}

function rewriteWorld(sourceFacts, parseLegacyPersistentAtomKey) {
  const summary = {
    activePureAgentsUpgraded: 0,
    activeProgramAgentsUpgraded: 0,
    archivedAgentsDemoted: 0,
    ambiguousSources: 0
  };
  const upgradedPaths = [];
  const activeProgramAgentPaths = [];
  const archivedDemotedPaths = [];

  function rewriteRecord(source, parentPath, insideDefaultBackup, address) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw problem(
        'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
        `Legacy Agent migration encountered a non-object Atom at ${address}`,
        { address }
      );
    }
    const entries = Object.entries(source).map(([rawKey, value]) => ({
      rawKey,
      value,
      parsed: parsePersistentKey(rawKey, `${address}:${rawKey}`, parseLegacyPersistentAtomKey)
    }));
    const possibleThingFields = entries.filter(({ parsed }) => parsed.baseKey === 'thing');
    const possiblyArchived = insideDefaultBackup || possibleThingFields.some(({ parsed }) => {
      const types = parsed.types.map(({ raw }) => raw);
      return types.includes('backup') && types.includes('default');
    });
    const possibleKeys = entries.map((entry) => {
      const originalTypes = entry.parsed.types.map(({ raw }) => raw);
      let types = originalTypes;
      if (possiblyArchived) {
        types = types.filter((type) => type !== 'agent' && type !== 'program');
      } else if (types.includes('agent')) {
        const wasProgram = types.includes('program');
        types = types.filter((type) => type !== 'agent');
        if (entry.parsed.baseKey === 'thing' && !wasProgram) types.push('program');
      }
      return keyFromMetadata(entry.parsed, types);
    });
    const possibleKeySet = new Set();
    for (const key of possibleKeys) {
      if (possibleKeySet.has(key)) {
        throw problem(
          'AGENT_MIGRATION_KEY_COLLISION',
          `Legacy Agent migration reconstructs a duplicate key at ${address}`,
          { path: address, key }
        );
      }
      possibleKeySet.add(key);
    }
    const thing = uniqueField(entries, 'thing', address);
    if (!thing || typeof thing.value !== 'string') {
      throw problem(
        'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
        `Legacy Agent migration requires one string Thing identity at ${address}`,
        { address }
      );
    }
    const situation = uniqueField(entries, 'situation', address);
    const contain = uniqueField(entries, 'contain', address);
    if (contain && !Array.isArray(contain.value)) {
      throw problem(
        'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
        `Legacy Agent migration requires contain to be an array at ${address}`,
        { address }
      );
    }

    const thingTypes = thing.parsed.types.map(({ raw }) => raw);
    const path = [...parentPath, thing.value].join('/');
    const archived = insideDefaultBackup
      || (thingTypes.includes('backup') && thingTypes.includes('default'));
    const hadAgent = thingTypes.includes('agent');
    const hadProgram = thingTypes.includes('program');
    let pureAgent = false;
    if (archived && (hadAgent || hadProgram)) {
      archivedDemotedPaths.push(path);
      if (hadAgent) summary.archivedAgentsDemoted += 1;
    } else if (hadAgent && hadProgram) {
      summary.activeProgramAgentsUpgraded += 1;
      upgradedPaths.push(path);
      activeProgramAgentPaths.push(path);
    } else if (hadAgent) {
      summary.activePureAgentsUpgraded += 1;
      upgradedPaths.push(path);
      pureAgent = true;
    }

    const rewrittenEntries = entries.map((entry) => {
      const originalTypes = entry.parsed.types.map(({ raw }) => raw);
      let types = originalTypes;
      if (archived) {
        types = originalTypes.filter((type) => type !== 'agent' && type !== 'program');
      } else if (originalTypes.includes('agent')) {
        types = originalTypes.filter((type) => type !== 'agent');
        if (entry === thing && pureAgent && !types.includes('program')) types.push('program');
      }
      const rawKey = keyFromMetadata(entry.parsed, types);
      const value = entry === situation && pureAgent
        ? legacyAgentProgramSource(entry.value ?? '')
        : structuredClone(entry.value);
      return { rawKey, value, parsed: entry.parsed };
    });
    if (pureAgent && !situation) {
      rewrittenEntries.push({
        rawKey: 'situation',
        value: legacyAgentProgramSource(''),
        parsed: parsePersistentKey(
          'situation', `${address}:situation`, parseLegacyPersistentAtomKey
        )
      });
    }

    const keys = new Set();
    for (const entry of rewrittenEntries) {
      if (keys.has(entry.rawKey)) {
        throw problem(
          'AGENT_MIGRATION_KEY_COLLISION',
          `Legacy Agent migration reconstructs a duplicate key at ${path}`,
          { path, key: entry.rawKey }
        );
      }
      keys.add(entry.rawKey);
    }

    const target = {};
    for (const entry of rewrittenEntries) {
      target[entry.rawKey] = entry.value;
    }
    const targetContain = rewrittenEntries.find(({ parsed }) => parsed.baseKey === 'contain');
    if (targetContain) {
      target[targetContain.rawKey] = targetContain.value.map((child, index) => (
        rewriteRecord(child, [...parentPath, thing.value], archived, `${address}/contain/${index}`)
      ));
    }
    return target;
  }

  const facts = sourceFacts.map((record, index) => rewriteRecord(record, [], false, `facts/${index}`));
  return { facts, summary, upgradedPaths, activeProgramAgentPaths, archivedDemotedPaths };
}

function assertNoRetiredAgentKeys(facts, parseLegacyPersistentAtomKey) {
  function visit(records, location) {
    for (const [index, record] of records.entries()) {
      const recordLocation = `${location}/${index}`;
      let contain = null;
      for (const [rawKey, value] of Object.entries(record)) {
        const parsed = parsePersistentKey(
          rawKey, `${recordLocation}:${rawKey}`, parseLegacyPersistentAtomKey
        );
        if (parsed.types.some(({ raw }) => raw === 'agent')) {
          throw problem(
            'AGENT_MIGRATION_TARGET_VERIFICATION_FAILED',
            `Migrated target retains retired Agent Key type at ${recordLocation}`,
            { location: recordLocation, rawKey }
          );
        }
        if (parsed.baseKey === 'contain') contain = value;
      }
      if (Array.isArray(contain)) visit(contain, `${recordLocation}/contain`);
    }
  }
  visit(facts, 'facts');
}

async function verifyTargetSecurity({
  facts,
  programScheduler,
  upgradedPaths,
  activeProgramAgentPaths,
  archivedDemotedPaths
}) {
  if (typeof programScheduler?.deriveAgentSecurity !== 'function') {
    throw problem(
      'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
      'Legacy Agent migration requires the Program declaration scheduler'
    );
  }
  let security;
  try {
    security = await programScheduler.deriveAgentSecurity(facts);
  } catch (error) {
    throw problem(
      'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
      'One or more active legacy Program Agents cannot be converted losslessly',
      { paths: activeProgramAgentPaths, cause: error.code ?? error.name }
    );
  }
  const missing = upgradedPaths.filter((path) => !security.has(path));
  if (missing.length > 0) {
    throw problem(
      'AGENT_MIGRATION_SOURCE_AMBIGUOUS',
      'One or more active legacy Agents do not produce one legal Agent declaration',
      { paths: missing }
    );
  }
  const activeArchived = archivedDemotedPaths.filter((path) => security.has(path));
  if (activeArchived.length > 0) {
    throw problem(
      'AGENT_MIGRATION_TARGET_VERIFICATION_FAILED',
      'Archived Agent paths remain active after migration',
      { paths: activeArchived }
    );
  }
}

function validPlan(plan) {
  if (!plan || plan.contract !== PLAN_CONTRACT || plan.version !== 1
    || typeof plan.migrationId !== 'string'
    || typeof plan.expectedRevision !== 'string'
    || typeof plan.nextRevision !== 'string'
    || !Array.isArray(plan.sourceFacts)
    || !Array.isArray(plan.facts)
    || !plan.summary || typeof plan.summary !== 'object') return false;
  try {
    if (revisionOfWorldFacts(plan.sourceFacts) !== plan.expectedRevision
      || revisionOfWorldFacts(plan.facts) !== plan.nextRevision
      || digest(plan.sourceFacts) !== plan.sourceFactsHash
      || digest(plan.facts) !== plan.nextFactsHash) return false;
    return plan.migrationId === migrationIdFor(plan);
  } catch {
    return false;
  }
}

function redactedBackupReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const allowed = [
    'id', 'hash', 'contract', 'version', 'migrationId', 'attemptId', 'directory',
    'sourceFile', 'copiedFile', 'sourceFileHash', 'copiedFileHash', 'sourceRevision',
    'sourceFactsHash', 'targetRevision', 'targetFactsHash', 'summary', 'receiptFile'
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(receipt, key))
    .map((key) => [key, structuredClone(receipt[key])]));
}

function normalizeCommittedProjection(error, {
  expectedCorrelationId,
  expectedBeforeRevision,
  expectedAfterRevision
}) {
  const receipt = error?.details?.receipt;
  if (error?.code !== 'WORLD_COMMITTED_PROJECTION_PENDING'
    || receipt?.contract !== 'atom.world-receipt'
    || receipt.version !== 1
    || receipt?.status !== 'committed'
    || typeof receipt.commandId !== 'string'
    || receipt.correlationId !== expectedCorrelationId
    || receipt.beforeRevision !== expectedBeforeRevision
    || receipt.afterRevision !== expectedAfterRevision) throw error;
  return Object.freeze({
    receipt,
    warning: Object.freeze({
      code: 'AGENT_MIGRATION_PROJECTION_RECOVERY_PENDING',
      projection: error.details?.projection ?? 'graph',
      cause: error.details?.cause ?? error.name
    })
  });
}

function redactedTransactionReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const allowed = [
    'contract', 'version', 'commandId', 'correlationId', 'beforeRevision',
    'afterRevision', 'status', 'committedAt'
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(receipt, key))
    .map((key) => [key, structuredClone(receipt[key])]));
}

export async function planAgentProgramMigration({
  snapshot,
  programScheduler,
  parseLegacyPersistentAtomKey
}) {
  if (!snapshot || !Array.isArray(snapshot.facts) || typeof snapshot.revision !== 'string'
    || revisionOfWorldFacts(snapshot.facts) !== snapshot.revision
    || typeof parseLegacyPersistentAtomKey !== 'function') {
    throw problem(
      'INVALID_AGENT_MIGRATION_PLAN',
      'Agent Program migration planning requires one revision-bound world snapshot'
    );
  }
  const sourceFacts = structuredClone(snapshot.facts);
  const rewritten = rewriteWorld(sourceFacts, parseLegacyPersistentAtomKey);
  assertNoRetiredAgentKeys(rewritten.facts, parseLegacyPersistentAtomKey);
  await verifyTargetSecurity({
    facts: rewritten.facts,
    programScheduler,
    upgradedPaths: rewritten.upgradedPaths,
    activeProgramAgentPaths: rewritten.activeProgramAgentPaths,
    archivedDemotedPaths: rewritten.archivedDemotedPaths
  });
  const nextRevision = revisionOfWorldFacts(rewritten.facts);
  const sourceFactsHash = digest(sourceFacts);
  const nextFactsHash = digest(rewritten.facts);
  const summary = Object.freeze(structuredClone(rewritten.summary));
  const identity = {
    expectedRevision: snapshot.revision,
    nextRevision,
    sourceFactsHash,
    nextFactsHash,
    summary
  };
  return Object.freeze({
    contract: PLAN_CONTRACT,
    version: 1,
    migrationId: migrationIdFor(identity),
    ...identity,
    sourceFacts: structuredClone(sourceFacts),
    facts: structuredClone(rewritten.facts)
  });
}

export async function applyAgentProgramMigration({
  plan,
  confirmation = false,
  backup,
  persistence,
  attemptId,
  correlationId = null
}) {
  if (confirmation !== true) {
    throw problem(
      'AGENT_MIGRATION_CONFIRMATION_REQUIRED',
      'Agent Program migration requires explicit confirmation'
    );
  }
  if (!validPlan(plan) || typeof attemptId !== 'string' || attemptId.length === 0) {
    throw problem('INVALID_AGENT_MIGRATION_PLAN', 'A valid Agent Program migration plan is required');
  }
  if (typeof backup?.create !== 'function' || typeof backup?.verify !== 'function') {
    throw problem(
      'AGENT_MIGRATION_BACKUP_REQUIRED',
      'Agent Program migration requires a verifiable private backup port'
    );
  }
  if (typeof persistence?.commit !== 'function' || typeof persistence?.rollback !== 'function') {
    throw problem(
      'AGENT_MIGRATION_TRANSACTION_REQUIRED',
      'Agent Program migration requires transactional commit and rollback ports'
    );
  }
  const transactionCorrelationId = correlationId
    ?? `${plan.migrationId}:attempt:${attemptId}`;
  const backupReceipt = await backup.create({
    migrationId: plan.migrationId,
    attemptId,
    revision: plan.expectedRevision,
    factsHash: plan.sourceFactsHash,
    targetRevision: plan.nextRevision,
    targetFactsHash: plan.nextFactsHash,
    summary: structuredClone(plan.summary),
    facts: structuredClone(plan.sourceFacts)
  });
  const verified = await backup.verify({
    receipt: backupReceipt,
    revision: plan.expectedRevision,
    factsHash: plan.sourceFactsHash
  });
  if (verified !== true) {
    throw problem(
      'AGENT_MIGRATION_BACKUP_VERIFICATION_FAILED',
      'Private Agent Program migration backup could not be verified'
    );
  }
  let receipt;
  let warnings = [];
  try {
    receipt = await persistence.commit({
      correlationId: transactionCorrelationId,
      expectedRevision: plan.expectedRevision,
      nextRevision: plan.nextRevision,
      facts: structuredClone(plan.facts),
      source: `agent-program-migration:${plan.migrationId}`
    });
  } catch (error) {
    const normalized = normalizeCommittedProjection(error, {
      expectedCorrelationId: transactionCorrelationId,
      expectedBeforeRevision: plan.expectedRevision,
      expectedAfterRevision: plan.nextRevision
    });
    receipt = normalized.receipt;
    warnings = [normalized.warning];
  }
  if (!receipt?.commandId || receipt.afterRevision !== plan.nextRevision) {
    throw problem(
      'AGENT_MIGRATION_TRANSACTION_REQUIRED',
      'Agent Program migration commit did not return a revision-bound receipt'
    );
  }
  return Object.freeze({
    contract: RECEIPT_CONTRACT,
    version: 1,
    migrationId: plan.migrationId,
    attemptId,
    sourceRevision: plan.expectedRevision,
    targetRevision: plan.nextRevision,
    summary: structuredClone(plan.summary),
    warnings,
    backup: redactedBackupReceipt(backupReceipt),
    receipt: redactedTransactionReceipt(receipt),
    rollback: Object.freeze({
      targetCommandId: receipt.commandId,
      expectedRevision: receipt.afterRevision
    })
  });
}

export async function rollbackAgentProgramMigration({
  migration,
  persistence,
  correlationId = null
}) {
  if (migration?.contract !== RECEIPT_CONTRACT || migration.version !== 1
    || typeof migration.migrationId !== 'string'
    || typeof migration.sourceRevision !== 'string'
    || typeof migration.rollback?.targetCommandId !== 'string'
    || typeof migration.rollback?.expectedRevision !== 'string') {
    throw problem(
      'INVALID_AGENT_MIGRATION_RECEIPT',
      'A durable Agent Program migration receipt is required for rollback'
    );
  }
  if (typeof persistence?.rollback !== 'function') {
    throw problem(
      'AGENT_MIGRATION_TRANSACTION_REQUIRED',
      'Agent Program migration rollback requires the transactional rollback port'
    );
  }
  const transactionCorrelationId = correlationId ?? `${migration.migrationId}:rollback`;
  let receipt;
  let warnings = [];
  try {
    receipt = await persistence.rollback({
      targetCommandId: migration.rollback.targetCommandId,
      expectedRevision: migration.rollback.expectedRevision,
      correlationId: transactionCorrelationId
    });
  } catch (error) {
    const normalized = normalizeCommittedProjection(error, {
      expectedCorrelationId: transactionCorrelationId,
      expectedBeforeRevision: migration.rollback.expectedRevision,
      expectedAfterRevision: migration.sourceRevision
    });
    receipt = normalized.receipt;
    warnings = [normalized.warning];
  }
  return Object.freeze({ ...receipt, warnings });
}
