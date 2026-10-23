import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProfile } from '../model/profile.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
const good = () => load('../profiles/active.json');

test('both preset profiles validate', () => {
  assert.deepEqual(validateProfile(load('../profiles/active.json')), []);
  assert.deepEqual(validateProfile(load('../profiles/casual.json')), []);
});

test('an empty object is a clean list of errors, not a crash', () => {
  const errs = validateProfile({});
  assert.ok(errs.length >= 2);
  for (const e of errs) assert.ok(typeof e.path === 'string' && typeof e.message === 'string', JSON.stringify(e));
  const paths = errs.map((e) => e.path);
  assert.ok(paths.includes('sessions'), paths.join());
  assert.ok(paths.includes('policy'), paths.join());
  assert.deepEqual(validateProfile(null).length >= 1, true);
  assert.deepEqual(validateProfile('x').length >= 1, true);
});

test('session and policy fields are range-checked with paths', () => {
  const p = good();
  p.sessions.day1.hour = 24;
  p.sessions.day1.minutes = 0;
  p.sessions.later[1].tps = -1;
  p.sessions.later[2] = 'noon';
  p.policy.saveForBigWithinMinutes = -5;
  p.policy.bigValueRatio = 0.5;
  p.policy.buyRigsWhenAffordable = 'yes';
  delete p.policy.restartManualJobs;
  const paths = validateProfile(p).map((e) => e.path).sort();
  assert.deepEqual(paths, [
    'policy.bigValueRatio', 'policy.buyRigsWhenAffordable', 'policy.restartManualJobs', 'policy.saveForBigWithinMinutes',
    'sessions.day1.hour', 'sessions.day1.minutes', 'sessions.later[1].tps', 'sessions.later[2]',
  ]);
  const q = good();
  q.sessions.later = { hour: 8 };
  assert.deepEqual(validateProfile(q).map((e) => e.path), ['sessions.later']);
  const r = good();
  r.id = 7;
  assert.deepEqual(validateProfile(r).map((e) => e.path), ['id']);
});
