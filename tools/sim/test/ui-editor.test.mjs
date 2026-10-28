import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, validateConfig, num, pos, bool, str, atLeast, nonNegInt, prob, enumOf, list, record } from '../model/config.mjs';
import {
  EDITABLE_BLOCKS, NUMERIC_KINDS, kindOf, isRecordList, fieldsFor, columnsFor, formValue, displayValue, getAt, setAt, blankRow,
  groupErrors, holderPathFor, parsePath,
} from '../ui/editor.mjs';
import { parsePath as sweepParsePath } from '../model/sweep.mjs';
import { fmt, fmtMetric } from '../ui/format.mjs';
import { loadDefaultPreset } from './default-preset.mjs';
import { base } from './fixtures/starter-base.mjs';

const CLASS = SHAPES.classes.keys.list.of; // one classes.list entry
const TIER = CLASS.keys.tiers.of;          // one tier
const JOB = SHAPES.jobs.keys.list.of;
const preset = loadDefaultPreset();

test('EDITABLE_BLOCKS is every schema block except schema itself, in schema order', () => {
  assert.deepEqual(EDITABLE_BLOCKS, ['taps', 'bar', 'jobs', 'rigs', 'classes', 'events', 'loot', 'offline']);
});

test('kindOf normalises string and object shapes', () => {
  assert.equal(kindOf(num), 'num');
  assert.equal(kindOf(bool), 'bool');
  assert.equal(kindOf(str), 'str');
  assert.equal(kindOf(pos), 'pos');
  assert.equal(kindOf(atLeast(1)), 'atLeast');
  assert.equal(kindOf(nonNegInt), 'nonNegInt');
  assert.equal(kindOf(prob), 'prob');
  assert.equal(kindOf(enumOf(['a'])), 'enum');
  assert.equal(kindOf(list(num)), 'list');
  assert.equal(kindOf(record({})), 'record');
});

test('NUMERIC_KINDS covers every numeric shape kind, prob included', () => {
  for (const k of ['num', 'pos', 'atLeast', 'nonNegInt', 'prob']) assert.ok(NUMERIC_KINDS.has(k), k);
  for (const k of ['bool', 'str', 'enum', 'list', 'record']) assert.ok(!NUMERIC_KINDS.has(k), k);
});

test('isRecordList: a list of records, and nothing else', () => {
  assert.equal(isRecordList(CLASS.keys.tiers), true);
  assert.equal(isRecordList(SHAPES.jobs.keys.list), true);
  assert.equal(isRecordList(list(str)), false);
  assert.equal(isRecordList(list(num)), false);
  assert.equal(isRecordList(record({})), false);
  assert.equal(isRecordList(num), false);
});

test('fieldsFor returns ordered descriptors: required keys first, then optional, with kind/options/min/max', () => {
  const fields = fieldsFor(CLASS);
  assert.deepEqual(fields.map((f) => f.name), ['id', 'name', 'effect', 'tiers', 'event']);
  assert.deepEqual(fields.map((f) => f.optional), [false, false, false, false, true]);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  assert.equal(byName.id.kind, 'str');
  assert.equal(byName.effect.kind, 'enum');
  assert.deepEqual(byName.effect.options, ['pay', 'tapAdvance', 'rigSpeed', 'tapMoney', 'barBonus', 'rigSlots', 'none']);
  assert.equal(byName.tiers.kind, 'list');
  assert.equal(kindOf(byName.tiers.shape.of), 'record');
  assert.equal(byName.event.kind, 'record');

  const tier = Object.fromEntries(fieldsFor(TIER).map((f) => [f.name, f]));
  assert.deepEqual(Object.keys(tier), ['name', 'cost', 'value', 'comfort']);
  assert.equal(tier.cost.kind, 'pos');
  assert.equal(tier.cost.min, 0);
  assert.equal(tier.value.kind, 'atLeast');
  assert.equal(tier.value.min, 1);
  assert.equal(tier.comfort.min, 0);

  const loot = Object.fromEntries(fieldsFor(SHAPES.loot).map((f) => [f.name, f]));
  assert.equal(loot.chance.kind, 'prob');
  assert.equal(loot.chance.min, 0);
  assert.equal(loot.chance.max, 1);
  assert.equal(loot.payRuns.max, undefined, 'only prob has an upper bound');

  assert.equal(fieldsFor(SHAPES.jobs).find((f) => f.name === 'list').kind, 'list');
  assert.equal(fieldsFor(JOB).find((f) => f.name === 'loot').optional, true);
  assert.throws(() => fieldsFor(num), /record/);
});

