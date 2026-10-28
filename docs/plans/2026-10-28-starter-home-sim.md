# Starter Home Sim Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Teach the balance simulator the starter home design (item classes with tiers, a three-rig shelf, passive comfort, realistic job names, random loot drops) so the starter home numbers can be tuned against the journey targets before the game is changed.

**Architecture:** Config schema 2 replaces the `items` and `racks` blocks with `classes`, adds a `loot` block, and lets each job carry loot texts. In the sim, a `classes` module replaces `items.mjs` and `racks.mjs` (a rack is a class whose effect is rig slots), and a new `loot` module turns completed runs into deterministic expected loot. Four new context multipliers (`rigSpeedMult`, `tapMult`, `barMult`, `tapAdvanceMult`) carry the per-class effects to the taps, bar and jobs modules. The game is not touched by this plan; a follow-on plan ports the game to schema 2 once the numbers are chosen.

**Tech Stack:** Plain ES modules, Node 22, Node's test runner (`npm test` from `tools/sim`), no dependencies. Design: `docs/plans/2026-10-28-starter-home-classes-design.md`. Sim contract: `tools/sim/README.md`, `tools/sim/model/registry.mjs`.

**Working directory for every command:** `/Users/ugurkoc/repos/root-access/tools/sim` (the `npm test` script lives there). Commit from the repo root. Never add Claude attribution to commits.

---

## Schema 2 at a glance

```json
{
  "schema": 2,
  "taps":  { "enabled": true, "rate": 0.25, "minMoney": 1, "advance": 0.25 },
  "bar":   { "enabled": true, "steps": 10, "bonusTaps": 15, "speed": 0.25, "speedDur": 12 },
  "jobs":  { "enabled": true, "maxLevel": 50, "milestones": [], "revealAt": 0.6,
             "list": [ { "id": "wifi", "name": "…", "time": 6, "pay": 2, "cost": 5, "r": 1.2, "rep": 3, "unlock": 0,
                         "loot": ["Neighbor's Netflix login", "…"] } ] },
  "rigs":  { "enabled": true, "list": [ { "job": "wifi", "name": "Wi-Fi cracking script", "cost": 120 } ] },
  "classes": { "enabled": true,
             "list": [ { "id": "rack", "name": "Rack", "effect": "rigSlots",
                         "tiers": [ { "name": "Server rack", "cost": 60, "value": 3, "comfort": 0 } ] },
                       { "id": "desk", "name": "Desk", "effect": "tapMoney",
                         "tiers": [ { "name": "Simple desk", "cost": 30, "value": 1.25, "comfort": 2 } ] },
                       { "id": "cat", "name": "Cat", "effect": "none",
                         "tiers": [ { "name": "Cat", "cost": 300, "value": 1, "comfort": 10 } ],
                         "event": { "boost": 20, "dur": 30 } } ] },
  "events": { "enabled": true, "window": 20, "first": 15, "min": 60, "max": 120, "acceptRate": 0.7 },
  "loot":  { "enabled": true, "chance": 0.03, "payRuns": 25 },
  "offline": { "enabled": true, "capHours": 8 }
}
```

