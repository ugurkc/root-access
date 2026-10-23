// Racks and room slots. The room has `racks.largeSlots` large tech slots and `racks.decorSlots`
// decor slots. A rack is a large item: it takes a large slot and adds `racks.holds` small slots
// (shelves). Small items and rigs sit on shelves. Nothing is ever removed.
//
// The layout of `state.racks` is private; items and rigs use only these entry points:
//   freeLarge / freeSmall / freeDecor (state, cfg)   free slots of that kind
//   takeLarge / takeSmall / takeDecor (state, cfg, what)  occupy one, recording `what`; throws when none is free
//   rackCount(state), rackCost(state, cfg)
import { passiveIncome } from './jobs.mjs';

const OFFER_ID = 'rack';

export function rackCount(state) {
  return state.racks.racks;
}

// The next rack costs cost × r^(racks already placed): 400, 20K, 1M with the preset.
export function rackCost(state, cfg) {
  return cfg.racks.cost * cfg.racks.r ** rackCount(state);
}

export function freeLarge(state, cfg) {
  return cfg.racks.largeSlots - state.racks.large.length;
}

export function freeSmall(state, cfg) {
  return rackCount(state) * cfg.racks.holds - state.racks.small.length;
}

export function freeDecor(state, cfg) {
  return cfg.racks.decorSlots - state.racks.decor.length;
}

function take(kind, free, state, cfg, what) {
  if (free(state, cfg) <= 0) throw new Error(`no free ${kind} slot for ${what}`);
  state.racks[kind].push(what);
}

export function takeLarge(state, cfg, what) {
  take('large', freeLarge, state, cfg, what);
}

export function takeSmall(state, cfg, what) {
  take('small', freeSmall, state, cfg, what);
}

export function takeDecor(state, cfg, what) {
  take('decor', freeDecor, state, cfg, what);
}

export const racks = {
  id: 'racks',

  init(state) {
    state.racks = { large: [], small: [], decor: [], racks: 0 };
  },

  tick() {},

  // A rack earns nothing by itself; it only makes room for rigs and small items. The shop ranks by
  // gainPerSec / cost, so a true 0 would never be bought. Heuristic: 1 % of the current passive
  // income plus 1 credit per second, which makes a rack the fallback once cheap job levels are gone.
  offers(state, ctx) {
    const cfg = state.config;
    if (freeLarge(state, cfg) <= 0) return [];
    const passive = state.jobs ? passiveIncome(state, cfg, ctx) : 0;
    return [{ id: OFFER_ID, cost: rackCost(state, cfg), gainPerSec: 0.01 * passive + 1, kind: 'rack' }];
  },

  buy(state) {
    takeLarge(state, state.config, OFFER_ID);
    state.racks.racks += 1;
  },

  metrics(state) {
    const cfg = state.config;
    return {
      'racks.count': rackCount(state),
      'slots.largeFree': freeLarge(state, cfg),
      'slots.smallFree': freeSmall(state, cfg),
      'slots.decorFree': freeDecor(state, cfg),
    };
  },
};
