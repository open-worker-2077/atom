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

test('repository keeps durable local authority and makes GitHub collaboration optional', () => {
  for (const file of ['CONTRIBUTING.md', 'CHANGELOG.md', 'docs/releases/v0.2.0.md']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} exists`);
  }
  const contributing = read('CONTRIBUTING.md');
  const readme = read('README.md');
  assert.match(contributing, /需要 Node\.js 24 或更高版本与 Git。/);
  assert.match(contributing, /仅在使用 GitHub 远程协作时，需要已登录的 GitHub CLI。/);
  assert.match(contributing, /npm\.cmd test/);
  assert.match(readme, /批准的 Superpowers 规格定义产品合同/);
  assert.match(readme, /当前检出的代码与 Git 记录当前实现/);
  assert.match(readme, /绑定当前 revision 的新鲜验证证据定义完成/);
  assert.match(readme, /GitHub Releases 只承载已发布产物/);
  assert.match(readme, /发布产物：\[Atom v0\.3\.0\]/);
  assert.match(readme, /可选反馈与讨论：\[GitHub Issues\]/);
  assert.match(readme, /代码评审与协作：\[GitHub Pull Requests\]/);
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
  const developmentTemplate = read('.github/ISSUE_TEMPLATE/development.yml');
  const pullRequestTemplate = read('.github/pull_request_template.md');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /npm run check:development-control/);
  assert.doesNotMatch(workflow, /check:online-control/);
  assert.match(workflow, /npm test/);
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=24');
  assert.match(pullRequestTemplate, /实际渲染/);
  assert.match(developmentTemplate, /可选线索入口/);
  assert.match(developmentTemplate, /不构成 Atom 的需求、状态或完成权威/);
  assert.doesNotMatch(developmentTemplate, /label: OpenSpec/);
  assert.doesNotMatch(developmentTemplate, /专职 Session/);
  const bodyItems = developmentTemplate.match(/^  - type: [^\r\n]+(?:\r?\n(?!  - type: )[^\r\n]*)*/gm) ?? [];
  const superpowersArtifactItem = bodyItems.find((item) =>
    /^    id: superpowers_artifact\r?$/m.test(item)
  );
  assert.ok(superpowersArtifactItem, 'superpowers_artifact body item exists');
  assert.match(superpowersArtifactItem, /^  - type: input\r?$/m);
  assert.match(superpowersArtifactItem, /^    id: superpowers_artifact\r?$/m);
  assert.doesNotMatch(
    superpowersArtifactItem,
    /^    validations:\s*$[\s\S]*?^      required:/m
  );
  assert.match(pullRequestTemplate, /Superpowers 规格\/计划/);
  assert.match(pullRequestTemplate, /可选关联 Issue/);
  assert.doesNotMatch(pullRequestTemplate, /关联 Issue 保持打开/);
  assert.match(read('.github/ISSUE_TEMPLATE/bug.yml'), /复现步骤/);
  assert.match(read('.github/ISSUE_TEMPLATE/spatial-research.yml'), /视觉交互范式/);
  assert.match(read('.gitignore'), /data\/knowledge\.json/);
  assert.match(read('.gitignore'), /^runtime-data\/$/m);
  assert.match(read('.gitignore'), /^submissions\.jsonl$/m);
  assert.match(read('.gitignore'), /^atom\.transactions\.json$/m);
  assert.match(read('.gitignore'), /\*\.baiduyun\.uploading\.cfg/);
});

test('project routing uses official Superpowers without shadowing it', () => {
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true, 'AGENTS.md routes official Superpowers work');
  const instructions = read('AGENTS.md');
  assert.match(instructions, /superpowers:using-superpowers/);
  assert.match(instructions, /docs\/superpowers\/specs/);
  assert.match(instructions, /docs\/superpowers\/plans/);
  assert.match(instructions, /docs\/history\/development-control/);
  assert.match(instructions, /read-only historical evidence/);
  assert.match(instructions, /must not edit, copy, wrap, override, or shadow/);
});

test('contributor prerequisites require the supported Node.js runtime', () => {
  const contributing = read('CONTRIBUTING.md');
  assert.match(contributing, /Node\.js 24 或更高版本/);
  assert.doesNotMatch(contributing, /Node\.js 22 或更高版本/);
});
