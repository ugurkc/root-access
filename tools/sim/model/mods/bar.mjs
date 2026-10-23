// HACK bar: every `steps` taps fill it. A full bar pays `bonusTaps` taps of money and grants a job
// speed boost for `speedDur` seconds; active boosts stack linearly (speed = 1 + speed × active).
// Expiry is judged against `state.t`, so an expired boost never scales anything, and the stack
// does not survive an absence (offline() clears it).
//
// The core collects multipliers() before ticking, so a bar filled this tick speeds up job work from
// the next tick on.
import { tapMoney } from './taps.mjs';

const activeBoosts = (state) => state.bar.boosts.filter((until) => until > state.t).length;

export function barSpeed(state, cfg) {
  return 1 + cfg.bar.speed * activeBoosts(state);
}

export const bar = {
  id: 'bar',

  init(state) {
    state.bar = { steps: 0, boosts: [], bars: 0 };
  },

  tick(state, dt, ctx) {
    const cfg = state.config;
    const b = state.bar;
    for (let i = 0; i < ctx.tapsThisTick; i++) {
      b.steps += 1;
      if (b.steps < cfg.bar.steps) continue;
      b.steps = 0;
      b.bars += 1;
      state.credits += cfg.bar.bonusTaps * tapMoney(state, cfg, ctx);
      b.boosts.push(state.t + cfg.bar.speedDur);
    }
    b.boosts = b.boosts.filter((until) => until > state.t);
  },

  offline(state) {
    state.bar.boosts = [];
  },

  multipliers(state) {
    return { speedMult: barSpeed(state, state.config) };
  },

  offers() {
    return [];
  },

  buy() {},

  metrics(state) {
    return { 'bar.bars': state.bar.bars, 'bar.activeBoosts': activeBoosts(state) };
  },
};
