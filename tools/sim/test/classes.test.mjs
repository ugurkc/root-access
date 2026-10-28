import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, ctx, close } from './fixtures/starter-base.mjs';
import { classes, ownedClasses, totalComfort, rigSlots, roomSlots } from '../model/mods/classes.mjs';
import { eventsComfort } from '../model/mods/events.mjs';
import { jobs, runningIncome } from '../model/mods/jobs.mjs';
import { taps, tapMoney } from '../model/mods/taps.mjs';
import { bar } from '../model/mods/bar.mjs';


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
  close(offer.gainPerSec, income * (1.5 / 1.2 - 1));                   // tps 0: the comfort step is worth nothing offline
  const c2 = { ...ctx(), tps: 2 };
  const tapRate = tapMoney(state, config, c2) * 2;
  close(classes.offers(state, c2).find((o) => o.id === 'class:lamp').gainPerSec,
    (income + tapRate) * (1.5 / 1.2 - 1) + tapRate * ((100 + now - 5 + 8) / (100 + now) - 1));
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
  assert.equal(offer('desk', 0).gainPerSec, 0);                       // tapMoney and comfort: both tap-side
  assert.ok(offer('desk', 2).gainPerSec > 0);
});

// The chair scales the full-bar payout, so its gain follows today's payout rate: tap money × tps ×
// bonusTaps / steps × the barMult already in force, plus the comfort share.
test('a chair offer values the bar payout rate at the current barMult', () => {
  const config = base();
  const state = { credits: 0, config };
  for (const m of [taps, bar, jobs, classes]) m.init(state, config);
  jobs.buy(state, 'job:wifi:lv');
  jobs.tick(state, 0.01, { ...ctx(), policy: { restartManualJobs: true } });
  const gain = (c) => classes.offers(state, c).find((o) => o.id === 'class:chair').gainPerSec;
  for (const barMult of [1, 2]) {
    const c = { ...ctx(), tps: 2, barMult };
    const tapRate = tapMoney(state, config, c) * 2;
    const barRate = tapRate * 15 / 10 * barMult;
    const comfortGain = (tapRate + barRate) * (102 / 100 - 1);                             // kitchen chair: comfort 2, on taps and bar
    close(gain(c), barRate * (1.5 - 1) + comfortGain);
  }
});

test('a class with start begins at that tier: owned, counted, and offered at the next tier only', () => {
  const cfg = base();
  const desk = cfg.classes.list.find((c) => c.id === 'desk'); desk.start = 1;
  const state = { credits: 0, config: cfg };
  classes.init(state, cfg);
  assert.equal(state.classes.tier.desk, 1);
  assert.ok(ownedClasses(state).some(({ cls, tier }) => cls.id === 'desk' && tier === 1));
  assert.equal(totalComfort(state), desk.tiers[0].comfort);
  const offer = classes.offers(state, ctx()).find((o) => o.id === 'class:desk');
  assert.equal(offer.kind, 'tier');
  assert.equal(offer.cost, desk.tiers[1].cost);
});

test('a timeCut class sums seconds into ctx.timeCut and values the running income at the new cut', () => {
  const cfg = base();
  cfg.classes.list.push({ id: 'isp', name: 'ISP line', effect: 'timeCut',
    tiers: [{ name: 'ISP box', cost: 40, value: 2, comfort: 0 }, { name: 'Mesh', cost: 150, value: 3, comfort: 0 }] });
  const state = { credits: 0, config: cfg };
  jobs.init(state, cfg); classes.init(state, cfg);
  jobs.buy(state, 'job:wifi:lv'); state.jobs.byId.wifi.running = true;   // wifi: 2 per 6 s
  const c = ctx();
  const before = runningIncome(state, cfg, c);
  const offer = classes.offers(state, c).find((o) => o.id === 'class:isp');
  close(offer.gainPerSec, 2 / 4 - before);                                 // 6 s − 2 s
  classes.buy(state, 'class:isp');
  assert.equal(classes.multipliers(state).timeCut, 2);
  classes.buy(state, 'class:isp');
  assert.equal(classes.multipliers(state).timeCut, 3);
  close(runningIncome(state, cfg, { ...c, timeCut: 3 }), 2 / 3);
});

