// Config schema and validator for the balance simulator.
// A shape is num | pos | atLeast(n) | nonNegInt | prob | bool | str | enumOf([...]) | list(shape) | record(required, optional).
// `pos` is a finite number > 0: durations, prices and growth factors that would divide by or loop on zero.
// `atLeast(n)` is a finite number ≥ n: multipliers (≥ 1) and amounts that may be zero but not negative.
// `nonNegInt` is an integer ≥ 0: slot counts (`rigs.slots`, `classes.slots`, a tier's `slots`).
// `prob` is a finite number in [0, 1]: chances rolled per run.
// Blocks: schema, taps, bar, jobs, rigs, classes, events, loot, offline. Rig slots are `rigs.slots` plus
// any class with effect `rigSlots` (a purchasable rack), whose tier values are slot counts.
// Room slots: `classes.slots` is the room's base count per kind (tech, comfort, small); a class with a
// `slot` kind takes one of them when its first tier is bought, and a tier's `slots` adds to the counts
// while that tier is in force (a desk's tabletop spots, a room expansion).

export const SCHEMA = 2;

export const num = 'number';
export const pos = { kind: 'pos' };
export const atLeast = (min) => ({ kind: 'atLeast', min });
export const nonNegInt = { kind: 'nonNegInt' };
export const prob = { kind: 'prob' };
export const bool = 'boolean';
export const str = 'string';
export const enumOf = (values) => ({ kind: 'enum', values });
export const list = (of) => ({ kind: 'list', of });
export const record = (keys, optional = {}) => ({ kind: 'record', keys, optional });

// Class effects. The multiplier effects' tier values are ≥ 1; `rigSlots` values are whole slot counts;
// `lootChance` values are a loot drop chance per run (0…1), summed over the owned classes and added to
// `loot.chance`; `none` does nothing beyond comfort (and slots).
export const EFFECTS = ['pay', 'tapAdvance', 'rigSpeed', 'tapMoney', 'barBonus', 'rigSlots', 'timeCut', 'offlineCap', 'lootChance', 'none'];
export const SLOT_KINDS = ['tech', 'comfort', 'small'];
const SLOTS = record({}, Object.fromEntries(SLOT_KINDS.map((k) => [k, nonNegInt])));

// Every block is required: a block switched off with `enabled: false` must still be complete.
export const SHAPES = {
  schema: num,
  taps: record({ enabled: bool, rate: pos, minMoney: num, advance: pos }),
  bar: record({ enabled: bool, steps: pos, bonusTaps: pos, speed: num, speedDur: pos }),
  jobs: record({
    enabled: bool, maxLevel: num, milestones: list(num), revealAt: num,
    list: list(record(
      { id: str, name: str, time: pos, pay: pos, cost: pos, r: pos, rep: num, unlock: num },
      { loot: list(str) },
    )),
  }, { levelGain: atLeast(0) }),   // a level adds levelGain × base pay; absent = 1 (pay × level)
  rigs: record({ enabled: bool, list: list(record({ job: str, name: str, cost: pos })) },
    { speed: pos,                   // a rig runs its job at this fraction of hand speed; absent = 1
      slots: nonNegInt }),          // rig slots the room has without a rack; absent = 0
  classes: record({
    enabled: bool,
    list: list(record(
      { id: str, name: str, effect: enumOf(EFFECTS),
        tiers: list(record({ name: str, cost: pos, value: atLeast(0), comfort: atLeast(0) }, { slots: SLOTS })) },
      { event: record({ boost: atLeast(0), dur: atLeast(0) }),
        start: atLeast(0),             // tiers owned from the start (the first `start` tiers are never bought)
        slot: enumOf(SLOT_KINDS),      // the room slot the class takes when first bought; absent = none
        requires: str },               // a class id that must be owned before this one is offered
    )),
  }, { slots: SLOTS }),               // the room's base slot counts; absent = none of each kind
  events: record({ enabled: bool, window: num, first: num, min: num, max: num, acceptRate: num }),
  loot: record({ enabled: bool, chance: prob, payRuns: atLeast(0) }),
  offline: record({ enabled: bool, capHours: pos }),
};

