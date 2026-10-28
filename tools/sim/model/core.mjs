// Simulation core: session schedule, module composition, buying policy, timeline and metrics.
// No mechanics live here; they plug in as modules (see registry.mjs).
import { defaultModules } from './registry.mjs';

export const VERSION = '0.1.0';

// Purchase kinds the modules emit, in shop order: `class` is a class's first tier, `tier` a later one.
// Everything but a job level is "big": the shop saves for one (see shop()).
export const PURCHASE_KINDS = ['level', 'class', 'tier', 'rig'];
export const BIG_KINDS = new Set(['rig', 'class', 'tier']);
const MAX_BUYS_PER_SHOP = 300;

// Day 1 plays `sessions.day1`; every later day plays each entry of `sessions.later`, sorted by hour.
// `start` is wall-clock seconds since midnight of day 1.
export function sessionsFor(profile, days) {
  const out = [];
  const add = (day, s) => out.push({ day, hour: s.hour, minutes: s.minutes, tps: s.tps, start: ((day - 1) * 24 + s.hour) * 3600 });
  if (days >= 1) add(1, profile.sessions.day1);
  const later = [...profile.sessions.later].sort((a, b) => a.hour - b.hour);
  for (let day = 2; day <= days; day++) for (const s of later) add(day, s);
  return out;
}

export function run({ config, profile, days = 7, modules = defaultModules() }) {
  const mods = modules.filter((m) => config[m.id]?.enabled !== false);
  // state.t is simulated seconds since the first session began (gaps included), not since midnight
  // of day 1, so timeline `t` and `session.start` are in different frames.
  const state = { t: 0, day: 1, credits: 0, config };
  for (const m of mods) m.init(state, config, profile);

  const timeline = [];
  const firstEvent = {};
  const summary = Array.from({ length: days }, (_, i) => ({
    day: i + 1, activeMinutes: 0, credits: 0, incomePassive: 0, offlineEarned: 0, activeEarned: 0, purchases: [],
  }));
  let activeSeconds = 0;
  const shopStats = { capHits: 0 };
  // Every timeline event has t, day and kind; a purchase also has a numeric cost. The first time
  // each kind (other than offline) appears is a metric, so a module-recorded kind gets one too.
  const record = (event) => {
    timeline.push(event);
    if (event.kind !== 'offline' && !(event.kind in firstEvent)) firstEvent[event.kind] = activeSeconds;
  };

  let prevEnd = null;
  for (const session of sessionsFor(profile, days)) {
    const row = summary[session.day - 1];
    // A gap belongs to the day of the session it precedes, so events recorded during it do too.
    state.day = session.day;
    if (prevEnd !== null && session.start > prevEnd) {
      const gap = session.start - prevEnd;
      const before = state.credits;
      // Modules see the gap in registry order, each with multipliers rebuilt after the previous one,
      // so a module that resets state on absence must precede one that prices the gap.
      for (const m of mods) if (m.offline) m.offline(state, gap, buildCtx(state, mods, profile, 0, 0, record));
      state.t += gap;
      const earned = state.credits - before;
      row.offlineEarned += earned;
      record({ t: state.t, day: session.day, kind: 'offline', seconds: gap, earned });
    }

    // Integer tick count and time derived from the tick index, so neither the count nor t drifts.
    const dt = 1 / session.tps;
    const total = session.minutes * 60;
    const ticks = Math.round(total * session.tps);
    const sessionStartT = state.t;
    const sessionStartActive = activeSeconds;
    let lastShopSecond = 0;
    for (let i = 1; i <= ticks; i++) {
      const ctx = buildCtx(state, mods, profile, 1, session.tps, record);
      const before = state.credits;
      for (const m of mods) m.tick(state, dt, ctx);
      row.activeEarned += state.credits - before;
      const elapsed = i * dt;
      state.t = sessionStartT + elapsed;
      activeSeconds = sessionStartActive + elapsed;
      if (Math.floor(elapsed) > lastShopSecond) {
        lastShopSecond = Math.floor(elapsed);
        shop(state, ctx, mods, session.tps, record, shopStats);
      }
    }
    prevEnd = session.start + total;
    row.activeMinutes += session.minutes;
    row.credits = state.credits;
    row.incomePassive = passiveIncome(state, mods, buildCtx(state, mods, profile, 0, 0, record));
  }

  // Days without a session keep the previous day's closing balance and income.
  for (let i = 1; i < summary.length; i++) {
    if (summary[i].activeMinutes === 0) {
      summary[i].credits = summary[i - 1].credits;
      summary[i].incomePassive = summary[i - 1].incomePassive;
    }
  }
  // Purchases are the events with a cost; module-recorded events (loot drops) have none.
  const byKind = {};
  for (const e of timeline) {
    if (typeof e.cost !== 'number') continue;
    summary[e.day - 1].purchases.push(e.id);
    (byKind[e.kind] ??= new Array(days).fill(0))[e.day - 1]++;
  }

  const finalCtx = buildCtx(state, mods, profile, 0, 0, record);
  const metrics = {};
  for (const m of mods) Object.assign(metrics, m.metrics(state, finalCtx));
  for (const [kind, seconds] of Object.entries(firstEvent)) metrics[`firstEvent:${kind}`] = seconds;
  metrics.purchasesPerDay = summary.map((r) => r.purchases.length);
  metrics.purchasesByKindPerDay = byKind;
  metrics['credits.final'] = state.credits;
  metrics['offersLeft.final'] = allOffers(state, finalCtx, mods).length;
  metrics['shop.capHits'] = shopStats.capHits;

  return { summary, timeline, metrics, final: { credits: state.credits, state } };
}

