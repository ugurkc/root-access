// Offline: bookkeeping for absences. The credits and rep earned while away come from `jobs.offline`
// (rigged jobs, capped at `offline.capHours`); this module earns nothing and only records how
// many gaps there were and how much of them the cap cut off.
export const offline = {
  id: 'offline',

  init(state) {
    state.offline = { gaps: 0, cappedCount: 0, cappedSeconds: 0 };
  },

  tick() {},

  offline(state, seconds) {
    const o = state.offline;
    o.gaps += 1;
    const cap = state.config.offline.capHours * 3600;
    if (seconds > cap) {
      o.cappedCount += 1;
      o.cappedSeconds += seconds - cap;
    }
  },

  offers() {
    return [];
  },

  buy() {},

  metrics(state) {
    const o = state.offline;
    return { 'offline.gaps': o.gaps, 'offline.cappedCount': o.cappedCount, 'offline.cappedSeconds': o.cappedSeconds };
  },
};
