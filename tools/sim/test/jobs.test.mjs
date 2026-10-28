import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { jobs, costN, payFor, runRate, runsOf, advanceRunning, setRigged, isRigged } from '../model/mods/jobs.mjs';
import { taps, tapMoney } from '../model/mods/taps.mjs';
import { base, ctx } from './fixtures/starter-base.mjs';
// The starter fixture: wifi (cost 5, r 1.2, pay 2 per 6 s, rep 3) and stream (unlocks at rep 25); no milestones, cap 50.
const cfg = base();
const active = JSON.parse(readFileSync(new URL('../profiles/active.json', import.meta.url)));
const ctx1 = { ...ctx(), policy: active.policy };
// A state as the core hands it to init: the config is set there, not by a module.
const fresh = (config = cfg) => ({ credits: 0, config });

test('wifi level cost matches the spec formula', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  assert.equal(costN(s, cfg, 'wifi', 1), 5);
  s.jobs.byId.wifi.lv = 1;
  assert.ok(Math.abs(costN(s, cfg, 'wifi', 1) - 5 * 1.2) < 1e-9);
  assert.ok(Math.abs(costN(s, cfg, 'wifi', 2) - 5 * 1.2 * (1.2 ** 2 - 1) / 0.2) < 1e-9);
});

test('a job caps at maxLevel; pay is linear in level and doubles at each milestone reached', () => {
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 50;
  assert.equal(jobs.offers(s, ctx1).filter(o => o.id === 'job:wifi:lv').length, 0);
  assert.equal(payFor(s, cfg, 'wifi', ctx1), 2 * 50);
  const milestone = structuredClone(cfg); milestone.jobs.milestones = [25];
  const m = fresh(milestone); jobs.init(m, milestone, active); m.jobs.byId.wifi.lv = 25;
  assert.equal(payFor(m, milestone, 'wifi', ctx1), 2 * 25 * 2);
  m.jobs.byId.wifi.lv = 24;
  assert.equal(payFor(m, milestone, 'wifi', ctx1), 2 * 24);
});

test('only unlocked jobs are offered', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  const ids = jobs.offers(s, ctx1).map(o => o.id);
  assert.deepEqual(ids, ['job:wifi:lv']);
  s.jobs.rep = 25;
  assert.ok(jobs.offers(s, ctx1).some(o => o.id === 'job:stream:lv'));
});

test('a manual job runs once per start and is restarted by the policy; a rigged job loops', () => {
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 1;
  for (let i = 0; i < 12; i++) jobs.tick(s, 1, ctx1);     // 12 s: two 6 s runs
  assert.equal(s.credits, 4); assert.equal(s.jobs.rep, 6);
  const noRestartCtx = { ...ctx1, policy: { restartManualJobs: false } };
  const noRestart = fresh(); jobs.init(noRestart, cfg, active); noRestart.jobs.byId.wifi.lv = 1;
  for (let i = 0; i < 12; i++) jobs.tick(noRestart, 1, noRestartCtx);
  assert.equal(noRestart.credits, 0);                       // never started
  const rigged = fresh(); jobs.init(rigged, cfg, active);
  rigged.jobs.byId.wifi.lv = 1; setRigged(rigged, 'wifi', 'Script');
  for (let i = 0; i < 12; i++) jobs.tick(rigged, 1, noRestartCtx);
  assert.equal(rigged.credits, 4);                          // loops without the policy
  assert.equal(rigged.jobs.byId.wifi.running, true);
});

test('speedMult 2 finishes a 6 s run in 3 s and doubles offline runs', () => {
  const fast = { ...ctx1, speedMult: 2 };
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 1;
  for (let i = 0; i < 3; i++) jobs.tick(s, 1, fast);
  assert.equal(s.credits, 2);
  const off = fresh(); jobs.init(off, cfg, active);
  off.jobs.byId.wifi.lv = 1; setRigged(off, 'wifi', 'Script');
  jobs.offline(off, 10 * 3600, fast);
  assert.equal(off.credits, 2 * (8 * 3600 * 2 / 6));
});