test('columnsFor flattens nested records into dotted optional columns and keeps a list of records as one column', () => {
  const cols = columnsFor(CLASS);
  assert.deepEqual(cols.map((c) => c.name), ['id', 'name', 'effect', 'tiers', 'event.boost', 'event.dur']);
  const boost = cols.find((c) => c.name === 'event.boost');
  assert.equal(boost.kind, 'atLeast');
  assert.equal(boost.optional, true);
  const tiers = cols.find((c) => c.name === 'tiers');
  assert.equal(tiers.kind, 'list');
  assert.equal(kindOf(tiers.shape.of), 'record');
  assert.equal(tiers.optional, false);
  assert.deepEqual(columnsFor(SHAPES.rigs.keys.list.of).map((c) => c.name), ['job', 'name', 'cost']);
  assert.deepEqual(columnsFor(JOB).map((c) => c.name), ['id', 'name', 'time', 'pay', 'cost', 'r', 'rep', 'unlock', 'loot']);
});

test('formValue: empty text is undefined for scalars, numbers parse, garbage becomes NaN', () => {
  for (const shape of [num, pos, atLeast(1), nonNegInt, prob, str, enumOf(['a'])]) assert.equal(formValue(shape, ''), undefined);
  assert.equal(formValue(num, '  '), undefined);
  assert.equal(formValue(num, '8'), 8);
  assert.equal(formValue(pos, '1.12'), 1.12);
  assert.equal(formValue(atLeast(1), ' 2 '), 2);
  assert.equal(formValue(nonNegInt, '3'), 3);
  assert.equal(formValue(prob, '0.02'), 0.02);
  assert.equal(formValue(prob, '2'), 2, 'the validator rejects out-of-range probabilities, not the editor');
  assert.ok(Number.isNaN(formValue(num, 'abc')));
  assert.ok(Number.isNaN(formValue(pos, '1,5')));
  assert.equal(formValue(str, ' wifi '), 'wifi');
  assert.equal(formValue(enumOf(['pay', 'none']), 'none'), 'none');
  assert.equal(formValue(enumOf(['pay', 'none']), 'other'), 'other', 'the validator rejects bad enum values, not the editor');
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
  assert.deepEqual(formValue(list(num), '1,,2,'), [1, 2], 'empty tokens are dropped');
  assert.deepEqual(formValue(list(num), ' , '), []);
  assert.deepEqual(formValue(list(str), 'a login, a folder'), ['a login', 'a folder']);
  const bad = formValue(list(num), '25, x');
  assert.equal(bad[0], 25);
  assert.ok(Number.isNaN(bad[1]));
});

test('formValue: a list of records is JSON text; anything but a JSON array is undefined', () => {
  const tiers = CLASS.keys.tiers;
  assert.deepEqual(formValue(tiers, '[{"name":"a","cost":1,"value":1,"comfort":0}]'), [{ name: 'a', cost: 1, value: 1, comfort: 0 }]);
  assert.deepEqual(formValue(tiers, ' [] '), []);
  assert.equal(formValue(tiers, 'not json'), undefined);
  assert.equal(formValue(tiers, '{"name":"a"}'), undefined, 'JSON, but not an array');
  assert.equal(formValue(tiers, '"a"'), undefined);
  assert.equal(formValue(tiers, ''), undefined);
});

test('displayValue inverts formValue for controls', () => {
  assert.equal(displayValue(num, undefined), '');
  assert.equal(displayValue(num, 8), '8');
  assert.equal(displayValue(prob, 0.02), '0.02');
  assert.equal(displayValue(str, 'wifi'), 'wifi');
  assert.equal(displayValue(list(num), [25, 50]), '25, 50');
  assert.equal(displayValue(list(num), []), '');
  assert.equal(displayValue(list(str), ['a login', 'a folder']), 'a login, a folder');
  assert.equal(formValue(list(num), displayValue(list(num), [1, 2, 3])).join(), '1,2,3');
});