Rules:
- A class owns one room spot. Tier 0 means not owned; buying moves it to the next tier. `tiers[t].value` is the multiplier the class applies at tier t+1 (≥ 1); `effect` says to what: `pay` (job pay), `tapAdvance` (seconds of job work per HACK tap), `rigSpeed` (speed of rigged jobs only), `tapMoney` (credits per tap), `barBonus` (the full-bar payout), `rigSlots` (the tier's `value` is a count of rig slots, not a multiplier), or `none`. `comfort` is the tier's permanent comfort; `event` (optional, per class) is averaged exactly as today's decor events.
- `comfortMult = 1 + (owned tiers' comfort + average event comfort) / 100`, applied to job pay and to taps, as today.
- Rigs need a free rig slot. Only the rack class provides them: owning the Server rack gives 3. Six rigs exist, three fit; the shop buys the first affordable ones. The rack is cheap and bought before the first rig; the shop's rack offer gets a gainPerSec heuristic (1 % of passive income plus 1 credit/s) so it is bought when nothing else pays.
- Loot: every completed run (active or offline) drops loot with probability `loot.chance`, worth `loot.payRuns` runs of that job's current pay. The sim models the expectation, not the dice: each run adds `chance × payRuns × pay` to a pending pool and `chance` to an expected drop count. Pending loot is cashed on the next active tick (tapping the card), so loot from a gap lands at the start of the next session, and a `loot` timeline event is recorded each time the expected count crosses a whole number. Loot events have no `cost` and are not purchases.
- Offer kinds: `level` (job level), `class` (a class's first tier), `tier` (a later tier), `rig`. `class`, `tier` and `rig` are "big" offers the shop may save for.

## Task 1: Schema 2 shapes and validator

> Amended 2026-10-28 after the first commit: there is no `room` block. Rig slots come from a class with `effect: "rigSlots"`. The amendment removes `room` from SHAPES, adds `rigSlots` to the effect enum, and adds a rack class to the shared fixture. Block order: `schema, taps, bar, jobs, rigs, classes, events, loot, offline`.

**Files:**
- Modify: `tools/sim/model/config.mjs`
- Test: `tools/sim/test/config.test.mjs`

**Step 1: Write the failing tests**

Add to `test/config.test.mjs` (keep the existing tests that still apply; delete the ones about `items`, `racks`, tech sizes):

```js
import { SHAPES, validateConfig, SCHEMA } from '../model/config.mjs';

const tier = (over = {}) => ({ name: 'Simple desk', cost: 30, value: 1.25, comfort: 2, ...over });
const base = () => ({
  schema: 2,
  taps: { enabled: true, rate: 0.25, minMoney: 1, advance: 0.25 },
  bar: { enabled: true, steps: 10, bonusTaps: 15, speed: 0.25, speedDur: 12 },
  jobs: { enabled: true, maxLevel: 50, milestones: [], revealAt: 0.6,
    list: [{ id: 'wifi', name: 'Wi-Fi', time: 6, pay: 2, cost: 5, r: 1.2, rep: 3, unlock: 0, loot: ['a login'] }] },
  rigs: { enabled: true, list: [{ job: 'wifi', name: 'Script', cost: 120 }] },
  room: { enabled: true, rigSlots: 3 },
  classes: { enabled: true, list: [
    { id: 'desk', name: 'Desk', effect: 'tapMoney', tiers: [tier()] },
    { id: 'cat', name: 'Cat', effect: 'none', tiers: [tier({ name: 'Cat', cost: 300, value: 1, comfort: 10 })], event: { boost: 20, dur: 30 } },
  ] },
  events: { enabled: true, window: 20, first: 15, min: 60, max: 120, acceptRate: 0.7 },
  loot: { enabled: true, chance: 0.03, payRuns: 25 },
  offline: { enabled: true, capHours: 8 },
});

test('schema is 2 and the blocks are the starter home set', () => {
  assert.equal(SCHEMA, 2);
  assert.deepEqual(Object.keys(SHAPES), ['schema', 'taps', 'bar', 'jobs', 'rigs', 'room', 'classes', 'events', 'loot', 'offline']);
  assert.deepEqual(validateConfig(base()), []);
});

test('items and racks blocks are rejected as unknown', () => {
  const cfg = base();
  cfg.items = { enabled: false };
  assert.deepEqual(validateConfig(cfg).map((e) => e.path), ['items']);
});

test('a class needs at least one tier, a known effect and unique ids', () => {
  const cfg = base();
  cfg.classes.list[0].tiers = [];
  cfg.classes.list[1].effect = 'speed';
  cfg.classes.list.push({ id: 'desk', name: 'Again', effect: 'none', tiers: [tier()] });
  const paths = validateConfig(cfg).map((e) => `${e.path}: ${e.message}`);
  assert.ok(paths.includes('classes.list[0].tiers: at least one tier'));
  assert.ok(paths.some((p) => p.startsWith('classes.list[1].effect: expected one of')));
  assert.ok(paths.includes('classes.list[2].id: duplicate id "desk"'));
});

test('tier value is at least 1 and comfort at least 0', () => {
  const cfg = base();
  cfg.classes.list[0].tiers[0].value = 0.9;
  cfg.classes.list[0].tiers[0].comfort = -1;
  assert.deepEqual(validateConfig(cfg).map((e) => e.path), ['classes.list[0].tiers[0].value', 'classes.list[0].tiers[0].comfort']);
});

test('loot chance is a probability and job loot texts are strings', () => {
  const cfg = base();
  cfg.loot.chance = 1.5;
  cfg.jobs.list[0].loot = [3];
  assert.deepEqual(validateConfig(cfg).map((e) => e.path), ['jobs.list[0].loot[0]', 'loot.chance']);
});
```

**Step 2: Run to verify failure**

Run: `node --test test/config.test.mjs`
Expected: FAIL (schema 1, unknown blocks `room`, `classes`, `loot`).

**Step 3: Implement**

In `model/config.mjs`:
- `SCHEMA = 2`.
- Add a `prob` shape: `{ kind: 'prob' }`, a finite number in [0, 1]; in `check`, `if (shape.kind === 'prob') { if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) fail(\`expected number between 0 and 1, got ${shown}\`); return; }`.
- Replace the `racks` and `items` entries of SHAPES, in this order, with:

```js
  room: record({ enabled: bool, rigSlots: nonNegInt }),
  classes: record({
    enabled: bool,
    list: list(record(
      { id: str, name: str, effect: enumOf(['pay', 'tapAdvance', 'rigSpeed', 'tapMoney', 'barBonus', 'none']),
        tiers: list(record({ name: str, cost: pos, value: atLeast(1), comfort: atLeast(0) })) },
      { event: record({ boost: atLeast(0), dur: atLeast(0) }) },
    )),
  }),
  events: record({ enabled: bool, window: num, first: num, min: num, max: num, acceptRate: num }),
  loot: record({ enabled: bool, chance: prob, payRuns: atLeast(0) }),
```
- Make the job record's `loot` optional: `record({ id: str, … }, { loot: list(str) })`.
- Replace `checkItemSizes` with `checkClassTiers(cfg, errs)`: when `classes.list` is clean and an array, push `{ path: \`classes.list[${i}].tiers\`, message: 'at least one tier' }` for every class whose `tiers.length === 0`.
- `validateConfig`: `checkDuplicateIds(cfg, 'classes', errs)` instead of `'items'`; call `checkClassTiers`.
- Update the header comment to list the shapes incl. `prob`.

**Step 4: Run the tests**

Run: `node --test test/config.test.mjs`
Expected: PASS. (`npm test` will fail elsewhere until later tasks; that is expected.)

**Step 5: Commit**

```bash
git add tools/sim/model/config.mjs tools/sim/test/config.test.mjs
git commit -m "sim: schema 2 — room, classes and loot blocks replace items and racks"
```

## Task 2: Core — new multipliers, tps and non-purchase events

**Files:**
- Modify: `tools/sim/model/core.mjs`
- Modify: `tools/sim/model/registry.mjs` (contract comment only)
- Test: `tools/sim/test/core.test.mjs`

**Step 1: Write the failing tests**

Append to `test/core.test.mjs` (follow the existing stub-module style there):

```js
test('ctx carries the four new multipliers, defaulting to 1, and the session tps', () => {
  let seen;
  const probe = { id: 'probe', init: (s) => { s.probe = {}; }, tick: (s, dt, ctx) => { seen = ctx; },
    offers: () => [], buy: () => {}, metrics: () => ({}),
    multipliers: () => ({ tapMult: 2, barMult: 3 }) };
  run({ config: minimalConfig(), profile: oneSession({ tps: 2.5, minutes: 1 }), days: 1, modules: [probe] });
  assert.equal(seen.tapMult, 2);
  assert.equal(seen.barMult, 3);
  assert.equal(seen.rigSpeedMult, 1);
  assert.equal(seen.tapAdvanceMult, 1);
  assert.equal(seen.tps, 2.5);
});

test('ctx.record adds a timeline event that is not a purchase but does set firstEvent', () => {
  const m = { id: 'm', init: (s) => { s.m = { done: false }; },
    tick: (s, dt, ctx) => { if (!s.m.done) { s.m.done = true; ctx.record({ kind: 'loot', id: 'loot:wifi', earned: 5 }); } },
    offers: () => [], buy: () => {}, metrics: () => ({}) };
  const r = run({ config: minimalConfig(), profile: oneSession({ tps: 1, minutes: 1 }), days: 1, modules: [m] });
  const ev = r.timeline.find((e) => e.kind === 'loot');
  assert.equal(ev.day, 1);
  assert.equal(ev.earned, 5);
  assert.deepEqual(r.summary[0].purchases, []);
  assert.deepEqual(r.metrics.purchasesPerDay, [0]);
  assert.equal(r.metrics['firstEvent:loot'], 0);
});
```

Use whatever helpers `core.test.mjs` already has for a minimal config and a one-session profile; if there are none, add `minimalConfig()` returning `{ schema: 2 }` plus `enabled: true` blocks the stubs need, and `oneSession({ tps, minutes })` returning a profile with `sessions.day1 = { hour: 20, minutes, tps }`, `later: []` and the default policy.

**Step 2: Run to verify failure**

Run: `node --test test/core.test.mjs`
Expected: FAIL (`seen.tapMult` undefined, `ctx.record` not a function).

**Step 3: Implement**

In `model/core.mjs`:
- `const MULT_KEYS = ['payMult', 'speedMult', 'comfortMult', 'rigSpeedMult', 'tapMult', 'barMult', 'tapAdvanceMult'];`
- `const BIG_KINDS = new Set(['rig', 'class', 'tier']);`
- `buildCtx(state, mods, profile, tapsThisTick, tps, record)`: initialise every MULT_KEY to 1 in a loop (`Object.fromEntries(MULT_KEYS.map((k) => [k, 1]))`), then add `tapsThisTick, t, policy, tps, record`. `record` is the core's record function wrapped so the module only passes `{ kind, id, ... }`: `(event) => record({ t: state.t, day: state.day, ...event })`. Pass `session.tps` in the tick loop, `0` for gaps and the final/summary ctx. A purchase is an event with a numeric `cost`:
  - `summary[e.day - 1].purchases.push(e.id)` and the `byKind` count only when `typeof e.cost === 'number'`.
  - `record()`'s `firstEvent` logic stays for every non-`offline` kind, so `firstEvent:loot` works.
- In `run()`, build the gap-loop ctx with tps 0 and the same `record`.

In `model/registry.mjs`, update the MODULE CONTRACT comment: `multipliers?` may return any of the seven keys; ctx has `tps` (taps per second of the current session, 0 offline) and `record(event)` (adds a timeline event; give it a `cost` only for purchases); the purchase kinds are `level class tier rig` and the big kinds `rig class tier`; the order line reads `taps, bar, jobs, rigs, room, classes, events, loot, offline`.

**Step 4: Run the tests**

Run: `node --test test/core.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add tools/sim/model/core.mjs tools/sim/model/registry.mjs tools/sim/test/core.test.mjs
git commit -m "sim core: seven multipliers, ctx.tps, module-recorded non-purchase events"
```

## Task 3: Classes module replaces items and racks

**Files:**
- Create: `tools/sim/model/mods/classes.mjs`
- Delete: `tools/sim/model/mods/items.mjs`, `tools/sim/model/mods/racks.mjs`
- Modify: `tools/sim/model/mods/events.mjs` (reads owned classes instead of placed items)
- Test: `tools/sim/test/classes.test.mjs`; delete `tools/sim/test/room.test.mjs` (its rig tests move to Task 4)

**Step 1: Write the failing tests**

`test/classes.test.mjs`, using `base()` and `ctx()` from `test/fixtures/starter-base.mjs`:

```js
import { classes, ownedClasses, totalComfort, rigSlots } from '../model/mods/classes.mjs';
import { eventsComfort } from '../model/mods/events.mjs';

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
  assert.equal(eventsComfort(state, state.config), 0);
  assert.equal(rigSlots(state), 0);
});
```

**Step 2: Run to verify failure**

Run: `node --test test/classes.test.mjs`
Expected: FAIL (module missing).

**Step 3: Implement**

`model/mods/classes.mjs`:

```js
// Classes: each class owns one room spot and is bought once, then upgraded through its tiers.
// `state.classes.tier[id]` is 0 (not owned) … tiers.length. The tier in force is tiers[tier − 1]:
// its `value` multiplies what the class's `effect` names (pay, tapAdvance, rigSpeed, tapMoney,
// barBonus), or, for `rigSlots`, is the number of rig slots the class provides; `none` does
// nothing beyond comfort. Its `comfort` adds to the room's permanent comfort.
// comfortMult = 1 + roomComfort / 100, roomComfort = owned tiers' comfort + the average comfort of
// the owned classes' events (events.mjs). Ownership changes only in buy(), so the owned list, the
// multiplier products and the slot count are cached there.
//
// The layout of `state.classes` is private; other modules use:
//   ownedClasses(state)       [{ cls, tier }]          (events)
//   totalComfort(state)       owned tiers' comfort alone
//   rigSlots(state)           rig slots the owned rack tiers provide; 0 when the block is off (rigs)
// classes.mjs and events.mjs import each other; the cycle is safe only while every cross-import
// is a function declaration called at run time. Same for taps.mjs (tapMoney).
import { runningIncome, passiveIncome } from './jobs.mjs';
import { tapMoney } from './taps.mjs';
import { eventsComfort, eventComfortOf } from './events.mjs';

const OFFER_PREFIX = 'class:';
const EFFECT_KEY = { pay: 'payMult', tapAdvance: 'tapAdvanceMult', rigSpeed: 'rigSpeedMult', tapMoney: 'tapMult', barBonus: 'barMult' };

const tierAt = (cls, tier) => (tier === 0 ? null : cls.tiers[tier - 1]);
const valueAt = (cls, tier) => tierAt(cls, tier)?.value ?? 1;
const comfortAt = (cls, tier) => tierAt(cls, tier)?.comfort ?? 0;
const slotsAt = (cls, tier) => (cls.effect === 'rigSlots' ? tierAt(cls, tier)?.value ?? 0 : 0);

export function ownedClasses(state) { return state.classes.ownedList; }
export function totalComfort(state) { return state.classes.comfort; }
export function rigSlots(state) { return state.classes ? state.classes.rigSlots : 0; }
export function roomComfort(state, cfg) { return totalComfort(state) + eventsComfort(state, cfg); }

function refresh(state, cfg) {
  const ownedList = cfg.classes.list.filter((cls) => state.classes.tier[cls.id] > 0).map((cls) => ({ cls, tier: state.classes.tier[cls.id] }));
  const mults = Object.fromEntries(Object.values(EFFECT_KEY).map((k) => [k, 1]));
  let comfort = 0;
  let slots = 0;
  for (const { cls, tier } of ownedList) {
    if (cls.effect in EFFECT_KEY) mults[EFFECT_KEY[cls.effect]] *= valueAt(cls, tier);
    comfort += comfortAt(cls, tier);
    slots += slotsAt(cls, tier);
  }
  Object.assign(state.classes, { ownedList, mults, comfort, rigSlots: slots });
}

// Extra credits per second the next tier would add, against the current room. Approximate, like
// the old items module: pay and comfort scale the running income; tapMoney scales the tap rate;
// barBonus the bar payout rate; tapAdvance the extra work taps push into running jobs; rigSpeed the
// passive income. ctx.tps is 0 outside a session, so tap-side gains are 0 there. A rack earns
// nothing itself; it gets the old racks module's heuristic (1 % of passive income + 1 credit/s) so
// the shop buys it once cheap job levels are gone.
function gainOf(state, cfg, ctx, cls, from, to) {
  const ratio = valueAt(cls, to) / valueAt(cls, from);
  const comfortNow = roomComfort(state, cfg);
  const eventNow = from === 0 ? 0 : eventComfortOf(cfg, cls);
  const comfortRatio = (100 + comfortNow - comfortAt(cls, from) - eventNow + comfortAt(cls, to) + eventComfortOf(cfg, cls)) / (100 + comfortNow);
  const running = state.jobs ? runningIncome(state, cfg, ctx) : 0;
  const passive = state.jobs ? passiveIncome(state, cfg, ctx) : 0;
  const tapRate = (state.jobs && state.taps && cfg.taps?.enabled !== false ? tapMoney(state, cfg, ctx) : 0) * ctx.tps;
  const barRate = cfg.bar?.enabled === false ? 0 : tapRate * cfg.bar.bonusTaps / cfg.bar.steps;
  const comfortGain = (running + tapRate) * (comfortRatio - 1);
  switch (cls.effect) {
    case 'pay': return running * (ratio - 1) + comfortGain;
    case 'tapMoney': return tapRate * (ratio - 1) + comfortGain;
    case 'barBonus': return barRate * (ratio - 1) + comfortGain;
    case 'tapAdvance': return running * ctx.tps * (cfg.taps?.enabled === false ? 0 : cfg.taps.advance) * ctx.tapAdvanceMult * (ratio - 1) + comfortGain;
    case 'rigSpeed': return passive * (ratio - 1) + comfortGain;
    case 'rigSlots': return 0.01 * passive + 1 + comfortGain;
    default: return comfortGain;
  }
}

export const classes = {
  id: 'classes',
  init(state, config) {
    state.classes = { tier: Object.fromEntries(config.classes.list.map((c) => [c.id, 0])) };
    refresh(state, config);
  },
  tick() {},
  offers(state, ctx) {
    const cfg = state.config;
    const out = [];
    for (const cls of cfg.classes.list) {
      const tier = state.classes.tier[cls.id];
      if (tier >= cls.tiers.length) continue;
      out.push({ id: OFFER_PREFIX + cls.id, cost: cls.tiers[tier].cost, kind: tier === 0 ? 'class' : 'tier',
        gainPerSec: gainOf(state, cfg, ctx, cls, tier, tier + 1) });
    }
    return out;
  },
  buy(state, offerId) {
    state.classes.tier[offerId.slice(OFFER_PREFIX.length)] += 1;
    refresh(state, state.config);
  },
  multipliers(state) {
    return { ...state.classes.mults, comfortMult: 1 + roomComfort(state, state.config) / 100 };
  },
  metrics(state) {
    const cfg = state.config;
    const owned = ownedClasses(state);
    const out = { 'classes.owned': owned.length, 'classes.tiers': owned.reduce((s, { tier }) => s + tier, 0),
      'comfort.total': totalComfort(state), 'slots.rig': rigSlots(state) };
    for (const cls of cfg.classes.list) out[`classes.${cls.id}.tier`] = state.classes.tier[cls.id];
    return out;
  },
};
```

`events.mjs`: import `ownedClasses` from `./classes.mjs`; `eventComfortOf(cfg, cls)` reads `cls.event`; `eventsComfort` returns 0 when `!state.classes`, else sums `eventComfortOf(cfg, cls)` over `ownedClasses(state)`. Header comment: "an owned class with an event" instead of "placed decor item".

Delete `items.mjs` and `racks.mjs`. `rigs.mjs` still imports from `racks.mjs` at this point and is fixed in Task 4; `node --test test/classes.test.mjs` does not load rigs, so it runs.

**Step 4: Run the tests**

Run: `node --test test/classes.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A tools/sim/model/mods tools/sim/test/classes.test.mjs tools/sim/test/room.test.mjs
git commit -m "sim: classes module — tiered room classes, per-effect multipliers, rack rig slots"
```

## Task 4: Rigs take their slots from the rack class

**Files:**
- Modify: `tools/sim/model/mods/rigs.mjs`
- Test: `tools/sim/test/rigs.test.mjs`

**Step 1: Write the failing tests**

```js
import { rigs } from '../model/mods/rigs.mjs';
import { classes } from '../model/mods/classes.mjs';
import { jobs } from '../model/mods/jobs.mjs';

const setup = () => {
  const state = { credits: 0, config: base() };
  for (const m of [jobs, rigs, classes]) m.init(state, state.config);
  return state;
};

test('a rig is offered only for an unlocked, unrigged job while a rack slot is free, and takes the slot', () => {
  const state = setup();
  jobs.buy(state, 'job:wifi:lv');
  assert.deepEqual(rigs.offers(state, ctx()), []);           // no rack yet
  classes.buy(state, 'class:rack');
  const [offer] = rigs.offers(state, ctx());
  assert.deepEqual([offer.id, offer.kind, offer.cost], ['rig:wifi', 'rig', 120]);
  rigs.buy(state, offer.id);
  assert.deepEqual(rigs.metrics(state), { 'rigs.count': 1, 'slots.rigFree': 2 });
  assert.deepEqual(rigs.offers(state, ctx()), []);           // wifi rigged; stream locked
});

test('a rig for a locked job is not offered', () => {
  const state = setup();
  classes.buy(state, 'class:rack');
  assert.deepEqual(rigs.offers(state, ctx()), []);
});

test('buying a rig without a free slot throws before the job is marked', () => {
  const state = setup();
  jobs.buy(state, 'job:wifi:lv');
  assert.throws(() => rigs.buy(state, 'rig:wifi'), /no free rig slot/);
  assert.equal(rigs.metrics(state)['rigs.count'], 0);
});

test('a rig offer values the job as rigged: runRate with rigSpeedMult applied', () => {
  const state = setup();
  jobs.buy(state, 'job:wifi:lv'); classes.buy(state, 'class:rack');
  const [plain] = rigs.offers(state, ctx());
  const [fast] = rigs.offers(state, { ...ctx(), rigSpeedMult: 2 });
  assert.equal(fast.gainPerSec, plain.gainPerSec * 2);
});
```

The last test depends on Task 5's `runRate(..., asRigged)`; write it now, expect it to fail until Task 5 lands, and note that in the commit message — or move it to Task 5's jobs tests. Prefer moving it to Task 5.

**Step 2: Run to verify failure**

Run: `node --test test/rigs.test.mjs`
Expected: FAIL (rigs.mjs imports racks.mjs, which is gone).

**Step 3: Implement**

`rigs.mjs`: import `rigSlots` from `./classes.mjs`; replace `freeSmall(state, cfg) <= 0` with `freeRigSlot(state) <= 0` where `const freeRigSlot = (state) => rigSlots(state) - state.rigs.count;` (rigs placed are counted by this module; no slot list is needed because a rig slot holds nothing but a rig). In `buy`, throw `new Error(\`no free rig slot for ${offerId}\`)` when `freeRigSlot(state) <= 0` before `setRigged`. Metrics: add `'slots.rigFree': freeRigSlot(state)`. Header comment: "A rig needs a free rig slot; the rack class provides them (classes.mjs `rigSlots`)".

**Step 4: Run the tests**

Run: `node --test test/rigs.test.mjs test/classes.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add tools/sim/model/mods/rigs.mjs tools/sim/test/rigs.test.mjs
git commit -m "sim: rigs take their slots from the rack class"
```

## Task 5: Taps, bar and jobs consume the new multipliers

**Files:**
- Modify: `tools/sim/model/mods/taps.mjs`, `tools/sim/model/mods/bar.mjs`, `tools/sim/model/mods/jobs.mjs`, `tools/sim/model/mods/rigs.mjs`
- Test: `tools/sim/test/bar.test.mjs`, `tools/sim/test/jobs.test.mjs`

**Step 1: Write the failing tests**

Add to `test/jobs.test.mjs`:

```js
test('rigSpeedMult speeds up rigged jobs only, active and offline', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); jobs.buy(state, 'job:stream:lv');
  setRigged(state, 'wifi', 'Script');
  const c = { ...ctx(), rigSpeedMult: 2, policy: { restartManualJobs: true } };
  jobs.tick(state, 3, c);                     // wifi: 6 s of work → one run; stream: 3 s, no run
  assert.equal(state.credits, 2);
  assert.equal(runRate(state, state.config, 'wifi', c), 2 / 6 * 2);
  assert.equal(runRate(state, state.config, 'stream', c), 8 / 15);
  state.credits = 0;
  jobs.offline(state, 60, c);                 // 60 s × 2 / 6 = 20 wifi runs; stream is not rigged
  assert.equal(state.credits, 40);
});

test('runsOf counts completed runs, active and offline', () => {
  const state = { credits: 0, t: 0, config: base() };
  jobs.init(state, state.config);
  jobs.buy(state, 'job:wifi:lv'); setRigged(state, 'wifi', 'Script');
  jobs.tick(state, 12, ctx());
  jobs.offline(state, 60, ctx());
  assert.equal(runsOf(state, 'wifi'), 12);
});
```

Add to `test/bar.test.mjs` (next to the existing bonus test): a full bar with `barMult: 2` in ctx pays `2 × bonusTaps × tapMoney`. Add to a new `test/taps.test.mjs`: with `tapMult: 2` a tap pays twice `max(minMoney, rate × income) × comfortMult`; with `tapAdvanceMult: 3` one tap advances a running job by `3 × taps.advance` seconds (read the job's work through a completed-run count: give wifi `time: 0.75` in the test config so one tap finishes it).

**Step 2: Run to verify failure**

Run: `node --test test/jobs.test.mjs test/bar.test.mjs test/taps.test.mjs`
Expected: FAIL.

**Step 3: Implement**

- `jobs.mjs`: `runRate` multiplies by `ctx.speedMult × (isRigged ? ctx.rigSpeedMult : 1)`; add an optional fourth arg to force the rigged view for a rig that is not yet bought: `runRate(state, cfg, id, ctx, asRigged = state.jobs.byId[id].rigged)`. In `tick`, `j.work += dt * ctx.speedMult * (j.rigged ? ctx.rigSpeedMult : 1)`. In `offline`, `runs = Math.floor(secs * ctx.speedMult * ctx.rigSpeedMult / job.time)` (only rigged jobs run there). Count runs: `byId[id].runs = 0` in init, `+1` in `finishRun`, `+runs` in `offline`; export `runsOf(state, id)` and list it in the header's entry points.
- `rigs.mjs`: the offer's `gainPerSec` is `runRate(state, cfg, rig.job, ctx, true)`. Add the rig-offer test from Task 4 ("a rig offer values the job as rigged") to `test/rigs.test.mjs` now.
- `taps.mjs`: `tapMoney` multiplies by `ctx.tapMult`; `tick` advances by `n × cfg.taps.advance × ctx.tapAdvanceMult`. Header: mention both.
- `bar.mjs`: the full-bar payout is `cfg.bar.bonusTaps * ctx.barMult * tapMoney(...)`.

**Step 4: Run the tests**

Run: `node --test test/jobs.test.mjs test/bar.test.mjs test/taps.test.mjs test/classes.test.mjs test/room.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add tools/sim/model/mods tools/sim/test
git commit -m "sim: taps, bar and jobs read tapMult, tapAdvanceMult, barMult and rigSpeedMult"
```

## Task 6: Loot module

> Shipped model (amended 2026-10-28 after review): one `loot` timeline event per claim that crosses at least one whole expected drop, carrying `earned` (the pool cashed at that claim) and `drops` (whole drops since the last event). `loot.earned` in metrics is the authoritative total; claims below a whole drop cash but record nothing. The floor uses a 1e-9 epsilon because `drops` is an accumulated float. Pending value is fixed at drop time (the job's pay at the moment the run completed, with that moment's multipliers).

**Files:**
- Create: `tools/sim/model/mods/loot.mjs`
- Modify: `tools/sim/model/registry.mjs` (import, module order `taps, bar, jobs, rigs, classes, events, loot, offline`; loot after jobs because it prices the runs that completed this step)
- Test: `tools/sim/test/loot.test.mjs`; `test/bar.test.mjs` order test

**Behaviour:** `accrue(state, ctx)`: for each job, fresh = `runsOf − seen`; `pending += fresh × chance × payRuns × payFor(ctx)` (also per job in `pendingBy`), `drops += fresh × chance`. `tick` = accrue then claim; `offline` = accrue only, so loot from a gap lands on the first tick of the next session. `claim`: credits += pending; `whole = floor(drops + 1e-9)`; if `whole > recorded`, `ctx.record({ kind: 'loot', id: 'loot:<job with most pending>', earned: pending, drops: whole − recorded })`, no `cost`; reset pending. Metrics `loot.pending`, `loot.earned`, `loot.drops`.

**Tests:** per-run accrual cashed on the next tick; absence waits for the next session; events per claim with `drops` 1, 1, then 2 for a 70-run claim; block disabled adds nothing; drop-time pay (a level bought between accrue and claim does not change the claimed amount); sub-whole claim cashes and records nothing; 100 single-run cycles record exactly 3 events with the third at the 100th run; a 3-day full `run()` on the fixture has finite `loot.earned > 0`, numeric `firstEvent:loot`, loot events outside `purchasesPerDay`, `shop.capHits` 0.

Commits: `b215d59`, `948a994`, plus the review follow-up.

## Task 7: Starter preset, profiles, targets, fixture

**Files:**
- Create: `tools/sim/presets/starter-2026-10-28.json`
- Delete: `tools/sim/presets/v2-2026-10-23.json`, `tools/sim/presets/v2-2026-10-27.json` (schema 1; kept in git at commit `65ac455`)
- Modify: `tools/sim/ui/manifest.json`, `tools/sim/targets/seven-day-idle.json`, `tools/sim/presets/README.md`, `tools/sim/test/fixtures/README.md`, `tools/sim/test/pacing.test.mjs`
- Regenerate: `tools/sim/test/fixtures/v2-expected.json` → rename to `starter-expected.json`

**Step 1: Write the preset** (first draft of the starter home numbers; the sweep in Task 10 adjusts them)

```json
{
  "schema": 2,
  "taps": { "enabled": true, "rate": 0.25, "minMoney": 1, "advance": 0.25 },
  "bar": { "enabled": true, "steps": 10, "bonusTaps": 15, "speed": 0.25, "speedDur": 12 },
  "jobs": {
    "enabled": true, "maxLevel": 50, "milestones": [], "revealAt": 0.6,
    "list": [
      { "id": "wifi",    "name": "Guess a neighbor's Wi-Fi password", "time": 6,   "pay": 2,    "cost": 5,     "r": 1.2, "rep": 3,   "unlock": 0,
        "loot": ["Neighbor's Netflix login", "Their kid's Fortnite account", "A folder called TAXES_FINAL_v7"] },
      { "id": "stream",  "name": "Sell a cracked streaming account",  "time": 15,  "pay": 8,    "cost": 40,    "r": 1.2, "rep": 9,   "unlock": 25,
        "loot": ["A password reused on a dating site", "A watch history nobody should see"] },
      { "id": "phone",   "name": "Recover a locked phone for cash",   "time": 30,  "pay": 30,   "cost": 250,   "r": 1.2, "rep": 30,  "unlock": 400,
        "loot": ["A photo of someone's winning lottery ticket", "A crypto seed phrase saved in Notes"] },
      { "id": "kebab",   "name": "Hack a kebab shop's loyalty app",   "time": 60,  "pay": 120,  "cost": 1500,  "r": 1.2, "rep": 90,  "unlock": 6000,
        "loot": ["The secret garlic sauce recipe", "The owner's 'cash only' spreadsheet"] },
      { "id": "dentist", "name": "Ransom a dentist's office PC",      "time": 120, "pay": 500,  "cost": 8000,  "r": 1.2, "rep": 300, "unlock": 60000,
        "loot": ["A celebrity's dental records", "An insurance claim with your name on it now"] },
      { "id": "radio",   "name": "Crash a local radio station",       "time": 240, "pay": 2000, "cost": 40000, "r": 1.2, "rep": 900, "unlock": 350000,
        "loot": ["An unreleased demo from a local band", "The DJ's blackmail folder"] }
    ]
  },
  "rigs": { "enabled": true, "list": [
    { "job": "wifi",    "name": "Wi-Fi cracking script",  "cost": 120 },
    { "job": "stream",  "name": "Account checker bot",    "cost": 600 },
    { "job": "phone",   "name": "Phone unlock kit",       "cost": 2500 },
    { "job": "kebab",   "name": "Loyalty app exploit",    "cost": 12000 },
    { "job": "dentist", "name": "Ransomware kit",         "cost": 60000 },
    { "job": "radio",   "name": "Transmitter hijack rig", "cost": 250000 } ] },
  "classes": { "enabled": true, "list": [
    { "id": "rack", "name": "Rack", "effect": "rigSlots", "tiers": [
      { "name": "Server rack", "cost": 60, "value": 3, "comfort": 0 } ] },
    { "id": "computer", "name": "Computer", "effect": "pay", "tiers": [
      { "name": "Old laptop",   "cost": 80,   "value": 1.15, "comfort": 0 },
      { "name": "Used desktop", "cost": 350,  "value": 1.35, "comfort": 0 },
      { "name": "Gaming PC",    "cost": 1400, "value": 1.65, "comfort": 0 },
      { "name": "Workstation",  "cost": 4500, "value": 2.0,  "comfort": 0 } ] },
    { "id": "router", "name": "Router", "effect": "tapAdvance", "tiers": [
      { "name": "ISP box",       "cost": 40,   "value": 1.5, "comfort": 0 },
      { "name": "Better router", "cost": 150,  "value": 2.0, "comfort": 0 },
      { "name": "Mesh Wi-Fi",    "cost": 500,  "value": 3.0, "comfort": 0 },
      { "name": "Fiber line",    "cost": 1200, "value": 4.0, "comfort": 0 } ] },
    { "id": "tower", "name": "Tower Unit", "effect": "rigSpeed", "tiers": [
      { "name": "Tower Unit", "cost": 9000, "value": 2.0, "comfort": 0 } ] },
    { "id": "desk", "name": "Desk", "effect": "tapMoney", "tiers": [
      { "name": "Simple desk",   "cost": 30,  "value": 1.25, "comfort": 2 },
      { "name": "IKAE table",    "cost": 180, "value": 1.6,  "comfort": 5 },
      { "name": "Standing desk", "cost": 700, "value": 2.0,  "comfort": 10 } ] },
    { "id": "chair", "name": "Chair", "effect": "barBonus", "tiers": [
      { "name": "Kitchen chair", "cost": 25,  "value": 1.5, "comfort": 2 },
      { "name": "Office chair",  "cost": 220, "value": 2.0, "comfort": 5 },
      { "name": "Gaming chair",  "cost": 600, "value": 3.0, "comfort": 10 } ] },
    { "id": "cat", "name": "Cat", "effect": "none", "tiers": [
      { "name": "Cat", "cost": 300, "value": 1, "comfort": 10 } ], "event": { "boost": 20, "dur": 30 } },
    { "id": "gf", "name": "Girlfriend", "effect": "none", "tiers": [
      { "name": "Girlfriend", "cost": 2500, "value": 1, "comfort": 20 } ], "event": { "boost": 100, "dur": 15 } }
  ] },
  "events": { "enabled": true, "window": 20, "first": 15, "min": 60, "max": 120, "acceptRate": 0.7 },
  "loot": { "enabled": true, "chance": 0.02, "payRuns": 12 },
  "offline": { "enabled": true, "capHours": 8 }
}
```

Run: `node cli.mjs validate --config presets/starter-2026-10-28.json` → `ok` on stderr, exit 0.

**Step 2: Point everything at it**

- `ui/manifest.json`: `"presets": ["starter-2026-10-28.json"]`.
- Delete the two `v2-*.json` presets. In `presets/README.md` add: "Presets before `starter-2026-10-28` use schema 1 and live in git history (last at commit `65ac455`); they do not load in this version of the sim."
- `targets/seven-day-idle.json`: change `daily-rig-or-item` to `"metric": "purchasesPerDay[rig,class,tier]:min"`, label "A rig or room upgrade every day D2–D6"; add `{ "id": "first-loot", "label": "First loot card within 10 min of play", "metric": "firstEvent:loot", "op": "<=", "value": 600, "profile": "all" }`.
- `model/targets.mjs`: `KINDS = ['level', 'class', 'tier', 'rig']`; fix `test/targets.test.mjs` where it names old kinds.
- `test/pacing.test.mjs`: rename the fixture to `fixtures/starter-expected.json`; in layer 1 change "owns at least five rigs by day 7" to "owns three rigs (the shelf is full) by day 7" and add "loot.earned > 0 for both profiles". Update the header of `test/fixtures/README.md` (fixture name, preset name, drop the baseline sections, add a "Current baseline (2026-10-28)" section after the regeneration in Step 3).

**Step 3: Regenerate the fixture and read it**

Run: `UPDATE_FIXTURE=1 npm test` then `npm test`.
Expected: all tests pass, except any remaining UI tests (fixed in Task 8). Read the new fixture and record in `fixtures/README.md`: first rig second, rigs per day, `offersLeft.final`, `purchasesPerDay`, `loot.earned`, day-7 credits for both profiles. If the shop hits its cap (`shop.capHits > 0`) or a metric is not finite, that is a model bug from Tasks 2–6: fix it before committing.

**Step 4: Commit**

```bash
git add -A tools/sim/presets tools/sim/ui/manifest.json tools/sim/targets tools/sim/model/targets.mjs tools/sim/test
git commit -m "sim: starter home preset (draft numbers), targets, fixture; schema-1 presets retired"
```

## Task 8: UI follows the schema

**Files:**
- Modify: `tools/sim/ui/charts.mjs`, `tools/sim/ui/app.mjs`, `tools/sim/ui/editor.mjs`, `tools/sim/ui/style.css` (if a style is needed for the tiers cell)
- Test: `tools/sim/test/ui-editor.test.mjs`, `tools/sim/test/ui-charts.test.mjs`

**Step 1: Write the failing tests**

- `ui-charts.test.mjs`: `MARKER_KINDS` deep-equals `['rig', 'class', 'tier', 'loot']` and the marker builder puts a `loot` event on the chart even though it has no cost (assert it uses `e.earned ?? e.cost` for the tooltip value).
- `ui-editor.test.mjs`: `columnsFor` on the classes list entry shape returns a column `tiers` of kind `list` whose `of` is a record; `formValue(listOfRecordShape, '[{"name":"a","cost":1,"value":1,"comfort":0}]')` parses JSON into the array and `formValue(..., 'not json')` returns `NaN`-free `undefined` plus an error marker the panel can show (pick one: return `undefined` and let the validator report the missing key). Also `formText` (the inverse, whatever it is called in that file) renders a list of records as pretty JSON on one line.

**Step 2: Run to verify failure**

Run: `node --test test/ui-*.test.mjs`
Expected: FAIL.

**Step 3: Implement**

- `charts.mjs`: `MARKER_KINDS = ['rig', 'class', 'tier', 'loot']`; the tooltip value falls back to `earned`.
- `app.mjs`: `METRICS_SHOWN = ['rigs.count', 'classes.owned', 'classes.tiers', 'loot.earned', 'offersLeft.final', 'shop.capHits']`.
- `editor.mjs`: a list whose `of` is a record is edited as a JSON text cell: `formValue` tries `JSON.parse`, returns the array when it parses to an array, else `undefined`; the text renderer prints `JSON.stringify(value)`. The table for `classes.list` therefore has a wide `tiers` column. The validator reports malformed tiers with a path into `classes.list[i].tiers[j]`, which the panel already shows.
- Hand-check in the browser (`preview_start` name `root-access`, open `/tools/sim/`): the starter preset loads, the classes table shows tier JSON, the chart draws class and loot markers, the targets panel shows 6 targets, a sweep over `classes.list[tower].tiers[0].cost` with values `6000,9000,12000` runs.

**Step 4: Run the tests**

Run: `npm test`
Expected: PASS, all files.

**Step 5: Commit**

```bash
git add tools/sim/ui tools/sim/test
git commit -m "sim ui: classes and loot in the editor, markers and metrics"
```

## Task 9: README and CLI help

**Files:**
- Modify: `tools/sim/README.md`, `tools/sim/cli.mjs` (help text paths), `tools/sim/test/cli.test.mjs` (expected transcripts)

**Steps:** Rewrite the config section of `README.md` for schema 2 (the block list, the class and tier rules, the loot rule, the four new multipliers, the purchase kinds `level class tier rig`, the `loot` timeline kind, the metrics `classes.owned`, `classes.tiers`, `classes.<id>.tier`, `comfort.total`, `slots.rig`, `slots.rigFree`, `loot.pending`, `loot.earned`, `loot.drops`, `firstEvent:loot`). Replace every example path (`racks.cost`, `items.list[gpu].pay`) with `classes.list[rack].tiers[0].value`, `classes.list[desk].tiers[1].cost`, `loot.chance`. Re-run each CLI example in the README and paste the real output. Update the help text in `cli.mjs` the same way, and the expected strings in `cli.test.mjs`. Run `npm test`; commit:

```bash
git add tools/sim/README.md tools/sim/cli.mjs tools/sim/test/cli.test.mjs
git commit -m "sim docs: schema 2 contract, paths and examples"
```

## Task 10: First sweep and the numbers decision

Not code. With the sim green:

1. `node cli.mjs run --config presets/starter-2026-10-28.json --profile profiles/active.json --targets targets/seven-day-idle.json` and the same for `casual`. Note the verdicts, `purchasesPerDay`, `purchasesByKindPerDay`, day-7 credits, `loot.earned`.
2. Sweep the levers most likely to move a failing target: `loot.chance` (0.02, 0.03, 0.05), `classes.list[tower].tiers[0].cost`, `rigs.list[kebab].cost`, `jobs.list[radio].pay`, and `classes.list[rack].tiers[0].value` (3 against 4, to see what the shelf size costs the curve).
3. Write the results to `docs/plans/2026-10-28-starter-home-numbers.md` as a table per sweep with a recommendation, and stop for the user's decision. The chosen numbers become the committed preset; regenerate the fixture with them and note the baseline in `test/fixtures/README.md`.

## Out of scope, next plan

Porting the game (`public/root-access-v2/index.html` and `config.js` in ugurkc.github.io) to schema 2: class spots and sprites, the Tower Unit, the rig shelf, loot cards, the kebab and radio jobs, the save-format change (`items`/`slots` → class tiers), and the spec doc `docs/root-access-v2-spec.md`. That plan starts once Task 10's numbers are chosen.
