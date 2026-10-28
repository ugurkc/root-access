import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { evaluate, validateTargets } from '../model/targets.mjs';
import { loadDefaultPreset } from './default-preset.mjs';

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
  assert.deepEqual(ok, { id: 't', label: 'test', profile: 'a', pass: true, actual: 100, expected: { metric: 'credits.final', op: '>=', value: 100 } });
  const [bad] = evaluate([t({ op: '<', value: 100 })], runs);
  assert.equal(bad.pass, false);
  assert.equal(bad.actual, 100);
  assert.deepEqual(bad.expected, { metric: 'credits.final', op: '<', value: 100 });
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
  assert.equal(v.actual, null);
  assert.match(v.error, /no run/);
});

test('profile "all" with no runs at all yields one failed verdict per target with error "no runs"', () => {
  const out = evaluate([t({ profile: 'all' }), t({ id: 'u', profile: 'all' })], {});
  assert.equal(out.length, 2);
  for (const v of out) {
    assert.equal(v.pass, false);
    assert.equal(v.actual, null);
    assert.equal(v.error, 'no runs');
  }
});

test('purchasesPerDay:min/max/sum honour the days range', () => {
  const m = (metric, days) => evaluate([t({ metric, days, op: '==', value: 0 })], runs)[0].actual;
  assert.equal(m('purchasesPerDay:min'), 0);
  assert.equal(m('purchasesPerDay:min', [3, 4]), 2);
  assert.equal(m('purchasesPerDay:max', [2, 5]), 3);
  assert.equal(m('purchasesPerDay:sum', [1, 3]), 8);
  assert.equal(m('purchasesPerDay:sum'), 15);
  const [v] = evaluate([t({ metric: 'purchasesPerDay:min', days: [3, 4], op: '==', value: 2 })], runs);
  assert.deepEqual(v.expected, { metric: 'purchasesPerDay:min', op: '==', value: 2, days: [3, 4] });
});

test('a days range past the end of the run is an error, not a silent slice', () => {
  const [v] = evaluate([t({ metric: 'purchasesPerDay:min', days: [6, 9] })], runs);
  assert.equal(v.pass, false);
  assert.equal(v.actual, null);
  assert.equal(v.error, 'days [6, 9] exceed run length 7');
});

test('purchasesPerDay[kinds]:reducer sums the named kinds per day', () => {
  const byKind = {
    rig: [1, 0, 2, 0, 0, 0, 0],
    class: [0, 1, 0, 0, 0, 3, 0],
    level: [9, 9, 9, 9, 9, 9, 9],
  };
  const kinds = { k: fake({ purchasesPerDay: [10, 10, 11, 9, 9, 12, 9], purchasesByKindPerDay: byKind }) };
  const m = (metric, days) => evaluate([{ ...t({ metric, days, op: '==', value: 0 }), profile: 'k' }], kinds)[0].actual;
  assert.equal(m('purchasesPerDay[rig,class]:sum'), 7);
  assert.equal(m('purchasesPerDay[rig, class]:min', [1, 3]), 1);
  assert.equal(m('purchasesPerDay[rig,class]:min', [4, 5]), 0);
  assert.equal(m('purchasesPerDay[rig,class]:max', [2, 6]), 3);
  assert.equal(m('purchasesPerDay[tier]:sum'), 0);
  assert.equal(evaluate([{ ...t({ metric: 'purchasesPerDay[rig]:median' }), profile: 'k' }], kinds)[0].error, 'unknown metric');
});

test('purchasesPerDay[...] only accepts the known offer kinds, and at least one', () => {
  const [typo] = evaluate([t({ metric: 'purchasesPerDay[rigs]:min' })], runs);
  assert.equal(typo.pass, false);
  assert.equal(typo.actual, null);
  assert.equal(typo.error, 'unknown kind "rigs"');
  assert.equal(evaluate([t({ metric: 'purchasesPerDay[rig,items]:sum' })], runs)[0].error, 'unknown kind "items"');
  assert.equal(evaluate([t({ metric: 'purchasesPerDay[]:sum' })], runs)[0].error, 'unknown metric');
  assert.equal(evaluate([t({ metric: 'purchasesPerDay[ ]:sum' })], runs)[0].error, 'unknown metric');
  const errs = validateTargets([t({ metric: 'purchasesPerDay[rigs]:min' }), t({ id: 'e', metric: 'purchasesPerDay[]:min' }), t({ id: 'ok', metric: 'purchasesPerDay[level,class,tier,rig]:max' })]);
  assert.deepEqual(errs.map((e) => e.path), ['[0].metric', '[1].metric']);
  assert.match(errs[0].message, /unknown kind "rigs"/);
  assert.match(errs[0].message, /level, class, tier, rig/);
});

