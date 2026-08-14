import assert from 'node:assert/strict';
import test from 'node:test';

const architectureModuleUrl = new URL('../src/atom-system/public/architecture.mjs', import.meta.url);
const contractsModuleUrl = new URL('../src/atom-system/public/contracts.mjs', import.meta.url);

async function loadTargetArchitecture() {
  const [architecture, contracts] = await Promise.all([
    import(architectureModuleUrl),
    import(contractsModuleUrl)
  ]);
  return { ...architecture, ...contracts };
}

test('the target architecture assigns every fact to one owner and permits only declared dependencies', async () => {
  const {
    ATOM_SYSTEM_ARCHITECTURE,
    validateArchitectureManifest
  } = await loadTargetArchitecture();

  assert.deepEqual(validateArchitectureManifest(ATOM_SYSTEM_ARCHITECTURE), {
    ok: true,
    components: 6,
    facts: 7
  });

  const dependenciesByComponent = Object.fromEntries(
    ATOM_SYSTEM_ARCHITECTURE.components.map(({ id, allowedDependencies }) => [id, [...allowedDependencies]])
  );
  assert.deepEqual(dependenciesByComponent.adapters, [
    'world-kernel',
    'world-runtime',
    'projections',
    'spatial-experience'
  ]);
  assert.deepEqual(dependenciesByComponent.operations, [
    'world-runtime',
    'spatial-experience'
  ]);

  const duplicateOwner = structuredClone(ATOM_SYSTEM_ARCHITECTURE);
  duplicateOwner.components[1].owns.push(duplicateOwner.components[0].owns[0]);
  assert.throws(
    () => validateArchitectureManifest(duplicateOwner),
    (error) => error.code === 'DUPLICATE_FACT_OWNER'
  );

  const forbiddenDependency = structuredClone(ATOM_SYSTEM_ARCHITECTURE);
  forbiddenDependency.components
    .find(({ id }) => id === 'world-kernel')
    .dependsOn.push('adapters');
  assert.throws(
    () => validateArchitectureManifest(forbiddenDependency),
    (error) => error.code === 'FORBIDDEN_ARCHITECTURE_DEPENDENCY'
  );
});

test('world command and receipt contracts require versions, revisions, and correlation ids', async () => {
  const {
    validateWorldCommandEnvelope,
    validateWorldReceipt
  } = await loadTargetArchitecture();

  const command = validateWorldCommandEnvelope({
    contract: 'atom.world-command',
    version: 1,
    commandId: 'cmd-001',
    correlationId: 'interaction-001',
    expectedRevision: 'rev-7',
    name: 'transform',
    payload: { source: 'transform {}' }
  });
  assert.equal(command.expectedRevision, 'rev-7');
  assert.throws(
    () => validateWorldCommandEnvelope({ ...command, version: undefined }),
    (error) => error.code === 'INVALID_CONTRACT_VERSION'
  );
  assert.throws(
    () => validateWorldCommandEnvelope({ ...command, correlationId: '' }),
    (error) => error.code === 'INVALID_CORRELATION_ID'
  );

  const receipt = validateWorldReceipt({
    contract: 'atom.world-receipt',
    version: 1,
    commandId: command.commandId,
    correlationId: command.correlationId,
    beforeRevision: 'rev-7',
    afterRevision: 'rev-8',
    status: 'committed',
    result: {}
  });
  assert.equal(receipt.afterRevision, 'rev-8');
  assert.throws(
    () => validateWorldReceipt({ ...receipt, afterRevision: 'rev-7' }),
    (error) => error.code === 'INVALID_REVISION_TRANSITION'
  );
  assert.throws(
    () => validateWorldCommandEnvelope({ ...command, expectedRevision: 7 }),
    (error) => error.code === 'INVALID_WORLD_REVISION'
  );
});

test('world snapshots and projections are explicitly revision-labelled', async () => {
  const {
    validateWorldSnapshot,
    validateProjectionEnvelope
  } = await loadTargetArchitecture();

  const snapshot = validateWorldSnapshot({
    contract: 'atom.world-snapshot',
    version: 1,
    worldId: 'primary',
    revision: 'sha256:world-12',
    facts: []
  });
  assert.equal(snapshot.revision, 'sha256:world-12');

  const projection = validateProjectionEnvelope({
    contract: 'atom.projection',
    version: 1,
    projection: 'graph',
    worldId: snapshot.worldId,
    sourceRevision: snapshot.revision,
    value: { name: 'atom.json' }
  });
  assert.equal(projection.sourceRevision, snapshot.revision);
  assert.throws(
    () => validateProjectionEnvelope({ ...projection, sourceRevision: '' }),
    (error) => error.code === 'INVALID_WORLD_REVISION'
  );
});
