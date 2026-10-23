import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHAPES, validateConfig, num, pos, bool, str, atLeast, nonNegInt, enumOf, list, record } from '../model/config.mjs';
import {
  EDITABLE_BLOCKS, kindOf, fieldsFor, columnsFor, formValue, displayValue, getAt, setAt, blankRow, groupErrors,
} from '../ui/editor.mjs';
import { fmt, fmtMetric } from '../ui/format.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));
const clone = () => structuredClone(preset);

test('EDITABLE_BLOCKS is every schema block except schema itself, in schema order', () => {
  assert.deepEqual(EDITABLE_BLOCKS, ['taps', 'bar', 'jobs', 'rigs', 'racks', 'items', 'events', 'offline']);
});

test('kindOf normalises string and object shapes', () => {
  assert.equal(kindOf(num), 'num');
  assert.equal(kindOf(bool), 'bool');
  assert.equal(kindOf(str), 'str');
  assert.equal(kindOf(pos), 'pos');
  assert.equal(kindOf(atLeast(1)), 'atLeast');
  assert.equal(kindOf(nonNegInt), 'nonNegInt');
  assert.equal(kindOf(enumOf(['a'])), 'enum');
  assert.equal(kindOf(list(num)), 'list');
  assert.equal(kindOf(record({})), 'record');
});

test('fieldsFor returns ordered descriptors: required keys first, then optional, with kind/options/min', () => {
  const fields = fieldsFor(SHAPES.items.keys.list.of);
  assert.deepEqual(fields.map((f) => f.name), ['id', 'type', 'name', 'cost', 'comfort', 'size', 'pay', 'speed', 'event']);
  assert.deepEqual(fields.map((f) => f.optional), [false, false, false, false, false, true, true, true, true]);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.id.kind, 'str');
  assert.equal(byName.type.kind, 'enum');
  assert.deepEqual(byName.type.options, ['tech', 'decor']);
  assert.equal(byName.cost.kind, 'pos');
  assert.equal(byName.comfort.kind, 'atLeast');
  assert.equal(byName.comfort.min, 0);
  assert.equal(byName.pay.min, 1);
  assert.equal(byName.event.kind, 'record');
  assert.equal(fieldsFor(SHAPES.racks).find((f) => f.name === 'largeSlots').kind, 'nonNegInt');
  assert.equal(fieldsFor(SHAPES.jobs).find((f) => f.name === 'list').kind, 'list');
  assert.throws(() => fieldsFor(num), /record/);
});

test('columnsFor flattens nested records into dotted optional columns', () => {
  const cols = columnsFor(SHAPES.items.keys.list.of);
  assert.deepEqual(cols.map((c) => c.name), ['id', 'type', 'name', 'cost', 'comfort', 'size', 'pay', 'speed', 'event.boost', 'event.dur']);
  const boost = cols.find((c) => c.name === 'event.boost');
  assert.equal(boost.kind, 'atLeast');
  assert.equal(boost.optional, true);
  assert.deepEqual(columnsFor(SHAPES.rigs.keys.list.of).map((c) => c.name), ['job', 'name', 'cost']);
});

test('formValue: empty text is undefined for scalars, numbers parse, garbage becomes NaN', () => {
  for (const shape of [num, pos, atLeast(1), nonNegInt, str, enumOf(['a'])]) assert.equal(formValue(shape, ''), undefined);
  assert.equal(formValue(num, '  '), undefined);
  assert.equal(formValue(num, '8'), 8);
  assert.equal(formValue(pos, '1.12'), 1.12);
  assert.equal(formValue(atLeast(1), ' 2 '), 2);
  assert.equal(formValue(nonNegInt, '3'), 3);
  assert.ok(Number.isNaN(formValue(num, 'abc')));
  assert.ok(Number.isNaN(formValue(pos, '1,5')));
  assert.equal(formValue(str, ' wifi '), 'wifi');
  assert.equal(formValue(enumOf(['tech', 'decor']), 'decor'), 'decor');
  assert.equal(formValue(enumOf(['tech', 'decor']), 'other'), 'other', 'the validator rejects bad enum values, not the editor');
});

test('formValue: booleans from checkboxes and from text', () => {
  assert.equal(formValue(bool, true), true);
  assert.equal(formValue(bool, false), false);
  assert.equal(formValue(bool, 'true'), true);
  assert.equal(formValue(bool, 'false'), false);
  assert.equal(formValue(bool, ''), false);
});

test('formValue: a list of scalars is comma-separated text', () => {
  assert.deepEqual(formValue(list(num), '25, 50'), [25, 50]);
  assert.deepEqual(formValue(list(num), ''), []);
  const bad = formValue(list(num), '25, x');
  assert.equal(bad[0], 25);
  assert.ok(Number.isNaN(bad[1]));
});

