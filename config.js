// Root Access — design bench tunables.
// Every number a designer might want to change lives here. Edit, commit, push.
// The game reads this file once at load; saves are per variant combo, so
// changing numbers does not wipe anyone's progress (costs recompute from level).

window.RA_CONFIG = {
  version: 1,

  // ---- Variant axes (the tabs) ------------------------------------------
  tapModes: {
    instant: { label: 'Instant', hint: 'Every tap pays out.' },
    bar:     { label: 'Bar',     hint: 'Taps fill a job. Payout on completion.', jobTaps: 8 },
    jobs:    { label: 'Jobs',    hint: 'Tap to start a hack. Collect when done.', jobDuration: 3, jobTapEquivalent: 6 },
  },
  idleModes: {
    equipment: { label: 'Equipment', hint: 'Gear earns while you rest.' },
    helpers:   { label: 'Helpers',   hint: 'Only the Botnet earns passively.' },
    none:      { label: 'None',      hint: 'Pure clicker. No passive income.' },
  },
  defaultTap: 'instant',
  defaultIdle: 'equipment',

  // ---- Economy ------------------------------------------------------------
  baseTap: 1,                // $ per tap with nothing bought
  costGrowth: 1.15,          // price multiplier per level
  maxLevel: 25,              // per item; "bought everything" target
  offlineCapSeconds: 2 * 3600,
  offlineEfficiency: 1.0,    // 0.5 = offline earns at half rate

  // Each item has ONE job. `tap` adds $ per tap, `idle` adds $ per second.
  // In Helpers mode, items with `helperModeTap` switch to tap power and only
  // items flagged `helper` keep earning passively.
  items: [
    { id: 'keyboard', name: 'Mech Keyboard', desc: 'Clackier keys, faster exploits.',
      baseCost: 10,    tap: 1 },
    { id: 'laptop',   name: 'Old Laptop',    desc: 'Runs scripts while you sleep.',
      baseCost: 50,    idle: 0.5, helperModeTap: 2 },
    { id: 'monitor',  name: 'Second Monitor',desc: 'More terminals, more hacks.',
      baseCost: 250,   tap: 5 },
    { id: 'rack',     name: 'Server Rack',   desc: 'Hums in the corner. Earns.',
      baseCost: 1500,  idle: 5, helperModeTap: 15 },
    { id: 'gpu',      name: 'GPU Cluster',   desc: 'Cracks hashes by the million.',
      baseCost: 8000,  tap: 30 },
    { id: 'botnet',   name: 'Botnet',        desc: 'Ten thousand machines work for you.',
      baseCost: 40000, idle: 80, helper: true },
  ],

  // ---- Feel ---------------------------------------------------------------
  feel: {
    pops: true,        // floating +$ numbers
    squash: true,      // button squash on press
    shake: true,       // light screen shake on big payouts
    shakeThresholdTaps: 5, // payout >= this many taps' worth shakes the screen
    sound: true,       // synthesized clacks and cash; tester can mute
    volume: 0.4,
  },

  // ---- Display ------------------------------------------------------------
  display: {
    currency: '$',
    suffixes: ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi'],
    decimals: 1,
  },
};
