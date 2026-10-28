// Pacing fixture: the full default module set against the default preset (manifest.presets[0]),
// both profiles, 7 days.
// Two layers (see fixtures/README.md):
//   1. coarse facts asserted here, measured from the model and expected to survive tuning;
//   2. an exact fixture (fixtures/starter-expected.json) so any drift in the per-day purchase lists or
//      credits is visible. Regenerate deliberately with `UPDATE_FIXTURE=1 npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { loadDefaultPreset } from './default-preset.mjs';

const DAYS = 7;
const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = loadDefaultPreset();
const profiles = { active: load('../profiles/active.json'), casual: load('../profiles/casual.json') };
const runs = Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, run({ config, profile, days: DAYS })]));

// First session lengths in active seconds: active 12 min, casual 8 min.
const FIRST_SESSION = { active: 720, casual: 480 };

for (const [id, r] of Object.entries(runs)) {
  test(`${id}: every metric is finite`, () => {
    for (const [k, v] of Object.entries(r.metrics)) {
      const leaves = Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v).flat() : [v];
      for (const x of leaves) assert.ok(Number.isFinite(x), `${k} has ${x}`);
    }
  });

  test(`${id}: the shop never hits its per-second buy cap`, () => {
    assert.equal(r.metrics['shop.capHits'], 0);
  });

  test(`${id}: first job level-up within 90 s of active play`, () => {
    assert.ok(r.metrics['firstEvent:level'] <= 90, `firstEvent:level = ${r.metrics['firstEvent:level']}`);
  });

  test(`${id}: first rig inside the first session`, () => {
    assert.ok(r.metrics['firstEvent:rig'] <= FIRST_SESSION[id], `firstEvent:rig = ${r.metrics['firstEvent:rig']}`);
  });

  test(`${id}: at least one purchase on each of days 2–6`, () => {
    const perDay = r.metrics.purchasesPerDay;
    assert.equal(perDay.length, DAYS);
    for (let day = 2; day <= 6; day++) assert.ok(perDay[day - 1] >= 1, `day ${day}: ${perDay[day - 1]} purchases`);
  });

  test(`${id}: purchasesByKindPerDay splits purchasesPerDay by offer kind`, () => {
    const byKind = r.metrics.purchasesByKindPerDay;
    assert.ok(byKind.rig && byKind.level, Object.keys(byKind).join(','));
    for (const counts of Object.values(byKind)) assert.equal(counts.length, DAYS);
    for (let i = 0; i < DAYS; i++) {
      const total = Object.values(byKind).reduce((s, counts) => s + counts[i], 0);
      assert.equal(total, r.metrics.purchasesPerDay[i], `day ${i + 1}`);
    }
    assert.equal(byKind.rig.reduce((s, x) => s + x, 0), r.metrics['rigs.count']);
  });

  test(`${id}: loot has paid out by day 7`, () => {
    assert.ok(r.metrics['loot.earned'] > 0, `loot.earned = ${r.metrics['loot.earned']}`);
  });
}

// The starter room is meant to be finished inside the week, and the first four jobs scripted.
for (const [id, r] of Object.entries(runs)) {
  test(`${id}: the room is complete by day 7 and wifi, stream, phone and kebab are scripted`, () => {
    assert.equal(r.metrics['room.complete'], 1);
    assert.ok(r.metrics['firstDay:roomComplete'] <= DAYS, `firstDay:roomComplete = ${r.metrics['firstDay:roomComplete']}`);
    for (const job of ['wifi', 'stream', 'phone', 'kebab']) assert.equal(r.metrics[`jobs.${job}.rigged`], 1, job);
  });
}

// Exact fixture. Credits are rounded to 6 significant digits so the fixture is readable and
// stable under reordering of floating-point sums; purchase lists are compared verbatim.
const sig6 = (x) => Number(x.toPrecision(6));
const snapshot = (r) => ({
  days: r.summary.map((row) => ({ day: row.day, purchases: row.purchases, credits: sig6(row.credits) })),
  'credits.final': sig6(r.metrics['credits.final']),
  'offersLeft.final': r.metrics['offersLeft.final'],
  'firstEvent:rig': sig6(r.metrics['firstEvent:rig']),
  'firstDay:roomComplete': r.metrics['firstDay:roomComplete'],
});
const FIXTURE = new URL('./fixtures/starter-expected.json', import.meta.url);

test('the default preset matches fixtures/starter-expected.json (UPDATE_FIXTURE=1 to regenerate)', () => {
  const actual = Object.fromEntries(Object.entries(runs).map(([id, r]) => [id, snapshot(r)]));
  if (process.env.UPDATE_FIXTURE === '1') writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n');
  assert.ok(existsSync(FIXTURE), 'fixture missing: run UPDATE_FIXTURE=1 npm test');
  const expected = JSON.parse(readFileSync(FIXTURE));
  assert.deepEqual(actual, expected);
});
