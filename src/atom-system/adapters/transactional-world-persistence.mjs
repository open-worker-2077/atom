import crypto from 'node:crypto';
import path from 'node:path';

import { writeAtomGraphProjection } from '../../../work-engine/atom-language/context-store.mjs';
import { parseAtomKey } from '../../../work-engine/atom-language/key-parser.mjs';
import { createCommitCoordinator } from '../world-runtime/commit-coordinator.mjs';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository
} from './json-world-repository.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function commandIdFor({ correlationId, expectedRevision, nextRevision }) {
  const digest = crypto.createHash('sha256')
    .update(`${correlationId}\0${expectedRevision}\0${nextRevision}`)
    .digest('hex');
  return `legacy-${digest}`;
}

function rollbackCommandIdFor({ correlationId, expectedRevision, targetCommandId }) {
  const digest = crypto.createHash('sha256')
    .update(`${correlationId}\0${expectedRevision}\0${targetCommandId}`)
    .digest('hex');
  return `rollback-${digest}`;
}

function canonicalRevision(value) {
  return String(value).startsWith('sha256:') ? String(value) : `sha256:${value}`;
}

function agentRegistrationCount(atoms) {
  let count = 0;
  const visit = (items) => {
    for (const atom of Array.isArray(items) ? items : []) {
      for (const [key, value] of Object.entries(atom ?? {})) {
        const parsed = parseAtomKey(key, { descriptionSymbolWarnings: false });
        if (parsed.baseKey === 'name' && parsed.types.some((type) => type.raw === 'agent')) count += 1;
        if (parsed.baseKey === 'children') visit(value);
      }
    }
  };
  visit(atoms);
  return count;
}

function explicitlyChangesRegistration(source) {
  return typeof source === 'string' && /["']name\.typ\./u.test(source);
}

export function createTransactionalWorldPersistence({
  contextFile,
  projectionFile,
  journalFile = path.join(path.dirname(contextFile), 'atom.transactions.json'),
  worldId = 'primary',
  publishLegacyProjection = true,
  onAuthoritativeWrite = async () => {}
}) {
  const worldRepository = createJsonWorldRepository({ file: contextFile, worldId, initialFacts: [] });
  const journalRepository = createJsonTransactionJournal({ file: journalFile });
  const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
  let recovery = null;

  function recover() {
    recovery ??= coordinator.recover();
    return recovery;
  }

  async function commit({
    correlationId,
    expectedRevision,
    nextRevision,
    facts,
    source = 'legacy-interaction',
    registrationChange = null
  }) {
    await recover();
    const current = await worldRepository.read();
    if (
      agentRegistrationCount(facts) < agentRegistrationCount(current.facts)
      && !explicitlyChangesRegistration(source)
      && registrationChange !== 'window-recycle'
    ) {
      throw problem(
        'AGENT_REGISTRATION_LOSS',
        'Ordinary Atom updates cannot erase an existing @agent registration'
      );
    }
    const computedRevision = revisionOfWorldFacts(facts);
    const canonicalNextRevision = canonicalRevision(nextRevision);
    const canonicalExpectedRevision = canonicalRevision(expectedRevision);
    if (computedRevision !== canonicalNextRevision) {
      throw problem('INVALID_WORLD_REVISION', 'Legacy transition revision does not match its facts', {
        nextRevision,
        computedRevision
      });
    }
    const commandId = commandIdFor({
      correlationId,
      expectedRevision: canonicalExpectedRevision,
      nextRevision: canonicalNextRevision
    });
    const receipt = await coordinator.execute({
      command: {
        contract: 'atom.world-command',
        version: 1,
        commandId,
        correlationId,
        expectedRevision: canonicalExpectedRevision,
        name: 'legacy-transition',
        payload: { source }
      },
      transition: () => ({ facts: structuredClone(facts), result: { source } })
    });
    await onAuthoritativeWrite({
      operation: 'commit',
      contextFile,
      revision: receipt.afterRevision,
      receipt
    });
    if (publishLegacyProjection) {
      try {
        await writeAtomGraphProjection(projectionFile, facts, { rootName: path.basename(contextFile) });
      } catch (error) {
        throw problem(
          'WORLD_COMMITTED_PROJECTION_PENDING',
          'World transition committed, but the legacy Graph projection requires recovery',
          { receipt, projection: 'graph', cause: error.code ?? error.name }
        );
      }
    }
    return receipt;
  }

  async function rollback({ targetCommandId, correlationId, expectedRevision }) {
    await recover();
    const canonicalExpectedRevision = canonicalRevision(expectedRevision);
    const receipt = await coordinator.rollback({
      targetCommandId,
      command: {
        contract: 'atom.world-command',
        version: 1,
        commandId: rollbackCommandIdFor({
          correlationId,
          expectedRevision: canonicalExpectedRevision,
          targetCommandId
        }),
        correlationId,
        expectedRevision: canonicalExpectedRevision,
        name: 'rollback-world-command',
        payload: { targetCommandId }
      }
    });
    await onAuthoritativeWrite({
      operation: 'rollback',
      contextFile,
      revision: receipt.afterRevision,
      receipt
    });
    if (publishLegacyProjection) {
      const restored = await worldRepository.read();
      try {
        await writeAtomGraphProjection(projectionFile, restored.facts, {
          rootName: path.basename(contextFile)
        });
      } catch (error) {
        throw problem(
          'WORLD_COMMITTED_PROJECTION_PENDING',
          'World rollback committed, but the legacy Graph projection requires recovery',
          { receipt, projection: 'graph', cause: error.code ?? error.name }
        );
      }
    }
    return receipt;
  }

  return Object.freeze({ commit, recover, rollback });
}