export const BLOCKS = Object.keys(SHAPES);

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const describe = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return typeof v;
};
const join = (path, key) => (path ? `${path}.${key}` : key);
const clean = (errs, prefix) => errs.every((e) => !e.path.startsWith(prefix));

function check(value, shape, path, errs) {
  const fail = (message) => errs.push({ path, message });
  if (typeof shape === 'string') {
    const ok = typeof value === shape && (shape !== num || Number.isFinite(value));
    if (!ok) fail(`expected ${shape}, got ${describe(value)}`);
    return;
  }
  const shown = typeof value === 'number' ? value : describe(value);
  if (shape.kind === 'pos') {
    if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) fail(`expected positive number, got ${shown}`);
    return;
  }
  if (shape.kind === 'atLeast') {
    if (!(typeof value === 'number' && Number.isFinite(value) && value >= shape.min)) fail(`expected number ≥ ${shape.min}, got ${shown}`);
    return;
  }
  if (shape.kind === 'nonNegInt') {
    if (!(Number.isInteger(value) && value >= 0)) fail(`expected non-negative integer, got ${shown}`);
    return;
  }
  if (shape.kind === 'prob') {
    if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) fail(`expected number between 0 and 1, got ${shown}`);
    return;
  }
  if (shape.kind === 'enum') {
    if (!shape.values.includes(value)) fail(`expected one of ${shape.values.join(', ')}, got ${JSON.stringify(value)}`);
    return;
  }
  if (shape.kind === 'list') {
    if (!Array.isArray(value)) fail(`expected array, got ${describe(value)}`);
    else value.forEach((item, i) => check(item, shape.of, `${path}[${i}]`, errs));
    return;
  }
  if (!isRecord(value)) {
    fail(`expected object, got ${describe(value)}`);
    return;
  }
  for (const [key, keyShape] of Object.entries(shape.keys)) {
    if (key in value) check(value[key], keyShape, join(path, key), errs);
    else errs.push({ path: join(path, key), message: 'missing required key' });
  }
  for (const [key, keyShape] of Object.entries(shape.optional)) {
    if (key in value) check(value[key], keyShape, join(path, key), errs);
  }
  for (const key of Object.keys(value)) {
    if (!(key in shape.keys) && !(key in shape.optional)) errs.push({ path: join(path, key), message: 'unknown key' });
  }
}

function checkSchema(cfg, errs) {
  if (clean(errs, 'schema') && cfg.schema !== SCHEMA) {
    errs.push({ path: 'schema', message: `unsupported schema ${cfg.schema}, expected ${SCHEMA}` });
  }
}

function checkDuplicateIds(cfg, block, errs) {
  if (!Array.isArray(cfg[block]?.list)) return;
  const seen = new Set();
  cfg[block].list.forEach((entry, i) => {
    const id = entry?.id;
    if (typeof id !== 'string') return;
    if (seen.has(id)) errs.push({ path: `${block}.list[${i}].id`, message: `duplicate id ${JSON.stringify(id)}` });
    seen.add(id);
  });
}

function checkRigJobs(cfg, errs) {
  if (!clean(errs, 'jobs.list') || !clean(errs, 'rigs.list')) return;
  if (!Array.isArray(cfg.jobs?.list) || !Array.isArray(cfg.rigs?.list)) return;
  const jobIds = new Set(cfg.jobs.list.map((job) => job.id));
  cfg.rigs.list.forEach((rig, i) => {
    if (typeof rig.job === 'string' && !jobIds.has(rig.job)) {
      errs.push({ path: `rigs.list[${i}].job`, message: `unknown job id ${JSON.stringify(rig.job)}` });
    }
  });
}

