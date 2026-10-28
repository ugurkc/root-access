// Targets: declarative pacing goals checked against run results.
//
// A target is { id, label, metric, op, value, profile: 'all' | '<profileId>', days?: [from, to] }.
// Ops: <=, <, >=, >, == (exact: `actual === value`, no tolerance). Metric names resolve against a
// run result `r` (core.mjs run()):
//   '<key>'                      r.metrics[key], e.g. 'firstEvent:rig', 'offersLeft.final'
//   'purchasesPerDay:min|max|sum'          over r.metrics.purchasesPerDay
//   'purchasesPerDay[k1,k2]:min|max|sum'   over the per-day sum of r.metrics.purchasesByKindPerDay for
//                                          the listed offer kinds (one or more of KINDS); an unknown
//                                          kind is an error
//                                both restricted to `days` (1-based, inclusive) when given; a range
//                                past the run's last day is an error
//   'summary.<field>:day<N>'     r.summary[N-1][field], e.g. 'summary.incomePassive:day7'
// Anything else is an unknown metric and yields a failed verdict carrying `error`. A metric that
// resolves to no finite value yields `error: 'no value'`. Every failed-with-error verdict carries
// `actual: null` so JSON output keeps the key.
// Plain ES module with no node: imports: it runs in the browser too.
import { PURCHASE_KINDS } from './core.mjs';

export const OPS = {
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '==': (a, b) => a === b,
};

const REDUCERS = {
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  sum: (xs) => xs.reduce((s, x) => s + x, 0),
};

// Offer kinds the modules emit (core.mjs PURCHASE_KINDS), accepted inside purchasesPerDay[...].
export const KINDS = PURCHASE_KINDS;

const SUMMARY_RE = /^summary\.([A-Za-z_]\w*):day([1-9]\d*)$/;
const PER_DAY_RE = /^purchasesPerDay(?:\[([^\]]*)\])?:(\w+)$/;
const FIRST_EVENT_PREFIX = 'firstEvent:';

const isPerDayMetric = (metric) => typeof metric === 'string' && PER_DAY_RE.test(metric);

// "rig, item" → { kinds } or { error }: 'unknown metric' for an empty list, 'unknown kind "x"' otherwise.
function parseKinds(kindList) {
  const kinds = kindList.split(',').map((k) => k.trim()).filter(Boolean);
  if (kinds.length === 0) return { error: 'unknown metric' };
  const bad = kinds.find((k) => !KINDS.includes(k));
  return bad === undefined ? { kinds } : { error: `unknown kind ${JSON.stringify(bad)}` };
}

// → { actual } or { error }. `actual` is undefined when the metric exists but has no value yet.
export function resolveMetric(r, metric, days) {
  if (typeof metric !== 'string') return { error: 'unknown metric' };
  const perDay = PER_DAY_RE.exec(metric);
  if (perDay) {
    const [, kindList, reducer] = perDay;
    if (!Object.hasOwn(REDUCERS, reducer)) return { error: 'unknown metric' };
    let kinds;
    if (kindList !== undefined) {
      const parsed = parseKinds(kindList);
      if (parsed.error) return { error: parsed.error };
      kinds = parsed.kinds;
    }
    const all = perDayCounts(r, kinds);
    const [from, to] = Array.isArray(days) ? days : [1, all.length];
    if (to > all.length) return { error: `days [${from}, ${to}] exceed run length ${all.length}` };
    const slice = all.slice(from - 1, to);
    return { actual: slice.length ? REDUCERS[reducer](slice) : undefined };
  }
  const m = SUMMARY_RE.exec(metric);
  if (m) return { actual: r.summary?.[Number(m[2]) - 1]?.[m[1]] };
  if (metric.startsWith('summary.')) return { error: 'unknown metric' };
  const metrics = r.metrics ?? {};
  if (Object.hasOwn(metrics, metric)) return { actual: metrics[metric] };
  if (metric.startsWith(FIRST_EVENT_PREFIX)) return { actual: undefined };
  return { error: 'unknown metric' };
}

