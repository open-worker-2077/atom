const WORLD_OUTSIDE_NAME = '世界之外';
const TRANSFORM_MARKER = /\.(?:rep|sum|typ|ren|lnk|mov|cpy|add|dsc|rst|run)\./u;

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function spatialChildPath(node) {
  let hash = 2166136261;
  for (const character of String(node?.id || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${node?.path || 'root'}/${(hash >>> 0).toString(36)}`;
}

function quoted(value) {
  return JSON.stringify(String(value));
}

function field(key, value) {
  return `${quoted(key)}:${JSON.stringify(value)}`;
}

function bare(key) {
  return quoted(key);
}

function transform(fields) {
  return `transform {${fields.join(',')}}`;
}

function atomName(path) {
  return path.split('/').at(-1) || '';
}

function commandParameter(value) {
  const parameter = String(value);
  if (TRANSFORM_MARKER.test(parameter)) {
    throw problem(
      'WEB_COMMAND_PARAMETER_UNREPRESENTABLE',
      'Atom CLI command parameters cannot contain a complete transform command marker'
    );
  }
  return parameter;
}

function frozenCommand(source, operationKind, affectedAtomPaths) {
  return Object.freeze({
    source,
    operationKind,
    affectedAtomPaths: Object.freeze([...new Set(affectedAtomPaths)])
  });
}

export function createBrowserCommandMapper() {
  let atomPathByKey = new Map();
  let atomPathByContainer = new Map([['root', '']]);
  let loadedAtomPaths = new Set();

  function unresolved() {
    throw problem('WEB_COMMAND_TARGET_UNRESOLVED', 'Web command target is not loaded in the authoritative Atom projection');
  }

  function resolveNode(primary, fallback = null) {
    const candidates = [primary, fallback].filter((value) => value && typeof value === 'object');
    const explicitPaths = [...new Set(candidates.map((candidate) => text(candidate.atomPath)).filter(Boolean))];
    if (explicitPaths.some((path) => !loadedAtomPaths.has(path)) || explicitPaths.length > 1) return unresolved();
    const keyedPaths = [...new Set(candidates.map((candidate) => atomPathByKey.get(text(candidate.key))).filter(Boolean))];
    if (keyedPaths.length > 1 || (explicitPaths[0] && keyedPaths[0] && explicitPaths[0] !== keyedPaths[0])) {
      return unresolved();
    }
    if (explicitPaths[0]) return explicitPaths[0];
    if (keyedPaths[0]) return keyedPaths[0];
    return unresolved();
  }

  function resolveContainer(target) {
    const spatialPath = text(target?.path ?? target);
    if (atomPathByContainer.has(spatialPath)) return atomPathByContainer.get(spatialPath);
    return unresolved();
  }

  function nodeEdit(operation) {
    const sourcePath = resolveNode(operation.node, operation.sourceNode);
    if (operation.status === 'delete') {
      return frozenCommand(transform([field('thing.dsc.', sourcePath)]), operation.kind, [sourcePath]);
    }
    const draft = operation.draft && typeof operation.draft === 'object' ? operation.draft : {};
    const label = String(draft.label ?? '').trim();
    const atomTypes = Array.isArray(draft.atomTypes) ? draft.atomTypes : [];
    const shortcut = atomTypes.includes('shortcut') || operation.node?.atomTypes?.includes('shortcut');
    if (shortcut) {
      const targetPath = text(draft.shortcutTargetPath);
      if (!targetPath) return unresolved();
      const resolvedTargetPath = resolveNode({ atomPath: targetPath });
      const command = `thing${label === atomName(sourcePath) ? '' : `.ren.${commandParameter(label)}`}.lnk.${commandParameter(resolvedTargetPath)}`;
      return frozenCommand(transform([field(command, sourcePath)]), operation.kind, [sourcePath, targetPath]);
    }
    const type = operation.atomTypesChanged === true ? String(atomTypes[0] ?? '').trim() : '';
    const command = `thing${operation.atomTypesChanged === true ? `.typ.${commandParameter(type)}` : ''}${label === atomName(sourcePath) ? '' : `.ren.${commandParameter(label)}`}`;
    const description = String(draft.description ?? draft.detail ?? '');
    return frozenCommand(transform([
      field(command, sourcePath),
      bare(`situation.rep.${description}`)
    ]), operation.kind, [sourcePath]);
  }

  function nodeCreate(operation) {
    const parentPath = resolveContainer(operation.path);
    const draft = operation.draft && typeof operation.draft === 'object' ? operation.draft : {};
    const label = String(draft.label ?? '').trim();
    const type = String(Array.isArray(draft.atomTypes) ? draft.atomTypes[0] ?? '' : '').trim();
    const thing = parentPath ? `${parentPath}/${label}` : label;
    const source = `transform new ${JSON.stringify({
      [`thing${type ? `@${commandParameter(type)}` : ''}`]: thing,
      situation: String(draft.description ?? draft.detail ?? ''),
      slot: [],
      strut: []
    })}`;
    return frozenCommand(source, operation.kind, [thing]);
  }

  function landing(operation) {
    const sourcePath = resolveNode(operation.source, operation.sourceNode ?? operation.draft);
    const destinationPath = resolveContainer(operation.target);
    const destination = commandParameter(destinationPath || WORLD_OUTSIDE_NAME);
    return {
      sourcePath,
      destinationPath,
      field: field(`thing.mov.${destination}`, sourcePath)
    };
  }

  function compile(operation) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw problem('WEB_COMMAND_OPERATION_INVALID', 'Web command operation must be an object');
    }
    switch (operation.kind) {
      case 'node-create':
        return nodeCreate(operation);
      case 'node-edit':
        return nodeEdit(operation);
      case 'node-land': {
        const command = landing(operation);
        return frozenCommand(transform([command.field]), operation.kind, [command.sourcePath, command.destinationPath]);
      }
      case 'node-land-batch': {
        const landings = Array.isArray(operation.landings) ? operation.landings.map(landing) : [];
        if (!landings.length) throw problem('WEB_COMMAND_OPERATION_INVALID', 'Batch landing requires at least one loaded source');
        return frozenCommand(
          `transform [${landings.map((entry) => `{${entry.field}}`).join(',')}]`,
          operation.kind,
          landings.flatMap(({ sourcePath, destinationPath }) => [sourcePath, destinationPath])
        );
      }
      case 'edge-create': {
        const sourcePath = resolveNode(operation.source);
        const targetPath = resolveNode(operation.target);
        return frozenCommand(transform([
          field('thing', sourcePath),
          field('strut.add.', { thing: targetPath })
        ]), operation.kind, [sourcePath, targetPath]);
      }
      case 'edge-edit': {
        if (operation.status !== 'delete') {
          throw problem('WEB_COMMAND_OPERATION_UNSUPPORTED', 'Atom strut relations only support deletion from this Web operation');
        }
        const sourcePath = resolveNode(operation.edge?.from);
        const targetPath = resolveNode(operation.edge?.to);
        return frozenCommand(transform([
          field('thing', sourcePath),
          field('strut.dsc.', { thing: targetPath })
        ]), operation.kind, [sourcePath, targetPath]);
      }
      default:
        throw problem('WEB_COMMAND_OPERATION_UNSUPPORTED', `Unsupported Web command operation: ${String(operation.kind)}`);
    }
  }

  return Object.freeze({
    replaceKnowledge(knowledge) {
      const nextByKey = new Map();
      const nextByContainer = new Map([['root', '']]);
      const nextLoadedPaths = new Set();
      const nodes = Array.isArray(knowledge?.nodes) ? knowledge.nodes : [];
      for (const node of nodes) {
        const atomPath = text(node?.atomPath);
        if (!atomPath) continue;
        nextLoadedPaths.add(atomPath);
        const key = text(node?.key);
        if (key) nextByKey.set(key, atomPath);
        nextByContainer.set(spatialChildPath(node), atomPath);
      }
      atomPathByKey = nextByKey;
      atomPathByContainer = nextByContainer;
      loadedAtomPaths = nextLoadedPaths;
    },
    compile
  });
}