// The mean interval (min + max) / 2 divides the events' average comfort.
function checkEventsInterval(cfg, errs) {
  if (!clean(errs, 'events')) return;
  if (!(cfg.events.min + cfg.events.max > 0)) errs.push({ path: 'events.min', message: 'min + max must be positive' });
}

// A class is bought tier by tier, so a class without tiers could never be offered. An empty list is
// its own root cause, so this is reported alongside other errors in the class rather than hidden by them.
function checkClassTiers(cfg, errs) {
  if (!Array.isArray(cfg.classes?.list)) return;
  cfg.classes.list.forEach((cls, i) => {
    if (isRecord(cls) && Array.isArray(cls.tiers) && cls.tiers.length === 0) {
      errs.push({ path: `classes.list[${i}].tiers`, message: 'at least one tier' });
    }
  });
}

// `start` is a tier index the player begins at, so it must be a whole number within the tiers.
function checkClassStart(cfg, errs) {
  if (!Array.isArray(cfg.classes?.list)) return;
  cfg.classes.list.forEach((cls, i) => {
    if (!isRecord(cls) || typeof cls.start !== 'number' || !Array.isArray(cls.tiers)) return;
    if (!(Number.isInteger(cls.start) && cls.start <= cls.tiers.length)) {
      errs.push({ path: `classes.list[${i}].start`, message: `start must be an integer ≤ the number of tiers (${cls.tiers.length})` });
    }
  });
}

// A tier's `value` means something different per effect: a multiplier (≥ 1) for most, a whole rig
// slot count (≥ 1) for `rigSlots`, a chance (≤ 1) for `lootChance`. The shape only keeps it ≥ 0.
// Guarded per entry: anything that is not a record / array / number is already a shape error.
function checkTierValues(cfg, errs) {
  if (!Array.isArray(cfg.classes?.list)) return;
  cfg.classes.list.forEach((cls, i) => {
    if (!isRecord(cls) || !Array.isArray(cls.tiers)) return;
    cls.tiers.forEach((t, j) => {
      if (!isRecord(t) || typeof t.value !== 'number' || !Number.isFinite(t.value)) return;
      const path = `classes.list[${i}].tiers[${j}].value`;
      if (cls.effect === 'lootChance') {
        if (t.value > 1) errs.push({ path, message: `expected number between 0 and 1, got ${t.value}` });
      } else if (t.value < 1) {
        errs.push({ path, message: `expected number ≥ 1, got ${t.value}` });
      } else if (cls.effect === 'rigSlots' && !Number.isInteger(t.value)) {
        errs.push({ path, message: 'rig slot count must be an integer' });
      }
    });
  });
}

// `requires` names another class; a class cannot require itself.
function checkClassRequires(cfg, errs) {
  if (!Array.isArray(cfg.classes?.list)) return;
  const ids = new Set(cfg.classes.list.map((cls) => cls?.id));
  cfg.classes.list.forEach((cls, i) => {
    if (!isRecord(cls) || typeof cls.requires !== 'string') return;
    if (!ids.has(cls.requires) || cls.requires === cls.id) {
      errs.push({ path: `classes.list[${i}].requires`, message: `unknown class id ${JSON.stringify(cls.requires)}` });
    }
  });
}

export function validateConfig(cfg) {
  const errs = [];
  check(cfg, record(SHAPES), '', errs);
  if (!isRecord(cfg)) return errs;
  checkSchema(cfg, errs);
  checkDuplicateIds(cfg, 'jobs', errs);
  checkDuplicateIds(cfg, 'classes', errs);
  checkRigJobs(cfg, errs);
  checkEventsInterval(cfg, errs);
  checkClassTiers(cfg, errs);
  checkTierValues(cfg, errs);
  checkClassStart(cfg, errs);
  checkClassRequires(cfg, errs);
  return errs;
}
