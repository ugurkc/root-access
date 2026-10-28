# Balance simulator

Runs the game's economy from one JSON config over a schedule of play sessions and reports a daily
summary, a purchase timeline and named metrics per player profile. A targets file turns those numbers
into pass/fail verdicts, so "do these numbers give the journey we want?" is one command with an exit
code. The model under `model/` is plain ES modules with no Node imports, so the same code runs in a
browser; only `cli.mjs` and the tests use Node 22. Tests: `npm test` from the repository root
(`node --test`, no dependencies). Regenerate the pacing fixture only on purpose: `UPDATE_FIXTURE=1 npm test`.

## JSON contract

### Config (`presets/starter-<date>.json`)

`{ "schema": 2, taps, bar, jobs, rigs, classes, events, loot, offline }`. Every block is required and
carries `enabled`; `enabled: false` skips that mechanic's module everywhere (init, tick, offers,
metrics) but the block must still be complete. Shapes live in `model/config.mjs` (`SHAPES`). Trimmed
from `presets/starter-2026-10-28.json` (one job, one rig, three of the eight classes):

```json
{ "schema": 2,
  "taps":  { "enabled": true, "rate": 0.25, "minMoney": 1, "advance": 0.25 },
  "bar":   { "enabled": true, "steps": 10, "bonusTaps": 15, "speed": 0.25, "speedDur": 12 },
  "jobs":  { "enabled": true, "maxLevel": 50, "milestones": [], "revealAt": 0.6,
             "list": [ { "id": "wifi", "name": "Guess a neighbor's Wi-Fi password", "time": 6, "pay": 2,
                         "cost": 5, "r": 1.2, "rep": 3, "unlock": 0,
                         "loot": ["Neighbor's Netflix login", "Their kid's Fortnite account"] } ] },
  "rigs":  { "enabled": true, "list": [ { "job": "wifi", "name": "Wi-Fi cracking script", "cost": 120 } ] },
  "classes": { "enabled": true, "list": [
    { "id": "rack", "name": "Rack", "effect": "rigSlots",
      "tiers": [ { "name": "Server rack", "cost": 60, "value": 3, "comfort": 0 } ] },
    { "id": "desk", "name": "Desk", "effect": "tapMoney",
      "tiers": [ { "name": "Simple desk", "cost": 30, "value": 1.25, "comfort": 2 },
                 { "name": "IKAE table",  "cost": 180, "value": 1.6, "comfort": 5 } ] },
    { "id": "cat", "name": "Cat", "effect": "none",
      "tiers": [ { "name": "Cat", "cost": 300, "value": 1, "comfort": 10 } ],
      "event": { "boost": 20, "dur": 30 } } ] },
  "events": { "enabled": true, "window": 20, "first": 15, "min": 60, "max": 120, "acceptRate": 0.7 },
  "loot":  { "enabled": true, "chance": 0.02, "payRuns": 12 },
  "offline": { "enabled": true, "capHours": 8 } }
```

Rules the blocks encode:

- **Classes.** A class owns one room spot and is bought once, then upgraded tier by tier; tier 0 is
  "not owned" and the tier in force is `tiers[tier − 1]`. `effect` is one of `pay`, `tapAdvance`,
  `rigSpeed`, `tapMoney`, `barBonus`, `rigSlots`, `none` and says what the tier's `value` multiplies
  (`value` ≥ 1), except for `rigSlots`, where `value` is a whole count of rig slots. Each tier's
  `comfort` (≥ 0) adds to the room's permanent comfort. An optional per-class `event { boost, dur }`
  is averaged, not rolled: it adds `boost × dur × acceptRate / meanInterval` comfort while the class
  is owned, with `meanInterval = (events.min + events.max) / 2`.
- **Rack.** A rig needs a free rig slot and only a `rigSlots` class provides them (the preset's
  `rack`: one tier, 3 slots). With the classes block off, no rig can ever be bought.
- **Loot.** Every completed run (active or offline) adds the expectation `chance × payRuns × pay at
  drop time` to a pending pool and `chance` to an expected drop count. The pool is cashed by the loot step
  of the same tick (accrue, then claim: the player taps the card), so only loot from a gap waits, until
  the first tick of the next session.
  A claim that crosses at least one whole expected drop records one `loot` timeline event (one per
  claim, not per drop) with `earned`, the pool cashed at that claim, and `drops`, the whole drops since
  the last event; a claim below a whole drop cashes the pool but records nothing, so the metric
  `loot.earned` is the authoritative total, not the sum of the events' `earned`.
