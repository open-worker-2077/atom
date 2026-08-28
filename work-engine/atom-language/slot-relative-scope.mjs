import {
  atomName,
  childrenOf,
  instanceRevisionOf,
  resolveUnique
} from './slot-graph-semantics.mjs';

function scopeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

export function parseSlotRelativeSelector(selector) {
  if (selector === '.') return [];
  if (typeof selector !== 'string' || !selector.startsWith('./')) return null;
  const parts = selector.slice(2).split('/');
  if (parts.length === 0 || parts.some((part) => (
    !part || part === '.' || part === '..' || part.includes('\\')
  ))) {
    throw scopeError('SLOT_RELATIVE_SELECTOR_REQUIRED', '相对槽选择器必须是 . 或 ./段[/段]', {
      selector
    });
  }
  return parts;
}

export function resolveSlotRelativeSelector({ atoms, selector, scopeRoot }) {
  const parts = parseSlotRelativeSelector(selector);
  if (parts == null) {
    if (scopeRoot) {
      throw scopeError(
        'SLOT_RELATIVE_SELECTOR_REQUIRED',
        '已绑定当前槽例域的 Program 只能使用 . 或 ./… 访问槽数据',
        { selector, scope_root: scopeRoot }
      );
    }
    return { selector, scopeRoot: null, relative: false };
  }
  if (!scopeRoot) {
    throw scopeError('SLOT_SCOPE_ROOT_UNBOUND', '相对槽选择器缺少当前域 scope_root', { selector });
  }
  const selected = resolveUnique(atoms, scopeRoot);
  if (selected.error) {
    throw scopeError('SLOT_SCOPE_ROOT_UNBOUND', 'scope_root 不能解析为唯一候选槽模或槽例', {
      selector,
      scope_root: scopeRoot,
      cause: selected.error.code
    });
  }
  let current = selected.match.atom;
  const path = [...selected.match.path];
  for (const [index, segment] of parts.entries()) {
    if (index > 0 && instanceRevisionOf(current)) {
      throw scopeError('SLOT_SCOPE_BOUNDARY_CROSSING', '相对槽选择器不能穿透嵌套槽体实例域', {
        selector,
        scope_root: scopeRoot,
        boundary: path.join('/')
      });
    }
    const matches = (childrenOf(current) ?? []).filter((child) => atomName(child) === segment);
    if (matches.length === 0) {
      throw scopeError('SLOT_RELATIVE_TARGET_NOT_FOUND', `当前域内找不到相对槽：${selector}`, {
        selector,
        scope_root: scopeRoot,
        parent: path.join('/'),
        segment
      });
    }
    if (matches.length > 1) {
      throw scopeError('SLOT_RELATIVE_TARGET_AMBIGUOUS', `当前域内相对槽不唯一：${selector}`, {
        selector,
        scope_root: scopeRoot,
        candidates: matches.map(() => [...path, segment].join('/'))
      });
    }
    current = matches[0];
    path.push(segment);
  }
  return { selector: path.join('/'), scopeRoot, relative: true, relativeSelector: selector };
}

export function normalizeScopedTransformRequest({ atoms, request, scopeRoot }) {
  if (!scopeRoot) return structuredClone(request);
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw scopeError('INVALID_PROGRAM_TRANSFORM', 'transform() requires one JSON object');
  }
  const normalized = structuredClone(request);
  if (typeof normalized.thing !== 'string') {
    throw scopeError('SLOT_RELATIVE_SELECTOR_REQUIRED', '相对域 Transform 必须以 thing:. 或 thing:./… 选择槽', {
      scope_root: scopeRoot
    });
  }
  const resolved = resolveSlotRelativeSelector({ atoms, selector: normalized.thing, scopeRoot });
  normalized.thing = resolved.selector;
  return normalized;
}
