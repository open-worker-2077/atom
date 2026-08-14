const DIRECTION_ALIASES = new Map([
  ['down', 'down'],
  ['向下', 'down'],
  ['up', 'up'],
  ['向上', 'up'],
  ['vertical', 'vertical'],
  ['垂直', 'vertical'],
  ['forward', 'forward'],
  ['向前', 'forward'],
  ['backward', 'backward'],
  ['向后', 'backward'],
  ['level', 'level'],
  ['平层', 'level'],
  ['all', 'all'],
  ['全部', 'all'],
  ['全向', 'all']
]);

const MOVES = Object.freeze({
  down: ['down'],
  up: ['up'],
  vertical: ['up', 'down'],
  forward: ['forward'],
  backward: ['backward'],
  level: ['forward', 'backward'],
  all: ['up', 'down', 'forward', 'backward']
});

function hashText(value) {
  const input = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function childDomainPath(node) {
  const parent = typeof node?.path === 'string' && node.path ? node.path : 'root';
  return `${parent}/${hashText(node?.id).toString(36)}`;
}

function parentPath(domainPath) {
  if (!domainPath || domainPath === 'root') return null;
  const separator = domainPath.lastIndexOf('/');
  return separator < 0 ? 'root' : domainPath.slice(0, separator) || 'root';
}

function normalizeDirection(value) {
  const normalized = DIRECTION_ALIASES.get(String(value || 'all').toLocaleLowerCase('zh-CN'));
  if (!normalized) throw new TypeError(`Invalid probe direction: ${value}`);
  return normalized;
}

function normalizeSteps(value) {
  const normalized = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`Invalid probe steps: ${value}`);
  }
  return normalized;
}

function searchable(node) {
  return [node.label, node.detail, node.path]
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLocaleLowerCase('zh-CN');
}

function routeIdentity(route) {
  return `${route.anchor}|${route.moves.join('>')}`;
}

export function probeKnowledge(knowledge, params = {}) {
  const nodes = Array.isArray(knowledge?.nodes) ? knowledge.nodes : [];
  const revision = Math.max(0, Number(knowledge?.revision) || 0);
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const needle = query.toLocaleLowerCase('zh-CN');
  const direction = normalizeDirection(params.direction ?? params.dir);
  const steps = normalizeSteps(params.steps);
  const nodesByPath = new Map();
  const ownerByDomain = new Map();

  for (const node of nodes) {
    const domainPath = typeof node.path === 'string' && node.path ? node.path : 'root';
    if (!nodesByPath.has(domainPath)) nodesByPath.set(domainPath, []);
    nodesByPath.get(domainPath).push(node);
    ownerByDomain.set(childDomainPath(node), node);
    ownerByDomain.set(`${domainPath}/${node.id}`, node);
  }

  const childCount = (node) => (nodesByPath.get(childDomainPath(node)) || []).length;
  const decorateNode = (node) => ({ ...node, children: childCount(node) });
  const matches = needle ? nodes.filter((node) => searchable(node).includes(needle)) : [];
  const anchors = needle
    ? matches.map((node) => ({
      kind: 'node',
      key: node.key,
      path: node.path,
      domain: childDomainPath(node),
      label: node.label,
      detail: node.detail,
      children: childCount(node)
    }))
    : [{ kind: 'root', path: 'root', domain: 'root' }];

  const domains = new Map();
  const visited = new Set();

  function addDomain(state, step) {
    let block = domains.get(state.domain);
    if (!block) {
      block = {
        path: state.domain,
        step,
        routes: [],
        nodes: (nodesByPath.get(state.domain) || []).map(decorateNode)
      };
      domains.set(state.domain, block);
    } else {
      block.step = Math.min(block.step, step);
    }
    const route = { anchor: state.anchor, moves: [...state.moves] };
    const identity = routeIdentity(route);
    if (!block.routes.some((candidate) => routeIdentity(candidate) === identity)) block.routes.push(route);
  }

  function moveStates(state, move) {
    if (move === 'down') {
      return (nodesByPath.get(state.domain) || []).map((node) => ({
        domain: childDomainPath(node),
        anchor: state.anchor,
        moves: [...state.moves, 'down']
      }));
    }
    if (move === 'up') {
      const owner = ownerByDomain.get(state.domain);
      const target = owner?.path || parentPath(state.domain);
      return target ? [{ domain: target, anchor: state.anchor, moves: [...state.moves, 'up'] }] : [];
    }
    const owner = ownerByDomain.get(state.domain);
    if (!owner) return [];
    const siblings = nodesByPath.get(owner.path) || [];
    const index = siblings.findIndex((node) => node.key === owner.key);
    const offset = move === 'forward' ? 1 : -1;
    const sibling = siblings[index + offset];
    return sibling ? [{
      domain: childDomainPath(sibling),
      anchor: state.anchor,
      moves: [...state.moves, move]
    }] : [];
  }

  let frontier = anchors.map((anchor) => ({ domain: anchor.domain, anchor: anchor.key || 'root', moves: [] }));
  for (const state of frontier) {
    addDomain(state, 0);
    visited.add(state.domain);
  }

  for (let step = 1; step <= steps && frontier.length; step += 1) {
    const candidates = [];
    for (const state of frontier) {
      for (const move of MOVES[direction]) candidates.push(...moveStates(state, move));
    }
    const next = new Map();
    for (const state of candidates) {
      addDomain(state, step);
      if (!visited.has(state.domain) && !next.has(state.domain)) next.set(state.domain, state);
    }
    frontier = [...next.values()];
    for (const state of frontier) visited.add(state.domain);
  }

  const domainList = [...domains.values()];
  const uniqueNodeKeys = new Set(domainList.flatMap((domain) => domain.nodes.map((node) => node.key)));
  return {
    query,
    direction,
    steps,
    revision,
    anchors,
    domains: domainList,
    stats: {
      anchorCount: anchors.length,
      domainCount: domainList.length,
      nodeCount: uniqueNodeKeys.size
    }
  };
}
