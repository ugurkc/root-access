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
  // `footprint` is how many floor tiles each level occupies (see `rooms`).
  items: [
    { id: 'keyboard', name: 'Mech Keyboard', desc: 'Clackier keys, faster exploits.',
      baseCost: 10,    tap: 1,              footprint: 1 },
    { id: 'laptop',   name: 'Old Laptop',    desc: 'Runs scripts while you sleep.',
      baseCost: 50,    idle: 0.5, helperModeTap: 2, footprint: 2 },
    { id: 'monitor',  name: 'Second Monitor',desc: 'More terminals, more hacks.',
      baseCost: 250,   tap: 5,              footprint: 1 },
    { id: 'rack',     name: 'Server Rack',   desc: 'Hums in the corner. Earns.',
      baseCost: 1500,  idle: 5, helperModeTap: 15, footprint: 3 },
    { id: 'gpu',      name: 'GPU Cluster',   desc: 'Cracks hashes by the million.',
      baseCost: 8000,  tap: 30,             footprint: 3 },
    { id: 'botnet',   name: 'Botnet',        desc: 'Ten thousand machines work for you.',
      baseCost: 40000, idle: 80, helper: true, footprint: 2 },
  ],

  // ---- House --------------------------------------------------------------
  // Square rooms seen from above, drawn as diamonds. You start in the centre
  // room; buying "Expand" lights the next room in `order` ([dx, dy] from the
  // start room). Every equipment level takes `footprint` tiles, so a full
  // house gates upgrades. 9 rooms x 36 tiles = 324, minus the furniture
  // in the start room (desk, chair, bed, shelf, lamp, plants = 16 tiles).
  rooms: {
    tilesPerSide: 6,
    furnitureTiles: [
      [1, 0], [2, 0], [3, 0],          // desk along the back wall
      [0, 1], [0, 2],                  // desk return along the left wall
      [2, 1], [2, 2],                  // chair and the floor in front of it
      [4, 4], [5, 4], [4, 5], [5, 5],  // bed
      [5, 3],                          // nightstand + lamp
      [2, 5], [3, 5],                  // bookshelf
      [0, 5], [5, 0],                  // plants
    ],
    baseCost: 500,
    costGrowth: 3,                                // each room costs 3x the last
    order: [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]],
    name: 'Expand', desc: 'Knock through to the next room.',
  },

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
