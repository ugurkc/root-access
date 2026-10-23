import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run, sessionsFor } from '../model/core.mjs';
import { defaultModules } from '../model/registry.mjs';
import { jobs, setRigged } from '../model/mods/jobs.mjs';
import { taps, tapMoney } from '../model/mods/taps.mjs';
import { bar, barSpeed } from '../model/mods/bar.mjs';
import { offline } from '../model/mods/offline.mjs';
const cfg = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));
const active = JSON.parse(readFileSync(new URL('../profiles/active.json', import.meta.url)));
const ctx0 = { payMult: 1, speedMult: 1, comfortMult: 1, tapsThisTick: 0, t: 0, policy: active.policy };
const ctx1 = { ...ctx0, tapsThisTick: 1 };
// A state as the core hands it to init: the config is set there, not by a module.
const fresh = (config = cfg) => ({ t: 0, credits: 0, config });

// wifi at L25 running: 150 per 6 s = 25/s, so a tap pays 6.25.
function withWifiRunning() {
  const s = fresh(); jobs.init(s, cfg, active); taps.init(s, cfg, active); bar.init(s, cfg, active);
  s.jobs.byId.wifi.lv = 25; jobs.tick(s, 0, ctx0);
  return s;
}

test('the tenth tap fills the bar: 15 taps of bonus money, ×1.25 speed, one bar counted', () => {
  const s = withWifiRunning();
  const perTap = tapMoney(s, cfg, ctx1);
  assert.equal(perTap, 6.25);
  for (let i = 0; i < 9; i++) bar.tick(s, 0.4, ctx1);
  assert.equal(s.credits, 0);
  assert.equal(barSpeed(s, cfg), 1);
  bar.tick(s, 0.4, ctx1);
  assert.equal(s.credits, 15 * perTap);
  assert.equal(barSpeed(s, cfg), 1.25);
  assert.equal(bar.multipliers(s).speedMult, 1.25);
  assert.equal(bar.metrics(s, ctx0)['bar.bars'], 1);
  assert.equal(bar.metrics(s, ctx0)['bar.activeBoosts'], 1);
  assert.equal(s.bar.steps, 0);
});

test('two bars within 12 s stack to ×1.5 and expire one by one against state.t', () => {
  const s = withWifiRunning();
  // Like the core: tick, then advance t by dt.
  for (let i = 1; i <= 20; i++) { bar.tick(s, 0.4, ctx1); s.t = i * 0.4; }
  // Bars filled at t = 3.6 and 7.6 (the t of their tick), so boosts last to 15.6 and 19.6.
  assert.equal(bar.metrics(s, ctx0)['bar.bars'], 2);
  assert.equal(barSpeed(s, cfg), 1.5);
  s.t = 15.5;
  assert.equal(barSpeed(s, cfg), 1.5);
  s.t = 15.6;
  assert.equal(barSpeed(s, cfg), 1.25);
  s.t = 19.6;
  assert.equal(barSpeed(s, cfg), 1);
  assert.equal(bar.multipliers(s).speedMult, 1);
  assert.equal(bar.metrics(s, ctx0)['bar.activeBoosts'], 0);
  bar.tick(s, 0.4, ctx0);                                   // pruning drops the expired boosts
  assert.deepEqual(s.bar.boosts, []);
});

test('an absence clears the speed stack but keeps the partial bar', () => {
  const s = withWifiRunning();
  for (let i = 0; i < 15; i++) bar.tick(s, 0.4, ctx1);
  assert.equal(barSpeed(s, cfg), 1.25);
  assert.equal(s.bar.steps, 5);
  bar.offline(s, 36000, ctx0);
  assert.deepEqual(s.bar.boosts, []);
  assert.equal(barSpeed(s, cfg), 1);
  assert.equal(s.bar.steps, 5);
  assert.equal(s.credits, 15 * 6.25);                       // offline earns nothing here
});

test('bar offers nothing and buy is a no-op', () => {
  const s = withWifiRunning();
  assert.deepEqual(bar.offers(s, ctx0), []);
  bar.buy(s, 'anything');
  assert.deepEqual(s.bar, { steps: 0, boosts: [], bars: 0 });
});