- **Loot texts.** A job may carry `loot: [texts]`; the game shows them, the sim ignores them.

`validateConfig(cfg)` returns `[{ path, message }]`: unknown or missing keys, wrong types, NaN,
non-positive costs and durations, bad enums, `value` below 1, `prob` outside `[0, 1]`, duplicate job
or class ids, a rig whose `job` is not a job id, `events.min + max <= 0`, a class with no tiers, a
`rigSlots` tier whose `value` is not an integer. Every CLI command refuses an invalid config before
running.

### Profile (`profiles/<id>.json`, resolved by id or path)

```json
{ "id": "casual",
  "sessions": { "day1": { "hour": 20, "minutes": 8, "tps": 1.5 },
                "later": [ { "hour": 21, "minutes": 5, "tps": 1.5 } ] },
  "policy": { "saveForBigWithinMinutes": 30, "bigValueRatio": 1.5,
              "buyRigsWhenAffordable": true, "restartManualJobs": true } }
```

`hour` 0–23, `minutes` and `tps` > 0. The policy is greedy by gain per cost, buys a `rig` in a pre-pass
when affordable, and saves for a big offer (`rig`, `class` or `tier`) that is reachable within the
window and beats the best affordable offer by `bigValueRatio`.

### Targets (`targets/<name>.json`)

An array of `{ id, label, metric, op, value, profile, days? }`. `op` is one of `<= < >= > ==`
(exact); `profile` is `"all"` or a profile id; `days` is `[from, to]`, 1-based inclusive, and only
applies to `purchasesPerDay` metrics. Metric grammar (`model/targets.mjs`):

| metric | reads |
|---|---|
| `firstEvent:rig`, `firstEvent:loot`, `offersLeft.final`, `rigs.count`, `jobs.wifi.level`, … | any key of the run's `metrics` |
| `purchasesPerDay:min\|max\|sum` | over per-day purchase counts, restricted to `days` |
| `purchasesPerDay[rig,class,tier]:min` | same, counting only the listed kinds (`level class tier rig`) |
| `summary.incomePassive:day7` | field `incomePassive` of day 7's summary row |

A verdict is `{ id, label, profile, expected, pass, actual }`. When the metric cannot be read it
fails with `actual: null` and an `error`: `unknown metric`, `unknown kind "x"`, `no value` (the event
never happened), `no run for profile x`, `no runs`, or `days [2, 9] exceed run length 7`.

### Result (`run --json`)

`{ config, days, profiles: { <id>: { summary, timeline, metrics } }, verdicts }`. Trimmed from a real run
(numbers rounded, lists abridged):

```json
{ "config": "tools/sim/presets/starter-2026-10-28.json", "days": 7,
  "profiles": { "active": {
    "summary": [ { "day": 1, "activeMinutes": 12, "credits": 326479.15, "incomePassive": 993.56,
                   "offlineEarned": 0, "activeEarned": 7172133.38,
                   "purchases": ["job:wifi:lv", "job:wifi:lv", "job:wifi:lv", "class:chair", "class:rack", "rig:wifi"] } ],
    "timeline": [ { "t": 2, "day": 1, "kind": "level", "id": "job:wifi:lv", "cost": 5 },
                  { "t": 86.4, "day": 1, "kind": "loot", "id": "loot:wifi", "earned": 16.58, "drops": 1 } ],
    "metrics": { "income.passive": 1086.71, "rigs.count": 3, "classes.tiers": 18, "loot.earned": 79499220.96,
                 "offersLeft.final": 2, "firstEvent:level": 2, "firstEvent:rig": 29.2, "firstEvent:loot": 86.4,
                 "purchasesPerDay": [194, 79, 19, 7, 4, 3, 3],
                 "purchasesByKindPerDay": { "level": [173, 79, 19, 7, 4, 3, 3], "class": [8, 0, 0, 0, 0, 0, 0],
                                            "tier": [10, 0, 0, 0, 0, 0, 0], "rig": [3, 0, 0, 0, 0, 0, 0] } } } },
  "verdicts": [ { "id": "first-rig", "label": "First rig inside the first session", "profile": "active",
                  "expected": { "metric": "firstEvent:rig", "op": "<=", "value": 480 }, "pass": true, "actual": 29.2 } ] }
```

