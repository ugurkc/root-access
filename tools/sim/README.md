# Balance simulator

Runs the game's economy from one JSON config over a schedule of play sessions and reports a daily
summary, a purchase timeline and named metrics per player profile. A targets file turns those numbers
into pass/fail verdicts, so "do these numbers give the journey we want?" is one command with an exit
code. The model under `model/` is plain ES modules with no Node imports, so the same code runs in a
browser; only `cli.mjs` and the tests use Node 22. Tests: `npm test` from the repository root
(`node --test`, no dependencies). Regenerate the pacing fixture only on purpose: `UPDATE_FIXTURE=1 npm test`.

## JSON contract

### Config (`presets/<date>.json`)

`{ "schema": 1, taps, bar, jobs, rigs, racks, items, events, offline }`. Every block is required and
carries `enabled`; `enabled: false` skips that mechanic's module everywhere (init, tick, offers,
metrics) but the block must still be complete. Shapes live in `model/config.mjs` (`SHAPES`). One block:

```json
"racks": { "enabled": true, "largeSlots": 3, "decorSlots": 3, "cost": 400, "r": 50, "holds": 3 }
```

`validateConfig(cfg)` returns `[{ path, message }]`: unknown or missing keys, wrong types, NaN,
non-positive costs and durations, bad enums, duplicate ids, a rig whose `job` is not a job id, tech
items without `size` or decor with one, `events.min + max <= 0`. Every CLI command refuses an invalid
config before running.

### Profile (`profiles/<id>.json`, resolved by id or path)

```json
{ "id": "casual",
  "sessions": { "day1": { "hour": 20, "minutes": 8, "tps": 1.5 },
                "later": [ { "hour": 21, "minutes": 5, "tps": 1.5 } ] },
  "policy": { "saveForBigWithinMinutes": 30, "bigValueRatio": 1.5,
              "buyRigsWhenAffordable": true, "restartManualJobs": true } }
```

`hour` 0–23, `minutes` and `tps` > 0. The policy is greedy by gain per cost, buys a `rig` in a pre-pass
when affordable, and saves for a `rig`/`item`/`rack` that is reachable within the window and beats
the best affordable offer by `bigValueRatio`.

### Targets (`targets/<name>.json`)

An array of `{ id, label, metric, op, value, profile, days? }`. `op` is one of `<= < >= > ==`
(exact); `profile` is `"all"` or a profile id; `days` is `[from, to]`, 1-based inclusive, and only
applies to `purchasesPerDay` metrics. Metric grammar (`model/targets.mjs`):

| metric | reads |
|---|---|
| `firstEvent:rig`, `offersLeft.final`, `rigs.count`, `jobs.wifi.level`, … | any key of the run's `metrics` |
| `purchasesPerDay:min\|max\|sum` | over per-day purchase counts, restricted to `days` |
| `purchasesPerDay[rig,item]:min` | same, counting only the listed kinds (`level itemLevel item rig rack`) |
| `summary.incomePassive:day7` | field `incomePassive` of day 7's summary row |

A verdict is `{ id, label, profile, expected, pass, actual }`. When the metric cannot be read it
fails with `actual: null` and an `error`: `unknown metric`, `unknown kind "x"`, `no value` (the event
never happened), `no run for profile x`, `no runs`, or `days [2, 9] exceed run length 7`.

### Result (`run --json`)

`{ config, days, profiles: { <id>: { summary, timeline, metrics } }, verdicts }`. Trimmed from a real run:

```json
{ "config": "tools/sim/presets/v2-2026-10-23.json", "days": 7,
  "profiles": { "active": {
    "summary": [ { "day": 1, "activeMinutes": 12, "credits": 56128.94, "incomePassive": 2835.66,
                   "offlineEarned": 0, "activeEarned": 2957405.27,
                   "purchases": ["job:wifi:lv", "job:wifi:lv", "rack", "rig:wifi", "item:lamp", "item:gpu"] } ],  // ids abridged
    "timeline": [ { "t": 3.2, "day": 1, "kind": "level", "id": "job:wifi:lv", "cost": 6 } ],
    "metrics": { "income.passive": 241934.66, "rigs.count": 5, "offersLeft.final": 0,
                 "firstEvent:level": 3.2, "firstEvent:rig": 56,
                 "purchasesPerDay": [100, 124, 49, 5, 2, 1, 1],
                 "purchasesByKindPerDay": { "rig": [3, 2, 0, 0, 0, 0, 0] } } } },
  "verdicts": [ { "id": "first-rig", "label": "First rig inside the first session", "profile": "active",
                  "expected": { "metric": "firstEvent:rig", "op": "<=", "value": 480 }, "pass": true, "actual": 56 } ] }
```

