// Pure helpers behind the targets panel: editor rows ⇄ target objects, verdict summaries and the
// metric suggestions. No DOM here, so Node can test it.
import { OPS } from '../model/targets.mjs';

export const OP_NAMES = Object.keys(OPS);

// Grammar forms offered in the metric datalist next to the keys of the last run.
export const METRIC_FORMS = ['purchasesPerDay:min', 'purchasesPerDay:max', 'purchasesPerDay:sum', 'purchasesPerDay[rig,class,tier]:min', 'summary.incomePassive:day7', 'summary.credits:day7'];

// A row holds what the inputs hold: strings, with `from`/`to` empty when the target has no days.
export function targetToRow(target) {
  const t = target ?? {};
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  return {
    id: str(t.id), label: str(t.label), metric: str(t.metric), op: str(t.op ?? '<='), value: str(t.value),
    profile: str(t.profile || 'all'),
    from: Array.isArray(t.days) ? str(t.days[0]) : '', to: Array.isArray(t.days) ? str(t.days[1]) : '',
  };
}

// Inverse of targetToRow. Blank text becomes a value validateTargets() rejects (NaN, empty string)
// rather than a guess; `days` is present only when either bound is filled in.
export function rowToTarget(row) {
  const trim = (v) => (v == null ? '' : String(v).trim());
  const num = (v) => (trim(v) === '' ? NaN : Number(trim(v)));
  const target = { id: trim(row.id), label: trim(row.label), metric: trim(row.metric), op: trim(row.op), value: num(row.value), profile: trim(row.profile) || 'all' };
  if (trim(row.from) !== '' || trim(row.to) !== '') target.days = [num(row.from), num(row.to)];
  return target;
}

export const blankRow = () => targetToRow({ id: '', label: '', metric: '', op: '<=', value: '', profile: 'all' });

// verdicts (evaluate() output) → { passes, total, label: 'N/M pass', byKey: Map('<id>/<profile>' → verdict) }.
export function summarizeVerdicts(verdicts) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  const passes = list.filter((v) => v.pass).length;
  const byKey = new Map(list.map((v) => [`${v.id}/${v.profile}`, v]));
  return { passes, total: list.length, label: `${passes}/${list.length} pass`, byKey };
}

// Metric keys worth suggesting from runs: scalar-valued keys of every run's `metrics`, sorted, then the grammar forms.
export function metricSuggestions(runsByProfile) {
  const keys = new Set();
  for (const r of Object.values(runsByProfile ?? {})) {
    for (const [k, v] of Object.entries(r?.metrics ?? {})) if (typeof v === 'number') keys.add(k);
  }
  return [...[...keys].sort(), ...METRIC_FORMS];
}

// validateTargets() errors → Map(rowIndex → Map(field → [messages])); '' for whole-row messages.
export function groupTargetErrors(errors) {
  const out = new Map();
  for (const e of errors) {
    const m = /^\[(\d+)\](?:\.(\w+))?$/.exec(e.path);
    const row = m ? Number(m[1]) : -1;
    const field = m?.[2] ?? '';
    const fields = out.get(row) ?? out.set(row, new Map()).get(row);
    (fields.get(field) ?? fields.set(field, []).get(field)).push(e.message);
  }
  return out;
}
