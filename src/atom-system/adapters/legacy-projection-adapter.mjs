import { projectAtomContext } from '../../../work-engine/atom-language/context-store.mjs';
import { projectAtomGraphToKnowledge } from '../../../work-engine/atom-language/graph-4d-projection.mjs';
import { parseAtomKey } from '../../../work-engine/atom-language/key-parser.mjs';
import { evaluateSupportClausesWithPrograms } from '../../../work-engine/atom-language/support-runtime.mjs';

function atomTypesByPath(facts) {
  const result = new Map();
  const baseKeyOf = (rawKey) => String(rawKey).match(/^[^@#$~]+/u)?.[0] ?? '';
  const visit = (atom, parentPath = '') => {
    const nameField = Object.entries(atom).find(([key]) => baseKeyOf(key) === 'thing');
    if (!nameField) return;
    const [key, name] = nameField;
    const path = parentPath ? `${parentPath}/${name}` : name;
    const types = parseAtomKey(key).types.map((type) => type.name);
    if (types.length) result.set(path, types);
    const containField = Object.entries(atom).find(([rawKey]) => baseKeyOf(rawKey) === 'contain');
    for (const child of containField?.[1] ?? []) visit(child, path);
  };
  for (const atom of facts) visit(atom);
  return result;
}

export function createLegacyProjectionProjectors(options = {}) {
  const lockState = Array.isArray(options.lockState) ? structuredClone(options.lockState) : [];
  const programScheduler = options.programScheduler ?? null;
  return Object.freeze([
    Object.freeze({
      id: 'graph',
      project: ({ facts }) => projectAtomContext(facts, {
        allowLegacySupport: Boolean(options.compatibilityManifest)
      })
    }),
    Object.freeze({
      id: 'spatial',
      async project({ facts }) {
        const graphDocument = projectAtomContext(facts, {
          allowLegacySupport: Boolean(options.compatibilityManifest)
        });
        const supportDecisions = await evaluateSupportClausesWithPrograms(graphDocument, {
          evaluateProgram: (selector) => {
            if (!programScheduler?.evaluateSupportProgram) {
              throw Object.assign(new Error('Program support endpoint requires Program runtime'), {
                code: 'SUPPORT_PROGRAM_EVALUATOR_REQUIRED'
              });
            }
            return programScheduler.evaluateSupportProgram(facts, selector);
          }
        });
        const knowledge = projectAtomGraphToKnowledge(graphDocument, {
          lockState,
          atomTypesByPath: atomTypesByPath(facts),
          supportDecisions
        });
        if (options.compatibilityMetadata?.relations?.length) {
          knowledge.legacyRelations = structuredClone(options.compatibilityMetadata.relations);
        }
        return knowledge;
      }
    })
  ]);
}
