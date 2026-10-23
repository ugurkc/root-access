import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getPath, setPath, sweep } from '../model/sweep.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = load('../presets/v2-2026-10-23.json');
const profiles = { active: load('../profiles/active.json'), casual: load('../profiles/casual.json') };
const targets = load('../targets/seven-day-idle.json');

test('getPath/setPath address array entries by id, by job (rigs) or by index', () => {
  const cfg = structuredClone(config);
  assert.equal(getPath(cfg, 'jobs.list[wifi].cost'), 6);
  assert.equal(getPath(cfg, 'jobs.list[1].id'), 'ceo');
  assert.equal(getPath(cfg, 'rigs.list[ceo].cost'), 100000);
  assert.equal(getPath(cfg, 'items.list[gpu].pay'), 1.25);
  assert.equal(getPath(cfg, 'racks.cost'), 400);
  setPath(cfg, 'jobs.list[wifi].cost', 9);
  setPath(cfg, 'rigs.list[ceo].cost', 1);
  setPath(cfg, 'taps.enabled', false);
  assert.equal(cfg.jobs.list[0].cost, 9);
  assert.equal(cfg.rigs.list[1].cost, 1);
  assert.equal(cfg.taps.enabled, false);
  assert.equal(config.jobs.list[0].cost, 6, 'the original is untouched');
});

test('getPath/setPath reject paths that do not exist', () => {
  for (const path of ['jobs.list[nope].cost', 'jobs.list[99].cost', 'jobs.nope', 'jobs.list[wifi].nope', 'racks.cost.deeper', '']) {
    assert.throws(() => getPath(config, path), new RegExp(path.replace(/[[\]\\.]/g, '\\$&') || 'empty'), path);
    assert.throws(() => setPath(structuredClone(config), path, 1), path);
  }
});

test('sweep over two values yields two rows with total = targets × profiles', () => {
  const rows = sweep({ config, profiles, targets, days: 7, params: [{ path: 'jobs.list[wifi].cost', values: [6, 12] }] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.values), [{ 'jobs.list[wifi].cost': 6 }, { 'jobs.list[wifi].cost': 12 }]);
  for (const row of rows) {
    assert.equal(row.total, targets.length * Object.keys(profiles).length);
    assert.ok(Number.isInteger(row.passes) && row.passes >= 0 && row.passes <= row.total);
    assert.deepEqual(Object.keys(row.metrics), ['active', 'casual']);
    for (const m of Object.values(row.metrics)) {
      assert.deepEqual(Object.keys(m), ['firstEvent:rig', 'rigs.count', 'credits.final', 'offersLeft.final']);
    }
  }
  // The first row is the preset itself: 7 of 10 pass, as in the targets test.
  assert.equal(rows[0].passes, 7);
  assert.equal(rows[0].metrics.active['firstEvent:rig'], 56);
  assert.notEqual(rows[1].metrics.active['credits.final'], rows[0].metrics.active['credits.final']);
  assert.equal(config.jobs.list[0].cost, 6, 'the config passed in is untouched');
});

test('two params sweep the cartesian product, first param outermost', () => {
  const rows = sweep({ config, profiles: { casual: profiles.casual }, targets: [], days: 2,
    params: [{ path: 'racks.cost', values: [400, 800] }, { path: 'taps.rate', values: [0.25, 0.5, 1] }] });
  assert.deepEqual(rows.map((r) => [r.values['racks.cost'], r.values['taps.rate']]),
    [[400, 0.25], [400, 0.5], [400, 1], [800, 0.25], [800, 0.5], [800, 1]]);
  for (const row of rows) assert.deepEqual([row.passes, row.total], [0, 0]);
});

test('sweep refuses a combination that makes the config invalid', () => {
  assert.throws(() => sweep({ config, profiles, targets, params: [{ path: 'jobs.list[wifi].cost', values: [6, -1] }] }), /jobs\.list\[0\]\.cost/);
});
