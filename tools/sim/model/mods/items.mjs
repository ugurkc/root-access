// Items: tech and decor placed once each at level 1, then levelled up to `items.maxLevel`.
// grow(lv) = 1 + (lv − 1) × growPerLevel scales an item's effect: pay bonus (pay − 1) × grow,
// speed bonus (speed − 1) × grow, decor comfort round(comfort × grow); tech comfort is flat when
// `items.techComfortFlat`. The upgrade from level lv costs cost × r^lv.
//
// Multipliers: payMult = Π itemPay, speedMult = Π itemSpeed, comfortMult = 1 + roomComfort / 100
// where roomComfort is the placed items' comfort plus the average comfort of decor events
// (events.mjs). Placement changes only in buy(), so `state.items` caches the placed list and the
// three totals there; multipliers() and offers() read the cache.
//
// The layout of `state.items` is private; events.mjs uses `placedItems(state, cfg)`.
// items.mjs and events.mjs import each other. The cycle is safe only while every cross-import
// is a function declaration called at run time: nothing here or there may use the other
// module's bindings during module evaluation.
import { runningIncome } from './jobs.mjs';
import { freeLarge, freeSmall, freeDecor, takeLarge, takeSmall, takeDecor } from './racks.mjs';
import { eventsComfort, eventComfortOf } from './events.mjs';

const PLACE_PREFIX = 'item:';
const LEVEL_PREFIX = 'itemlv:';

const grow = (cfg, lv) => 1 + (lv - 1) * cfg.items.growPerLevel;
const bonus = (cfg, base, lv) => (base === undefined ? 1 : 1 + (base - 1) * grow(cfg, lv));

export function itemPay(cfg, item, lv) {
  return bonus(cfg, item.pay, lv);
}

export function itemSpeed(cfg, item, lv) {
  return bonus(cfg, item.speed, lv);
}

export function itemComfort(cfg, item, lv) {
  if (item.type === 'tech' && cfg.items.techComfortFlat) return item.comfort;
  return Math.round(item.comfort * grow(cfg, lv));
}

// Placed items with their level: [{ item, lv }].
export function placedItems(state) {
  return state.items.placedList;
}

// Comfort of the placed items alone.
export function totalComfort(state) {
  return state.items.comfort;
}

// Comfort the room runs at: placed items plus the average of their decor events.
export function roomComfort(state, cfg) {
  return totalComfort(state) + eventsComfort(state, cfg);
}

// Recompute the cache from `placed`; called at init and after every buy.
function refresh(state, cfg) {
  const placedList = cfg.items.list
    .filter((item) => item.id in state.items.placed)
    .map((item) => ({ item, lv: state.items.placed[item.id] }));
  let payMult = 1;
  let speedMult = 1;
  let comfort = 0;
  for (const { item, lv } of placedList) {
    payMult *= itemPay(cfg, item, lv);
    speedMult *= itemSpeed(cfg, item, lv);
    comfort += itemComfort(cfg, item, lv);
  }
  Object.assign(state.items, { placedList, payMult, speedMult, comfort });
}

const slotHelpers = (item) => {
  if (item.type === 'decor') return { free: freeDecor, take: takeDecor };
  return item.size === 'large' ? { free: freeLarge, take: takeLarge } : { free: freeSmall, take: takeSmall };
};

// Income ratio of one item going from `from` to `to` (level 0 = not placed) against the current
// room comfort: pay and speed are multiplicative, comfort enters through 1 + comfort / 100.
function effectRatio(cfg, item, from, to, comfortNow) {
  const at = (lv, f) => (lv === 0 ? 1 : f(cfg, item, lv));
  const comfortAt = (lv) => (lv === 0 ? 0 : itemComfort(cfg, item, lv) + eventComfortOf(cfg, item));
  const comfortRatio = (100 + comfortNow - comfortAt(from) + comfortAt(to)) / (100 + comfortNow);
  return at(to, itemPay) / at(from, itemPay) * at(to, itemSpeed) / at(from, itemSpeed) * comfortRatio;
}

export const items = {
  id: 'items',

  init(state, config) {
    state.items = { placed: {} };
    refresh(state, config);
  },

  tick() {},

  // gainPerSec is the extra income the item's multipliers would add to the jobs now running
  // (`runningIncome` already includes the current ctx). An approximation: it ignores the tap
  // share and that comfort also scales taps, and a rigged job's income counts only while it runs.
  offers(state, ctx) {
    const cfg = state.config;
    const base = state.jobs ? runningIncome(state, cfg, ctx) : 0;
    const comfortNow = roomComfort(state, cfg);
    const out = [];
    for (const item of cfg.items.list) {
      const lv = state.items.placed[item.id] ?? 0;
      if (lv === 0) {
        if (slotHelpers(item).free(state, cfg) <= 0) continue;
        const gain = base * (effectRatio(cfg, item, 0, 1, comfortNow) - 1);
        out.push({ id: PLACE_PREFIX + item.id, cost: item.cost, gainPerSec: gain, kind: 'item' });
      } else if (lv < cfg.items.maxLevel) {
        const gain = base * (effectRatio(cfg, item, lv, lv + 1, comfortNow) - 1);
        out.push({ id: LEVEL_PREFIX + item.id, cost: item.cost * cfg.items.r ** lv, gainPerSec: gain, kind: 'itemLevel' });
      }
    }
    return out;
  },

  // Placing takes the slot first, so a missing slot throws before anything is recorded.
  buy(state, offerId) {
    const cfg = state.config;
    if (offerId.startsWith(PLACE_PREFIX)) {
      const id = offerId.slice(PLACE_PREFIX.length);
      slotHelpers(cfg.items.list.find((i) => i.id === id)).take(state, cfg, offerId);
      state.items.placed[id] = 1;
    } else {
      state.items.placed[offerId.slice(LEVEL_PREFIX.length)] += 1;
    }
    refresh(state, cfg);
  },

  multipliers(state) {
    const { payMult, speedMult } = state.items;
    return { payMult, speedMult, comfortMult: 1 + roomComfort(state, state.config) / 100 };
  },

  metrics(state) {
    const cfg = state.config;
    const placed = placedItems(state);
    const out = {
      'items.placed': placed.length,
      'items.levels': placed.reduce((sum, { lv }) => sum + lv, 0),
      'comfort.total': totalComfort(state),
    };
    for (const item of cfg.items.list) out[`items.${item.id}.level`] = state.items.placed[item.id] ?? 0;
    return out;
  },
};
