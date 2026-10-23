// Config schema and validator for the balance simulator.
// A shape is 'number' | 'boolean' | 'string', list(shape), or record(required, optional).

const num = 'number';
const bool = 'boolean';
const str = 'string';
const list = (of) => ({ kind: 'list', of });
const record = (keys, optional = {}) => ({ kind: 'record', keys, optional });

const SHAPES = {
  schema: num,
  taps: record({ enabled: bool, rate: num, minMoney: num, advance: num }),
  bar: record({ enabled: bool, steps: num, bonusTaps: num, speed: num, speedDur: num }),
  jobs: record({
    enabled: bool, maxLevel: num, milestones: list(num), revealAt: num,
    list: list(record({ id: str, name: str, time: num, pay: num, cost: num, r: num, rep: num, unlock: num })),
  }),
  rigs: record({ enabled: bool, list: list(record({ job: str, name: str, cost: num })) }),
  racks: record({ enabled: bool, largeSlots: num, decorSlots: num, cost: num, r: num, holds: num }),
  items: record({
    enabled: bool, maxLevel: num, r: num, growPerLevel: num, techComfortFlat: bool,
    list: list(record(
      { id: str, type: str, name: str, cost: num, comfort: num },
      { size: str, pay: num, speed: num, event: record({ boost: num, dur: num }) },
    )),
  }),
  events: record({ enabled: bool, window: num, first: num, min: num, max: num, acceptRate: num }),
  offline: record({ enabled: bool, capHours: num }),
};

export const BLOCKS = Object.keys(SHAPES);

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const describe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const join = (path, key) => (path ? `${path}.${key}` : key);

function check(value, shape, path, errs) {
  if (typeof shape === 'string') {
    if (typeof value !== shape) errs.push({ path, message: `expected ${shape}, got ${describe(value)}` });
    return;
  }
  if (shape.kind === 'list') {
    if (!Array.isArray(value)) {
      errs.push({ path, message: `expected array, got ${describe(value)}` });
      return;
    }
    value.forEach((item, i) => check(item, shape.of, `${path}[${i}]`, errs));
    return;
  }
  if (!isRecord(value)) {
    errs.push({ path, message: `expected object, got ${describe(value)}` });
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

function checkRigJobs(cfg, errs) {
  if (!Array.isArray(cfg?.jobs?.list) || !Array.isArray(cfg?.rigs?.list)) return;
  const jobIds = new Set(cfg.jobs.list.map((job) => job?.id));
  cfg.rigs.list.forEach((rig, i) => {
    if (isRecord(rig) && !jobIds.has(rig.job)) {
      errs.push({ path: `rigs.list[${i}].job`, message: `unknown job id ${JSON.stringify(rig.job)}` });
    }
  });
}

export function validateConfig(cfg) {
  const errs = [];
  check(cfg, record(SHAPES), '', errs);
  checkRigJobs(cfg, errs);
  return errs;
}
