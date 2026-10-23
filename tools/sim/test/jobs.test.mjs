import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { jobs, costN, payFor, runRate, advanceRunning, setRigged, isRigged } from '../model/mods/jobs.mjs';
import { taps, tapMoney } from '../model/mods/taps.mjs';
const cfg = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));
const active = JSON.parse(readFileSync(new URL('../profiles/active.json', import.meta.url)));
const ctx1 = { payMult: 1, speedMult: 1, comfortMult: 1, tapsThisTick: 0, t: 0, policy: active.policy };
// A state as the core hands it to init: the config is set there, not by a module.
const fresh = (config = cfg) => ({ credits: 0, config });

test('wifi level cost matches the spec formula', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  assert.equal(costN(s, cfg, 'wifi', 1), 6);
  s.jobs.byId.wifi.lv = 1;
  assert.ok(Math.abs(costN(s, cfg, 'wifi', 1) - 6 * 1.12) < 1e-9);
  assert.ok(Math.abs(costN(s, cfg, 'wifi', 2) - 6 * 1.12 * (1.12 ** 2 - 1) / 0.12) < 1e-9);
});

test('a job caps at maxLevel and doubles pay at 25', () => {
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 25;
  assert.equal(jobs.offers(s, ctx1).filter(o => o.id === 'job:wifi:lv').length, 0);
  assert.equal(payFor(s, cfg, 'wifi', ctx1), 3 * 25 * 2);
});

test('only unlocked jobs are offered', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  const ids = jobs.offers(s, ctx1).map(o => o.id);
  assert.deepEqual(ids, ['job:wifi:lv']);
  s.jobs.rep = 25;
  assert.ok(jobs.offers(s, ctx1).some(o => o.id === 'job:ceo:lv'));
});

test('a manual job runs once per start and is restarted by the policy; a rigged job loops', () => {
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 1;
  for (let i = 0; i < 12; i++) jobs.tick(s, 1, ctx1);     // 12 s: two 6 s runs
  assert.equal(s.credits, 6); assert.equal(s.jobs.rep, 6);
  const noRestartCtx = { ...ctx1, policy: { restartManualJobs: false } };
  const noRestart = fresh(); jobs.init(noRestart, cfg, active); noRestart.jobs.byId.wifi.lv = 1;
  for (let i = 0; i < 12; i++) jobs.tick(noRestart, 1, noRestartCtx);
  assert.equal(noRestart.credits, 0);                       // never started
  const rigged = fresh(); jobs.init(rigged, cfg, active);
  rigged.jobs.byId.wifi.lv = 1; setRigged(rigged, 'wifi', 'DeAuth-o-Matic 3000');
  for (let i = 0; i < 12; i++) jobs.tick(rigged, 1, noRestartCtx);
  assert.equal(rigged.credits, 6);                          // loops without the policy
  assert.equal(rigged.jobs.byId.wifi.running, true);
});

test('speedMult 2 finishes a 6 s run in 3 s and doubles offline runs', () => {
  const fast = { ...ctx1, speedMult: 2 };
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 1;
  for (let i = 0; i < 3; i++) jobs.tick(s, 1, fast);
  assert.equal(s.credits, 3);
  const off = fresh(); jobs.init(off, cfg, active);
  off.jobs.byId.wifi.lv = 1; setRigged(off, 'wifi', 'DeAuth-o-Matic 3000');
  jobs.offline(off, 10 * 3600, fast);
  assert.equal(off.credits, 3 * (8 * 3600 * 2 / 6));
});

test('offline earns nothing when the offline block is disabled', () => {
  const noOffline = structuredClone(cfg); noOffline.offline.enabled = false;
  const s = fresh(noOffline); jobs.init(s, noOffline, active);
  s.jobs.byId.wifi.lv = 1; setRigged(s, 'wifi', 'DeAuth-o-Matic 3000');
  jobs.offline(s, 3600, ctx1);
  assert.equal(s.credits, 0); assert.equal(s.jobs.rep, 0);
});

test('setRigged, isRigged and advanceRunning are the cross-module entry points', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  assert.equal(isRigged(s, 'wifi'), false);
  setRigged(s, 'wifi', 'DeAuth-o-Matic 3000');
  assert.equal(isRigged(s, 'wifi'), true);
  assert.equal(s.jobs.byId.wifi.rigName, 'DeAuth-o-Matic 3000');
  assert.equal(jobs.metrics(s, ctx1)['jobs.wifi.rigged'], 1);
  s.jobs.byId.wifi.lv = 1; s.jobs.byId.ceo.lv = 1;
  jobs.tick(s, 0, { ...ctx1, policy: { restartManualJobs: false } });   // only rigged wifi starts
  advanceRunning(s, 2);
  assert.equal(s.jobs.byId.wifi.work, 2);
  assert.equal(s.jobs.byId.ceo.work, 0);
});

test('metrics take the ctx they are asked about', () => {
  const s = fresh(); jobs.init(s, cfg, active); taps.init(s, cfg, active);
  s.jobs.byId.wifi.lv = 1; setRigged(s, 'wifi', 'DeAuth-o-Matic 3000'); jobs.tick(s, 0, ctx1);
  assert.equal(jobs.metrics(s, ctx1)['income.passive'], 0.5);
  assert.equal(jobs.metrics(s, { ...ctx1, payMult: 2 })['income.passive'], 1);
  assert.equal(taps.metrics(s, { ...ctx1, comfortMult: 3 })['income.tap'], 3);
});

test('tap money is max(1, 0.25 × running income) and taps advance running jobs', () => {
  const s = fresh(); jobs.init(s, cfg, active); taps.init(s, cfg, active);
  assert.equal(tapMoney(s, cfg, ctx1), 1);                 // nothing running
  s.jobs.byId.wifi.lv = 25; jobs.tick(s, 0, ctx1);         // starts the run: pay 150 per 6 s = 25/s
  assert.equal(tapMoney(s, cfg, ctx1), 25 * 0.25);
  taps.tick(s, 0.4, { ...ctx1, tapsThisTick: 1 });
  assert.ok(Math.abs(s.jobs.byId.wifi.work - 0.25) < 1e-9);
});

test('offline pays only rigged jobs, capped at 8 h', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  s.jobs.byId.wifi.lv = 1; setRigged(s, 'wifi', 'DeAuth-o-Matic 3000');
  jobs.offline(s, 10 * 3600, ctx1);
  assert.equal(s.credits, 3 * (8 * 3600 / 6));
});

test('first level-up happens within 90 s of active play', () => {
  const r = run({ config: cfg, profile: active, days: 1, modules: [taps, jobs] });
  assert.ok(r.metrics['firstEvent:level'] <= 90, String(r.metrics['firstEvent:level']));
  assert.ok(r.metrics['jobs.wifi.level'] >= 1);
});

test('runRate is a job\'s credits per second while it runs, scaled by speedMult', () => {
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 1;
  assert.equal(runRate(s, cfg, 'wifi', ctx1), 0.5);
  assert.equal(runRate(s, cfg, 'wifi', { ...ctx1, speedMult: 2 }), 1);
});
