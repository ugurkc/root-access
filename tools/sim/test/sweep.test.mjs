import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPath, setPath, sweep } from '../model/sweep.mjs';
import { loadDefaultPreset } from './default-preset.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = loadDefaultPreset();
const profiles = { active: load('../profiles/active.json'), casual: load('../profiles/casual.json') };
const targets = load('../targets/seven-day-idle.json');

test('getPath/setPath address array entries by id, by job (rigs) or by index, nested lists included', () => {
  const cfg = structuredClone(config);
  assert.equal(getPath(cfg, 'jobs.list[wifi].cost'), 5);
  assert.equal(getPath(cfg, 'jobs.list[1].id'), 'stream');
  assert.equal(getPath(cfg, 'rigs.list[stream].cost'), 600);
  assert.equal(getPath(cfg, 'classes.list[computer].tiers[0].value'), 1.15);
  assert.equal(getPath(cfg, 'classes.list[rack].tiers[0].cost'), 60);
  setPath(cfg, 'jobs.list[wifi].cost', 9);
  setPath(cfg, 'rigs.list[stream].cost', 1);
  setPath(cfg, 'taps.enabled', false);
  assert.equal(cfg.jobs.list[0].cost, 9);
  assert.equal(cfg.rigs.list[1].cost, 1);
  assert.equal(cfg.taps.enabled, false);
  assert.equal(config.jobs.list[0].cost, 5, 'the original is untouched');
});

test('getPath/setPath reject paths that do not exist', () => {
  for (const path of ['jobs.list[nope].cost', 'jobs.list[99].cost', 'jobs.nope', 'jobs.list[wifi].nope', 'offline.capHours.deeper', '']) {
    assert.throws(() => getPath(config, path), new RegExp(path.replace(/[[\]\\.]/g, '\\$&') || 'empty'), path);
    assert.throws(() => setPath(structuredClone(config), path, 1), path);
  }
});

test('sweep over two values yields two rows with total = targets × profiles', () => {
  const rows = sweep({ config, profiles, targets, days: 7, params: [{ path: 'jobs.list[wifi].cost', values: [5, 10] }] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.values), [{ 'jobs.list[wifi].cost': 5 }, { 'jobs.list[wifi].cost': 10 }]);
  for (const row of rows) {
    assert.equal(row.total, targets.length * Object.keys(profiles).length);
    assert.ok(Number.isInteger(row.passes) && row.passes >= 0 && row.passes <= row.total);
    assert.deepEqual(Object.keys(row.metrics), ['active', 'casual']);
    for (const m of Object.values(row.metrics)) {
      assert.deepEqual(Object.keys(m), ['firstEvent:rig', 'rigs.count', 'credits.final', 'offersLeft.final']);
    }
  }
  // The first row is the preset itself: 10 of 12 pass, as in the targets test (2026-10-28 baseline).
  assert.equal(rows[0].passes, 10);
  assert.ok(Math.abs(rows[0].metrics.active['firstEvent:rig'] - 29.2) < 1e-9, String(rows[0].metrics.active['firstEvent:rig']));
  assert.notEqual(rows[1].metrics.active['credits.final'], rows[0].metrics.active['credits.final']);
  assert.equal(config.jobs.list[0].cost, 5, 'the config passed in is untouched');
});

test('two params sweep the cartesian product, first param outermost', () => {
  const rows = sweep({ config, profiles: { casual: profiles.casual }, targets: [], days: 2,
    params: [{ path: 'classes.list[rack].tiers[0].cost', values: [60, 120] }, { path: 'taps.rate', values: [0.25, 0.5, 1] }] });
  assert.deepEqual(rows.map((r) => [r.values['classes.list[rack].tiers[0].cost'], r.values['taps.rate']]),
    [[60, 0.25], [60, 0.5], [60, 1], [120, 0.25], [120, 0.5], [120, 1]]);
  for (const row of rows) assert.deepEqual([row.passes, row.total], [0, 0]);
});

test('sweep refuses a combination that makes the config invalid', () => {
  assert.throws(() => sweep({ config, profiles, targets, params: [{ path: 'jobs.list[wifi].cost', values: [5, -1] }] }), /jobs\.list\[0\]\.cost/);
});
