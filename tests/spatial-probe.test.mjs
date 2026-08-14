import test from 'node:test';
import assert from 'node:assert/strict';

import { childDomainPath, probeKnowledge } from '../cli/lib/probe.mjs';

function node(path, id, label, detail = '') {
  return {
    id,
    key: `${path}::${id}`,
    path,
    label,
    detail,
    attachment: null,
    position: { x: 0, y: 0, z: 0 },
    radius: 0.82,
    carrier: 'tunnel',
    surfaceVisible: true,
    aliases: []
  };
}

function fixture() {
  const alpha = node('root', 'alpha', 'Alpha', 'first root carrier');
  const beta = node('root', 'beta', 'Beta', 'Alpha reference');
  const gamma = node('root', 'gamma', 'Gamma', 'third root carrier');
  const alphaPath = childDomainPath(alpha);
  const betaPath = childDomainPath(beta);
  const alphaOne = node(alphaPath, 'alpha-1', 'Alpha One', 'inside alpha');
  const alphaTwo = node(alphaPath, 'alpha-2', 'Alpha Two', 'inside alpha');
  const betaOne = node(betaPath, 'beta-1', 'Beta One', 'inside beta');
  const alphaOnePath = childDomainPath(alphaOne);
  const alphaEleven = node(alphaOnePath, 'alpha-1-1', 'Alpha Eleven', 'deep detail');
  return {
    schemaVersion: 1,
    revision: 9,
    nodes: [alpha, beta, gamma, alphaOne, alphaTwo, betaOne, alphaEleven],
    edges: [],
    view: null,
    named: { alpha, beta, gamma, alphaOne, alphaTwo, betaOne, alphaEleven }
  };
}

test('step zero without a keyword returns the root domain with details and child counts', () => {
  const knowledge = fixture();
  const result = probeKnowledge(knowledge, {});

  assert.equal(result.query, '');
  assert.equal(result.direction, 'all');
  assert.equal(result.steps, 0);
  assert.deepEqual(result.anchors, [{ kind: 'root', path: 'root', domain: 'root' }]);
  assert.deepEqual(result.domains.map((domain) => domain.path), ['root']);
  assert.deepEqual(result.domains[0].nodes.map((entry) => entry.label), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(result.domains[0].nodes[0].detail, 'first root carrier');
  assert.equal(result.domains[0].nodes[0].children, 2);
  assert.equal(result.domains[0].nodes[1].children, 1);
  assert.equal(result.domains[0].nodes[2].children, 0);
  assert.equal(result.stats.nodeCount, 3);
});

test('keyword capture returns every matching node without an arbitrary limit', () => {
  const knowledge = fixture();
  const result = probeKnowledge(knowledge, { query: 'alpha', direction: 'down', steps: 0 });

  assert.deepEqual(
    result.anchors.map((anchor) => anchor.key),
    [
      knowledge.named.alpha.key,
      knowledge.named.beta.key,
      knowledge.named.alphaOne.key,
      knowledge.named.alphaTwo.key,
      knowledge.named.alphaEleven.key
    ]
  );
  assert.deepEqual(
    new Set(result.domains.map((domain) => domain.path)),
    new Set(result.anchors.map((anchor) => anchor.domain))
  );
});

test('down traversal includes every descendant carrier domain through the requested step', () => {
  const knowledge = fixture();
  const result = probeKnowledge(knowledge, { query: 'first root', direction: 'down', steps: 2 });
  const alphaDomain = childDomainPath(knowledge.named.alpha);
  const alphaOneDomain = childDomainPath(knowledge.named.alphaOne);
  const alphaTwoDomain = childDomainPath(knowledge.named.alphaTwo);
  const alphaElevenDomain = childDomainPath(knowledge.named.alphaEleven);

  assert.deepEqual(
    result.domains.map(({ path, step }) => [path, step]),
    [
      [alphaDomain, 0],
      [alphaOneDomain, 1],
      [alphaTwoDomain, 1],
      [alphaElevenDomain, 2]
    ]
  );
  assert.deepEqual(result.domains[1].nodes.map((entry) => entry.label), ['Alpha Eleven']);
  assert.deepEqual(result.domains[2].nodes, []);
  assert.deepEqual(result.domains[3].nodes, []);
});

test('up, forward, backward, level and vertical use stable domain topology', () => {
  const knowledge = fixture();
  const betaDomain = childDomainPath(knowledge.named.beta);
  const alphaDomain = childDomainPath(knowledge.named.alpha);
  const gammaDomain = childDomainPath(knowledge.named.gamma);

  const up = probeKnowledge(knowledge, { query: 'Alpha reference', direction: 'up', steps: 1 });
  assert.deepEqual(up.domains.map(({ path, step }) => [path, step]), [[betaDomain, 0], ['root', 1]]);

  const forward = probeKnowledge(knowledge, { query: 'Alpha reference', direction: 'forward', steps: 1 });
  assert.deepEqual(forward.domains.map(({ path, step }) => [path, step]), [[betaDomain, 0], [gammaDomain, 1]]);

  const backward = probeKnowledge(knowledge, { query: 'Alpha reference', direction: 'backward', steps: 1 });
  assert.deepEqual(backward.domains.map(({ path, step }) => [path, step]), [[betaDomain, 0], [alphaDomain, 1]]);

  const level = probeKnowledge(knowledge, { query: 'Alpha reference', direction: 'level', steps: 1 });
  assert.deepEqual(level.domains.map(({ path, step }) => [path, step]), [
    [betaDomain, 0],
    [gammaDomain, 1],
    [alphaDomain, 1]
  ]);

  const vertical = probeKnowledge(knowledge, { query: 'Alpha reference', direction: 'vertical', steps: 1 });
  assert.deepEqual(vertical.domains.map(({ path, step }) => [path, step]), [
    [betaDomain, 0],
    ['root', 1],
    [childDomainPath(knowledge.named.betaOne), 1]
  ]);
});

test('all-direction traversal deduplicates domains reached by several routes', () => {
  const knowledge = fixture();
  const result = probeKnowledge(knowledge, { query: 'Alpha reference', direction: 'all', steps: 3 });
  const paths = result.domains.map((domain) => domain.path);

  assert.equal(paths.length, new Set(paths).size);
  assert.equal(result.stats.domainCount, paths.length);
  assert.equal(result.stats.nodeCount, new Set(result.domains.flatMap((domain) => domain.nodes.map((entry) => entry.key))).size);
  assert.ok(result.domains.some((domain) => domain.routes.length > 1));
});

test('invalid direction and steps are rejected explicitly', () => {
  const knowledge = fixture();
  assert.throws(() => probeKnowledge(knowledge, { direction: 'sideways' }), /direction/i);
  assert.throws(() => probeKnowledge(knowledge, { steps: -1 }), /steps/i);
});
