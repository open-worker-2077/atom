export const GRAPH_SCHEMA_VERSION = '3.0.0';
export const GRAPH_AXES = Object.freeze(['thing', 'situation', 'slot', 'strut']);
export const GRAPH_AXIS_SET = new Set(GRAPH_AXES);
export const RETIRED_GRAPH_AXES = Object.freeze({
  name: 'thing',
  detail: 'situation',
  children: 'slot',
  partners: 'strut',
  contain: 'slot',
  support: 'strut'
});
export const STRUT_KEYS = Object.freeze(['strut']);

export function validateStrutTypes(types) {
  const names = types.map(({ name }) => name);
  if (!names.length) return null;
  return {
    code: 'INVALID_STRUT_KEY',
    message: 'strut 不接受 @ 类型标记；推支方向必须用显式 if→then clause 表达',
    markers: names
  };
}

export { planGraphFourAxisMigration } from './graph-migration-planner.mjs';
