// Shared schema-2 fixture for the starter home tests: a small complete config and a neutral ctx.
// `base()` validates clean; tests mutate a copy. Later tasks (room, classes, jobs, loot) reuse it.

export const tier = (over = {}) => ({ name: 'Simple desk', cost: 30, value: 1.25, comfort: 2, ...over });

const tiers = (effectTiers) => effectTiers.map(([name, cost, value, comfort]) => ({ name, cost, value, comfort }));

export const base = () => ({
  schema: 2,
  taps: { enabled: true, rate: 0.25, minMoney: 1, advance: 0.25 },
  bar: { enabled: true, steps: 10, bonusTaps: 15, speed: 0.25, speedDur: 12 },
  jobs: {
    enabled: true, maxLevel: 50, milestones: [], revealAt: 0.6,
    list: [
      { id: 'wifi', name: 'Wi-Fi', time: 6, pay: 2, cost: 5, r: 1.2, rep: 3, unlock: 0, loot: ['a login'] },
      { id: 'stream', name: 'Stream', time: 15, pay: 8, cost: 40, r: 1.2, rep: 9, unlock: 25 },
    ],
  },
  rigs: { enabled: true, list: [{ job: 'wifi', name: 'Script', cost: 120 }, { job: 'stream', name: 'Bot', cost: 600 }] },
  room: { enabled: true, rigSlots: 3 },
  classes: {
    enabled: true,
    list: [
      { id: 'computer', name: 'Computer', effect: 'pay', tiers: tiers([
        ['Old laptop', 80, 1.15, 0], ['Used desktop', 350, 1.35, 0], ['Gaming PC', 1400, 1.65, 0], ['Workstation', 4500, 2.0, 0],
      ]) },
      { id: 'router', name: 'Router', effect: 'tapAdvance', tiers: tiers([
        ['ISP box', 40, 1.5, 0], ['Better router', 150, 2, 0], ['Mesh Wi-Fi', 500, 3, 0], ['Fiber line', 1200, 4, 0],
      ]) },
      { id: 'tower', name: 'Tower', effect: 'rigSpeed', tiers: tiers([['Tower Unit', 9000, 2, 0]]) },
      { id: 'desk', name: 'Desk', effect: 'tapMoney', tiers: tiers([
        ['Simple desk', 30, 1.25, 2], ['IKAE table', 180, 1.6, 5], ['Standing desk', 700, 2.0, 10],
      ]) },
      { id: 'chair', name: 'Chair', effect: 'barBonus', tiers: tiers([
        ['Kitchen chair', 25, 1.5, 2], ['Office chair', 220, 2, 5], ['Gaming chair', 600, 3, 10],
      ]) },
      { id: 'cat', name: 'Cat', effect: 'none', tiers: tiers([['Cat', 300, 1, 10]]), event: { boost: 20, dur: 30 } },
      { id: 'gf', name: 'Girlfriend', effect: 'none', tiers: tiers([['Girlfriend', 2500, 1, 20]]), event: { boost: 100, dur: 15 } },
    ],
  },
  events: { enabled: true, window: 20, first: 15, min: 60, max: 120, acceptRate: 0.7 },
  loot: { enabled: true, chance: 0.03, payRuns: 25 },
  offline: { enabled: true, capHours: 8 },
});

// A neutral ctx: every multiplier 1, no taps this tick, t = 0, no policy, events dropped.
export const ctx = () => ({
  payMult: 1, speedMult: 1, comfortMult: 1, rigSpeedMult: 1, tapMult: 1, barMult: 1, tapAdvanceMult: 1,
  tapsThisTick: 0, t: 0, tps: 0, policy: {}, record() {},
});
