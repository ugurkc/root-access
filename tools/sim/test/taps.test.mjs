import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, ctx, close } from './fixtures/starter-base.mjs';
import { taps } from '../model/mods/taps.mjs';
import { jobs, runningIncome, payFor } from '../model/mods/jobs.mjs';

const restart = { ...ctx(), policy: { restartManualJobs: true } };

// jobs first so wifi is bought to `lv` and running (no work done yet) before taps init.
const withWifiRunning = (config, lv) => {
  const state = { credits: 0, t: 0, config };
  jobs.init(state, config);
  for (let i = 0; i < lv; i++) jobs.buy(state, 'job:wifi:lv');
  jobs.tick(state, 0, restart);
  taps.init(state, config);
  return state;
};

test('tapMult 2 doubles a tap: 2 × max(minMoney, rate × running income) × comfortMult', () => {
  const config = base();
  const state = withWifiRunning(config, 25);                 // 50 per 6 s, so the rate side wins over minMoney
  const c = { ...ctx(), tapsThisTick: 1, tapMult: 2, comfortMult: 1.5 };
  const income = runningIncome(state, config, c);
  assert.ok(config.taps.rate * income > config.taps.minMoney);
  const before = state.credits;
  taps.tick(state, 0.1, c);
  close(state.credits - before, 2 * Math.max(config.taps.minMoney, config.taps.rate * income) * 1.5);
  assert.equal(taps.metrics(state, c)['taps.count'], 1);
  close(taps.metrics(state, c)['income.tap'], 2 * config.taps.rate * income * 1.5);
});

// wifi with time 0.75: one tap advances it by 0.25 s × tapAdvanceMult, so ×3 finishes the run and ×1 does not.
const tapOnce = (tapAdvanceMult) => {
  const config = base();
  config.jobs.list[0].time = 0.75;
  const state = withWifiRunning(config, 1);
  taps.tick(state, 0.1, { ...ctx(), tapsThisTick: 1, tapAdvanceMult });
  const before = state.credits;
  jobs.tick(state, 0, restart);                              // processes the completion, if any
  return { pay: payFor(state, config, 'wifi', ctx()), earned: state.credits - before };
};

test('tapAdvanceMult 3 makes one tap push a running job 3 × advance seconds along', () => {
  const { pay, earned } = tapOnce(3);
  assert.equal(pay, 2);
  assert.equal(earned, pay);
});

test('with tapAdvanceMult 1 the same tap does not finish the job', () => {
  assert.equal(tapOnce(1).earned, 0);
});