test('displayValue prints a list of records as one-line JSON that formValue reads back', () => {
  const tiers = CLASS.keys.tiers;
  const value = [{ name: 'a', cost: 1, value: 1, comfort: 0 }, { name: 'b', cost: 2, value: 1.5, comfort: 3 }];
  const text = displayValue(tiers, value);
  assert.equal(text, JSON.stringify(value));
  assert.ok(!text.includes('\n'));
  assert.deepEqual(formValue(tiers, text), value);
  assert.equal(displayValue(tiers, []), '[]');
  assert.equal(displayValue(tiers, undefined), '');
});

test('getAt reads nested paths by key, index and id, into tiers by index', () => {
  const cfg = base();
  assert.equal(getAt(cfg, 'loot.chance'), 0.03);
  assert.equal(getAt(cfg, 'jobs.list[1].cost'), 40);
  assert.equal(getAt(cfg, 'jobs.list[wifi].cost'), 5);
  assert.equal(getAt(cfg, 'rigs.list[stream].cost'), 600, 'rigs are addressed by job');
  assert.equal(getAt(cfg, 'classes.list[rack].tiers[0].value'), 3);
  assert.equal(getAt(cfg, 'classes.list[computer].tiers[3].cost'), 4500);
  assert.equal(getAt(cfg, 'classes.list[cat].event.boost'), 20);
  assert.equal(getAt(cfg, 'classes.list[computer].event.boost'), undefined);
  assert.deepEqual(getAt(cfg, 'jobs.list[wifi].loot'), ['a login']);
  assert.equal(getAt(cfg, 'jobs.list[stream].loot'), undefined);
  assert.equal(getAt(cfg, 'classes.list[rack].tiers[5].cost'), undefined);
  assert.equal(getAt(cfg, 'jobs.list[99].cost'), undefined);
  assert.equal(getAt(cfg, 'jobs.list[nope].cost'), undefined);
  assert.equal(getAt(cfg, 'nothing.here'), undefined);
  assert.throws(() => getAt(cfg, 'jobs.list[2'), /malformed/);
});

test('the default preset validates and its schema-2 paths resolve', () => {
  assert.deepEqual(validateConfig(preset), []);
  assert.equal(typeof getAt(preset, 'loot.chance'), 'number');
  assert.equal(typeof getAt(preset, 'classes.list[rack].tiers[0].value'), 'number');
  assert.equal(typeof getAt(preset, 'classes.list[cat].event.boost'), 'number');
  assert.ok(Array.isArray(getAt(preset, 'jobs.list[wifi].loot')));
});

test('setAt writes scalars, lists and tier fields in place and returns the config', () => {
  const cfg = base();
  assert.equal(setAt(cfg, 'jobs.list[1].cost', 8), cfg);
  assert.equal(cfg.jobs.list[1].cost, 8);
  setAt(cfg, 'jobs.list[wifi].cost', 8);
  assert.equal(cfg.jobs.list[0].cost, 8);
  setAt(cfg, 'loot.chance', 0.5);
  assert.equal(cfg.loot.chance, 0.5);
  setAt(cfg, 'classes.list[rack].tiers[0].value', 4);
  assert.equal(cfg.classes.list[0].tiers[0].value, 4);
  setAt(cfg, 'classes.list[cat].event.boost', 25);
  assert.equal(cfg.classes.list[6].event.boost, 25);
  setAt(cfg, 'taps.enabled', false);
  assert.equal(cfg.taps.enabled, false);
  setAt(cfg, 'jobs.milestones', [10, 25]);
  assert.deepEqual(cfg.jobs.milestones, [10, 25]);
  setAt(cfg, 'jobs.list[wifi].loot', ['x', 'y']);
  assert.deepEqual(cfg.jobs.list[0].loot, ['x', 'y']);
  setAt(cfg, 'classes.list[desk].tiers', formValue(CLASS.keys.tiers, '[{"name":"Desk","cost":10,"value":1.1,"comfort":1}]'));
  assert.deepEqual(cfg.classes.list[4].tiers, [{ name: 'Desk', cost: 10, value: 1.1, comfort: 1 }]);
  assert.deepEqual(validateConfig(cfg), []);
  assert.equal(base().jobs.list[0].cost, 5, 'the fixture itself is untouched');
});

