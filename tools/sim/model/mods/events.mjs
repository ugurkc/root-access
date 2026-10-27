// Class events: every `events.min…max` seconds an owned class with an event asks for attention;
// accepting adds its `event.boost` comfort for `event.dur` seconds. Modelled as a deterministic
// always-on average with no timers or randomness: each owned class with an event contributes
// boost × dur × acceptRate / meanInterval comfort, which classes.mjs folds into comfortMult.
// `events.window` (how long an ask stays open) and `events.first` (the delay before the first ask)
// are not modelled by the average.
import { ownedClasses } from './classes.mjs';

// Average extra comfort of one class's event; 0 without an event or when the events block is off.
export function eventComfortOf(cfg, cls) {
  const ev = cfg.events;
  if (!cls.event || !ev || ev.enabled === false) return 0;
  return cls.event.boost * cls.event.dur * ev.acceptRate / ((ev.min + ev.max) / 2);
}

export function eventsComfort(state, cfg) {
  if (!state.classes) return 0;
  return ownedClasses(state).reduce((sum, { cls }) => sum + eventComfortOf(cfg, cls), 0);
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
