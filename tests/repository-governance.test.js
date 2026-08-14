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
  for (const file of ['AGENTS.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/releases/v0.2.0.md']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} exists`);
  }
  assert.match(read('AGENTS.md'), /GitHub Release/);
  assert.match(read('AGENTS.md'), /npm\.cmd test/);
  assert.match(read('README.md'), /v0\.3\.0/);
  assert.match(read('CHANGELOG.md'), /\[0\.2\.0\]/);
});

test('architecture and accepted decisions are durable repository facts', () => {
  assert.match(read('docs/ARCHITECTURE.md'), /视觉交互层/);
  assert.match(read('docs/ARCHITECTURE.md'), /知识存储桥/);
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
  assert.match(read('.gitignore'), /\*\.baiduyun\.uploading\.cfg/);
});