test('summary.<field>:dayN resolves from the summary row', () => {
  const [v] = evaluate([t({ metric: 'summary.incomePassive:day3', op: '==', value: 30 })], runs);
  assert.equal(v.actual, 30);
  assert.equal(v.pass, true);
  const [missing] = evaluate([t({ metric: 'summary.incomePassive:day9' })], runs);
  assert.equal(missing.pass, false);
  assert.equal(missing.actual, null);
  assert.equal(missing.error, 'no value');
});

test('a firstEvent metric for an event that never happened has no value', () => {
  const [v] = evaluate([t({ metric: 'firstEvent:rig' })], runs);
  assert.equal(v.pass, false);
  assert.equal(v.actual, null);
  assert.equal(v.error, 'no value');
});

test('an unknown metric yields a failed verdict with error', () => {
  for (const metric of ['nope', 'purchasesPerDay:median', 'summary.credits:dayX', 'toString', 'constructor']) {
    const [v] = evaluate([t({ metric })], runs);
    assert.equal(v.pass, false, metric);
    assert.equal(v.actual, null, metric);
    assert.equal(v.error, 'unknown metric', metric);
  }
});

test('an inherited property name is not an op', () => {
  const [v] = evaluate([t({ op: 'constructor' })], runs);
  assert.equal(v.pass, false);
  assert.equal(v.actual, null);
  assert.match(v.error, /unknown op/);
  assert.deepEqual(validateTargets([t({ op: 'constructor' })]).map((e) => e.path), ['[0].op']);
});

test('validateTargets flags duplicate ids and days on a metric that is not per-day', () => {
  const errs = validateTargets([t({ id: 'dup' }), t({ id: 'dup' }), t({ id: 'x', metric: 'credits.final', days: [1, 2] }), t({ id: 'y', metric: 'purchasesPerDay[rig]:min', days: [1, 2] })]);
  assert.deepEqual(errs.map((e) => e.path), ['[1].id', '[2].days']);
  assert.match(errs[0].message, /duplicate id "dup"/);
  assert.match(errs[1].message, /purchasesPerDay/);
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

// The starter file against the default preset. This is the 2026-10-28 baseline (starter home preset,
// draft numbers; see test/fixtures/README.md): one target fails, for both profiles, as a known finding
// and not as a tool bug: `daily-rig-or-item` (the whole room and all three rigs are bought on day 1;
// from day 2 only job levels are left). `d7-not-done` passes for both, since the ladder is unfinished
// on day 7 (active has 2 offers left, casual 3).
test('seven-day-idle targets against the default preset: all pass except the baseline failures', () => {
  const config = loadDefaultPreset();
  const byProfile = {
    active: run({ config, profile: load('../profiles/active.json'), days: 7 }),
    casual: run({ config, profile: load('../profiles/casual.json'), days: 7 }),
  };
  const verdicts = evaluate(load('../targets/seven-day-idle.json'), byProfile);
  assert.equal(verdicts.length, 12);
  const failed = verdicts.filter((v) => !v.pass).map((v) => `${v.id}/${v.profile}`);
  // Accepted room preset, 2026-10-28: the room is finished by day 2 (active) or day 5 (casual) by
  // design, so a room item every day fails; the Storage unit comes late, so does the first loot.
  assert.deepEqual(failed, ['daily-rig-or-item/active', 'daily-rig-or-item/casual', 'first-loot/active', 'first-loot/casual']);
  for (const v of verdicts) assert.equal(v.error, undefined, `${v.id}/${v.profile}: ${v.error}`);
  const byKey = Object.fromEntries(verdicts.map((v) => [`${v.id}/${v.profile}`, v.actual]));
  assert.ok(byKey['d7-not-done/active'] >= 1 && byKey['d7-not-done/casual'] >= 1);
  assert.ok(byKey['first-rig/active'] === 1 && byKey['first-rig/casual'] === 1);
  assert.ok(byKey['daily-purchase/active'] >= 1 && byKey['daily-purchase/casual'] >= 1);
  assert.ok(byKey['first-loot/active'] > 600 && byKey['first-loot/casual'] > 600);
});