test('offline earns nothing when the offline block is disabled', () => {
  const noOffline = structuredClone(cfg); noOffline.offline.enabled = false;
  const s = fresh(noOffline); jobs.init(s, noOffline, active);
  s.jobs.byId.wifi.lv = 1; setRigged(s, 'wifi', 'Script');
  jobs.offline(s, 3600, ctx1);
  assert.equal(s.credits, 0); assert.equal(s.jobs.rep, 0);
});

test('setRigged, isRigged and advanceRunning are the cross-module entry points', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  assert.equal(isRigged(s, 'wifi'), false);
  setRigged(s, 'wifi', 'Script');
  assert.equal(isRigged(s, 'wifi'), true);
  assert.equal(s.jobs.byId.wifi.rigName, 'Script');
  assert.equal(jobs.metrics(s, ctx1)['jobs.wifi.rigged'], 1);
  s.jobs.byId.wifi.lv = 1; s.jobs.byId.stream.lv = 1;
  jobs.tick(s, 0, { ...ctx1, policy: { restartManualJobs: false } });   // only rigged wifi starts
  advanceRunning(s, 2);
  assert.equal(s.jobs.byId.wifi.work, 2);
  assert.equal(s.jobs.byId.stream.work, 0);
});

test('metrics take the ctx they are asked about', () => {
  const s = fresh(); jobs.init(s, cfg, active); taps.init(s, cfg, active);
  s.jobs.byId.wifi.lv = 3; setRigged(s, 'wifi', 'Script'); jobs.tick(s, 0, ctx1);   // 6 per 6 s = 1/s
  assert.equal(jobs.metrics(s, ctx1)['income.passive'], 1);
  assert.equal(jobs.metrics(s, { ...ctx1, payMult: 2 })['income.passive'], 2);
  assert.equal(taps.metrics(s, { ...ctx1, comfortMult: 3 })['income.tap'], 3);
});

test('tap money is max(1, 0.25 × running income) and taps advance running jobs', () => {
  const s = fresh(); jobs.init(s, cfg, active); taps.init(s, cfg, active);
  assert.equal(tapMoney(s, cfg, ctx1), 1);                 // nothing running
  s.jobs.byId.wifi.lv = 30; jobs.tick(s, 0, ctx1);         // starts the run: pay 60 per 6 s = 10/s
  assert.equal(tapMoney(s, cfg, ctx1), 10 * 0.25);
  taps.tick(s, 0.4, { ...ctx1, tapsThisTick: 1 });
  assert.ok(Math.abs(s.jobs.byId.wifi.work - 0.25) < 1e-9);
});

test('offline pays only rigged jobs, capped at 8 h', () => {
  const s = fresh(); jobs.init(s, cfg, active);
  s.jobs.byId.wifi.lv = 1; setRigged(s, 'wifi', 'Script');
  jobs.offline(s, 10 * 3600, ctx1);
  assert.equal(s.credits, 2 * (8 * 3600 / 6));
});

test('first level-up happens within 90 s of active play', () => {
  const r = run({ config: cfg, profile: active, days: 1, modules: [taps, jobs] });
  assert.ok(r.metrics['firstEvent:level'] <= 90, String(r.metrics['firstEvent:level']));
  assert.ok(r.metrics['jobs.wifi.level'] >= 1);
});

test('runRate is a job\'s credits per second while it runs, scaled by speedMult', () => {
  const s = fresh(); jobs.init(s, cfg, active); s.jobs.byId.wifi.lv = 3;   // 6 per 6 s
  assert.equal(runRate(s, cfg, 'wifi', ctx1), 1);
  assert.equal(runRate(s, cfg, 'wifi', { ...ctx1, speedMult: 2 }), 2);
});

// The starter fixture: wifi (time 6, pay 2) and stream (time 15, pay 8), both bought to level 1 unless noted.
test('rigSpeedMult speeds up rigged jobs only, active and offline', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); jobs.buy(state, 'job:stream:lv');
  setRigged(state, 'wifi', 'Script');
  const c = { ...ctx(), rigSpeedMult: 2, policy: { restartManualJobs: true } };
  jobs.tick(state, 3, c);                     // wifi: 3 s × 2 = 6 s of work → one run pays 2; stream: 3 s, no run
  assert.equal(state.credits, 2);
  assert.equal(runRate(state, state.config, 'wifi', c), 2 / 6 * 2);
  assert.equal(runRate(state, state.config, 'stream', c), 8 / 15);
  state.credits = 0;
  jobs.offline(state, 60, c);                 // 60 s × 2 / 6 = 20 wifi runs; stream is not rigged
  assert.equal(state.credits, 40);
});

