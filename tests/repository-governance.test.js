const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function findAdr(id) {
  const directory = path.join(root, 'docs', 'adr');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((file) => file.startsWith(`${id}-`));
}

test('repository exposes one GitHub-native handoff path', () => {
  for (const file of ['CONTRIBUTING.md', 'CHANGELOG.md', 'docs/releases/v0.2.0.md']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} exists`);
  }
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false, 'AGENTS.md is retired');
  assert.match(read('CONTRIBUTING.md'), /GitHub CLI/);
  assert.match(read('CONTRIBUTING.md'), /npm\.cmd test/);
  assert.match(read('README.md'), /v0\.3\.0/);
  assert.match(read('CHANGELOG.md'), /\[0\.2\.0\]/);
});

test('architecture and accepted decisions are durable repository facts', () => {
  const capabilityGraph = JSON.parse(read('docs/architecture/atom-capability-graph.json'));
  assert.equal(capabilityGraph.system.id, 'atom');
  assert.match(capabilityGraph.system.positioning, /高维事实世界/);
  assert.ok(capabilityGraph.components.some(({ id }) => id === 'world-kernel'));
  assert.ok(capabilityGraph.components.some(({ id }) => id === 'spatial-experience'));
  assert.ok(capabilityGraph.invariants.some(({ id }) => id === 'world-edit-preserves-view'));
  for (const id of ['0001', '0002', '0003']) {
    assert.equal(findAdr(id).length, 1, `ADR ${id} exists exactly once`);
  }
});

test('GitHub templates, CI and runtime-data exclusions are present', () => {
  const workflow = read('.github/workflows/test.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /npm test/);
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=24');
  assert.match(read('.github/pull_request_template.md'), /实际渲染/);
  assert.match(read('.github/ISSUE_TEMPLATE/bug.yml'), /复现步骤/);
  assert.match(read('.github/ISSUE_TEMPLATE/spatial-research.yml'), /视觉交互范式/);
  assert.match(read('.gitignore'), /data\/knowledge\.json/);
  assert.match(read('.gitignore'), /^runtime-data\/$/m);
  assert.match(read('.gitignore'), /^submissions\.jsonl$/m);
  assert.match(read('.gitignore'), /^atom\.transactions\.json$/m);
  assert.match(read('.gitignore'), /\*\.baiduyun\.uploading\.cfg/);
});
