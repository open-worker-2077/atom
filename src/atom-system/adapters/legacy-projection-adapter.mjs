import { projectAtomContext } from '../../../work-engine/atom-language/context-store.mjs';
import { projectAtomGraphToKnowledge } from '../../../work-engine/atom-language/graph-4d-projection.mjs';
import { parseAtomKey } from '../../../work-engine/atom-language/key-parser.mjs';

function atomTypesByPath(facts) {
  const result = new Map();
  const visit = (atom, parentPath = '') => {
    const nameField = Object.entries(atom).find(([key]) => parseAtomKey(key).baseKey === 'name');
    if (!nameField) return;
    const [key, name] = nameField;
    const path = parentPath ? `${parentPath}/${name}` : name;
    const types = parseAtomKey(key).types.map((type) => type.name);
    if (types.length) result.set(path, types);
    for (const child of atom.children ?? []) visit(child, path);
  };
  for (const atom of facts) visit(atom);
  return result;
}

export function createLegacyProjectionProjectors(options = {}) {
  const lockState = Array.isArray(options.lockState) ? structuredClone(options.lockState) : [];
  return Object.freeze([
    Object.freeze({
      id: 'graph',
      project: ({ facts }) => projectAtomContext(facts)
    }),
    Object.freeze({
      id: 'spatial',
      project: ({ facts }) => projectAtomGraphToKnowledge(projectAtomContext(facts), {
        lockState,
        atomTypesByPath: atomTypesByPath(facts)
      })
    })
  ]);
}
