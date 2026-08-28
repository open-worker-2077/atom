export const GRAPH_SCHEMA_VERSION = '2.0.0';
export const GRAPH_AXES = Object.freeze(['thing', 'situation', 'contain', 'support']);
export const GRAPH_AXIS_SET = new Set(GRAPH_AXES);
export const RETIRED_GRAPH_AXES = Object.freeze({
  name: 'thing',
  detail: 'situation',
  children: 'contain',
  partners: 'support'
});
export const SUPPORT_KEYS = Object.freeze(['support']);

export function validateSupportTypes(types) {
  const names = types.map(({ name }) => name);
  if (!names.length) return null;
  return {
    code: 'INVALID_SUPPORT_KEY',
    message: 'support 不接受 @ 类型标记；推支方向必须用显式 if→then clause 表达',
    markers: names
  };
}

export { planGraphFourAxisMigration } from './graph-migration-planner.mjs';
