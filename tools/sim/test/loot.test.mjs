import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, ctx, close } from './fixtures/starter-base.mjs';
import { loot } from '../model/mods/loot.mjs';
import { jobs, setRigged } from '../model/mods/jobs.mjs';
import { run } from '../model/core.mjs';

const setup = () => {
  const state = { credits: 0, t: 0, day: 1, config: base() };   // base(): loot chance 0.03, payRuns 25
  jobs.init(state, state.config); loot.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); setRigged(state, 'wifi', 'Script');
  return state;
};

test('each completed run adds chance × payRuns × pay to pending loot, cashed on the next active tick', () => {
  const state = setup();
  const c = ctx();
  jobs.tick(state, 6, c);                       // one wifi run, pays 2
  loot.tick(state, 1, c);
  close(state.credits, 2 + 0.03 * 25 * 2);
  close(loot.metrics(state)['loot.earned'], 1.5);
  close(loot.metrics(state)['loot.drops'], 0.03);
});

test('loot from an absence waits until the next session', () => {
  const state = setup();
  const c = ctx();
  jobs.offline(state, 600, c);                  // 100 runs
  loot.offline(state, 600, c);
  const afterGap = state.credits;
  close(loot.metrics(state)['loot.pending'], 100 * 0.03 * 25 * 2);
  loot.tick(state, 1, c);
  close(state.credits - afterGap, 150);
  assert.equal(loot.metrics(state)['loot.pending'], 0);
});

test('a claim that crosses a whole expected drop records one loot event carrying the drops seen', () => {
  const state = setup();
  const events = [];
  const c = { ...ctx(), record: (e) => events.push(e) };
  jobs.offline(state, 6 * 40, c);               // 40 runs → 1.2 expected drops
  loot.offline(state, 6 * 40, c);
  assert.deepEqual(events, []);                 // not yet claimed
  loot.tick(state, 1, c);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'loot');
  assert.equal(events[0].id, 'loot:wifi');
  assert.equal(events[0].drops, 1);
  close(events[0].earned, 40 * 0.03 * 25 * 2);  // the pool cashed at that claim
  assert.equal('cost' in events[0], false);
  jobs.offline(state, 6 * 40, c); loot.offline(state, 6 * 40, c); loot.tick(state, 1, c);   // 2.4 → one more event
  assert.equal(events.length, 2);
  assert.equal(events[1].drops, 1);
  jobs.offline(state, 6 * 70, c); loot.offline(state, 6 * 70, c); loot.tick(state, 1, c);   // 4.5 → one event, two drops
  assert.equal(events.length, 3);
  assert.equal(events[2].drops, 2);
  close(events[2].earned, 70 * 0.03 * 25 * 2);
});

test('a whole drop reached by many small accruals is not missed to float drift', () => {
  const state = setup();
  const events = [];
  const c = { ...ctx(), record: (e) => events.push(e) };
  let hundredth = null;
  for (let run = 1; run <= 100; run++) {       // 100 single-run claim cycles: 0.03 × 100 = 3 expected drops
    jobs.tick(state, 6, c);
    loot.tick(state, 1, c);
    if (run === 100) hundredth = events.length;
  }
  assert.equal(events.length, 3);
  assert.equal(hundredth, 3);                   // the third event lands on the 100th run, not later
});

test('a claim below a whole drop cashes the pool but records no event', () => {
  const state = setup();
  const events = [];
  const c = { ...ctx(), record: (e) => events.push(e) };
  jobs.tick(state, 6, c);                       // one run → 0.03 expected drops
  const before = state.credits;
  loot.tick(state, 1, c);
  close(state.credits - before, 1.5);
  assert.deepEqual(events, []);
});

test('pending loot is valued at the pay when the run completed, not when it is claimed', () => {
  const state = setup();
  const c = ctx();
  jobs.offline(state, 600, c);                  // 100 runs at level 1, pay 2
  loot.offline(state, 600, c);                  // pending 100 × 0.03 × 25 × 2 = 150
  jobs.buy(state, 'job:wifi:lv');               // level 2 doubles the pay before the claim
  const afterGap = state.credits;
  loot.tick(state, 1, c);
  close(state.credits - afterGap, 150);         // not 300
});

test('with the loot block disabled nothing is added', () => {
  const cfg = base(); cfg.loot.enabled = false;
  const state = { credits: 0, t: 0, config: cfg };
  jobs.init(state, cfg);                        // loot skipped, as the core would
  jobs.buy(state, 'job:wifi:lv'); setRigged(state, 'wifi', 'Script');
  jobs.tick(state, 6, ctx());
  assert.equal(state.credits, 2);
});

test('a full run earns loot, times its first drop, and keeps loot events out of the purchase counts', () => {
  const profile = {
    sessions: { day1: { hour: 20, minutes: 12, tps: 2.5 }, later: [{ hour: 21, minutes: 8, tps: 2.5 }] },
    policy: { saveForBigWithinMinutes: 30, bigValueRatio: 1.5, buyRigsWhenAffordable: true, restartManualJobs: true },
  };
  const r = run({ config: base(), profile, days: 3 });
  const m = r.metrics;
  assert.ok(Number.isFinite(m['loot.earned']) && m['loot.earned'] > 0, `loot.earned ${m['loot.earned']}`);
  assert.equal(typeof m['firstEvent:loot'], 'number');
  const lootEvents = r.timeline.filter((e) => e.kind === 'loot');
  assert.ok(lootEvents.length > 0);
  assert.ok(lootEvents.every((e) => !('cost' in e)));
  const nonOffline = r.timeline.filter((e) => e.kind !== 'offline').length;
  assert.equal(m.purchasesPerDay.reduce((a, b) => a + b, 0) + lootEvents.length, nonOffline);
  assert.equal(m['shop.capHits'], 0);
});