test('an offlineCap class multiplies offlineMult and is valued as the longer night spread over a day', () => {
  const cfg = base();
  cfg.classes.list.push({ id: 'isp', name: 'ISP line', effect: 'offlineCap',
    tiers: [{ name: 'ISP box', cost: 40, value: 1.2, comfort: 0 }] });
  const state = { credits: 0, config: cfg };
  jobs.init(state, cfg); classes.init(state, cfg);
  jobs.buy(state, 'job:wifi:lv'); state.jobs.byId.wifi.rigged = true; state.jobs.byId.wifi.running = true;
  const c = ctx();
  const passive = runningIncome(state, cfg, c);                            // the one rigged job
  const offer = classes.offers(state, c).find((o) => o.id === 'class:isp');
  close(offer.gainPerSec, passive * cfg.offline.capHours * 0.2 / 24);
  classes.buy(state, 'class:isp');
  assert.equal(classes.multipliers(state).offlineMult, 1.2);
});

// A room with slots: two tech, one comfort, none small until the desk adds them.
const roomed = () => {
  const cfg = base();
  cfg.classes.slots = { tech: 2, comfort: 1 };
  const by = Object.fromEntries(cfg.classes.list.map((c) => [c.id, c]));
  by.tower.slot = 'tech';
  by.computer.slot = 'tech';
  by.router.slot = 'none';
  delete by.router.slot;
  by.router.requires = 'rack';
  by.cat.slot = 'comfort';
  by.gf.slot = 'comfort';
  by.desk.start = 1;
  by.desk.tiers.forEach((t, i) => { t.slots = { small: i + 1 }; });
  cfg.classes.list.push(
    { id: 'lamp', name: 'Lamp', effect: 'none', slot: 'small', tiers: [{ name: 'Lamp', cost: 30, value: 1, comfort: 3 }] },
    { id: 'plant', name: 'Plant', effect: 'none', slot: 'small', tiers: [{ name: 'Plant', cost: 40, value: 1, comfort: 3 }] },
    { id: 'expand', name: 'Room expansion', effect: 'none', tiers: [{ name: 'Knock the wall down', cost: 50000, value: 1, comfort: 0, slots: { tech: 1, comfort: 1 } }] },
    { id: 'storage', name: 'Storage unit', effect: 'lootChance', slot: 'tech', tiers: [
      { name: 'Shelf', cost: 600, value: 0.01, comfort: 0 }, { name: 'Cabinet', cost: 2400, value: 0.02, comfort: 0 },
    ] },
  );
  const state = { credits: 0, config: cfg };
  classes.init(state, cfg);
  return state;
};
const offered = (state, id) => classes.offers(state, ctx()).some((o) => o.id === `class:${id}`);

test('room slots: the base counts plus the tiers in force, less the owned classes of each kind', () => {
  const state = roomed();
  assert.deepEqual(roomSlots(state), { tech: { cap: 2, used: 0 }, comfort: { cap: 1, used: 0 }, small: { cap: 1, used: 0 } });  // desk L1 adds one small
  classes.buy(state, 'class:tower'); classes.buy(state, 'class:cat'); classes.buy(state, 'class:lamp');
  assert.deepEqual(roomSlots(state), { tech: { cap: 2, used: 1 }, comfort: { cap: 1, used: 1 }, small: { cap: 1, used: 1 } });
  const m = classes.metrics(state);
  assert.deepEqual([m['slots.tech'], m['slots.techFree'], m['slots.comfort'], m['slots.comfortFree'], m['slots.small'], m['slots.smallFree']], [2, 1, 1, 0, 1, 0]);
});

test('a slotted class is offered at its first tier only while a slot of its kind is free; upgrades need no slot', () => {
  const state = roomed();
  classes.buy(state, 'class:cat');
  assert.equal(offered(state, 'gf'), false);                   // the one comfort slot is taken
  assert.equal(offered(state, 'cat'), false);                  // cat has one tier
  classes.buy(state, 'class:lamp');
  assert.equal(offered(state, 'plant'), false);                // one small slot at desk L1
  classes.buy(state, 'class:desk');                            // L2: two small slots
  assert.equal(offered(state, 'plant'), true);
  classes.buy(state, 'class:tower'); classes.buy(state, 'class:computer');
  assert.equal(offered(state, 'storage'), false);              // both tech slots taken
  assert.equal(offered(state, 'computer'), true);              // its next tier needs no slot
  classes.buy(state, 'class:expand');
  assert.equal(offered(state, 'storage'), true);
  assert.equal(offered(state, 'gf'), true);
});

