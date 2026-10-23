import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run, sessionsFor } from '../model/core.mjs';
const active = JSON.parse(readFileSync(new URL('../profiles/active.json', import.meta.url)));

test('active profile yields 1 + 3×6 sessions over 7 days', () => {
  assert.equal(sessionsFor(active, 7).length, 19);
});

test('run with no modules returns 7 summary rows and zero credits', () => {
  const r = run({ config: { schema: 1 }, profile: active, modules: [] });
  assert.equal(r.summary.length, 7);
  assert.equal(r.final.credits, 0);
});

test('a stub module earns per tick and the shop buys its offer', () => {
  const stub = {
    id: 'stub', init: s => { s.stub = { lv: 0 }; },
    tick: (s, dt) => { s.credits += 10 * dt; },
    offers: s => s.stub.lv < 1 ? [{ id: 'stub:lv', cost: 5, gainPerSec: 1, kind: 'level' }] : [],
    buy: (s) => { s.credits -= 5; s.stub.lv = 1; },
    metrics: s => ({ 'stub.lv': s.stub.lv }),
  };
  const r = run({ config: { schema: 1 }, profile: active, days: 1, modules: [stub] });
  assert.equal(r.metrics['stub.lv'], 1);
  assert.ok(r.timeline.some(e => e.kind === 'level' && e.id === 'stub:lv'));
  assert.ok(r.metrics['firstEvent:level'] <= 2);
});

test('a disabled module is skipped and offline is called across gaps', () => {
  const calls = { init: 0, offline: 0 };
  const mod = { id: 'x', init: () => { calls.init++; }, tick: () => {}, offline: (s, secs) => { calls.offline++; s.credits += secs; }, offers: () => [], buy: () => {}, metrics: () => ({}) };
  const off = run({ config: { schema: 1, x: { enabled: false } }, profile: active, days: 2, modules: [mod] });
  assert.equal(calls.init, 0);
  const on = run({ config: { schema: 1, x: { enabled: true } }, profile: active, days: 2, modules: [mod] });
  assert.equal(calls.offline, 3);                 // gaps before the 3 sessions of day 2
  assert.ok(on.timeline.filter(e => e.kind === 'offline').length === 3);
  assert.ok(on.summary[1].offlineEarned > 0);
});