test('runRate can value a job as if rigged before the rig is bought', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv');
  const c = { ...ctx(), rigSpeedMult: 2 };
  assert.equal(runRate(state, state.config, 'wifi', c), 2 / 6);          // not rigged: no rig speed
  assert.equal(runRate(state, state.config, 'wifi', c, true), 2 / 6 * 2); // as rigged
});

test('a rigged job\'s level-up gain runs at rig speed too', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv');
  const c = { ...ctx(), rigSpeedMult: 2 };
  const gain = () => jobs.offers(state, c).find((o) => o.id === 'job:wifi:lv').gainPerSec;
  assert.equal(gain(), 2 / 6);                // level 2 pays 4 per 6 s: +2 per 6 s
  setRigged(state, 'wifi', 'Script');
  assert.equal(gain(), 2 / 6 * 2);
});

test('runsOf counts completed runs, active and offline', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); setRigged(state, 'wifi', 'Script');
  jobs.tick(state, 12, ctx());                // 2 runs
  jobs.offline(state, 60, ctx());             // 10 runs
  assert.equal(runsOf(state, 'wifi'), 12);
  assert.equal(runsOf(state, 'stream'), 0);
});

test('jobs.levelGain scales what a level adds; absent it is pay × level', () => {
  const gain = structuredClone(cfg); gain.jobs.levelGain = 0.25;
  const s = fresh(gain); jobs.init(s, gain, active); s.jobs.byId.wifi.lv = 25;
  assert.ok(Math.abs(payFor(s, gain, 'wifi', ctx1) - 2 * (1 + 0.25 * 24)) < 1e-9);
  s.jobs.byId.wifi.lv = 1;
  assert.equal(payFor(s, gain, 'wifi', ctx1), 2);
  const plain = fresh(); jobs.init(plain, cfg, active); plain.jobs.byId.wifi.lv = 25;
  assert.equal(payFor(plain, cfg, 'wifi', ctx1), 2 * 25);
});

test('rigs.speed slows rigged jobs only, active and offline', () => {
  const state = { credits: 0, t: 0, config: base() }; state.config.rigs.speed = 0.5;
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); jobs.buy(state, 'job:stream:lv');
  setRigged(state, 'wifi', 'Script');
  const c = { ...ctx(), policy: { restartManualJobs: true } };
  assert.equal(runRate(state, state.config, 'wifi', c), 2 / 6 * 0.5);
  assert.equal(runRate(state, state.config, 'stream', c), 8 / 15);   // by hand: full speed
  jobs.tick(state, 6, c);                     // wifi: 6 s × 0.5 = half a run; nothing pays yet
  assert.equal(state.credits, 0);
  jobs.tick(state, 6, c);
  assert.equal(state.credits, 2);
  state.credits = 0;
  jobs.offline(state, 60, c);                 // 60 s × 0.5 / 6 = 5 wifi runs
  assert.equal(state.credits, 10);
});

test('ctx.timeCut shortens every run but never under 1 s', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); setRigged(state, 'wifi', 'Script');
  const c = { ...ctx(), timeCut: 4, policy: {} };
  assert.equal(runRate(state, state.config, 'wifi', c), 2 / 2);          // 6 s − 4 s
  jobs.tick(state, 2, c);
  assert.equal(state.credits, 2);
  const floor = { ...c, timeCut: 100 };
  assert.equal(runRate(state, state.config, 'wifi', floor), 2 / 1);
  state.credits = 0;
  jobs.offline(state, 10, floor);                                          // 10 runs of 1 s
  assert.equal(state.credits, 20);
});

test('offlineMult stretches the offline cap: 8 h × 1.5 of a long absence earns', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); setRigged(state, 'wifi', 'Script');
  jobs.offline(state, 24 * 3600, { ...ctx(), offlineMult: 1.5 });        // 12 h of 6 s runs at 2 each
  assert.equal(state.credits, 12 * 3600 / 6 * 2);
});