test('buying a slotted class into a full room throws before the tier moves', () => {
  const state = roomed();
  classes.buy(state, 'class:cat');
  assert.throws(() => classes.buy(state, 'class:gf'), /cannot place class:gf/);
  assert.equal(state.classes.tier.gf, 0);
});

test('a class with requires is offered and placeable only once that class is owned', () => {
  const state = roomed();
  assert.equal(offered(state, 'router'), false);
  assert.throws(() => classes.buy(state, 'class:router'), /cannot place class:router/);
  classes.buy(state, 'class:rack');
  assert.equal(offered(state, 'router'), true);
  classes.buy(state, 'class:router');
  assert.equal(state.classes.tier.router, 1);
});

test('without classes.slots or slot kinds nothing changes: every class is offered and the counts are 0', () => {
  const state = { credits: 0, config: base() };
  classes.init(state, state.config);
  assert.equal(classes.offers(state, ctx()).length, state.config.classes.list.length);
  for (const kind of ['tech', 'comfort', 'small']) assert.deepEqual(roomSlots(state)[kind], { cap: 0, used: 0 });
});

test('lootChance classes sum into ctx.lootChance and are valued as payRuns × chance of the running income', () => {
  const state = roomed();
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv');
  jobs.tick(state, 0, { ...ctx(), policy: { restartManualJobs: true } });   // wifi running: 2 / 6 s
  assert.equal(classes.multipliers(state).lootChance, 0);
  const c = ctx();
  const offer = classes.offers(state, c).find((o) => o.id === 'class:storage');
  close(offer.gainPerSec, (2 / 6) * 25 * 0.01);                               // payRuns 25
  classes.buy(state, 'class:storage');
  assert.equal(classes.multipliers(state).lootChance, 0.01);
  const next = classes.offers(state, c).find((o) => o.id === 'class:storage');
  close(next.gainPerSec, (2 / 6) * 25 * (0.02 - 0.01));
  classes.buy(state, 'class:storage');
  assert.equal(classes.multipliers(state).lootChance, 0.02);
  state.config.loot.enabled = false;
  const dark = roomed(); jobs.init(dark, dark.config); dark.config.loot.enabled = false;
  jobs.buy(dark, 'job:wifi:lv'); jobs.tick(dark, 0, { ...ctx(), policy: { restartManualJobs: true } });
  assert.equal(classes.offers(dark, c).find((o) => o.id === 'class:storage').gainPerSec, 0);
});

test('a tier that adds slots earns the best blocked class\'s gain, scaled to its share of the bundle cost', () => {
  // Three rooms, all with the lamp in the desk's only tabletop spot, the Wi-Fi job running and taps going.
  const c = { ...ctx(), tps: 2, policy: { restartManualJobs: true } };
  const room = (mutate = () => {}) => {
    const state = roomed(); mutate(state.config);
    jobs.init(state, state.config); taps.init(state, state.config);
    jobs.buy(state, 'job:wifi:lv'); jobs.tick(state, 0, c); classes.buy(state, 'class:lamp');
    return state;
  };
  const gain = (state, id) => classes.offers(state, c).find((o) => o.id === `class:${id}`)?.gainPerSec;
  const full = room();                                                                       // plant blocked: desk L2 would let it in
  assert.equal(gain(full, 'plant'), undefined);
  const noPlant = room((cfg) => { cfg.classes.list = cfg.classes.list.filter((cls) => cls.id !== 'plant'); });
  const deskAlone = gain(noPlant, 'desk');                                                   // comfort 2 → 5, nothing to let in
  const spare = room((cfg) => { cfg.classes.slots.small = 1; });                             // a free spot: the plant's own gain, same comfort
  const plantAlone = gain(spare, 'plant');
  assert.ok(plantAlone > 0);
  close(gain(full, 'desk'), deskAlone + plantAlone * 180 / (180 + 40));
  assert.equal(gain(spare, 'desk'), deskAlone, 'with a spot free the desk earns its comfort alone');
});
