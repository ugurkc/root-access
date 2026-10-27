import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, ctx } from './fixtures/starter-base.mjs';
import { classes, ownedClasses, totalComfort, rigSlots } from '../model/mods/classes.mjs';
import { eventsComfort } from '../model/mods/events.mjs';
import { jobs, runningIncome } from '../model/mods/jobs.mjs';
import { taps } from '../model/mods/taps.mjs';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test('every class is offered at its first tier; buying moves it up one tier at that tier\'s cost', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  const offers = classes.offers(state, ctx());
  assert.deepEqual(offers.filter((o) => o.id === 'class:desk').map((o) => [o.id, o.kind, o.cost]), [['class:desk', 'class', 30]]);
  assert.equal(offers.length, state.config.classes.list.length);
  classes.buy(state, 'class:desk');
  const next = classes.offers(state, ctx()).find((o) => o.id === 'class:desk');
  assert.deepEqual([next.kind, next.cost], ['tier', 180]);
  classes.buy(state, 'class:desk'); classes.buy(state, 'class:desk');
  assert.equal(classes.offers(state, ctx()).some((o) => o.id === 'class:desk'), false);  // no fourth tier
  assert.equal(classes.metrics(state)['classes.desk.tier'], 3);
});

test('multipliers route each effect to its own key and comfort to comfortMult', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  for (const id of ['computer', 'router', 'tower', 'desk', 'chair']) classes.buy(state, `class:${id}`);
  const m = classes.multipliers(state);
  assert.equal(m.payMult, 1.15);
  assert.equal(m.tapAdvanceMult, 1.5);
  assert.equal(m.rigSpeedMult, 2);
  assert.equal(m.tapMult, 1.25);
  assert.equal(m.barMult, 1.5);
  assert.equal(m.speedMult, undefined);                 // no class drives general job speed
  assert.equal(totalComfort(state), 4);                 // desk 2 + chair 2
  assert.equal(m.comfortMult, 1 + 4 / 100);
});

test('the rack class provides rig slots and multiplies nothing', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  assert.equal(rigSlots(state), 0);
  classes.buy(state, 'class:rack');
  assert.equal(rigSlots(state), 3);
  const m = classes.multipliers(state);
  for (const key of ['payMult', 'tapAdvanceMult', 'rigSpeedMult', 'tapMult', 'barMult']) assert.equal(m[key], 1);
  assert.equal(classes.metrics(state)['slots.rig'], 3);
});

test('the rack offer has a positive gain even with no job running, so an idle shop still buys it', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  const rack = classes.offers(state, ctx()).find((o) => o.id === 'class:rack');
  assert.ok(rack.gainPerSec >= 1);
});

test('cat and girlfriend add permanent comfort plus the average of their events', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  classes.buy(state, 'class:cat');
  assert.equal(totalComfort(state), 10);
  const avg = 20 * 30 * 0.7 / 90;                       // boost × dur × acceptRate / meanInterval
  assert.ok(Math.abs(eventsComfort(state, state.config) - avg) < 1e-9);
  assert.deepEqual(ownedClasses(state).map(({ cls, tier }) => [cls.id, tier]), [['cat', 1]]);
});

test('gainPerSec is finite for every effect, with and without running jobs', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  for (const o of classes.offers(state, ctx())) assert.ok(Number.isFinite(o.gainPerSec), o.id);
  for (const o of classes.offers(state, { ...ctx(), tps: 2.5 })) assert.ok(Number.isFinite(o.gainPerSec), o.id);
});

test('with the classes block disabled comfort is 0, events add nothing and there are no rig slots', () => {
  const state = { credits: 0, config: base() };
  state.config.classes.enabled = false;                 // the core then never calls classes.init
  assert.equal(eventsComfort(state, state.config), 0);
  assert.equal(totalComfort(state), 0);
  assert.deepEqual(ownedClasses(state), []);
  assert.equal(rigSlots(state), 0);
});

// A room with wifi unlocked and in a run, so the running income is positive.
function runningRoom(config) {
  const state = { credits: 0, config };
  for (const m of [taps, jobs, classes]) m.init(state, config);
  jobs.buy(state, 'job:wifi:lv');
  const running = { ...ctx(), policy: { restartManualJobs: true } };
  jobs.tick(state, 0.01, running);
  const income = runningIncome(state, config, running);
  assert.ok(income > 0);
  return { state, income };
}

test('an upgrade values the step between tiers and the comfort change alone; the event is already counted', () => {
  const config = base();
  config.classes.list.push({ id: 'lamp', name: 'Lamp', effect: 'pay', event: { boost: 20, dur: 30 }, tiers: [
    { name: 'Dim lamp', cost: 50, value: 1.2, comfort: 5 }, { name: 'Bright lamp', cost: 200, value: 1.5, comfort: 8 },
  ] });
  const { state, income } = runningRoom(config);
  classes.buy(state, 'class:lamp');
  const now = totalComfort(state) + eventsComfort(state, config);    // 5 + 20 × 30 × 0.7 / 90
  close(now, 5 + 20 * 30 * 0.7 / 90);
  const offer = classes.offers(state, { ...ctx(), tps: 0 }).find((o) => o.id === 'class:lamp');
  assert.equal(offer.kind, 'tier');
  close(offer.gainPerSec, income * (1.5 / 1.2 - 1) + income * ((100 + now - 5 + 8) / (100 + now) - 1));
});

test('two classes sharing an effect multiply', () => {
  const config = base();
  config.classes.list.push({ id: 'gpu', name: 'GPU', effect: 'pay', tiers: [{ name: 'Old GPU', cost: 90, value: 1.4, comfort: 0 }] });
  const state = { credits: 0, config };
  classes.init(state, config);
  classes.buy(state, 'class:computer');
  classes.buy(state, 'class:gpu');
  close(classes.multipliers(state).payMult, 1.15 * 1.4);              // not 1.15 + 0.4
});

// Pay-side gains follow the running income, tap-side gains follow ctx.tps and are 0 offline.
test('gainPerSec scales the running income by the tier\'s effect; tap-side effects earn nothing at tps 0', () => {
  const { state, income } = runningRoom(base());
  const offer = (id, tps) => classes.offers(state, { ...ctx(), tps }).find((o) => o.id === `class:${id}`);
  close(offer('computer', 0).gainPerSec, income * (1.15 - 1));        // comfort 0, so no comfort share
  assert.equal(offer('router', 0).gainPerSec, 0);                     // tapAdvance: nothing without taps
  assert.ok(offer('router', 2).gainPerSec > 0);
  close(offer('desk', 0).gainPerSec, income * (102 / 100 - 1));       // tapMoney: only its 2 comfort offline
  assert.ok(offer('desk', 2).gainPerSec > offer('desk', 0).gainPerSec);
});
