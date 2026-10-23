import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../model/config.mjs';
const preset = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));
test('the v2 preset validates', () => { assert.deepEqual(validateConfig(preset), []); });
test('unknown block is reported with its path', () => {
  const errs = validateConfig({ ...preset, bogus: {} });
  assert.ok(errs.some(e => e.path === 'bogus'));
});
test('wrong type is reported with its path', () => {
  const bad = structuredClone(preset); bad.jobs.list[0].cost = 'six';
  assert.ok(validateConfig(bad).some(e => e.path === 'jobs.list[0].cost'));
});
test('rig must reference an existing job', () => {
  const bad = structuredClone(preset); bad.rigs.list[0].job = 'nope';
  assert.ok(validateConfig(bad).some(e => e.path === 'rigs.list[0].job'));
});
test('a non-object config is an error, not a crash', () => {
  assert.ok(validateConfig(null).some(e => e.path === ''));
});
