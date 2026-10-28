// Taps: each HACK tap pays a share of the running jobs' income and nudges their work along.
// The desk class scales the money (ctx.tapMult), the router the nudge (ctx.tapAdvanceMult).
import { advanceRunning, runningIncome } from './jobs.mjs';

// Credits per tap: max(minMoney, rate × income of the running jobs) × comfortMult × tapMult. Comfort
// lives here (and in the bar payout, a multiple of this) and nowhere else.
export function tapMoney(state, cfg, ctx) {
  const income = state.jobs ? runningIncome(state, cfg, ctx) : 0;
  return Math.max(cfg.taps.minMoney, cfg.taps.rate * income) * ctx.comfortMult * ctx.tapMult;
}

export const taps = {
  id: 'taps',

  init(state) {
    state.taps = { count: 0 };
  },

  // Pays for this tick's taps and advances every running job by advance × tapAdvanceMult seconds
  // per tap; the jobs module, which ticks after taps, processes the completions.
  tick(state, dt, ctx) {
    const cfg = state.config;
    const n = ctx.tapsThisTick;
    if (!n) return;
    state.credits += n * tapMoney(state, cfg, ctx);
    state.taps.count += n;
    advanceRunning(state, n * cfg.taps.advance * ctx.tapAdvanceMult);
  },

  offers() {
    return [];
  },

  buy() {},

  metrics(state, ctx) {
    return { 'income.tap': tapMoney(state, state.config, ctx), 'taps.count': state.taps.count };
  },
};
