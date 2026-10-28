// Classes: each class is bought once, then upgraded through its tiers.
// `state.classes.tier[id]` is 0 (not owned) … tiers.length. The tier in force is tiers[tier − 1]:
// its `value` multiplies what the class's `effect` names (pay, tapAdvance, rigSpeed, tapMoney,
// barBonus), or, for `rigSlots`, is the number of rig slots the class provides, or, for `timeCut`,
// seconds taken off every job's run time (summed, additive key), or, for `offlineCap`, multiplies the
// hours an absence keeps earning, or, for `lootChance`, is a loot drop chance per run (summed, additive
// key, added to loot.chance); `none` does nothing beyond comfort.
// A class with `start` begins at that tier (owned without a purchase). Its `comfort` adds to the room's permanent comfort.
// Room slots: a class with a `slot` kind (tech, comfort, small) is offered at its first tier only while
// a slot of that kind is free: the room's `classes.slots` plus the `slots` of every tier in force
// (the desk's tabletop spots, a room expansion), less the owned classes of that kind. A class with
// `requires` is offered only once that class is owned.
// comfortMult = 1 + roomComfort / 100, roomComfort = owned tiers' comfort + the average comfort of
// the owned classes' events (events.mjs). It scales tap money and the bar payout only, not job pay. Ownership changes only in buy(), so the owned list, the
// multiplier products and the slot count are cached there.
//
// The layout of `state.classes` is private; other modules use these, each neutral ([] or 0) when
// the block is off and `state.classes` is absent:
//   ownedClasses(state)       [{ cls, tier }]          (events)
//   totalComfort(state)       owned tiers' comfort alone
//   rigSlots(state)           rig slots the owned rack tiers provide (rigs)
//   roomSlots(state)          { kind: { cap, used } } per slot kind
// classes.mjs and events.mjs import each other; the cycle is safe only while every cross-import
// is a function declaration called at run time. classes.mjs also imports jobs.mjs and taps.mjs,
// which do not import back.
import { runningIncome, passiveIncome } from './jobs.mjs';
import { tapMoney } from './taps.mjs';
import { eventsComfort, eventComfortOf } from './events.mjs';
import { SLOT_KINDS } from '../config.mjs';

const OFFER_PREFIX = 'class:';
const EFFECT_KEY = { pay: 'payMult', tapAdvance: 'tapAdvanceMult', rigSpeed: 'rigSpeedMult', tapMoney: 'tapMult', barBonus: 'barMult', offlineCap: 'offlineMult' };

const tierAt = (cls, tier) => (tier === 0 ? null : cls.tiers[tier - 1]);
const valueAt = (cls, tier) => tierAt(cls, tier)?.value ?? 1;
const comfortAt = (cls, tier) => tierAt(cls, tier)?.comfort ?? 0;
const slotsAt = (cls, tier) => (cls.effect === 'rigSlots' ? tierAt(cls, tier)?.value ?? 0 : 0);
const cutAt = (cls, tier) => (cls.effect === 'timeCut' ? tierAt(cls, tier)?.value ?? 0 : 0);
const chanceAt = (cls, tier) => (cls.effect === 'lootChance' ? tierAt(cls, tier)?.value ?? 0 : 0);
const slotsAddedAt = (cls, tier, kind) => tierAt(cls, tier)?.slots?.[kind] ?? 0;

export function ownedClasses(state) {
  return state.classes ? state.classes.ownedList : [];
}

export function totalComfort(state) {
  return state.classes ? state.classes.comfort : 0;
}

export function rigSlots(state) {
  return state.classes ? state.classes.rigSlots : 0;
}

const emptySlots = () => Object.fromEntries(SLOT_KINDS.map((k) => [k, { cap: 0, used: 0 }]));

export function roomSlots(state) {
  return state.classes ? state.classes.roomSlots : emptySlots();
}

const freeSlot = (state, kind) => roomSlots(state)[kind].cap - roomSlots(state)[kind].used;