test('displayValue inverts formValue for controls', () => {
  assert.equal(displayValue(num, undefined), '');
  assert.equal(displayValue(num, 8), '8');
  assert.equal(displayValue(str, 'wifi'), 'wifi');
  assert.equal(displayValue(list(num), [25, 50]), '25, 50');
  assert.equal(displayValue(list(num), []), '');
  assert.equal(formValue(list(num), displayValue(list(num), [1, 2, 3])).join(), '1,2,3');
});

test('getAt reads nested paths by key, index and id', () => {
  assert.equal(getAt(preset, 'racks.cost'), 400);
  assert.equal(getAt(preset, 'jobs.list[2].cost'), 3000);
  assert.equal(getAt(preset, 'jobs.list[wifi].cost'), 6);
  assert.equal(getAt(preset, 'rigs.list[ceo].cost'), 100000);
  assert.equal(getAt(preset, 'items.list[lamp].event.boost'), 10);
  assert.equal(getAt(preset, 'items.list[gpu].event.boost'), undefined);
  assert.equal(getAt(preset, 'items.list[gpu].size'), 'large');
  assert.equal(getAt(preset, 'items.list[lamp].size'), undefined);
  assert.equal(getAt(preset, 'jobs.list[99].cost'), undefined);
  assert.equal(getAt(preset, 'jobs.list[nope].cost'), undefined);
  assert.equal(getAt(preset, 'nothing.here'), undefined);
  assert.throws(() => getAt(preset, 'jobs.list[2'), /malformed/);
});

test('setAt writes scalars and list rows in place and returns the config', () => {
  const cfg = clone();
  assert.equal(setAt(cfg, 'jobs.list[2].cost', 8), cfg);
  assert.equal(cfg.jobs.list[2].cost, 8);
  setAt(cfg, 'jobs.list[wifi].cost', 8);
  assert.equal(cfg.jobs.list[0].cost, 8);
  setAt(cfg, 'racks.largeSlots', 4);
  assert.equal(cfg.racks.largeSlots, 4);
  setAt(cfg, 'taps.enabled', false);
  assert.equal(cfg.taps.enabled, false);
  setAt(cfg, 'jobs.milestones', [10, 25]);
  assert.deepEqual(cfg.jobs.milestones, [10, 25]);
  assert.deepEqual(validateConfig(cfg), []);
  assert.equal(preset.jobs.list[0].cost, 6, 'the preset itself is untouched');
});

test('setAt with undefined deletes the key; setting through an absent record creates it', () => {
  const cfg = clone();
  setAt(cfg, 'items.list[gpu].pay', undefined);
  assert.equal('pay' in cfg.items.list[0], false);
  setAt(cfg, 'items.list[gpu].event.boost', 5);
  assert.deepEqual(cfg.items.list[0].event, { boost: 5 });
  assert.equal(validateConfig(cfg).some((e) => e.path === 'items.list[0].event.dur'), true);
  setAt(cfg, 'items.list[fiber].event.dur', undefined);
  assert.equal('event' in cfg.items.list[1], false, 'deleting under an absent record creates nothing');
  setAt(cfg, 'jobs.list[1].cost', undefined);
  assert.deepEqual(validateConfig(cfg).filter((e) => e.path === 'jobs.list[1].cost'), [{ path: 'jobs.list[1].cost', message: 'missing required key' }]);
  assert.throws(() => setAt(cfg, 'jobs.list[nope].cost', 1), /no such entry/);
});

test('a NaN written by the editor surfaces as a validator error at the same path', () => {
  const cfg = clone();
  setAt(cfg, 'jobs.list[wifi].cost', formValue(pos, 'abc'));
  const errs = groupErrors(validateConfig(cfg));
  assert.deepEqual(errs.get('jobs.list[0].cost'), ['expected positive number, got NaN']);
});

test('blankRow has every required key, which the validator then flags until filled', () => {
  const row = blankRow(SHAPES.jobs.keys.list.of);
  assert.deepEqual(Object.keys(row), ['id', 'name', 'time', 'pay', 'cost', 'r', 'rep', 'unlock']);
  const cfg = clone();
  cfg.jobs.list.push(row);
  const paths = validateConfig(cfg).map((e) => e.path);
  assert.ok(paths.includes('jobs.list[6].cost'));
  assert.ok(!paths.includes('jobs.list[6].id'));
  const item = blankRow(SHAPES.items.keys.list.of);
  assert.equal(item.type, 'tech');
  assert.equal('size' in item, false, 'optional keys stay absent');
});

test('fmt and fmtMetric', () => {
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1234), '1.23K');
  assert.equal(fmt(2.5), '2.5');
  assert.equal(fmt(-1500000), '-1.50M');
  assert.equal(fmt(Infinity), '∞');
  assert.equal(fmtMetric(3), '3');
  assert.equal(fmtMetric(3.14159), '3.14');
  assert.equal(fmtMetric([1, 2.5]), '1, 2.50');
});
