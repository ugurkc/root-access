import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, validateConfig, SCHEMA } from '../model/config.mjs';
import { base, tier } from './fixtures/starter-base.mjs';

const idx = (id) => base().classes.list.findIndex((c) => c.id === id);
const DESK = idx('desk');
const CAT = idx('cat');
const RACK = idx('rack');

const broken = (mutate) => { const bad = base(); mutate(bad); return validateConfig(bad); };
const reportsAt = (errs, path) => assert.ok(errs.some((e) => e.path === path), JSON.stringify(errs));

test('schema is 2 and the blocks are the starter home set', () => {
  assert.equal(SCHEMA, 2);
  assert.deepEqual(Object.keys(SHAPES), ['schema', 'taps', 'bar', 'jobs', 'rigs', 'classes', 'events', 'loot', 'offline']);
  assert.deepEqual(validateConfig(base()), []);
});

test('items and racks blocks are rejected as unknown', () => {
  const cfg = base();
  cfg.items = { enabled: false };
  assert.deepEqual(validateConfig(cfg).map((e) => e.path), ['items']);
  cfg.racks = { enabled: false };
  assert.deepEqual(validateConfig(cfg).map((e) => e.path), ['items', 'racks']);
});

test('unknown block is reported with its path', () => {
  assert.ok(broken((c) => { c.bogus = {}; }).some((e) => e.path === 'bogus'));
});

test('wrong type is reported with its path', () => {
  reportsAt(broken((c) => { c.jobs.list[0].cost = 'six'; }), 'jobs.list[0].cost');
});

test('a zero rig price is reported at its path', () => {
  reportsAt(broken((c) => { c.rigs.list[0].cost = 0; }), 'rigs.list[0].cost');
});

test('rig must reference an existing job', () => {
  reportsAt(broken((c) => { c.rigs.list[0].job = 'nope'; }), 'rigs.list[0].job');
});

test('a non-object config is an error, not a crash', () => {
  assert.ok(validateConfig(null).some((e) => e.path === ''));
});

test('unsupported schema version is reported', () => {
  assert.deepEqual(broken((c) => { c.schema = 1; }), [{ path: 'schema', message: 'unsupported schema 1, expected 2' }]);
});

test('NaN and Infinity are not numbers', () => {
  const paths = broken((c) => { c.taps.rate = NaN; c.bar.speed = Infinity; }).map((e) => e.path);
  assert.deepEqual(paths, ['taps.rate', 'bar.speed']);
});

test('a malformed rig yields one root-cause error, not a cascade', () => {
  assert.deepEqual(broken((c) => { delete c.rigs.list[0].job; }), [{ path: 'rigs.list[0].job', message: 'missing required key' }]);
});

test('duplicate job ids are reported at the second occurrence', () => {
  const errs = broken((c) => { c.jobs.list[1].id = 'wifi'; });
  assert.deepEqual(errs, [{ path: 'jobs.list[1].id', message: 'duplicate id "wifi"' }]);
});

test('a class needs at least one tier, a known effect and unique ids', () => {
  const cfg = base();
  cfg.classes.list[DESK].tiers = [];
  cfg.classes.list[CAT].effect = 'speed';
  cfg.classes.list.push({ id: 'desk', name: 'Again', effect: 'none', tiers: [tier()] });
  const last = cfg.classes.list.length - 1;
  const paths = validateConfig(cfg).map((e) => `${e.path}: ${e.message}`);
  assert.ok(paths.includes(`classes.list[${DESK}].tiers: at least one tier`), paths);
  assert.ok(paths.some((p) => p.startsWith(`classes.list[${CAT}].effect: expected one of`)), paths);
  assert.ok(paths.includes(`classes.list[${last}].id: duplicate id "desk"`), paths);
});

test('a class that is not an object or whose tiers is not an array is one shape error, not a tiers error', () => {
  assert.deepEqual(broken((c) => { c.classes.list[DESK] = 5; }), [{ path: `classes.list[${DESK}]`, message: 'expected object, got number' }]);
  assert.deepEqual(broken((c) => { c.classes.list[DESK].tiers = 'x'; }), [{ path: `classes.list[${DESK}].tiers`, message: 'expected array, got string' }]);
});