test('the offline module counts gaps and how much of them the 8 h cap cut off', () => {
  const s = fresh(); offline.init(s, cfg, active);
  offline.offline(s, 10 * 3600, ctx0);
  assert.equal(offline.metrics(s, ctx0)['offline.gaps'], 1);
  assert.equal(offline.metrics(s, ctx0)['offline.cappedCount'], 1);
  assert.equal(offline.metrics(s, ctx0)['offline.cappedSeconds'], 7200);
  offline.offline(s, 8 * 3600, ctx0);
  assert.equal(offline.metrics(s, ctx0)['offline.gaps'], 2);
  assert.equal(offline.metrics(s, ctx0)['offline.cappedCount'], 1);
  assert.equal(offline.metrics(s, ctx0)['offline.cappedSeconds'], 7200);
  assert.equal(s.credits, 0);
  offline.tick(s, 1, ctx1);
  assert.deepEqual(offline.offers(s, ctx0), []);
  offline.buy(s, 'anything');
  assert.equal(s.credits, 0);
});

test('default modules are taps, bar, jobs, rigs, racks, items, events, offline', () => {
  assert.deepEqual(defaultModules().map((m) => m.id), ['taps', 'bar', 'jobs', 'rigs', 'racks', 'items', 'events', 'offline']);
});

test('over two days the offline module sees three gaps and earns nothing', () => {
  const full = run({ config: cfg, profile: active, days: 2 });
  const noOfflineMod = run({ config: cfg, profile: active, days: 2, modules: defaultModules().filter((m) => m.id !== 'offline') });
  assert.equal(full.metrics['offline.gaps'], 3);
  const [first, second] = sessionsFor(active, 2);
  const firstGap = second.start - (first.start + first.minutes * 60);   // 20:12 → 08:00, over the 8 h cap
  assert.equal(full.metrics['offline.cappedCount'], 1);
  assert.equal(full.metrics['offline.cappedSeconds'], firstGap - 8 * 3600);
  assert.equal(full.final.credits, noOfflineMod.final.credits);
  assert.deepEqual(full.summary.map((r) => r.offlineEarned), noOfflineMod.summary.map((r) => r.offlineEarned));
});

test('a disabled offline block drops the offline module from the run', () => {
  const noOffline = structuredClone(cfg); noOffline.offline.enabled = false;
  const r = run({ config: noOffline, profile: active, days: 2 });
  assert.equal('offline.gaps' in r.metrics, false);
  assert.deepEqual(r.summary.map((row) => row.offlineEarned), [0, 0]);
});

test('the bar bonus makes day 1 earn more than taps and jobs alone', () => {
  const withBar = run({ config: cfg, profile: active, days: 1, modules: [taps, bar, jobs] });
  const without = run({ config: cfg, profile: active, days: 1, modules: [taps, jobs] });
  assert.ok(withBar.metrics['bar.bars'] > 0);
  assert.ok(withBar.summary[0].credits > without.summary[0].credits,
    `${withBar.summary[0].credits} > ${without.summary[0].credits}`);
});

test('boosts active at session end do not scale offline earnings', () => {
  // wifi is capped at level 1 so the shop cannot level it: a run pays exactly 3 and offline earnings
  // are a known number of whole runs. ceo gets bought from rep but is not rigged, so it earns nothing away.
  const capped = structuredClone(cfg); capped.jobs.maxLevel = 1;
  const seen = [];
  // Rigs do not exist yet (Task 6), so a helper rigs wifi at init and, ticking last in the gap loop,
  // records what the bar looks like after every module's offline() has run.
  const helper = {
    id: 'helper',
    init(state) { state.jobs.byId.wifi.lv = 1; setRigged(state, 'wifi', 'x'); },
    tick() {},
    offline(state, seconds, ctx) { seen.push({ speedMult: ctx.speedMult, boosts: bar.metrics(state, ctx)['bar.activeBoosts'] }); },
    offers() { return []; },
    buy() {},
    metrics() { return {}; },
  };
  const r = run({ config: capped, profile: active, days: 2, modules: [taps, bar, jobs, offline, helper] });
  const gaps = r.timeline.filter((e) => e.kind === 'offline');
  assert.equal(gaps.length, 3);
  assert.equal(gaps[0].earned, 3 * Math.floor(8 * 3600 / 6));
  assert.deepEqual(seen.map((s) => s.boosts), [0, 0, 0]);
  assert.deepEqual(seen.map((s) => s.speedMult), [1, 1, 1]);
});
