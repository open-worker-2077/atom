import { applyPlanSlotBodyEffect } from './slot-body-plan-runtime.mjs';

export async function applySlotBodyEffect({
  atoms,
  effect,
  sourceProgramPath = null,
  authorize = async () => ({ decision: 'allow' }),
  mutateInput = false
}) {
  return applyPlanSlotBodyEffect({
    atoms,
    effect,
    sourceProgramPath,
    authorize,
    mutateInput
  });
}

export const SLOT_BODY_CONTRACT = Object.freeze({
  function: 'slot_body',
  actions: ['seal', 'print'],
  layout: { model: '槽模', print: 'print', examples: '槽例' },
  roleVerb: '槽模角色',
  revisionVerb: '采用槽模修订'
});