// A class's first tier can be bought: its slot kind (if any) has a free slot and its requirement is owned.
const placeable = (state, cls) =>
  (!cls.slot || freeSlot(state, cls.slot) > 0) && (!cls.requires || state.classes.tier[cls.requires] > 0);

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
  let timeCut = 0;
  let lootChance = 0;
  const roomSlots = emptySlots();
  for (const kind of SLOT_KINDS) roomSlots[kind].cap = cfg.classes.slots?.[kind] ?? 0;
  for (const { cls, tier } of ownedList) {
    if (cls.effect in EFFECT_KEY) mults[EFFECT_KEY[cls.effect]] *= valueAt(cls, tier);
    comfort += comfortAt(cls, tier);
    slots += slotsAt(cls, tier);
    timeCut += cutAt(cls, tier);
    lootChance += chanceAt(cls, tier);
    if (cls.slot) roomSlots[cls.slot].used += 1;
    for (const kind of SLOT_KINDS) roomSlots[kind].cap += slotsAddedAt(cls, tier, kind);
  }
  Object.assign(state.classes, { ownedList, mults, comfort, rigSlots: slots, timeCut, lootChance, roomSlots });
}

// Extra credits per second the tier `to` would add over `from` (0 = not owned), against the current
// room. Approximate, like the old items module: pay scales the running income (and the taps, a slice
// of it); comfort scales the tap and bar rates; tapMoney the tap rate; barBonus the bar payout rate;
// tapAdvance the extra work taps push into running jobs; rigSpeed the passive income. ctx.tps is 0
// outside a session, so tap-side gains, comfort included, are 0 there. A rack earns nothing itself; it gets the rack heuristic from the plan (1 % of passive
// income + 1 credit/s) so the shop buys it once cheap job levels are gone.
// A tier that adds room slots also earns the share of the best class those slots would let in:
// desk + lamp is one bundle, and the desk's gain is the lamp's gain × desk cost / bundle cost, so
// the bundle's value per credit is what the shop sees (`deep` stops that lookup recursing).
function gainOf(state, cfg, ctx, cls, from, to, deep = true) {
  return directGain(state, cfg, ctx, cls, from, to) + (deep ? slotGain(state, cfg, ctx, cls, from, to) : 0);
}

function slotGain(state, cfg, ctx, cls, from, to) {
  const kinds = SLOT_KINDS.filter((k) => slotsAddedAt(cls, to, k) > slotsAddedAt(cls, from, k));
  if (kinds.length === 0) return 0;
  const cost = cls.tiers[to - 1].cost;
  let best = 0;
  for (const other of cfg.classes.list) {
    if (other === cls || state.classes.tier[other.id] > 0 || !kinds.includes(other.slot)) continue;
    if (freeSlot(state, other.slot) > 0) continue;                      // not blocked by the slot, so not this tier's doing
    if (other.requires && state.classes.tier[other.requires] === 0) continue;
    const otherCost = other.tiers[0].cost;
    best = Math.max(best, gainOf(state, cfg, ctx, other, 0, 1, false) * cost / (cost + otherCost));
  }
  return best;
}

