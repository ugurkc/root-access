// Parameter sweeps: run every combination of one or two config values and count passing targets.
//
// A path addresses a config value with dotted keys; an array segment takes a selector in brackets:
//   jobs.list[wifi].cost     the entry whose `id` is "wifi" (or whose `job` is, for rigs)
//   jobs.list[1].cost        the entry at index 1
//   racks.cost               a plain key
// Plain ES module with no node: imports: it runs in the browser too.
import { run } from './core.mjs';
import { evaluate } from './targets.mjs';
import { validateConfig } from './config.mjs';

const SEGMENT_RE = /^([A-Za-z_]\w*)(?:\[([^\]]+)\])?$/;
const isRecord = (v) => typeof v === 'object' && v !== null;

// → [{ key, selector? }]; throws on a malformed path.
export function parsePath(path) {
  if (typeof path !== 'string' || path === '') throw new Error('empty path');
  return path.split('.').map((seg) => {
    const m = SEGMENT_RE.exec(seg);
    if (!m) throw new Error(`malformed path ${JSON.stringify(path)} at ${JSON.stringify(seg)}`);
    return { key: m[1], selector: m[2] };
  });
}

// Every error names the full path first, then where in it the walk stopped.
function indexOf(list, selector, path, trail) {
  if (!Array.isArray(list)) throw new Error(`${path}: ${trail} is not an array`);
  if (/^\d+$/.test(selector)) {
    const i = Number(selector);
    if (i >= list.length) throw new Error(`${path}: index ${i} out of range at ${trail} (${list.length} entries)`);
    return i;
  }
  const i = list.findIndex((e) => isRecord(e) && (e.id === selector || (e.id === undefined && e.job === selector)));
  if (i === -1) throw new Error(`${path}: no entry with id ${JSON.stringify(selector)} at ${trail}`);
  return i;
}

// Walks to the parent of the addressed value → { parent, key } so get and set share one resolver.
function locate(cfg, path) {
  const segments = parsePath(path);
  let node = cfg;
  let trail = '';
  for (let s = 0; s < segments.length; s++) {
    const { key, selector } = segments[s];
    trail = trail ? `${trail}.${key}` : key;
    if (!isRecord(node) || !Object.hasOwn(node, key)) throw new Error(`${path}: no such key at ${trail}`);
    const last = s === segments.length - 1;
    if (selector === undefined) {
      if (last) return { parent: node, key };
      node = node[key];
      continue;
    }
    const i = indexOf(node[key], selector, path, trail);
    trail += `[${selector}]`;
    if (last) return { parent: node[key], key: i };
    node = node[key][i];
  }
  throw new Error(`${path}: unreachable`);
}

export function getPath(cfg, path) {
  const { parent, key } = locate(cfg, path);
  return parent[key];
}

// Mutates `cfg` in place; sweep() works on clones so the caller's config is never touched.
export function setPath(cfg, path, value) {
  const { parent, key } = locate(cfg, path);
  parent[key] = value;
  return cfg;
}

const ROW_METRICS = ['firstEvent:rig', 'rigs.count', 'credits.final', 'offersLeft.final'];

// Cartesian product of the params' values, first param outermost.
function combinations(params) {
  return params.reduce((acc, p) => acc.flatMap((prefix) => p.values.map((v) => [...prefix, [p.path, v]])), [[]]);
}

// { config, profiles: { [id]: profile }, targets?, days?, params: [{ path, values }] } → rows
// [{ values: { [path]: value }, passes, total, metrics: { [profileId]: { ...ROW_METRICS } } }].
// A combination that makes the config invalid throws rather than running on garbage.
export function sweep({ config, profiles, targets = [], days = 7, params }) {
  if (!Array.isArray(params) || params.length < 1 || params.length > 2) throw new Error('sweep takes 1 or 2 params');
  return combinations(params).map((combo) => {
    const cfg = structuredClone(config);
    for (const [path, value] of combo) setPath(cfg, path, value);
    const errs = validateConfig(cfg);
    if (errs.length) {
      const shown = combo.map(([p, v]) => `${p}=${JSON.stringify(v)}`).join(' ');
      throw new Error(`invalid config at ${shown}: ${errs.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    }
    const runs = Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, run({ config: cfg, profile, days })]));
    const verdicts = evaluate(targets, runs);
    const metrics = Object.fromEntries(Object.entries(runs).map(([id, r]) =>
      [id, Object.fromEntries(ROW_METRICS.map((k) => [k, Object.hasOwn(r.metrics, k) ? r.metrics[k] : null]))]));
    return { values: Object.fromEntries(combo), passes: verdicts.filter((v) => v.pass).length, total: verdicts.length, metrics };
  });
}