`t` is simulated seconds since the first session began, gaps included; `firstEvent:*` is seconds of
active play. The `purchases` list above is a hand-picked selection; the real day 1 has 194 entries, in order.

**Timeline and purchase kinds.** Every timeline event has `t`, `day` and `kind`. Purchase kinds are
`level`, `class` (a class's first tier), `tier` (a later one) and `rig`; a purchase also carries a
numeric `cost` and is what `summary[].purchases`, `purchasesPerDay` and `purchasesByKindPerDay`
count. The shop saves for the big kinds `rig`, `class`, `tier`. Two more kinds are not purchases:
`loot` (`{ earned, drops }`, one per claim that crosses a whole expected drop; `earned` is the pool
cashed at that claim, `drops` the whole drops since the last event) and `offline` (`{ seconds, earned }`,
one per gap). `firstEvent:<kind>` exists for every kind except `offline`, so `firstEvent:loot` works.

**Multipliers.** `ctx` carries `payMult, speedMult, comfortMult, rigSpeedMult, tapMult, barMult,
tapAdvanceMult`, the product of every module's `multipliers()`, rebuilt each tick:

| key | produced by | consumed by |
|---|---|---|
| `speedMult` | bar (active boosts) | jobs: work speed of every job |
| `payMult` | classes (`pay`) | jobs: pay per run |
| `comfortMult` | classes: `1 + roomComfort / 100` | jobs: pay per run; taps: money per tap |
| `rigSpeedMult` | classes (`rigSpeed`) | jobs: work speed of rigged jobs only |
| `tapMult` | classes (`tapMoney`) | taps: money per tap |
| `tapAdvanceMult` | classes (`tapAdvance`) | taps: job work pushed per tap |
| `barMult` | classes (`barBonus`) | bar: the full-bar payout |

Comfort multiplies job pay and tap money. A tap pays `max(minMoney, rate × running income) × comfortMult
× tapMult`, and running income already carries `comfortMult`, so taps lean on comfort twice; the bar
payout is `bonusTaps × barMult × tap money`, so it inherits both.

**Metrics** (`metrics(state, ctx)` of each module, merged; the core adds the last group):

- taps: `income.tap` (credits per tap), `taps.count`
- bar: `bar.bars`, `bar.activeBoosts`
- jobs: `income.passive` (per second, rigged jobs), `income.running` (per second, every running job),
  `rep`, `jobs.<id>.level`, `jobs.<id>.rigged` (0/1)
- rigs: `rigs.count`, `slots.rigFree`
- classes: `classes.owned`, `classes.tiers` (owned tiers summed), `classes.<id>.tier`, `comfort.total`
  (owned tiers' comfort, events excluded), `slots.rig`
- events: `events.comfortAvg`
- loot: `loot.pending`, `loot.earned` (the authoritative total; claims below a whole drop record no
  event), `loot.drops` (expected cards, a float)
- offline: `offline.gaps`, `offline.cappedCount`, `offline.cappedSeconds`
- core: `firstEvent:<kind>`, `purchasesPerDay`, `purchasesByKindPerDay`, `credits.final`,
  `offersLeft.final`, `shop.capHits`

## UI

`index.html` next to this file is the same model in a browser: a config editor built from
`SHAPES` with inline validation, a run panel with the daily table and metrics, two charts
(credits and passive income over simulated days, with rig/class/tier markers; loot markers start
hidden until toggled in the legend and stay off the passive chart), the target checklist with live
verdicts, and a sweep panel whose rows load back into the editor. Serve the repo with any static
server and open `tools/sim/`; the page uses only relative URLs plus Chart.js from a CDN.
Import/Export round-trip `config.json`, `config.js` and targets JSON.

## CLI

Data (tables, JSON, validation reports) goes to stdout; diagnostics, refusals and usage go to stderr.
Exit 0 ok, 1 validation errors or any failed verdict, 2 usage error (usage text follows on stderr).
`node tools/sim/cli.mjs --help` prints every option. Quote `--param`/`--param2` paths, since they contain brackets.

```
$ node tools/sim/cli.mjs validate --config tools/sim/presets/starter-2026-10-28.json
ok
$ node tools/sim/cli.mjs validate --targets tools/sim/targets/seven-day-idle.json --profile active
ok
$ node tools/sim/cli.mjs validate --config bad.json       # exit 1, one line per error
loot.chance: expected number between 0 and 1, got 1.5
bogus: unknown key
rigs.list[0].job: unknown job id "wifii"
```

```
$ node tools/sim/cli.mjs run --config tools/sim/presets/starter-2026-10-28.json --targets tools/sim/targets/seven-day-idle.json
== active (7 days) ==
day  active min  credits  passive $/s  offline $  active $  purchases
  1          12     326K          993          0     7.17M        194
  2          16     450K        1.09K      45.1M     40.4M         79
  3          16    2.24M        1.09K      46.6M     60.1M         19
  4          16    8.64M        1.09K      46.6M     63.7M          7
  5          16    24.5M        1.09K      46.6M     65.9M          4
  6          16    34.4M        1.09K      46.6M     67.3M          3
  7          16    23.8M        1.09K      46.6M     69.0M          3

== casual (7 days) ==
  ...
targets: 10/12 pass
✓ first-upgrade/active  First job level-up within 90 s: actual 2 (firstEvent:level <= 90)
✓ first-rig/casual  First rig inside the first session: actual 38 (firstEvent:rig <= 480)
✓ d7-not-done/active  Something still to buy on day 7: actual 2 (offersLeft.final >= 1)
✗ daily-rig-or-item/active  A rig or room upgrade every day D2–D6: actual 0 (purchasesPerDay[rig,class,tier]:min days 2–6 >= 1)
✓ first-loot/active  First loot card within 10 min of play: actual 86.40 (firstEvent:loot <= 600)
...  (verdict lines trimmed; the real output has one per target and profile)
```

Exit 1 because verdicts failed. `--profile` repeats (`--profile active --profile my/profile.json`),
default `active, casual`; `--days N` default 7; `--json` prints the result object above instead.

```
$ node tools/sim/cli.mjs sweep --config tools/sim/presets/starter-2026-10-28.json --targets tools/sim/targets/seven-day-idle.json \
    --param 'rigs.list[wifi].cost' --values 60,120,240
rigs.list[wifi].cost   pass  firstEvent:rig/active  offersLeft.final/active  firstEvent:rig/casual  offersLeft.final/casual
                  60  10/12                     28                        2                   33.3                        3
                 120  10/12                   29.2                        2                     38                        3
                 240  10/12                     34                        2                   53.3                        3
```

Paths address list entries by `id` (`jobs.list[radio].pay`, `classes.list[cat].event.boost`), by `job`
for rigs (`rigs.list[stream].cost`), or by index (`jobs.list[2].pay`); plain keys need no brackets
(`loot.chance`). A class's `tiers` has no ids, so it is addressed by index:
`classes.list[rack].tiers[0].value`, `classes.list[desk].tiers[1].cost`. Add `--param2 … --values2 …`
for a grid. Values parse as numbers or `true`/`false`. Each combination is validated; an invalid one
aborts with exit 1 (`invalid config at rigs.list[wifi].cost=0: rigs.list[0].cost: expected positive
number, got 0`). `--json` gives
`[{ values, passes, total, metrics: { <profile>: { "firstEvent:rig", "rigs.count", "credits.final", "offersLeft.final" } } }]`.

```
$ node tools/sim/cli.mjs convert --to js --in tools/sim/presets/starter-2026-10-28.json --out /tmp/config.js
wrote /tmp/config.js
$ node tools/sim/cli.mjs convert --to json --in /tmp/config.js --out /tmp/config.json
wrote /tmp/config.json
```

`--to js` writes `window.RA_CONFIG = {…};`, the file the game loads next to its `index.html`. `--to json`
reads that form back; a hand-written `config.js` is evaluated in a sandbox, so only convert trusted files.
The round trip preserves every value of the preset exactly (`fromJs(toJs(cfg))` deep-equals `cfg`); only
the whitespace formatting differs. The game still reads schema 1: a schema-2 `config.js` is written for
the port that a separate plan covers, and the game does not load it yet.

## Adding a mechanic

The contract is the comment block at the top of `model/registry.mjs`; `model/mods/offline.mjs` is the
smallest example. A module is `{ id, init(state, config, profile), tick(state, dt, ctx),
offline?(state, seconds, ctx), offers(state, ctx), buy(state, offerId), metrics(state, ctx), multipliers?(state) }`.
`id` is the config block name. `init` creates the module's own slice (`state.<id> = {…}`); other modules
never reach into it and use exported helpers (`helper(state, cfg, …)`) instead. `offers` returns
`[{ id, cost, gainPerSec, kind }]` with finite numbers; `buy` applies the effect only, the core has
already deducted the cost. Read config from `state.config`. Validation belongs in `config.mjs`. A
module records a non-purchase event with `ctx.record({ kind, id, … })` and no `cost` (see `loot.mjs`).

1. Write the failing test first in `test/<id>.test.mjs` (see `test/bar.test.mjs` for the pattern: build
   a fresh state from `test/fixtures/starter-base.mjs`, call the module's methods directly with a neutral ctx).
2. Create `model/mods/<id>.mjs` and add it to `defaultModules()` in `model/registry.mjs`. Order matters
   only when a module's tick or offline depends on another's multipliers or counters (bar before jobs,
   loot after jobs).
3. Add its block to `SHAPES` in `model/config.mjs` with `enabled: bool` plus its numbers, and a
   cross-field check there if it references other blocks. Add a `config.test.mjs` case for the check.
4. Add the block to `presets/starter-2026-10-28.json` and any other preset (every block is required, so
   `validate` fails until you do) and to `test/fixtures/starter-base.mjs`.
5. Run `npm test`. If `pacing.test.mjs` fails, the fixture is telling you the baseline moved. When that
   is intended, `UPDATE_FIXTURE=1 npm test`, read the diff of `test/fixtures/starter-expected.json`, and
   commit it with the module, saying why in the message. A new purchase kind goes into `PURCHASE_KINDS`
   in `model/core.mjs` (`targets.mjs` reads `KINDS` from there), and into `BIG_KINDS` if the shop
   should save for it.

## Snapshotting a decision

When the game's numbers change, the preset must follow, so the simulator and the game stay one source
of truth. Until the game is ported to schema 2, the preset is edited by hand (or in the UI's editor and
exported); once it is, from the game's `config.js`:

```
node tools/sim/cli.mjs convert --to json --in path/to/config.js --out tools/sim/presets/starter-2026-11-05.json
node tools/sim/cli.mjs validate --config tools/sim/presets/starter-2026-11-05.json
node tools/sim/cli.mjs run --config tools/sim/presets/starter-2026-11-05.json --targets tools/sim/targets/seven-day-idle.json
```

Commit the new preset named `starter-<date>.json` and keep the old one; presets are history. If the
decision changed what "good pacing" means, update or add a targets file in the same commit so the
verdicts describe the intent, not the old one. The pacing fixture and the integration tests follow the
default preset, the first entry in `ui/manifest.json` (read through `test/default-preset.mjs`), so
moving the default is one manifest edit followed by `UPDATE_FIXTURE=1 npm test`.

## Baseline findings on `starter-2026-10-28.json`

Draft numbers, recorded in `test/fixtures/README.md`. Both profiles buy the whole room on day 1: the
active player places the rack at 24 s, the Wi-Fi rig at 29.2 s and the third rig at 124 s, and owns
every class at its last tier by 112 s; casual has the rack at 27.3 s, the Wi-Fi rig at 38 s and the room
complete at 180 s. The rack holds three rigs, so the kebab, dentist and radio rigs are never offered and
passive income plateaus (about $1.09K/s active, $931/s casual) from day 2; the rest of the week is job
levels. 10 of 12 verdicts pass (`first-upgrade`, `first-rig`, `daily-purchase`, `d7-not-done`,
`first-loot` for both); `daily-rig-or-item` fails for both with actual 0 on days 2–6, because
everything big is bought on day 1. Active play dominates: loot pays the active player about $79.5M
over the week and credits reach tens of millions by day 7 (about $23.8M, down from $34.4M on day 6 as
radio levels cost tens of millions each); casual ends at about $329K. That is a fact about the draft
numbers, not a tool bug; the next step is tuning (the plan's Task 10 sweeps `loot.chance`, the tower
and rack tiers, `rigs.list[kebab].cost` and `jobs.list[radio].pay`).
