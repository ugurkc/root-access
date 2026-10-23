// Decor events: every `events.min…max` seconds a placed decor item asks for attention; accepting
// adds its `event.boost` comfort for `event.dur` seconds. Modelled as a deterministic always-on
// average with no timers or randomness: each placed decor item with an event contributes
// boost × dur × acceptRate / meanInterval comfort, which items.mjs folds into comfortMult.
// `events.window` (how long an ask stays open) and `events.first` (the delay before the first ask)
// are not modelled by the average.
import { placedItems } from './items.mjs';

// Average extra comfort of one item's event; 0 without an event or when the events block is off.
export function eventComfortOf(cfg, item) {
  const ev = cfg.events;
  if (!item.event || !ev || ev.enabled === false) return 0;
  return item.event.boost * item.event.dur * ev.acceptRate / ((ev.min + ev.max) / 2);
}

export function eventsComfort(state, cfg) {
  if (!state.items) return 0;
  return placedItems(state).reduce((sum, { item }) => sum + eventComfortOf(cfg, item), 0);
}

export const events = {
  id: 'events',

  init(state) {
    state.events = {};
  },

  tick() {},

  offers() {
    return [];
  },

  buy() {},

  metrics(state) {
    return { 'events.comfortAvg': eventsComfort(state, state.config) };
  },
};
