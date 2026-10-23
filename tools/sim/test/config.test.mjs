import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../model/config.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));

test('the v2 preset validates', () => {
  assert.deepEqual(validateConfig(preset), []);
});

test('unknown block is reported with its path', () => {
  const errs = validateConfig({ ...preset, bogus: {} });
  assert.ok(errs.some(e => e.path === 'bogus'));
});

test('wrong type is reported with its path', () => {
  const bad = structuredClone(preset);
  bad.jobs.list[0].cost = 'six';
  assert.ok(validateConfig(bad).some(e => e.path === 'jobs.list[0].cost'));
});

test('a zero rig price is reported at its path', () => {
  const bad = structuredClone(preset);
  bad.rigs.list[0].cost = 0;
  assert.ok(validateConfig(bad).some(e => e.path === 'rigs.list[0].cost'));
});

test('rig must reference an existing job', () => {
  const bad = structuredClone(preset);
  bad.rigs.list[0].job = 'nope';
  assert.ok(validateConfig(bad).some(e => e.path === 'rigs.list[0].job'));
});

test('a non-object config is an error, not a crash', () => {
  assert.ok(validateConfig(null).some(e => e.path === ''));
});

test('unsupported schema version is reported', () => {
  const errs = validateConfig({ ...preset, schema: 2 });
  assert.deepEqual(errs, [{ path: 'schema', message: 'unsupported schema 2, expected 1' }]);
});

test('NaN and Infinity are not numbers', () => {
  const bad = structuredClone(preset);
  bad.taps.rate = NaN;
  bad.bar.speed = Infinity;
  const paths = validateConfig(bad).map(e => e.path);
  assert.deepEqual(paths, ['taps.rate', 'bar.speed']);
});

test('a malformed rig yields one root-cause error, not a cascade', () => {
  const bad = structuredClone(preset);
  delete bad.rigs.list[0].job;
  assert.deepEqual(validateConfig(bad), [{ path: 'rigs.list[0].job', message: 'missing required key' }]);
});

test('duplicate ids are reported at the second occurrence', () => {
  const bad = structuredClone(preset);
  bad.jobs.list[1].id = 'wifi';
  bad.items.list[2].id = 'gpu';
  const errs = validateConfig(bad);
  assert.ok(errs.some(e => e.path === 'jobs.list[1].id' && e.message === 'duplicate id "wifi"'));
  assert.ok(errs.some(e => e.path === 'items.list[2].id' && e.message === 'duplicate id "gpu"'));
});

test('item type and size are enums', () => {
  const bad = structuredClone(preset);
  bad.items.list[0].type = 'weird';
  bad.items.list[1].size = 'huge';
  const paths = validateConfig(bad).map(e => e.path);
  assert.deepEqual(paths, ['items.list[0].type', 'items.list[1].size']);
});

test('a missing block is exactly one missing-key error', () => {
  const bad = structuredClone(preset);
  delete bad.offline;
  assert.deepEqual(validateConfig(bad), [{ path: 'offline', message: 'missing required key' }]);
});

test('a zero job time is reported: times, costs and growth must be positive', () => {
  const bad = structuredClone(preset);
  bad.jobs.list[0].time = 0;
  bad.offline.capHours = -1;
  const paths = validateConfig(bad).map(e => e.path);
  assert.ok(paths.includes('jobs.list[0].time'));
  assert.ok(paths.includes('offline.capHours'));
});

const broken = (mutate) => { const bad = structuredClone(preset); mutate(bad); return validateConfig(bad); };
const reportsAt = (errs, path) => assert.ok(errs.some(e => e.path === path), JSON.stringify(errs));

test('an item pay below 1 is reported: it is a multiplier', () => {
  reportsAt(broken(c => { c.items.list[0].pay = 0.9; }), 'items.list[0].pay');
});

test('an item speed below 1 is reported', () => {
  reportsAt(broken(c => { c.items.list[1].speed = 0.5; }), 'items.list[1].speed');
});

test('negative item comfort is reported', () => {
  reportsAt(broken(c => { c.items.list[0].comfort = -1; }), 'items.list[0].comfort');
});

test('negative event boost or duration is reported', () => {
  reportsAt(broken(c => { c.items.list[5].event.boost = -1; }), 'items.list[5].event.boost');
  reportsAt(broken(c => { c.items.list[5].event.dur = -1; }), 'items.list[5].event.dur');
});

test('events.min + max must be positive: the mean interval divides', () => {
  reportsAt(broken(c => { c.events.min = 0; c.events.max = 0; }), 'events.min');
  assert.deepEqual(broken(c => { c.events.min = 0; c.events.max = 10; }), []);
});

test('rack slot counts are non-negative integers', () => {
  reportsAt(broken(c => { c.racks.largeSlots = -1; }), 'racks.largeSlots');
  reportsAt(broken(c => { c.racks.decorSlots = 1.5; }), 'racks.decorSlots');
  reportsAt(broken(c => { c.racks.holds = -2; }), 'racks.holds');
});

test('items.maxLevel must be at least 1', () => {
  reportsAt(broken(c => { c.items.maxLevel = 0; }), 'items.maxLevel');
});

test('tech items need a size and decor items must not have one', () => {
  reportsAt(broken(c => { delete c.items.list[0].size; }), 'items.list[0].size');
  reportsAt(broken(c => { c.items.list[5].size = 'small'; }), 'items.list[5].size');
});
