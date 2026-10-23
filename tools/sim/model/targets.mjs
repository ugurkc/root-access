// Targets: declarative pacing goals checked against run results.
//
// A target is { id, label, metric, op, value, profile: 'all' | '<profileId>', days?: [from, to] }.
// Ops: <=, <, >=, >, ==. Metric names resolve against a run result `r` (core.mjs run()):
//   '<key>'                      r.metrics[key], e.g. 'firstEvent:rig', 'offersLeft.final'
//   'purchasesPerDay:min|max|sum' over r.metrics.purchasesPerDay, restricted to `days` (1-based,
//                                inclusive) when given
//   'summary.<field>:day<N>'     r.summary[N-1][field], e.g. 'summary.incomePassive:day7'
// Anything else is an unknown metric and yields a failed verdict carrying `error`.
// Plain ES module with no node: imports: it runs in the browser too.

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

const SUMMARY_RE = /^summary\.([A-Za-z_]\w*):day([1-9]\d*)$/;

// → { actual } or { error }. `actual` is undefined when the metric exists but has no value yet.
export function resolveMetric(r, metric, days) {
  if (typeof metric !== 'string') return { error: 'unknown metric' };
  if (metric.startsWith('purchasesPerDay:')) {
    const reduce = REDUCERS[metric.slice('purchasesPerDay:'.length)];
    if (!reduce) return { error: 'unknown metric' };
    const all = r.metrics?.purchasesPerDay ?? [];
    const [from, to] = Array.isArray(days) ? days : [1, all.length];
    const slice = all.slice(from - 1, to);
    return { actual: slice.length ? reduce(slice) : undefined };
  }
  const m = SUMMARY_RE.exec(metric);
  if (m) return { actual: r.summary?.[Number(m[2]) - 1]?.[m[1]] };
  if (metric.startsWith('summary.')) return { error: 'unknown metric' };
  if (!r.metrics || !(metric in r.metrics)) return { error: 'unknown metric' };
  return { actual: r.metrics[metric] };
}

// Verdict for one target against one run.
function verdict(target, profile, r) {
  const base = { id: target.id, label: target.label, profile, expected: { op: target.op, value: target.value } };
  if (!r) return { ...base, pass: false, actual: undefined, error: `no run for profile ${profile}` };
  const { actual, error } = resolveMetric(r, target.metric, target.days);
  if (error) return { ...base, pass: false, actual: undefined, error };
  const cmp = OPS[target.op];
  if (!cmp) return { ...base, pass: false, actual, error: `unknown op ${target.op}` };
  const pass = typeof actual === 'number' && Number.isFinite(actual) && cmp(actual, target.value);
  return { ...base, pass, actual };
}

// runsByProfile: { [profileId]: run() result }. `profile: 'all'` expands to every key, in key order.
export function evaluate(targets, runsByProfile) {
  const out = [];
  for (const target of targets) {
    const profiles = target.profile === 'all' ? Object.keys(runsByProfile) : [target.profile];
    for (const p of profiles) out.push(verdict(target, p, runsByProfile[p]));
  }
  return out;
}

// Structural check of a targets list → [{ path, message }]; [] when valid.
// Metric names are not checked here: whether one resolves depends on the run (see evaluate()).
export function validateTargets(targets) {
  if (!Array.isArray(targets)) return [{ path: '', message: 'expected an array of targets' }];
  const errs = [];
  targets.forEach((t, i) => {
    const at = (key) => `[${i}].${key}`;
    const fail = (key, message) => errs.push({ path: at(key), message });
    if (typeof t !== 'object' || t === null || Array.isArray(t)) { errs.push({ path: `[${i}]`, message: 'expected an object' }); return; }
    for (const key of ['id', 'label', 'metric', 'profile']) {
      if (typeof t[key] !== 'string' || t[key] === '') fail(key, 'expected a non-empty string');
    }
    if (!(t.op in OPS)) fail('op', `expected one of ${Object.keys(OPS).join(' ')}, got ${JSON.stringify(t.op)}`);
    if (typeof t.value !== 'number' || !Number.isFinite(t.value)) fail('value', 'expected a finite number');
    if (t.days !== undefined) {
      const ok = Array.isArray(t.days) && t.days.length === 2 && t.days.every((d) => Number.isInteger(d) && d >= 1) && t.days[0] <= t.days[1];
      if (!ok) fail('days', 'expected [from, to] with 1 <= from <= to');
    }
  });
  return errs;
}
