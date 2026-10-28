import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { seriesFromResult, markerValue, MARKER_KINDS, KIND_STYLE } from '../ui/charts.mjs';
import { loadDefaultPreset } from './default-preset.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const config = loadDefaultPreset();
const active = load('../profiles/active.json');

const result = {
  summary: [
    { day: 1, credits: 100, incomePassive: 2 },
    { day: 2, credits: 1000, incomePassive: 6 },
  ],
  timeline: [
    { t: 0, day: 1, kind: 'level', id: 'wifi', cost: 6 },
    { t: 7200, day: 1, kind: 'rig', id: 'wifi', cost: 50 },
    { t: 3600 * 24, day: 2, kind: 'offline', seconds: 100, earned: 1 },
    { t: 3600 * 36, day: 2, kind: 'class', id: 'class:desk', cost: 400 },
    { t: 3600 * 38, day: 2, kind: 'loot', id: 'loot:wifi', earned: 24, drops: 2 },
    { t: 3600 * 40, day: 2, kind: 'tier', id: 'class:desk', cost: 800 },
  ],
  metrics: {},
};

test('seriesFromResult: day boundaries become the line points, with a zero start at the day-1 start hour', () => {
  const s = seriesFromResult(result, 'active', { day1StartHour: 12 });
  assert.equal(s.profile, 'active');
  assert.deepEqual(s.credits, [{ x: 0.5, y: 0 }, { x: 1, y: 100 }, { x: 2, y: 1000 }]);
  assert.deepEqual(s.passive, [{ x: 0.5, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 6 }]);
});

test('seriesFromResult: one marker per rig, class, tier and loot event with x on the wall clock in days', () => {
  const s = seriesFromResult(result, 'active', { day1StartHour: 12 });
  assert.deepEqual(MARKER_KINDS, ['rig', 'class', 'tier', 'loot']);
  assert.deepEqual(s.markers.map((m) => [m.kind, m.id, m.cost]), [
    ['rig', 'wifi', 50], ['class', 'class:desk', 400], ['loot', 'loot:wifi', undefined], ['tier', 'class:desk', 800],
  ]);
  assert.deepEqual(s.markers.map((m) => m.x), [(12 * 3600 + 7200) / 86400, 2, (12 * 3600 + 38 * 3600) / 86400, (12 * 3600 + 40 * 3600) / 86400]);
});

test('a loot marker carries earned and drops; markerValue is earned when there is no cost', () => {
  const s = seriesFromResult(result, 'active', { day1StartHour: 12 });
  const loot = s.markers.find((m) => m.kind === 'loot');
  assert.equal(loot.earned, 24);
  assert.equal(loot.drops, 2);
  assert.equal(markerValue(loot), 24);
  assert.equal(markerValue(s.markers[0]), 50, 'a purchase marker is valued at its cost');
  assert.equal(s.markers[0].earned, undefined);
});

test('every marker kind has a point style', () => {
  for (const kind of MARKER_KINDS) assert.equal(typeof KIND_STYLE[kind]?.pointStyle, 'string', kind);
  assert.equal(new Set(MARKER_KINDS.map((k) => KIND_STYLE[k].pointStyle)).size, MARKER_KINDS.length, 'styles are distinct');
  assert.equal(KIND_STYLE.loot.hollow, true, 'loot is not a purchase and looks different');
});

test('seriesFromResult: a marker carries the passive line interpolated at its x', () => {
  const s = seriesFromResult(result, 'active', { day1StartHour: 12 });
  // rig at x = 14/24 between (0.5, 0) and (1, 2): 2 * (14/24 - 0.5) / 0.5
  assert.ok(Math.abs(s.markers[0].passive - 2 * ((14 / 24 - 0.5) / 0.5)) < 1e-9);
  assert.equal(s.markers[1].passive, 6); // exactly at the day-2 boundary
  // tier at x = 52/24 lies past the last point: clamped to the day's end value
  assert.equal(s.markers[3].passive, 6);
});

test('seriesFromResult: default day1StartHour is 0 and odd results give empty series, not throws', () => {
  const s = seriesFromResult(result, 'p');
  assert.deepEqual(s.credits[0], { x: 0, y: 0 });
  assert.equal(s.markers[0].x, 7200 / 86400);
  assert.deepEqual(seriesFromResult(undefined, 'p'), { profile: 'p', credits: [{ x: 0, y: 0 }], passive: [{ x: 0, y: 0 }], markers: [] });
  assert.deepEqual(seriesFromResult({ summary: null, timeline: 'x' }, 'p').markers, []);
});

test('seriesFromResult on a real 7-day run: 8 points per line, markers inside the run and all finite', () => {
  const r = run({ config: structuredClone(config), profile: active, days: 7 });
  const s = seriesFromResult(r, active.id, { day1StartHour: active.sessions.day1.hour });
  assert.equal(s.credits.length, 8);
  assert.equal(s.passive.length, 8);
  assert.ok(s.markers.length > 0);
  for (const m of s.markers) {
    assert.ok(m.x >= 20 / 24 && m.x <= 7, `marker x ${m.x} inside the run`);
    assert.ok(Number.isFinite(markerValue(m)) && Number.isFinite(m.passive), `${m.kind} ${m.id} has a finite value`);
    assert.ok(MARKER_KINDS.includes(m.kind));
  }
  const kinds = r.timeline.filter((e) => MARKER_KINDS.includes(e.kind)).length;
  assert.equal(s.markers.length, kinds);
  assert.ok(s.markers.some((m) => m.kind === 'class'), 'the starter run buys at least one class');
});
