import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { defaultModules } from '../model/registry.mjs';
import { jobs, levelOf, isRigged } from '../model/mods/jobs.mjs';
import { racks, freeLarge, freeSmall, freeDecor, takeSmall, rackCount, rackCost } from '../model/mods/racks.mjs';
import { rigs } from '../model/mods/rigs.mjs';
import { items, itemComfort, itemPay, itemSpeed, totalComfort } from '../model/mods/items.mjs';
import { events, eventsComfort } from '../model/mods/events.mjs';
const cfg = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));
const active = JSON.parse(readFileSync(new URL('../profiles/active.json', import.meta.url)));
const ctx1 = { payMult: 1, speedMult: 1, comfortMult: 1, tapsThisTick: 0, t: 0, policy: active.policy };
const item = (id) => cfg.items.list.find((i) => i.id === id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

// A room state as the core builds it: every room module initialised against the preset.
function room(config = cfg) {
  const s = { credits: 0, config };
  for (const m of [jobs, rigs, racks, items, events]) m.init(s, config, active);
  return s;
}
const ids = (offers) => offers.map((o) => o.id);

test('a rig is offered only once a rack gives it a shelf', () => {
  const s = room();
  jobs.buy(s, 'job:wifi:lv');
  assert.equal(levelOf(s, 'wifi'), 1);
  assert.deepEqual(ids(rigs.offers(s, ctx1)), []);
  racks.buy(s, 'rack');
  const [offer] = rigs.offers(s, ctx1);
  assert.equal(offer.id, 'rig:wifi');
  assert.equal(offer.cost, 1000);
  assert.equal(offer.kind, 'rig');
  assert.ok(Number.isFinite(offer.gainPerSec) && offer.gainPerSec > 0);
  rigs.buy(s, 'rig:wifi');
  assert.equal(isRigged(s, 'wifi'), true);
  assert.equal(freeSmall(s, cfg), 2);
  assert.deepEqual(ids(rigs.offers(s, ctx1)), []);           // no second rig for wifi
  assert.equal(rigs.metrics(s, ctx1)['rigs.count'], 1);
});

test('a rig for a locked job is not offered', () => {
  const s = room();
  racks.buy(s, 'rack');
  assert.deepEqual(ids(rigs.offers(s, ctx1)), []);
});

test('each rack costs 50× the previous and three fill the large slots', () => {
  const s = room();
  assert.equal(rackCost(s, cfg), 400);
  assert.equal(racks.offers(s, ctx1)[0].cost, 400);
  assert.equal(racks.offers(s, ctx1)[0].kind, 'rack');
  racks.buy(s, 'rack');
  assert.equal(rackCost(s, cfg), 20000);
  racks.buy(s, 'rack');
  racks.buy(s, 'rack');
  assert.equal(rackCount(s), 3);
  assert.equal(freeLarge(s, cfg), 0);
  assert.equal(freeSmall(s, cfg), 9);
  assert.deepEqual(racks.offers(s, ctx1), []);
  const m = racks.metrics(s, ctx1);
  assert.equal(m['racks.count'], 3);
  assert.equal(m['slots.largeFree'], 0);
  assert.equal(m['slots.smallFree'], 9);
  assert.equal(m['slots.decorFree'], 3);
});

test('taking a slot that is not free throws', () => {
  const s = room();
  assert.throws(() => takeSmall(s, cfg, 'rig:wifi'));
});

test('items are offered only with a free slot of their kind', () => {
  const s = room();
  const offered = () => ids(items.offers(s, ctx1));
  assert.ok(offered().includes('item:gpu'));                 // large slot free
  assert.ok(!offered().includes('item:fiber'));              // no shelf yet
  assert.ok(offered().includes('item:lamp'));                // decor slot free
  racks.buy(s, 'rack'); racks.buy(s, 'rack'); racks.buy(s, 'rack');
  assert.ok(!offered().includes('item:gpu'));                // large slots all racks
  assert.ok(offered().includes('item:fiber'));
  items.buy(s, 'item:lamp'); items.buy(s, 'item:plant'); items.buy(s, 'item:phones');
  assert.equal(freeDecor(s, cfg), 0);
  assert.ok(!offered().includes('item:cat'));
  assert.ok(!offered().includes('item:lamp'));               // placed once only
  assert.ok(offered().includes('itemlv:lamp'));
});

test('an item takes its slot when placed', () => {
  const s = room();
  items.buy(s, 'item:gpu');
  assert.equal(freeLarge(s, cfg), 2);
  racks.buy(s, 'rack');
  items.buy(s, 'item:fiber');
  assert.equal(freeSmall(s, cfg), 2);
  assert.deepEqual(ids(rigs.offers(s, ctx1)), []);           // wifi still locked, slot irrelevant
});

test('item effects grow by a fifth per level; tech comfort stays flat', () => {
  assert.equal(itemComfort(cfg, item('lamp'), 1), 5);
  assert.equal(itemComfort(cfg, item('lamp'), 25), 29);
  assert.equal(itemComfort(cfg, item('gpu'), 25), 1);
  assert.equal(itemPay(cfg, item('gpu'), 1), 1.25);
  close(itemPay(cfg, item('gpu'), 25), 1 + 0.25 * 5.8);
  assert.equal(itemPay(cfg, item('lamp'), 25), 1);
  close(itemSpeed(cfg, item('fiber'), 1), 1.2);
  assert.equal(itemSpeed(cfg, item('gpu'), 25), 1);
});

test('an upgrade from level lv costs cost × 1.5^lv up to maxLevel', () => {
  const s = room();
  items.buy(s, 'item:lamp');
  const lvOffer = () => items.offers(s, ctx1).find((o) => o.id === 'itemlv:lamp');
  assert.equal(lvOffer().cost, 3000);
  assert.equal(lvOffer().kind, 'level');
  items.buy(s, 'itemlv:lamp');
  assert.equal(lvOffer().cost, 4500);
  assert.equal(items.metrics(s, ctx1)['items.lamp.level'], 2);
  for (let lv = 2; lv < 25; lv++) items.buy(s, 'itemlv:lamp');
  assert.equal(items.metrics(s, ctx1)['items.lamp.level'], 25);
  assert.equal(lvOffer(), undefined);
});

test('events add a deterministic average comfort for placed decor', () => {
  const s = room();
  assert.equal(eventsComfort(s, cfg), 0);
  items.buy(s, 'item:lamp');
  close(eventsComfort(s, cfg), 10 * 30 * 0.7 / 90);
  close(events.metrics(s, ctx1)['events.comfortAvg'], 10 * 30 * 0.7 / 90);
  const off = structuredClone(cfg); off.events.enabled = false;
  const s2 = room(off);
  items.buy(s2, 'item:lamp');
  assert.equal(eventsComfort(s2, off), 0);
});

test('multipliers multiply item effects and turn comfort into a percentage', () => {
  const s = room();
  assert.deepEqual(items.multipliers(s), { payMult: 1, speedMult: 1, comfortMult: 1 });
  items.buy(s, 'item:gpu');
  items.buy(s, 'item:lamp');
  const m = items.multipliers(s);
  assert.equal(m.payMult, 1.25);
  assert.equal(m.speedMult, 1);
  assert.equal(totalComfort(s, cfg), 6);
  close(m.comfortMult, 1 + (6 + 10 * 30 * 0.7 / 90) / 100);
  const k = items.metrics(s, ctx1);
  assert.equal(k['items.placed'], 2);
  assert.equal(k['items.levels'], 2);
  assert.equal(k['comfort.total'], 6);
  assert.equal(k['items.gpu.level'], 1);
  assert.equal(k['items.fiber.level'], 0);
});

test('offers are finite numbers with unique ids', () => {
  const s = room();
  racks.buy(s, 'rack');
  jobs.buy(s, 'job:wifi:lv');
  const all = [rigs, racks, items, events].flatMap((m) => m.offers(s, ctx1));
  const seen = new Set();
  for (const o of all) {
    assert.ok(Number.isFinite(o.cost) && Number.isFinite(o.gainPerSec), o.id);
    assert.ok(!seen.has(o.id), o.id);
    seen.add(o.id);
  }
});

test('one active day buys a rack and the wifi rig', () => {
  const r = run({ config: cfg, profile: active, days: 1, modules: defaultModules() });
  assert.ok(r.metrics['racks.count'] >= 1, `racks ${r.metrics['racks.count']}`);
  assert.ok(r.metrics['rigs.count'] >= 1, `rigs ${r.metrics['rigs.count']}`);
  assert.ok(r.metrics['income.passive'] > 0);
});

// With the 2026-10-23 preset an active week fills every slot by day 3 and buys the last item level
// on day 7, so `offersLeft.final` reaches 0: a balance fact for the gate doc, not a model property.
// This checks that the full module stack runs a week cleanly.
test('a week of active play runs the full stack with finite metrics and no shop cap hits', () => {
  const r = run({ config: cfg, profile: active, days: 7, modules: defaultModules() });
  assert.equal(r.metrics['shop.capHits'], 0);
  assert.ok(Number.isFinite(r.metrics['offersLeft.final']));
  for (const [k, v] of Object.entries(r.metrics)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} is ${v}`);
  }
});
