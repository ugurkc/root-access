// Loot: a completed run drops a funny, cashable piece of information with probability
// `loot.chance`, worth `loot.payRuns` runs of that job's pay at the moment of the drop. Modelled as
// the expectation, not the dice: every new run (read through jobs.mjs `runsOf`) adds
// chance × payRuns × pay to a pending pool and `chance` to an expected drop count. The pool is cashed
// on the next active tick (the player taps the card), so loot dropped while away lands at the start
// of the next session. One `loot` timeline event per whole expected drop, recorded at claim time
// through ctx.record with no cost: it is not a purchase. The loot texts (`jobs.list[i].loot`) are
// the game's; the sim never reads them.
import { runsOf, payFor } from './jobs.mjs';

export const loot = {
  id: 'loot',

  init(state, config) {
    state.loot = { pending: 0, earned: 0, drops: 0, recorded: 0, seen: {}, pendingBy: {} };
    for (const job of config.jobs.list) {
      state.loot.seen[job.id] = 0;
      state.loot.pendingBy[job.id] = 0;
    }
  },

  tick(state, dt, ctx) {
    accrue(state, ctx);
    claim(state, ctx);
  },

  offline(state, seconds, ctx) {
    accrue(state, ctx);
  },

  offers() {
    return [];
  },

  buy() {},

  metrics(state) {
    const l = state.loot;
    return { 'loot.pending': l.pending, 'loot.earned': l.earned, 'loot.drops': l.drops };
  },
};

// Price every run completed since the last look at the job's current pay and add it to the pool.
function accrue(state, ctx) {
  if (!state.jobs) return;
  const cfg = state.config;
  const l = state.loot;
  for (const job of cfg.jobs.list) {
    const runs = runsOf(state, job.id);
    const fresh = runs - l.seen[job.id];
    if (fresh <= 0) continue;
    l.seen[job.id] = runs;
    const value = fresh * cfg.loot.chance * cfg.loot.payRuns * payFor(state, cfg, job.id, ctx);
    l.pending += value;
    l.pendingBy[job.id] += value;
    l.drops += fresh * cfg.loot.chance;
  }
}

// Cash the pool. One event per whole expected drop, attributed to the job with the most pending loot.
function claim(state, ctx) {
  const l = state.loot;
  if (l.pending <= 0) return;
  const earned = l.pending;
  state.credits += earned;
  l.earned += earned;
  const top = Object.entries(l.pendingBy).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  while (l.recorded + 1 <= l.drops) {
    l.recorded += 1;
    ctx.record({ kind: 'loot', id: `loot:${top}`, earned });
  }
  l.pending = 0;
  for (const id of Object.keys(l.pendingBy)) l.pendingBy[id] = 0;
}
