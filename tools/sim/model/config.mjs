// Config schema and validator for the balance simulator.
// A shape is num | pos | atLeast(n) | nonNegInt | bool | str | enumOf([...]) | list(shape) | record(required, optional).
// `pos` is a finite number > 0: durations, prices and growth factors that would divide by or loop on zero.
// `atLeast(n)` is a finite number ≥ n: multipliers (≥ 1) and amounts that may be zero but not negative.
// `nonNegInt` is an integer ≥ 0: slot counts.

export const SCHEMA = 1;

export const num = 'number';
export const pos = { kind: 'pos' };
export const atLeast = (min) => ({ kind: 'atLeast', min });
export const nonNegInt = { kind: 'nonNegInt' };
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
    list: list(record({ id: str, name: str, time: pos, pay: pos, cost: pos, r: pos, rep: num, unlock: num })),
  }),
  rigs: record({ enabled: bool, list: list(record({ job: str, name: str, cost: pos })) }),
  racks: record({ enabled: bool, largeSlots: nonNegInt, decorSlots: nonNegInt, cost: pos, r: pos, holds: nonNegInt }),
  items: record({
    enabled: bool, maxLevel: atLeast(1), r: pos, growPerLevel: num, techComfortFlat: bool,
    list: list(record(
      { id: str, type: enumOf(['tech', 'decor']), name: str, cost: pos, comfort: atLeast(0) },
      { size: enumOf(['small', 'large']), pay: atLeast(1), speed: atLeast(1), event: record({ boost: atLeast(0), dur: atLeast(0) }) },
    )),
  }),
  events: record({ enabled: bool, window: num, first: num, min: num, max: num, acceptRate: num }),
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

// Tech items need a size to pick a slot; decor has its own slots and no size.
function checkItemSizes(cfg, errs) {
  if (!clean(errs, 'items.list') || !Array.isArray(cfg.items?.list)) return;
  cfg.items.list.forEach((item, i) => {
    const path = `items.list[${i}].size`;
    if (item.type === 'tech' && !('size' in item)) errs.push({ path, message: 'tech items need a size' });
    if (item.type === 'decor' && 'size' in item) errs.push({ path, message: 'decor items have no size' });
  });
}

export function validateConfig(cfg) {
  const errs = [];
  check(cfg, record(SHAPES), '', errs);
  if (!isRecord(cfg)) return errs;
  checkSchema(cfg, errs);
  checkDuplicateIds(cfg, 'jobs', errs);
  checkDuplicateIds(cfg, 'items', errs);
  checkRigJobs(cfg, errs);
  checkEventsInterval(cfg, errs);
  checkItemSizes(cfg, errs);
  return errs;
}
