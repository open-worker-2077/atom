export const WORLD_OUTSIDE_NAME = '世界之外';
export const WORLD_OUTSIDE_TYPE = 'universe';

export function worldOutsideAtom() {
  return {
    [`name@${WORLD_OUTSIDE_TYPE}`]: WORLD_OUTSIDE_NAME,
    detail: '当前 Atom 世界之外的虚拟父级；仅用于定位世界顶层，不作为事实落盘。',
    children: [],
    partners: []
  };
}
