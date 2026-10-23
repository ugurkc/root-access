import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { evaluate, validateTargets } from '../model/targets.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));

// A hand-built run result: only the fields the evaluator reads.
const fake = (metrics, summary = []) => ({ metrics, summary, timeline: [], final: {} });
const runs = {
  a: fake({ 'credits.final': 100, purchasesPerDay: [5, 0, 3, 2, 0, 1, 4] },
    [{ day: 1, incomePassive: 10 }, { day: 2, incomePassive: 20 }, { day: 3, incomePassive: 30 }]),
  b: fake({ 'credits.final': 50, purchasesPerDay: [1, 1, 1, 1, 1, 1, 1] },
    [{ day: 1, incomePassive: 1 }, { day: 2, incomePassive: 2 }, { day: 3, incomePassive: 3 }]),
};
const t = (over) => ({ id: 't', label: 'test', metric: 'credits.final', op: '>=', value: 1, profile: 'a', ...over });

test('a true target passes and a false one fails, both with actual filled', () => {
  const [ok] = evaluate([t({ value: 100 })], runs);
  assert.deepEqual(ok, { id: 't', label: 'test', profile: 'a', pass: true, actual: 100, expected: { op: '>=', value: 100 } });
  const [bad] = evaluate([t({ op: '<', value: 100 })], runs);
  assert.equal(bad.pass, false);
  assert.equal(bad.actual, 100);
  assert.deepEqual(bad.expected, { op: '<', value: 100 });
});

test('every op compares as written', () => {
  const cases = [['<=', 100, true], ['<=', 99, false], ['<', 101, true], ['<', 100, false],
    ['>=', 100, true], ['>=', 101, false], ['>', 99, true], ['>', 100, false], ['==', 100, true], ['==', 99, false]];
  for (const [op, value, pass] of cases) {
    assert.equal(evaluate([t({ op, value })], runs)[0].pass, pass, `${op} ${value}`);
  }
});

test('profile "all" expands to one verdict per run, in run order', () => {
  const out = evaluate([t({ profile: 'all', value: 60 })], runs);
  assert.deepEqual(out.map((v) => [v.profile, v.pass, v.actual]), [['a', true, 100], ['b', false, 50]]);
});

test('a profile with no run yields a failed verdict with an error', () => {
  const [v] = evaluate([t({ profile: 'zzz' })], runs);
  assert.equal(v.pass, false);
  assert.equal(v.actual, undefined);
  assert.match(v.error, /no run/);
});

test('purchasesPerDay:min/max/sum honour the days range', () => {
  const m = (metric, days) => evaluate([t({ metric, days, op: '==', value: 0 })], runs)[0].actual;
  assert.equal(m('purchasesPerDay:min'), 0);
  assert.equal(m('purchasesPerDay:min', [3, 4]), 2);
  assert.equal(m('purchasesPerDay:max', [2, 5]), 3);
  assert.equal(m('purchasesPerDay:sum', [1, 3]), 8);
  assert.equal(m('purchasesPerDay:sum'), 15);
});

test('summary.<field>:dayN resolves from the summary row', () => {
  const [v] = evaluate([t({ metric: 'summary.incomePassive:day3', op: '==', value: 30 })], runs);
  assert.equal(v.actual, 30);
  assert.equal(v.pass, true);
  const [missing] = evaluate([t({ metric: 'summary.incomePassive:day9' })], runs);
  assert.equal(missing.pass, false);
  assert.equal(missing.actual, undefined);
});

test('an unknown metric yields a failed verdict with error', () => {
  for (const metric of ['nope', 'purchasesPerDay:median', 'summary.credits:dayX']) {
    const [v] = evaluate([t({ metric })], runs);
    assert.equal(v.pass, false, metric);
    assert.equal(v.actual, undefined, metric);
    assert.equal(v.error, 'unknown metric', metric);
  }
});

test('validateTargets accepts the starter file and rejects malformed targets with paths', () => {
  assert.deepEqual(validateTargets(load('../targets/seven-day-idle.json')), []);
  const errs = validateTargets([
    t({ op: '~=' }),
    t({ days: [6, 2] }),
    { id: 'x' },
    t({ days: [0, 3] }),
    t({ value: 'ten' }),
  ]);
  const paths = errs.map((e) => e.path);
  assert.ok(paths.includes('[0].op'), JSON.stringify(errs));
  assert.ok(paths.includes('[1].days'), JSON.stringify(errs));
  assert.ok(paths.some((p) => p.startsWith('[2].')), JSON.stringify(errs));
  assert.ok(paths.includes('[3].days'), JSON.stringify(errs));
  assert.ok(paths.includes('[4].value'), JSON.stringify(errs));
  assert.deepEqual(validateTargets('not a list'), [{ path: '', message: 'expected an array of targets' }]);
});

// The starter file against the v2 preset. `d7-not-done` fails for `active`: a greedy active player
// buys the last upgrade on day 7 (offersLeft.final is 0), which is the known baseline finding from
// tuning (see test/fixtures/README.md), not a tool bug. Casual still has offers left.
test('seven-day-idle targets against the v2 preset: all pass except d7-not-done for active', () => {
  const config = load('../presets/v2-2026-10-23.json');
  const byProfile = {
    active: run({ config, profile: load('../profiles/active.json'), days: 7 }),
    casual: run({ config, profile: load('../profiles/casual.json'), days: 7 }),
  };
  const verdicts = evaluate(load('../targets/seven-day-idle.json'), byProfile);
  assert.equal(verdicts.length, 8);
  const failed = verdicts.filter((v) => !v.pass).map((v) => `${v.id}/${v.profile}`);
  assert.deepEqual(failed, ['d7-not-done/active']);
  const byKey = Object.fromEntries(verdicts.map((v) => [`${v.id}/${v.profile}`, v.actual]));
  assert.equal(byKey['d7-not-done/active'], 0);
  assert.ok(byKey['d7-not-done/casual'] >= 1);
  assert.ok(byKey['first-rig/active'] <= 480 && byKey['first-rig/casual'] <= 480);
  assert.ok(byKey['daily-purchase/active'] >= 1 && byKey['daily-purchase/casual'] >= 1);
});