const MULT_KEYS = ['payMult', 'speedMult', 'comfortMult', 'rigSpeedMult', 'tapMult', 'barMult', 'tapAdvanceMult', 'offlineMult'];
// Additive keys: summed across modules, default 0. timeCut is seconds taken off every job's run time;
// lootChance is added to loot.chance (storage units).
const ADD_KEYS = ['timeCut', 'lootChance'];

// Multipliers of all modules multiplied together (default 1), plus tick bookkeeping, the policy,
// the session's taps per second (`tps`, 0 while offline and in the final metrics ctx) and
// `record(event)`, which adds a timeline event stamped with the current t and day (the stamp overwrites
// any t or day in the event) so a module only passes `{ kind, id, ... }`; the core records purchases
// itself, this is for the rest.
// A non-finite multiplier would silently poison every number downstream, so it is an error here.
function buildCtx(state, mods, profile, tapsThisTick, tps, record) {
  const ctx = {
    ...Object.fromEntries(MULT_KEYS.map((k) => [k, 1])),
    ...Object.fromEntries(ADD_KEYS.map((k) => [k, 0])),
    tapsThisTick, t: state.t, policy: profile.policy, tps,
    record: (event) => record({ ...event, t: state.t, day: state.day }),
  };
  for (const m of mods) {
    if (!m.multipliers) continue;
    const k = m.multipliers(state) ?? {};
    for (const key of MULT_KEYS) {
      const v = k[key] ?? 1;
      if (!Number.isFinite(v)) throw new Error(`module ${m.id}: multipliers().${key} is ${v}`);
      ctx[key] *= v;
    }
    for (const key of ADD_KEYS) {
      const v = k[key] ?? 0;
      if (!Number.isFinite(v)) throw new Error(`module ${m.id}: multipliers().${key} is ${v}`);
      ctx[key] += v;
    }
  }
  return ctx;
}

function allOffers(state, ctx, mods) {
  return mods.flatMap((m) => m.offers(state, ctx).map((o) => ({ ...o, module: m })));
}

function passiveIncome(state, mods, ctx) {
  return mods.reduce((sum, m) => sum + (m.metrics(state, ctx)['income.passive'] ?? 0), 0);
}

// Credits per second the player can expect: passive income plus tap earnings
// (`income.tap` is reported per tap; the session's taps per second turn it into a rate).
function effectiveIncome(state, mods, ctx, tps) {
  return mods.reduce((sum, m) => {
    const k = m.metrics(state, ctx);
    return sum + (k['income.passive'] ?? 0) + (k['income.tap'] ?? 0) * tps;
  }, 0);
}

// Gain per credit spent; a non-finite ratio (NaN, zero cost) ranks below everything.
const value = (o) => {
  const v = o.gainPerSec / o.cost;
  return Number.isFinite(v) ? v : -Infinity;
};

// Buying policy from the profile, applied to the union of all modules' offers.
// The core deducts the cost; a module's buy() only applies the effect.
function shop(state, ctx, mods, tps, record, stats) {
  const policy = ctx.policy ?? {};
  const purchase = (o) => {
    state.credits -= o.cost;
    o.module.buy(state, o.id);
    record({ t: state.t, day: state.day, kind: o.kind, id: o.id, cost: o.cost });
  };

  if (policy.buyRigsWhenAffordable) {
    let i = 0;
    for (; i < MAX_BUYS_PER_SHOP; i++) {
      const rig = allOffers(state, ctx, mods).find((o) => o.kind === 'rig' && o.cost <= state.credits);
      if (!rig) break;
      purchase(rig);
    }
    if (i === MAX_BUYS_PER_SHOP) stats.capHits++;
  }

  let i = 0;
  for (; i < MAX_BUYS_PER_SHOP; i++) {
    const offers = allOffers(state, ctx, mods);
    const affordable = offers.filter((o) => o.cost <= state.credits);
    if (affordable.length === 0) break;
    const best = affordable.reduce((a, b) => (value(b) > value(a) ? b : a));
    const reach = state.credits + effectiveIncome(state, mods, ctx, tps) * (policy.saveForBigWithinMinutes ?? 0) * 60;
    const big = offers.find((o) =>
      o.cost > state.credits && BIG_KINDS.has(o.kind) && o.cost <= reach &&
      value(o) > value(best) * (policy.bigValueRatio ?? 1));
    if (big) break;
    purchase(best);
  }
  if (i === MAX_BUYS_PER_SHOP) stats.capHits++;
}