`t` is simulated seconds since the first session began, gaps included; `firstEvent:*` is seconds of
active play. The `purchases` list above is abridged (a hand-picked selection; the real day 1 has 100 entries, in order).

## UI

`index.html` next to this file is the same model in a browser: a config editor built from
`SHAPES` with inline validation, a run panel with the daily table and metrics, two charts
(credits and passive income over simulated days, with rig/rack/item markers), the target
checklist with live verdicts, and a sweep panel whose rows load back into the editor.
Serve the repo with any static server and open `tools/sim/`; the page uses only relative
URLs plus Chart.js from a CDN. Import/Export round-trip `config.json`, `config.js` and
targets JSON.

## CLI

Data (tables, JSON, validation reports) goes to stdout; diagnostics, refusals and usage go to stderr.
Exit 0 ok, 1 validation errors or any failed verdict, 2 usage error (usage text follows on stderr).
`node tools/sim/cli.mjs --help` prints every option. Quote `--param`/`--param2` paths, since they contain brackets.

```
$ node tools/sim/cli.mjs validate --config tools/sim/presets/v2-2026-10-23.json
ok
$ node tools/sim/cli.mjs validate --targets tools/sim/targets/seven-day-idle.json --profile active
ok
$ node tools/sim/cli.mjs validate --config bad.json       # exit 1, one line per error
racks.cost: expected positive number, got 0
bogus: unknown key
rigs.list[0].job: unknown job id "wifii"
```

```
$ node tools/sim/cli.mjs run --config tools/sim/presets/v2-2026-10-23.json --targets tools/sim/targets/seven-day-idle.json
== active (7 days) ==
day  active min  credits  passive $/s  offline $  active $  purchases
  1          12    56.1K        2.84K          0     2.96M        100
  2          16    41.0M         143K       693M      409M        124
  ...
  7          16    4.32B         241K       10.2B     4.57B          1

== casual (7 days) ==
  ...
targets: 7/10 pass
✓ first-upgrade/active  First job level-up within 90 s: actual 3.20 (firstEvent:level <= 90)
✓ first-rig/casual  First rig inside the first session: actual 89.33 (firstEvent:rig <= 480)
✗ d7-not-done/active  Something still to buy on day 7: actual 0 (offersLeft.final >= 1)
✗ daily-rig-or-item/active  A rig or item placed every day D2–D6: actual 0 (purchasesPerDay[rig,item]:min days 2–6 >= 1)
...  (verdict lines trimmed; the real output has one per target and profile)
```

Exit 1 because verdicts failed. `--profile` repeats (`--profile active --profile my/profile.json`),
default `active, casual`; `--days N` default 7; `--json` prints the result object above instead.

```
$ node tools/sim/cli.mjs sweep --config tools/sim/presets/v2-2026-10-23.json --targets tools/sim/targets/seven-day-idle.json \
    --param 'rigs.list[wifi].cost' --values 500,1000,2000
rigs.list[wifi].cost  pass  firstEvent:rig/active  offersLeft.final/active  firstEvent:rig/casual  offersLeft.final/casual
                 500  7/10                   53.2                        0                   83.3                        2
                1000  7/10                     56                        0                   89.3                        2
                2000  7/10                     60                        0                     98                        2
```

Paths address list entries by `id` (`jobs.list[wifi].cost`, `items.list[gpu].pay`), by `job` for rigs,
or by index (`items.list[2].pay`). Add `--param2 … --values2 …` for a grid. Values parse as numbers or
`true`/`false`. Each combination is validated; an invalid one aborts with exit 1
(`invalid config at rigs.list[wifi].cost=0: rigs.list[0].cost: expected positive number, got 0`). `--json` gives
`[{ values, passes, total, metrics: { <profile>: { "firstEvent:rig", "rigs.count", "credits.final", "offersLeft.final" } } }]`.

