function segments(path) {
  return typeof path === 'string' && path
    ? path.split('/').filter(Boolean)
    : [];
}

function parentPath(path) {
  const parts = segments(path);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null;
}

function depthBelow(ancestor, target) {
  if (target === ancestor) return 0;
  return target.startsWith(`${ancestor}/`)
    ? segments(target).length - segments(ancestor).length
    : null;
}

export function defaultWindowSelfLockDecision({ agentPath, targetPath, operation }) {
  const agentParent = parentPath(agentPath);
  const targetParent = parentPath(targetPath);
  const below = depthBelow(agentPath, targetPath);
  if (operation === 'write') return below !== null && below > 0;
  return targetPath === agentPath
    || (below !== null && below > 0)
    || targetPath === agentParent
    || (agentParent !== null && targetParent === agentParent);
}

function ruleMatches(rule, targetPath) {
  const start = rule.fromPath;
  if (targetPath === start) return true;
  if (rule.parent === true && targetPath === parentPath(start)) return true;
  if (rule.peers === true
    && parentPath(start) !== null
    && parentPath(targetPath) === parentPath(start)) return true;
  const below = depthBelow(start, targetPath);
  if (below === null || below === 0 || rule.descendants === undefined) return false;
  return rule.descendants === 'all' || below <= rule.descendants;
}

function validateRule(rule) {
  return rule && typeof rule === 'object' && !Array.isArray(rule)
    && Number.isInteger(rule.priority) && rule.priority > 0
    && typeof rule.fromPath === 'string' && rule.fromPath.length > 0
    && (rule.parent === undefined || typeof rule.parent === 'boolean')
    && (rule.peers === undefined || typeof rule.peers === 'boolean')
    && (rule.descendants === undefined || rule.descendants === 'all'
      || (Number.isInteger(rule.descendants) && rule.descendants >= 0))
    && (rule.currentRelative === undefined || typeof rule.currentRelative === 'boolean')
    && Object.keys(rule).every((key) => (
      ['priority', 'fromPath', 'parent', 'peers', 'descendants', 'currentRelative'].includes(key)
    ));
}

export function validateWindowSelfLock(policy) {
  if (policy == null) return null;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some((key) => !['read', 'write'].includes(key))) {
    throw Object.assign(new Error('Window self-lock accepts only read and write sides'), {
      code: 'INVALID_WINDOW_SELF_LOCK'
    });
  }
  for (const side of Object.values(policy)) {
    if (!side || typeof side !== 'object' || Array.isArray(side)
      || Object.keys(side).some((key) => !['allow', 'deny'].includes(key))) {
      throw Object.assign(new Error('Window self-lock side accepts allow and deny rule arrays'), {
        code: 'INVALID_WINDOW_SELF_LOCK'
      });
    }
    for (const effect of ['allow', 'deny']) {
      if (side[effect] !== undefined
        && (!Array.isArray(side[effect]) || side[effect].some((rule) => !validateRule(rule)))) {
        throw Object.assign(new Error('Window self-lock rules require an exact start and positive integer priority'), {
          code: 'INVALID_WINDOW_SELF_LOCK'
        });
      }
    }
  }
  return structuredClone(policy);
}

export function authorizeWindowSelfLock({ policy = null, agentPath, targetPath, operation }) {
  const side = policy?.[operation] ?? null;
  const matches = [];
  for (const effect of ['allow', 'deny']) {
    for (const rule of side?.[effect] ?? []) {
      if (ruleMatches(rule, targetPath)) matches.push({ effect, priority: rule.priority });
    }
  }
  if (matches.length === 0) {
    return defaultWindowSelfLockDecision({ agentPath, targetPath, operation });
  }
  const highest = Math.max(...matches.map((entry) => entry.priority));
  return !matches.some((entry) => entry.priority === highest && entry.effect === 'deny');
}

export function windowPolicyIsSubset({ previous, next, agentPath, targetPaths }) {
  for (const operation of ['read', 'write']) {
    for (const targetPath of targetPaths) {
      const wasAllowed = authorizeWindowSelfLock({
        policy: previous, agentPath, targetPath, operation
      });
      const nowAllowed = authorizeWindowSelfLock({
        policy: next, agentPath, targetPath, operation
      });
      if (nowAllowed && !wasAllowed) return false;
    }
  }
  return true;
}