test('tier value is at least 1 and comfort at least 0', () => {
  const paths = broken((c) => {
    c.classes.list[DESK].tiers[0].value = 0.9;
    c.classes.list[DESK].tiers[0].comfort = -1;
  }).map((e) => e.path);
  assert.deepEqual(paths, [`classes.list[${DESK}].tiers[0].value`, `classes.list[${DESK}].tiers[0].comfort`]);
});

test('a zero tier cost is reported: it is a price', () => {
  reportsAt(broken((c) => { c.classes.list[DESK].tiers[0].cost = 0; }), `classes.list[${DESK}].tiers[0].cost`);
});

test('class event is optional, but its boost and duration must not be negative', () => {
  assert.deepEqual(broken((c) => { delete c.classes.list[CAT].event; }), []);
  reportsAt(broken((c) => { c.classes.list[CAT].event.boost = -1; }), `classes.list[${CAT}].event.boost`);
  reportsAt(broken((c) => { c.classes.list[CAT].event.dur = -1; }), `classes.list[${CAT}].event.dur`);
});

test('loot chance is a probability and job loot texts are strings', () => {
  const paths = broken((c) => { c.loot.chance = 1.5; c.jobs.list[0].loot = [3]; }).map((e) => e.path);
  assert.deepEqual(paths, ['jobs.list[0].loot[0]', 'loot.chance']);
});

test('loot chance accepts the bounds 0 and 1 and rejects negatives and NaN', () => {
  assert.deepEqual(broken((c) => { c.loot.chance = 0; }), []);
  assert.deepEqual(broken((c) => { c.loot.chance = 1; }), []);
  reportsAt(broken((c) => { c.loot.chance = -0.1; }), 'loot.chance');
  reportsAt(broken((c) => { c.loot.chance = NaN; }), 'loot.chance');
  reportsAt(broken((c) => { c.loot.chance = '0.5'; }), 'loot.chance');
});

test('job loot is optional; loot payRuns may be zero but not negative', () => {
  assert.deepEqual(broken((c) => { delete c.jobs.list[0].loot; }), []);
  assert.deepEqual(broken((c) => { c.loot.payRuns = 0; }), []);
  reportsAt(broken((c) => { c.loot.payRuns = -1; }), 'loot.payRuns');
});

test('a rigSlots class is accepted and its tier values are whole slot counts', () => {
  assert.equal(base().classes.list[RACK].effect, 'rigSlots');
  assert.deepEqual(broken((c) => { c.classes.list[RACK].tiers[0].value = 3; }), []);
  assert.deepEqual(broken((c) => { c.classes.list[RACK].tiers[0].value = 2.5; }),
    [{ path: `classes.list[${RACK}].tiers[0].value`, message: 'rig slot count must be an integer' }]);
  // A rack tier that adds no slot is caught by the tier value floor (≥ 1), once, not twice.
  assert.deepEqual(broken((c) => { c.classes.list[RACK].tiers[0].value = 0; }).map((e) => e.path), [`classes.list[${RACK}].tiers[0].value`]);
  // Other effects keep fractional multipliers.
  assert.deepEqual(broken((c) => { c.classes.list[DESK].tiers[0].value = 2.5; }), []);
});

test('a missing block is exactly one missing-key error', () => {
  assert.deepEqual(broken((c) => { delete c.offline; }), [{ path: 'offline', message: 'missing required key' }]);
  assert.deepEqual(broken((c) => { delete c.loot; }), [{ path: 'loot', message: 'missing required key' }]);
});

test('a zero job time is reported: times, costs and growth must be positive', () => {
  const paths = broken((c) => { c.jobs.list[0].time = 0; c.offline.capHours = -1; }).map((e) => e.path);
  assert.ok(paths.includes('jobs.list[0].time'));
  assert.ok(paths.includes('offline.capHours'));
});

test('events.min + max must be positive: the mean interval divides', () => {
  reportsAt(broken((c) => { c.events.min = 0; c.events.max = 0; }), 'events.min');
  assert.deepEqual(broken((c) => { c.events.min = 0; c.events.max = 10; }), []);
});
