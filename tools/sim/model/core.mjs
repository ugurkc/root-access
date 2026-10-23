// Simulation core: session schedule, module composition, buying policy, timeline and metrics.
// No mechanics live here; they plug in as modules (see registry.mjs).
import { defaultModules } from './registry.mjs';

export const VERSION = '0.1.0';

const BIG_KINDS = new Set(['rig', 'item', 'rack']);
const MAX_BUYS_PER_SHOP = 300;

// Day 1 plays `sessions.day1`; every later day plays each entry of `sessions.later`.
// `start` is wall-clock seconds since midnight of day 1.
export function sessionsFor(profile, days) {
  const out = [];
  const add = (day, s) => out.push({ day, hour: s.hour, minutes: s.minutes, tps: s.tps, start: ((day - 1) * 24 + s.hour) * 3600 });
  if (days >= 1) add(1, profile.sessions.day1);
  for (let day = 2; day <= days; day++) for (const s of profile.sessions.later) add(day, s);
  return out;
}

export function run({ config, profile, days = 7, modules = defaultModules() }) {
  const mods = modules.filter((m) => config[m.id]?.enabled !== false);
  // state.t is simulated seconds since the first session began (gaps included), not since midnight
  // of day 1, so timeline `t` and `session.start` are in different frames.
  const state = { t: 0, day: 1, credits: 0 };
  for (const m of mods) m.init(state, config);

  const timeline = [];
  const firstEvent = {};
  const summary = Array.from({ length: days }, (_, i) => ({
    day: i + 1, activeMinutes: 0, credits: 0, incomePassive: 0, offlineEarned: 0, activeEarned: 0, purchases: [],
  }));
  let activeSeconds = 0;
  const record = (event) => {
    timeline.push(event);
    if (event.kind !== 'offline' && !(event.kind in firstEvent)) firstEvent[event.kind] = activeSeconds;
  };

  let prevEnd = null;
  for (const session of sessionsFor(profile, days)) {
    const row = summary[session.day - 1];
    if (prevEnd !== null && session.start > prevEnd) {
      const gap = session.start - prevEnd;
      const ctx = buildCtx(state, mods, 0);
      const before = state.credits;
      for (const m of mods) if (m.offline) m.offline(state, gap, ctx);
      state.t += gap;
      state.day = session.day;
      const earned = state.credits - before;
      row.offlineEarned += earned;
      record({ t: state.t, day: session.day, kind: 'offline', seconds: gap, earned });
    }
    state.day = session.day;

    // Integer tick count and time derived from the tick index, so neither the count nor t drifts.
    const dt = 1 / session.tps;
    const total = session.minutes * 60;
    const ticks = Math.round(total * session.tps);
    const sessionStartT = state.t;
    const sessionStartActive = activeSeconds;
    let lastShopSecond = 0;
    for (let i = 1; i <= ticks; i++) {
      const ctx = buildCtx(state, mods, 1);
      const before = state.credits;
      for (const m of mods) m.tick(state, dt, ctx);
      row.activeEarned += state.credits - before;
      const elapsed = i * dt;
      state.t = sessionStartT + elapsed;
      activeSeconds = sessionStartActive + elapsed;
      if (Math.floor(elapsed) > lastShopSecond) {
        lastShopSecond = Math.floor(elapsed);
        shop(state, ctx, profile, mods, session.tps, record);
      }
    }
    prevEnd = session.start + total;
    row.activeMinutes += session.minutes;
    row.credits = state.credits;
    row.incomePassive = passiveIncome(state, mods);
  }

  // Days without a session keep the previous day's closing balance and income.
  for (let i = 1; i < summary.length; i++) {
    if (summary[i].activeMinutes === 0) {
      summary[i].credits = summary[i - 1].credits;
      summary[i].incomePassive = summary[i - 1].incomePassive;
    }
  }
  for (const e of timeline) if (e.kind !== 'offline') summary[e.day - 1].purchases.push(e.id);

  const metrics = {};
  for (const m of mods) Object.assign(metrics, m.metrics(state));
  for (const [kind, seconds] of Object.entries(firstEvent)) metrics[`firstEvent:${kind}`] = seconds;
  metrics.purchasesPerDay = summary.map((r) => r.purchases.length);
  metrics['credits.final'] = state.credits;
  metrics['offersLeft.final'] = allOffers(state, buildCtx(state, mods, 0), mods).length;

  return { summary, timeline, metrics, final: { credits: state.credits, state } };
}

// Multipliers of all modules multiplied together (default 1), plus tick bookkeeping.
function buildCtx(state, mods, tapsThisTick) {
  const ctx = { payMult: 1, speedMult: 1, comfortMult: 1, tapsThisTick, t: state.t };
  for (const m of mods) {
    if (!m.multipliers) continue;
    const k = m.multipliers(state) ?? {};
    ctx.payMult *= k.payMult ?? 1;
    ctx.speedMult *= k.speedMult ?? 1;
    ctx.comfortMult *= k.comfortMult ?? 1;
  }
  return ctx;
}

function allOffers(state, ctx, mods) {
  return mods.flatMap((m) => m.offers(state, ctx).map((o) => ({ ...o, module: m })));
}

function passiveIncome(state, mods) {
  return mods.reduce((sum, m) => sum + (m.metrics(state)['income.passive'] ?? 0), 0);
}

// Credits per second the player can expect: passive income plus tap earnings
// (`income.tap` is reported per tap; the session's taps per second turn it into a rate).
function effectiveIncome(state, mods, tps) {
  return mods.reduce((sum, m) => {
    const k = m.metrics(state);
    return sum + (k['income.passive'] ?? 0) + (k['income.tap'] ?? 0) * tps;
  }, 0);
}

const value = (o) => (o.cost > 0 ? o.gainPerSec / o.cost : Infinity);

// Buying policy from the profile, applied to the union of all modules' offers.
function shop(state, ctx, profile, mods, tps, record) {
  const policy = profile.policy ?? {};
  const purchase = (o) => {
    o.module.buy(state, o.id);
    record({ t: state.t, day: state.day, kind: o.kind, id: o.id, cost: o.cost });
  };

  if (policy.buyRigsWhenAffordable) {
    for (let i = 0; i < MAX_BUYS_PER_SHOP; i++) {
      const rig = allOffers(state, ctx, mods).find((o) => o.kind === 'rig' && o.cost <= state.credits);
      if (!rig) break;
      purchase(rig);
    }
  }

  for (let i = 0; i < MAX_BUYS_PER_SHOP; i++) {
    const offers = allOffers(state, ctx, mods);
    const affordable = offers.filter((o) => o.cost <= state.credits);
    if (affordable.length === 0) break;
    const best = affordable.reduce((a, b) => (value(b) > value(a) ? b : a));
    const reach = state.credits + effectiveIncome(state, mods, tps) * (policy.saveForBigWithinMinutes ?? 0) * 60;
    const big = offers.find((o) =>
      o.cost > state.credits && BIG_KINDS.has(o.kind) && o.cost <= reach &&
      value(o) > value(best) * (policy.bigValueRatio ?? 1));
    if (big) break;
    purchase(best);
  }
}