```
$ node tools/sim/cli.mjs convert --to js --in tools/sim/presets/v2-2026-10-23.json --out /tmp/config.js
wrote /tmp/config.js
$ node tools/sim/cli.mjs convert --to json --in /tmp/config.js --out /tmp/config.json
wrote /tmp/config.json
```

`--to js` writes `window.RA_CONFIG = {…};`, the file the game loads next to its `index.html`. `--to json`
reads that form back; a hand-written `config.js` is evaluated in a sandbox, so only convert trusted files.
The round trip preserves every value of the preset exactly (`fromJs(toJs(cfg))` deep-equals `cfg`); only the whitespace formatting differs.

## Adding a mechanic

The contract is the comment block at the top of `model/registry.mjs`; `model/mods/offline.mjs` is the
smallest example. A module is `{ id, init(state, config, profile), tick(state, dt, ctx),
offline?(state, seconds, ctx), offers(state, ctx), buy(state, offerId), metrics(state, ctx), multipliers?(state) }`.
`id` is the config block name. `init` creates the module's own slice (`state.<id> = {…}`); other modules
never reach into it and use exported helpers (`helper(state, cfg, …)`) instead. `offers` returns
`[{ id, cost, gainPerSec, kind }]` with finite numbers; `buy` applies the effect only, the core has
already deducted the cost. Read config from `state.config`. Validation belongs in `config.mjs`.

1. Write the failing test first in `test/<id>.test.mjs` (see `test/bar.test.mjs` for the pattern: build
   a fresh state with the preset, call the module's methods directly with a neutral ctx).
2. Create `model/mods/<id>.mjs` and add it to `defaultModules()` in `model/registry.mjs`. Order matters
   only when a module's tick or offline depends on another's multipliers (bar before jobs).
3. Add its block to `SHAPES` in `model/config.mjs` with `enabled: bool` plus its numbers, and a
   cross-field check there if it references other blocks. Add a `config.test.mjs` case for the check.
4. Add the block to `presets/v2-2026-10-23.json` and any other preset (every block is required, so
   `validate` fails until you do) and to the game's `config.js` through `convert --to js`.
5. Run `npm test`. If `pacing.test.mjs` fails, the fixture is telling you the baseline moved. When that
   is intended, `UPDATE_FIXTURE=1 npm test`, read the diff of `test/fixtures/v2-expected.json`, and
   commit it with the module, saying why in the message. A new offer kind also goes into `KINDS` in
   `model/targets.mjs`.

## Snapshotting a decision

When the game's numbers change, the preset must follow, so the simulator and the game stay one source
of truth. From the game's `config.js`:

```
node tools/sim/cli.mjs convert --to json --in path/to/config.js --out tools/sim/presets/2026-11-05.json
node tools/sim/cli.mjs validate --config tools/sim/presets/2026-11-05.json
node tools/sim/cli.mjs run --config tools/sim/presets/2026-11-05.json --targets tools/sim/targets/seven-day-idle.json
```

Commit the new preset named by date and keep the old one; presets are history. If the decision changed
what "good pacing" means, update or add a targets file in the same commit so the verdicts describe the
intent, not the old one. The pacing fixture stays locked to `v2-2026-10-23.json` unless you move it.

## Baseline findings on `v2-2026-10-23.json`

A greedy active player fills the three large slots with two racks and the GPU tower on day 1, has all
five reachable rigs and all six jobs at level 25 by day 3, and buys the last upgrade (`itemlv:fiber`)
on day 7: `offersLeft.final` is 0 and `purchasesPerDay` is `[100, 124, 49, 5, 2, 1, 1]`. The server,
cooler, quantum card, cat, girlfriend and the satellite rig can never be bought. Casual ends day 7 with
two offers left and `purchasesPerDay` `[72, 65, 48, 26, 47, 9, 5]`. First job level-up at 3.2 s and 4 s, first rig at 56 s
and 89 s; active passive income plateaus around $240K/s from day 4. The starter targets `d7-not-done`
(active) and `daily-rig-or-item` (both) fail, so `run` with them exits 1 at 7/10. These are facts about
the preset, not tool bugs; the fixture records them deliberately (`test/fixtures/README.md`).
