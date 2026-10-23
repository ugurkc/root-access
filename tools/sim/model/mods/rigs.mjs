// Rigs: one per job, bought once, automate the job (it loops by itself and runs while away).
// A rig is small hardware and needs a free shelf (see racks.mjs). It goes through jobs.mjs's
// `levelOf` / `isRigged` / `setRigged` / `runRate` and never reads `state.jobs` itself.
import { levelOf, isRigged, setRigged, runRate } from './jobs.mjs';
import { freeSmall, takeSmall } from './racks.mjs';

const OFFER_PREFIX = 'rig:';
const offerIdFor = (jobId) => `${OFFER_PREFIX}${jobId}`;
const jobIdOf = (offerId) => offerId.slice(OFFER_PREFIX.length);

const rigFor = (cfg, jobId) => cfg.rigs.list.find((r) => r.job === jobId);

export const rigs = {
  id: 'rigs',

  init(state) {
    state.rigs = { count: 0 };
  },

  tick() {},

  // Offered while the job is unlocked (level ≥ 1), not yet rigged and a shelf is free.
  // gainPerSec is what the job earns continuously once automated: its run rate.
  offers(state, ctx) {
    const cfg = state.config;
    if (!state.jobs || freeSmall(state, cfg) <= 0) return [];
    const out = [];
    for (const rig of cfg.rigs.list) {
      if (levelOf(state, rig.job) < 1 || isRigged(state, rig.job)) continue;
      out.push({ id: offerIdFor(rig.job), cost: rig.cost, gainPerSec: runRate(state, cfg, rig.job, ctx), kind: 'rig' });
    }
    return out;
  },

  // takeSmall throws when no shelf is free, before the job is marked.
  buy(state, offerId) {
    const cfg = state.config;
    const jobId = jobIdOf(offerId);
    takeSmall(state, cfg, offerId);
    setRigged(state, jobId, rigFor(cfg, jobId).name);
    state.rigs.count += 1;
  },

  metrics(state) {
    return { 'rigs.count': state.rigs.count };
  },
};
