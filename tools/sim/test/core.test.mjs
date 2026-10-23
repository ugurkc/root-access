import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run, sessionsFor } from '../model/core.mjs';
const active = JSON.parse(readFileSync(new URL('../profiles/active.json', import.meta.url)));
const casual = JSON.parse(readFileSync(new URL('../profiles/casual.json', import.meta.url)));
const cfg = { schema: 1 };

// A module that earns `rate` credits per second and sells `offers` once each; buy applies no cost.
const seller = (rate, offers) => ({
  id: 'stub', init: s => { s.stub = { bought: [] }; },
  tick: (s, dt) => { s.credits += rate * dt; },
  offers: s => offers.filter(o => !s.stub.bought.includes(o.id)),
  buy: (s, id) => { s.stub.bought.push(id); },
  metrics: s => ({ 'income.passive': rate, 'stub.bought': s.stub.bought.length }),
});

test('active profile yields 1 + 3×6 sessions over 7 days', () => {
  assert.equal(sessionsFor(active, 7).length, 19);
});

test('casual profile yields 1 + 1×6 sessions over 7 days', () => {
  assert.equal(sessionsFor(casual, 7).length, 7);
});

test('later sessions are sorted by hour within a day', () => {
  const profile = { sessions: { day1: { hour: 20, minutes: 1, tps: 1 },
    later: [{ hour: 21, minutes: 1, tps: 1 }, { hour: 8, minutes: 1, tps: 1 }, { hour: 13, minutes: 1, tps: 1 }] } };
  const starts = sessionsFor(profile, 3).map(s => s.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.equal(starts.length, 7);
});

test('run with no modules returns 7 summary rows and zero credits', () => {
  const r = run({ config: cfg, profile: active, modules: [] });
  assert.equal(r.summary.length, 7);
  assert.equal(r.final.credits, 0);
  assert.equal(r.metrics['shop.capHits'], 0);
});

test('a stub module earns per tick and the shop buys its offer', () => {
  const stub = {
    id: 'stub', init: s => { s.stub = { lv: 0 }; },
    tick: (s, dt) => { s.credits += 10 * dt; },
    offers: s => s.stub.lv < 1 ? [{ id: 'stub:lv', cost: 5, gainPerSec: 1, kind: 'level' }] : [],
    buy: (s) => { s.stub.lv = 1; },
    metrics: s => ({ 'stub.lv': s.stub.lv }),
  };
  const r = run({ config: cfg, profile: active, days: 1, modules: [stub] });
  assert.equal(r.metrics['stub.lv'], 1);
  assert.ok(r.timeline.some(e => e.kind === 'level' && e.id === 'stub:lv'));
  assert.ok(r.metrics['firstEvent:level'] <= 2);
});

test('the core deducts the cost; buy only applies the effect', () => {
  const mod = {
    id: 'x', init: s => { s.x = { bought: 0 }; s.credits = 5; }, tick: () => {},
    offers: s => s.x.bought ? [] : [{ id: 'x:one', cost: 5, gainPerSec: 1, kind: 'level' }],
    buy: s => { s.x.bought++; }, metrics: s => ({ 'x.bought': s.x.bought }),
  };
  const r = run({ config: cfg, profile: active, days: 1, modules: [mod] });
  assert.equal(r.metrics['x.bought'], 1);
  assert.equal(r.timeline.filter(e => e.kind === 'level').length, 1);
  assert.equal(r.final.credits, 0);
});

test('init receives the profile and ctx carries its policy', () => {
  let initProfile, tickPolicy;
  const mod = { id: 'x', init: (s, c, p) => { initProfile = p; }, tick: (s, dt, ctx) => { tickPolicy = ctx.policy; },
    offers: () => [], buy: () => {}, metrics: () => ({}) };
  run({ config: cfg, profile: active, days: 1, modules: [mod] });
  assert.equal(initProfile, active);
  assert.equal(tickPolicy, active.policy);
});

test('a disabled module is skipped and offline is called across gaps', () => {
  const calls = { init: 0, offline: 0 };
  const mod = { id: 'x', init: () => { calls.init++; }, tick: () => {}, offline: (s, secs) => { calls.offline++; s.credits += secs; }, offers: () => [], buy: () => {}, metrics: () => ({}) };
  run({ config: { schema: 1, x: { enabled: false } }, profile: active, days: 2, modules: [mod] });
  assert.equal(calls.init, 0);
  const on = run({ config: { schema: 1, x: { enabled: true } }, profile: active, days: 2, modules: [mod] });
  assert.equal(calls.offline, 3);                 // gaps before the 3 sessions of day 2
  assert.equal(on.timeline.filter(e => e.kind === 'offline').length, 3);
  assert.ok(on.summary[1].offlineEarned > 0);
});

test('a session runs exactly minutes×60×tps ticks and earns an exact amount', () => {
  let ticks = 0;
  const stub = { id: 'stub', init: () => {}, tick: (s, dt) => { ticks++; s.credits += 10 * dt; }, offers: () => [], buy: () => {}, metrics: () => ({}) };
  const day1 = run({ config: cfg, profile: active, days: 1, modules: [stub] });
  assert.ok(Math.abs(day1.summary[0].activeEarned - 7200) < 1e-6);
  assert.equal(ticks, 12 * 60 * 2.5);
  ticks = 0;
  run({ config: cfg, profile: active, days: 7, modules: [stub] });
  assert.equal(ticks, 16200);
});

test('offline is not a firstEvent metric', () => {
  const mod = { id: 'x', init: () => {}, tick: () => {}, offline: (s, secs) => { s.credits += secs; }, offers: () => [], buy: () => {}, metrics: () => ({}) };
  const r = run({ config: cfg, profile: active, days: 2, modules: [mod] });
  assert.equal(r.metrics['firstEvent:offline'], undefined);
});

test('the shop saves for a reachable big offer of much better value', () => {
  const mod = seller(1, [
    { id: 'small', cost: 10, gainPerSec: 1, kind: 'level' },
    { id: 'big', cost: 100, gainPerSec: 50, kind: 'rig' },
  ]);
  const r = run({ config: cfg, profile: active, days: 1, modules: [mod] });
  const bought = r.timeline.filter(e => e.kind !== 'offline').map(e => e.id);
  assert.deepEqual(bought, ['big', 'small']);
});

test('a rig is bought in the pre-pass before a better-value non-rig offer', () => {
  const mod = seller(10, [
    { id: 'item', cost: 5, gainPerSec: 10, kind: 'item' },
    { id: 'rig', cost: 5, gainPerSec: 1, kind: 'rig' },
  ]);
  const r = run({ config: cfg, profile: active, days: 1, modules: [mod] });
  const bought = r.timeline.filter(e => e.kind !== 'offline').map(e => e.id);
  assert.deepEqual(bought, ['rig', 'item']);
});

test('an offer with a non-finite value never wins', () => {
  const mod = seller(10, [
    { id: 'nan', cost: 5, gainPerSec: NaN, kind: 'level' },
    { id: 'ok', cost: 5, gainPerSec: 1, kind: 'level' },
  ]);
  const r = run({ config: cfg, profile: active, days: 1, modules: [mod] });
  assert.equal(r.timeline.filter(e => e.kind !== 'offline')[0].id, 'ok');
});

test('an offer that never goes away hits the shop cap, counted in shop.capHits', () => {
  const mod = { id: 'x', init: () => {}, tick: () => {},
    offers: () => [{ id: 'free', cost: 0, gainPerSec: 1, kind: 'level' }], buy: () => {}, metrics: () => ({}) };
  const r = run({ config: cfg, profile: active, days: 1, modules: [mod] });
  assert.ok(r.metrics['shop.capHits'] > 0);
  assert.equal(r.timeline.length, r.metrics['shop.capHits'] * 300);
});

test('the core sets state.config and passes the current ctx to metrics', () => {
  let seenConfig, seenCtx;
  const mod = { id: 'x', init: s => { seenConfig = s.config; }, tick: () => {}, offers: () => [], buy: () => {},
    metrics: (s, ctx) => { seenCtx = ctx; return {}; }, multipliers: () => ({ payMult: 3 }) };
  run({ config: cfg, profile: active, days: 1, modules: [mod] });
  assert.equal(seenConfig, cfg);
  assert.equal(seenCtx.payMult, 3);
  assert.equal(seenCtx.policy, active.policy);
});

test('a non-finite multiplier is a clear error, not a silent NaN run', () => {
  const mod = { id: 'bad', init: () => {}, tick: () => {}, offers: () => [], buy: () => {}, metrics: () => ({}),
    multipliers: () => ({ speedMult: NaN }) };
  assert.throws(() => run({ config: cfg, profile: active, days: 1, modules: [mod] }), /bad.*speedMult/);
});
