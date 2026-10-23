import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { evaluate, validateTargets } from '../model/targets.mjs';
import {
  OP_NAMES, METRIC_FORMS, targetToRow, rowToTarget, blankRow, summarizeVerdicts, metricSuggestions, groupTargetErrors,
} from '../ui/targets.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = load('../presets/v2-2026-10-23.json');
const profiles = { active: load('../profiles/active.json'), casual: load('../profiles/casual.json') };
const targets = load('../targets/seven-day-idle.json');

test('OP_NAMES mirror the model ops', () => {
  assert.deepEqual(OP_NAMES, ['<=', '<', '>=', '>', '==']);
});

test('targetToRow: strings for every input, days split into from/to, blanks when absent', () => {
  assert.deepEqual(targetToRow(targets[2]), {
    id: 'daily-purchase', label: 'A purchase every day D2–D6', metric: 'purchasesPerDay:min', op: '>=', value: '1', profile: 'all', from: '2', to: '6',
  });
  assert.deepEqual(targetToRow(targets[0]).from, '');
  assert.deepEqual(targetToRow({}), { id: '', label: '', metric: '', op: '<=', value: '', profile: 'all', from: '', to: '' });
  assert.deepEqual(blankRow(), targetToRow({}));
});

test('rowToTarget inverts targetToRow for every starter target', () => {
  for (const t of targets) assert.deepEqual(rowToTarget(targetToRow(t)), t);
});

test('rowToTarget: blank value is NaN and a half-filled days pair is kept so the validator names it', () => {
  const t = rowToTarget({ id: ' x ', label: 'L', metric: 'offersLeft.final', op: '>=', value: '', profile: '', from: '2', to: '' });
  assert.deepEqual(t, { id: 'x', label: 'L', metric: 'offersLeft.final', op: '>=', value: NaN, profile: 'all', days: [2, NaN] });
  const errs = validateTargets([t]);
  assert.deepEqual(errs.map((e) => e.path).sort(), ['[0].days', '[0].value']);
});

test('groupTargetErrors indexes validator errors by row and field', () => {
  const grouped = groupTargetErrors([
    { path: '[0].value', message: 'expected a finite number' },
    { path: '[0].value', message: 'again' },
    { path: '[2].op', message: 'bad op' },
    { path: '[3]', message: 'expected an object' },
    { path: '', message: 'expected an array of targets' },
  ]);
  assert.deepEqual(grouped.get(0).get('value'), ['expected a finite number', 'again']);
  assert.deepEqual(grouped.get(2).get('op'), ['bad op']);
  assert.deepEqual(grouped.get(3).get(''), ['expected an object']);
  assert.deepEqual(grouped.get(-1).get(''), ['expected an array of targets']);
});

test('summarizeVerdicts on the baseline run: 7/10 pass, keyed by id/profile', () => {
  const runs = Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, run({ config: structuredClone(config), profile: p, days: 7 })]));
  const s = summarizeVerdicts(evaluate(targets, runs));
  assert.equal(s.total, 10);
  assert.equal(s.passes, 7);
  assert.equal(s.label, '7/10 pass');
  assert.equal(s.byKey.get('first-upgrade/active').pass, true);
  assert.equal(s.byKey.get('daily-rig-or-item/casual').pass, false);
  assert.equal(s.byKey.size, 10);
  assert.deepEqual(summarizeVerdicts([]), { passes: 0, total: 0, label: '0/0 pass', byKey: new Map() });
  assert.equal(summarizeVerdicts(undefined).label, '0/0 pass');
});

test('metricSuggestions: scalar metric keys of the runs, sorted, then the grammar forms', () => {
  const runs = { a: { metrics: { 'rigs.count': 1, 'firstEvent:rig': 50, purchasesPerDay: [1, 2], purchasesByKindPerDay: {} } }, b: { metrics: { 'offersLeft.final': 3 } } };
  assert.deepEqual(metricSuggestions(runs), ['firstEvent:rig', 'offersLeft.final', 'rigs.count', ...METRIC_FORMS]);
  assert.deepEqual(metricSuggestions({}), METRIC_FORMS);
  assert.ok(METRIC_FORMS.includes('purchasesPerDay[rig,item]:min') && METRIC_FORMS.includes('summary.incomePassive:day7'));
});