function directGain(state, cfg, ctx, cls, from, to) {
  const ratio = valueAt(cls, to) / valueAt(cls, from);
  const comfortNow = roomComfort(state, cfg);
  const eventGain = from === 0 ? eventComfortOf(cfg, cls) : 0;        // the event starts with the first tier
  const comfortRatio = (100 + comfortNow - comfortAt(cls, from) + comfortAt(cls, to) + eventGain) / (100 + comfortNow);
  const running = state.jobs ? runningIncome(state, cfg, ctx) : 0;
  const passive = state.jobs ? passiveIncome(state, cfg, ctx) : 0;
  const tapsOn = Boolean(state.taps);                                  // tapMoney guards state.jobs itself
  const tapRate = (tapsOn ? tapMoney(state, cfg, ctx) : 0) * ctx.tps;
  const barRate = state.bar ? tapRate * cfg.bar.bonusTaps / cfg.bar.steps * ctx.barMult : 0;   // today's payout rate
  const comfortGain = (tapRate + barRate) * (comfortRatio - 1);                    // comfort: taps and the bar only
  switch (cls.effect) {
    case 'pay': return (running + tapRate) * (ratio - 1) + comfortGain;       // tap money is a slice of running income
    case 'tapMoney': return tapRate * (ratio - 1) + comfortGain;
    case 'barBonus': return barRate * (ratio - 1) + comfortGain;
    case 'tapAdvance': return running * ctx.tps * (tapsOn ? cfg.taps.advance : 0) * ctx.tapAdvanceMult * (ratio - 1) + comfortGain;
    case 'rigSpeed': return passive * (ratio - 1) + comfortGain;
    case 'offlineCap': {                                                  // the longer night's extra, spread over a day
      const off = cfg.offline;
      const capHours = off && off.enabled !== false ? off.capHours : 0;
      return passive * capHours * ctx.offlineMult * (ratio - 1) / 24 + comfortGain;
    }
    case 'rigSlots': return 0.01 * passive + 1 + comfortGain;
    case 'timeCut': {                                                     // exact: the running income at the new cut
      const cut = { ...ctx, timeCut: ctx.timeCut - cutAt(cls, from) + cutAt(cls, to) };
      return (state.jobs ? runningIncome(state, cfg, cut) - running : 0) + comfortGain;
    }
    case 'lootChance': {                                                  // loot is payRuns × chance of every run's pay
      const lootOn = cfg.loot && cfg.loot.enabled !== false;
      return (lootOn ? running * cfg.loot.payRuns * (chanceAt(cls, to) - chanceAt(cls, from)) : 0) + comfortGain;
    }
    default: return comfortGain;
  }
}

export const classes = {
  id: 'classes',

  init(state, config) {
    state.classes = { tier: Object.fromEntries(config.classes.list.map((cls) => [cls.id, cls.start ?? 0])) };
    refresh(state, config);
  },

  tick() {},

  // Each class is offered at its next tier until the last one is owned: kind 'class' for the
  // first tier (only while it can be placed), 'tier' for the later ones.
  offers(state, ctx) {
    const cfg = state.config;
    const out = [];
    for (const cls of cfg.classes.list) {
      const tier = state.classes.tier[cls.id];
      if (tier >= cls.tiers.length) continue;
      if (tier === 0 && !placeable(state, cls)) continue;
      out.push({
        id: OFFER_PREFIX + cls.id,
        cost: cls.tiers[tier].cost,
        gainPerSec: gainOf(state, cfg, ctx, cls, tier, tier + 1),
        kind: tier === 0 ? 'class' : 'tier',
      });
    }
    return out;
  },

  // Throws when the first tier has no free slot or its requirement is missing, before the tier moves.
  buy(state, offerId) {
    const id = offerId.slice(OFFER_PREFIX.length);
    const cls = state.config.classes.list.find((c) => c.id === id);
    if (state.classes.tier[id] === 0 && !placeable(state, cls)) throw new Error(`cannot place ${offerId}`);
    state.classes.tier[id] += 1;
    refresh(state, state.config);
  },

  multipliers(state) {
    return {
      ...state.classes.mults,
      comfortMult: 1 + roomComfort(state, state.config) / 100,
      timeCut: state.classes.timeCut,
      lootChance: state.classes.lootChance,
    };
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
    for (const kind of SLOT_KINDS) {
      const s = roomSlots(state)[kind];
      out[`slots.${kind}`] = s.cap;
      out[`slots.${kind}Free`] = s.cap - s.used;
    }
    for (const cls of cfg.classes.list) out[`classes.${cls.id}.tier`] = state.classes.tier[cls.id];
    return out;
  },
};
