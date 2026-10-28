// Config schema and validator for the balance simulator.
// A shape is num | pos | atLeast(n) | nonNegInt | prob | bool | str | enumOf([...]) | list(shape) | record(required, optional).
// `pos` is a finite number > 0: durations, prices and growth factors that would divide by or loop on zero.
// `atLeast(n)` is a finite number ≥ n: multipliers (≥ 1) and amounts that may be zero but not negative.
// `nonNegInt` is an integer ≥ 0: slot counts. No SHAPES entry uses it today; kept for future slot-count
// fields (the editor still handles it).
// `prob` is a finite number in [0, 1]: chances rolled per run.
// Blocks: schema, taps, bar, jobs, rigs, classes, events, loot, offline. Rig slots come from a class
// with effect `rigSlots` (a purchasable rack), whose tier values are slot counts.

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
  }),
  rigs: record({ enabled: bool, list: list(record({ job: str, name: str, cost: pos })) }),
  classes: record({
    enabled: bool,
    list: list(record(
      { id: str, name: str, effect: enumOf(['pay', 'tapAdvance', 'rigSpeed', 'tapMoney', 'barBonus', 'rigSlots', 'none']),
        tiers: list(record({ name: str, cost: pos, value: atLeast(1), comfort: atLeast(0) })) },
      { event: record({ boost: atLeast(0), dur: atLeast(0) }) },
    )),
  }),
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

// A `rigSlots` class adds its tier value to the rig slots, so the value must be a whole count.
// Guarded per entry: anything that is not a record / array / number is already a shape error.
function checkRigSlotTiers(cfg, errs) {
  if (!Array.isArray(cfg.classes?.list)) return;
  cfg.classes.list.forEach((cls, i) => {
    if (!isRecord(cls) || cls.effect !== 'rigSlots' || !Array.isArray(cls.tiers)) return;
    cls.tiers.forEach((t, j) => {
      if (isRecord(t) && typeof t.value === 'number' && !(Number.isInteger(t.value) && t.value >= 0)) {
        errs.push({ path: `classes.list[${i}].tiers[${j}].value`, message: 'rig slot count must be an integer' });
      }
    });
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
  checkRigSlotTiers(cfg, errs);
  return errs;
}
