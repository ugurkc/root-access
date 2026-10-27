// Rigs: one per job, bought once, automate the job (it loops by itself and runs while away).
// A rig needs a free rig slot; the rack class provides them (classes.mjs `rigSlots`). A slot holds
// nothing but a rig, so free slots are rigSlots − rigs bought. The module goes through jobs.mjs's
// `levelOf` / `isRigged` / `setRigged` / `runRate` and never reads `state.jobs` itself.
import { levelOf, isRigged, setRigged, runRate } from './jobs.mjs';
import { rigSlots } from './classes.mjs';

const OFFER_PREFIX = 'rig:';
const offerIdFor = (jobId) => `${OFFER_PREFIX}${jobId}`;
const jobIdOf = (offerId) => offerId.slice(OFFER_PREFIX.length);

const rigFor = (cfg, jobId) => cfg.rigs.list.find((r) => r.job === jobId);

// 0 when the classes block is off (rigSlots is 0 then and no rig can be bought).
const freeRigSlot = (state) => rigSlots(state) - state.rigs.count;

export const rigs = {
  id: 'rigs',

  init(state) {
    state.rigs = { count: 0 };
  },

  tick() {},

  // Offered while the job is unlocked (level ≥ 1), not yet rigged and a rig slot is free.
  // gainPerSec is what the job earns continuously once automated: its run rate as a rigged job
  // (at rigSpeedMult, which the job does not enjoy yet).
  offers(state, ctx) {
    const cfg = state.config;
    if (!state.jobs || freeRigSlot(state) <= 0) return [];
    const out = [];
    for (const rig of cfg.rigs.list) {
      if (levelOf(state, rig.job) < 1 || isRigged(state, rig.job)) continue;
      out.push({ id: offerIdFor(rig.job), cost: rig.cost, gainPerSec: runRate(state, cfg, rig.job, ctx, true), kind: 'rig' });
    }
    return out;
  },

  // The core only buys what offers() listed, so the unlocked/unrigged checks live there.
  // Throws when no slot is free, before the job is marked.
  buy(state, offerId) {
    const cfg = state.config;
    const jobId = jobIdOf(offerId);
    if (freeRigSlot(state) <= 0) throw new Error(`no free rig slot for ${offerId}`);
    setRigged(state, jobId, rigFor(cfg, jobId).name);
    state.rigs.count += 1;
  },

  metrics(state) {
    return { 'rigs.count': state.rigs.count, 'slots.rigFree': freeRigSlot(state) };
  },
};
