const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModel() {
  const sandbox = { window: {} };
  sandbox.window.window = sandbox.window;
  const file = path.join(__dirname, '..', 'spatial-work-order-registry-model.js');
  if (fs.existsSync(file)) {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window.SpatialWorkOrderRegistryModel;
}

function fixture() {
  return {
    contract: 'atom-work-order-registry',
    version: 1,
    runtimeContract: 'atom-interaction/4',
    templates: [{
      id: 'work-order', label: '工单', latest: '1', versions: [{
        version: '1', groups: ['Output', 'Step', 'Criteria'],
        actions: [{ id: 'create', label: '创建' }, { id: 'read-back', label: '回读' }],
        errors: [{ code: 'ATOM_PROGRAM_FAILED', meaning: '无效输入' }],
        commitReceipt: { contract: 'atom.world-receipt', version: 1, required: ['commandId'] }
      }]
    }]
  };
}

test('work-order Web model derives rendering data from the shared registry only', () => {
  const model = loadModel();
  assert.ok(model, 'SpatialWorkOrderRegistryModel must exist');
  assert.deepEqual(JSON.parse(JSON.stringify(model.summarize(fixture()))), {
    title: '工单 v1',
    groups: ['Output', 'Step', 'Criteria'],
    actions: [{ id: 'create', label: '创建' }, { id: 'read-back', label: '回读' }],
    errors: [{ code: 'ATOM_PROGRAM_FAILED', meaning: '无效输入' }],
    receipt: { contract: 'atom.world-receipt', version: 1, required: ['commandId'] }
  });
});

test('work-order Web model rejects stale or incomplete registry data', () => {
  const model = loadModel();
  assert.throws(() => model.summarize({ ...fixture(), version: 2 }), /registry contract/i);
  const missingActions = fixture();
  delete missingActions.templates[0].versions[0].actions;
  assert.throws(() => model.summarize(missingActions), /registry contract/i);
});
