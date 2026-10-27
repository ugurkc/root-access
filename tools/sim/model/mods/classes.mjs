// Classes: each class owns one room spot and is bought once, then upgraded through its tiers.
// `state.classes.tier[id]` is 0 (not owned) … tiers.length. The tier in force is tiers[tier − 1]:
// its `value` multiplies what the class's `effect` names (pay, tapAdvance, rigSpeed, tapMoney,
// barBonus), or, for `rigSlots`, is the number of rig slots the class provides; `none` does
// nothing beyond comfort. Its `comfort` adds to the room's permanent comfort.
// comfortMult = 1 + roomComfort / 100, roomComfort = owned tiers' comfort + the average comfort of
// the owned classes' events (events.mjs). Ownership changes only in buy(), so the owned list, the
// multiplier products and the slot count are cached there.
//
// The layout of `state.classes` is private; other modules use:
//   ownedClasses(state)       [{ cls, tier }]          (events)
//   totalComfort(state)       owned tiers' comfort alone
//   rigSlots(state)           rig slots the owned rack tiers provide; 0 when the block is off (rigs)
// classes.mjs and events.mjs import each other; the cycle is safe only while every cross-import
// is a function declaration called at run time. Same for taps.mjs (tapMoney).
import { runningIncome, passiveIncome } from './jobs.mjs';
import { tapMoney } from './taps.mjs';
import { eventsComfort, eventComfortOf } from './events.mjs';

const OFFER_PREFIX = 'class:';
const EFFECT_KEY = { pay: 'payMult', tapAdvance: 'tapAdvanceMult', rigSpeed: 'rigSpeedMult', tapMoney: 'tapMult', barBonus: 'barMult' };

const tierAt = (cls, tier) => (tier === 0 ? null : cls.tiers[tier - 1]);
const valueAt = (cls, tier) => tierAt(cls, tier)?.value ?? 1;
const comfortAt = (cls, tier) => tierAt(cls, tier)?.comfort ?? 0;
const slotsAt = (cls, tier) => (cls.effect === 'rigSlots' ? tierAt(cls, tier)?.value ?? 0 : 0);

export function ownedClasses(state) {
  return state.classes.ownedList;
}

export function totalComfort(state) {
  return state.classes.comfort;
}

export function rigSlots(state) {
  return state.classes ? state.classes.rigSlots : 0;
}

// Comfort the room runs at: owned tiers plus the average of the owned classes' events.
function roomComfort(state, cfg) {
  return totalComfort(state) + eventsComfort(state, cfg);
}

// Recompute the cache from `tier`; called at init and after every buy.
function refresh(state, cfg) {
  const ownedList = cfg.classes.list
    .filter((cls) => state.classes.tier[cls.id] > 0)
    .map((cls) => ({ cls, tier: state.classes.tier[cls.id] }));
  const mults = Object.fromEntries(Object.values(EFFECT_KEY).map((key) => [key, 1]));
  let comfort = 0;
  let slots = 0;
  for (const { cls, tier } of ownedList) {
    if (cls.effect in EFFECT_KEY) mults[EFFECT_KEY[cls.effect]] *= valueAt(cls, tier);
    comfort += comfortAt(cls, tier);
    slots += slotsAt(cls, tier);
  }
  Object.assign(state.classes, { ownedList, mults, comfort, rigSlots: slots });
}

// Extra credits per second the tier `to` would add over `from` (0 = not owned), against the current
// room. Approximate, like the old items module: pay and comfort scale the running income; tapMoney
// scales the tap rate; barBonus the bar payout rate; tapAdvance the extra work taps push into
// running jobs; rigSpeed the passive income. ctx.tps is 0 outside a session, so tap-side gains are
// 0 there. A rack earns nothing itself; it keeps the old racks module's heuristic (1 % of passive
// income + 1 credit/s) so the shop buys it once cheap job levels are gone.
function gainOf(state, cfg, ctx, cls, from, to) {
  const ratio = valueAt(cls, to) / valueAt(cls, from);
  const comfortNow = roomComfort(state, cfg);
  const eventGain = from === 0 ? eventComfortOf(cfg, cls) : 0;        // the event starts with the first tier
  const comfortRatio = (100 + comfortNow - comfortAt(cls, from) + comfortAt(cls, to) + eventGain) / (100 + comfortNow);
  const running = state.jobs ? runningIncome(state, cfg, ctx) : 0;
  const passive = state.jobs ? passiveIncome(state, cfg, ctx) : 0;
  const tapsOn = Boolean(state.jobs && state.taps);
  const tapRate = (tapsOn ? tapMoney(state, cfg, ctx) : 0) * ctx.tps;
  const barRate = state.bar ? tapRate * cfg.bar.bonusTaps / cfg.bar.steps : 0;
  const comfortGain = (running + tapRate) * (comfortRatio - 1);
  switch (cls.effect) {
    case 'pay': return running * (ratio - 1) + comfortGain;
    case 'tapMoney': return tapRate * (ratio - 1) + comfortGain;
    case 'barBonus': return barRate * (ratio - 1) + comfortGain;
    case 'tapAdvance': return running * ctx.tps * (tapsOn ? cfg.taps.advance : 0) * ctx.tapAdvanceMult * (ratio - 1) + comfortGain;
    case 'rigSpeed': return passive * (ratio - 1) + comfortGain;
    case 'rigSlots': return 0.01 * passive + 1 + comfortGain;
    default: return comfortGain;
  }
}

export const classes = {
  id: 'classes',

  init(state, config) {
    state.classes = { tier: Object.fromEntries(config.classes.list.map((cls) => [cls.id, 0])) };
    refresh(state, config);
  },

  tick() {},

  // Each class is offered at its next tier until the last one is owned: kind 'class' for the
  // first tier, 'tier' for the later ones.
  offers(state, ctx) {
    const cfg = state.config;
    const out = [];
    for (const cls of cfg.classes.list) {
      const tier = state.classes.tier[cls.id];
      if (tier >= cls.tiers.length) continue;
      out.push({
        id: OFFER_PREFIX + cls.id,
        cost: cls.tiers[tier].cost,
        gainPerSec: gainOf(state, cfg, ctx, cls, tier, tier + 1),
        kind: tier === 0 ? 'class' : 'tier',
      });
    }
    return out;
  },

  buy(state, offerId) {
    state.classes.tier[offerId.slice(OFFER_PREFIX.length)] += 1;
    refresh(state, state.config);
  },

  multipliers(state) {
    return { ...state.classes.mults, comfortMult: 1 + roomComfort(state, state.config) / 100 };
  },

  metrics(state) {
    const cfg = state.config;
    const owned = ownedClasses(state);
    const out = {
      'classes.owned': owned.length,
      'classes.tiers': owned.reduce((sum, { tier }) => sum + tier, 0),
      'comfort.total': totalComfort(state),
      'slots.rig': rigSlots(state),
    };
    for (const cls of cfg.classes.list) out[`classes.${cls.id}.tier`] = state.classes.tier[cls.id];
    return out;
  },
};