// Per-day purchase counts: all kinds, or the sum of the given kinds.
function perDayCounts(r, kinds) {
  const total = r.metrics?.purchasesPerDay ?? [];
  if (kinds === undefined) return total;
  const byKind = r.metrics?.purchasesByKindPerDay ?? {};
  return total.map((_, i) => kinds.reduce((s, k) => s + (Object.hasOwn(byKind, k) ? byKind[k][i] ?? 0 : 0), 0));
}

// Verdict for one target against one run.
function verdict(target, profile, r) {
  const expected = { metric: target.metric, op: target.op, value: target.value };
  if (target.days !== undefined) expected.days = target.days;
  const base = { id: target.id, label: target.label, profile, expected };
  if (!r) return { ...base, pass: false, actual: null, error: `no run for profile ${profile}` };
  const { actual, error } = resolveMetric(r, target.metric, target.days);
  if (error) return { ...base, pass: false, actual: null, error };
  if (!Object.hasOwn(OPS, target.op)) return { ...base, pass: false, actual: null, error: `unknown op ${target.op}` };
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return { ...base, pass: false, actual: null, error: 'no value' };
  return { ...base, pass: OPS[target.op](actual, target.value), actual };
}

// runsByProfile: { [profileId]: run() result }. `profile: 'all'` expands to every key, in key order;
// with no runs at all it yields one failed verdict per target carrying `error: 'no runs'`.
export function evaluate(targets, runsByProfile) {
  const out = [];
  const ids = Object.keys(runsByProfile);
  for (const target of targets) {
    if (target.profile === 'all' && ids.length === 0) {
      out.push({ ...verdict(target, 'all', undefined), error: 'no runs' });
      continue;
    }
    const profiles = target.profile === 'all' ? ids : [target.profile];
    for (const p of profiles) out.push(verdict(target, p, runsByProfile[p]));
  }
  return out;
}

// Structural check of a targets list → [{ path, message }]; [] when valid.
// Metric names are not checked here: whether one resolves depends on the run (see evaluate()).
export function validateTargets(targets) {
  if (!Array.isArray(targets)) return [{ path: '', message: 'expected an array of targets' }];
  const errs = [];
  const seen = new Set();
  targets.forEach((t, i) => {
    const at = (key) => `[${i}].${key}`;
    const fail = (key, message) => errs.push({ path: at(key), message });
    if (typeof t !== 'object' || t === null || Array.isArray(t)) { errs.push({ path: `[${i}]`, message: 'expected an object' }); return; }
    for (const key of ['id', 'label', 'metric', 'profile']) {
      if (typeof t[key] !== 'string' || t[key] === '') fail(key, 'expected a non-empty string');
    }
    const perDay = typeof t.metric === 'string' ? PER_DAY_RE.exec(t.metric) : null;
    if (perDay && perDay[1] !== undefined) {
      const { error } = parseKinds(perDay[1]);
      if (error) fail('metric', `${error === 'unknown metric' ? 'empty kind list' : error}; kinds are ${KINDS.join(', ')}`);
    }
    if (typeof t.id === 'string') {
      if (seen.has(t.id)) fail('id', `duplicate id ${JSON.stringify(t.id)}`);
      seen.add(t.id);
    }
    if (!Object.hasOwn(OPS, t.op)) fail('op', `expected one of ${Object.keys(OPS).join(' ')}, got ${JSON.stringify(t.op)}`);
    if (typeof t.value !== 'number' || !Number.isFinite(t.value)) fail('value', 'expected a finite number');
    if (t.days !== undefined) {
      const ok = Array.isArray(t.days) && t.days.length === 2 && t.days.every((d) => Number.isInteger(d) && d >= 1) && t.days[0] <= t.days[1];
      if (!ok) fail('days', 'expected [from, to] with 1 <= from <= to');
      else if (!isPerDayMetric(t.metric)) fail('days', 'days only applies to purchasesPerDay metrics');
    }
  });
  return errs;
}
