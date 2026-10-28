import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stress, VARIANTS } from '../model/stress.mjs';
import { loadDefaultPreset } from './default-preset.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = loadDefaultPreset();
const profiles = { active: load('../profiles/active.json'), casual: load('../profiles/casual.json') };
const targets = load('../targets/seven-day-idle.json');
const rows = stress({ config, profiles, targets, days: 7 });
const row = (profile, variant) => rows.find((r) => r.profile === profile && r.variant === variant);

test('one row per profile and applicable variant, base first; a variant that changes nothing is skipped', () => {
  assert.equal(VARIANTS[0].id, 'base');
  assert.deepEqual(rows.filter((r) => r.profile === 'active').map((r) => r.variant), VARIANTS.map((v) => v.id));
  assert.equal(row('casual', 'fewer-visits'), undefined, 'casual has one daily session: nothing to drop');
  for (const r of rows) {
    assert.ok(Number.isFinite(r.earned) && r.earned > 0, `${r.profile}/${r.variant}`);
    assert.ok(Number.isInteger(r.passes) && r.passes <= r.total);
    assert.equal(r.total, targets.length);
  }
});

test('base matches a plain run and is the 0% reference; perturbations move the week', () => {
  assert.equal(row('active', 'base').deltaPct, 0);
  assert.ok(row('active', 'slow-taps').earned < row('active', 'base').earned, 'slower taps earn less');
  assert.ok(row('casual', 'short-sessions').earned < row('casual', 'base').earned, 'shorter sessions earn less');
  for (const r of rows) close(r.deltaPct, 100 * (r.earned / row(r.profile, 'base').earned - 1));
});

test('rows carry the pacing checkpoints, undefined when the event never happened', () => {
  for (const key of ['firstEvent:rig', 'firstDay:rig', 'firstDay:roomComplete', 'firstEvent:loot']) {
    assert.ok(key in row('active', 'base').metrics, key);
  }
  assert.equal(row('active', 'base').metrics['firstDay:rig'], 1);
});

test('stress leaves the profiles and config it was given untouched', () => {
  assert.equal(profiles.active.sessions.day1.tps, 2.5);
  assert.equal(profiles.active.sessions.later.length, 3);
  assert.equal(profiles.casual.policy.saveForBigWithinMinutes, 30);
});

function close(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`); }