test('setAt with undefined deletes the key; setting through an absent record creates it', () => {
  const cfg = base();
  setAt(cfg, 'jobs.list[wifi].loot', undefined);
  assert.equal('loot' in cfg.jobs.list[0], false);
  setAt(cfg, 'classes.list[computer].event.boost', 5);
  assert.deepEqual(cfg.classes.list[1].event, { boost: 5 });
  assert.equal(validateConfig(cfg).some((e) => e.path === 'classes.list[1].event.dur'), true);
  setAt(cfg, 'classes.list[tower].event.dur', undefined);
  assert.equal('event' in cfg.classes.list[3], false, 'deleting under an absent record creates nothing');
  setAt(cfg, 'jobs.list[1].cost', undefined);
  assert.deepEqual(validateConfig(cfg).filter((e) => e.path === 'jobs.list[1].cost'), [{ path: 'jobs.list[1].cost', message: 'missing required key' }]);
  assert.throws(() => setAt(cfg, 'jobs.list[nope].cost', 1), /no such entry/);
});

test('a NaN or an unparseable tiers cell written by the editor surfaces as a validator error at the same path', () => {
  const cfg = base();
  setAt(cfg, 'jobs.list[wifi].cost', formValue(pos, 'abc'));
  setAt(cfg, 'loot.chance', formValue(prob, '1.5'));
  setAt(cfg, 'classes.list[rack].tiers', formValue(CLASS.keys.tiers, 'not json'));
  setAt(cfg, 'classes.list[desk].tiers', formValue(CLASS.keys.tiers, '[{"name":"Desk"}]'));
  const errs = groupErrors(validateConfig(cfg));
  assert.deepEqual(errs.get('jobs.list[0].cost'), ['expected positive number, got NaN']);
  assert.deepEqual(errs.get('loot.chance'), ['expected number between 0 and 1, got 1.5']);
  assert.deepEqual(errs.get('classes.list[0].tiers'), ['missing required key']);
  assert.deepEqual(errs.get('classes.list[4].tiers[0].cost'), ['missing required key']);
});

test('blankRow has every required key, which the validator then flags until filled', () => {
  const row = blankRow(JOB);
  assert.deepEqual(Object.keys(row), ['id', 'name', 'time', 'pay', 'cost', 'r', 'rep', 'unlock']);
  const cfg = base();
  cfg.jobs.list.push(row);
  const paths = validateConfig(cfg).map((e) => e.path);
  assert.ok(paths.includes('jobs.list[2].cost'));
  assert.ok(!paths.includes('jobs.list[2].id'));
  const cls = blankRow(CLASS);
  assert.deepEqual(Object.keys(cls), ['id', 'name', 'effect', 'tiers']);
  assert.equal(cls.effect, 'pay');
  assert.deepEqual(cls.tiers, []);
  assert.equal('event' in cls, false, 'optional keys stay absent');
  cfg.classes.list.push(cls);
  assert.ok(validateConfig(cfg).some((e) => e.path === 'classes.list[8].tiers' && e.message === 'at least one tier'));
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

test('parsePath is the one from model/sweep.mjs, not a copy', () => {
  assert.equal(parsePath, sweepParsePath);
  assert.deepEqual(parsePath('jobs.list[wifi].cost'), [{ key: 'jobs', selector: undefined }, { key: 'list', selector: 'wifi' }, { key: 'cost', selector: undefined }]);
  assert.deepEqual(parsePath('classes.list[rack].tiers[0].cost'), [
    { key: 'classes', selector: undefined }, { key: 'list', selector: 'rack' }, { key: 'tiers', selector: '0' }, { key: 'cost', selector: undefined },
  ]);
});

test('holderPathFor: the path itself, else the nearest ancestor with a holder, else undefined', () => {
  const has = (p) => ['jobs.milestones', 'jobs.list[1].cost', 'jobs', 'classes.list[0].tiers'].includes(p);
  assert.equal(holderPathFor('jobs.milestones', has), 'jobs.milestones');
  assert.equal(holderPathFor('jobs.milestones[1]', has), 'jobs.milestones');
  assert.equal(holderPathFor('jobs.list[1].cost', has), 'jobs.list[1].cost');
  assert.equal(holderPathFor('jobs.list[1].name', has), 'jobs');
  assert.equal(holderPathFor('jobs.list[1]', has), 'jobs');
  assert.equal(holderPathFor('classes.list[0].tiers[2].cost', has), 'classes.list[0].tiers', 'a tier error shows at its tiers cell');
  assert.equal(holderPathFor('loot.chance', has), undefined);
  assert.equal(holderPathFor('', has), undefined);
});
