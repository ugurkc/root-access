# Balance Simulator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A simulator in this repo that runs the game's economy from one config file, judges it against editable customer-journey targets, and is usable both from a static web page and from a CLI with a JSON contract.

**Architecture:** A pure-JS model composed of mechanic modules (taps, bar, jobs, rigs, racks, items, events, offline) driven by a versioned `config.json`; player behaviour lives in profile JSON; an evaluator turns metrics into target verdicts. The same ES modules run under Node 22 (CLI, tests) and in the browser (UI page). The live game is refactored to read the same numbers from a `config.js` global, in a separate PR.

**Tech Stack:** Plain ES modules (`.mjs`), Node 22 built-in test runner (`node --test`), no npm dependencies; the UI uses one pinned chart library from a CDN. Design: `docs/plans/2026-10-23-balance-sim-design.md`. Game mechanics reference: `docs/root-access-v2-spec.md`.

**Conventions for every task:** commit messages are plain project text with no attribution lines. Run `npm test` (defined in Task 1) before each commit. Paths are relative to this repo unless they start with `/Users/ugurkoc/repos/ugurkc.github.io/`.

---

### Task 1: Project scaffold and test runner

**Files:**
- Create: `package.json`
- Create: `tools/sim/README.md` (stub, filled in Task 12)
- Create: `tools/sim/test/smoke.test.mjs`

**Step 1: Write the failing test**

```js
// tools/sim/test/smoke.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../model/core.mjs';

test('core module loads', () => {
  assert.equal(typeof VERSION, 'string');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test` (Node 22 needs the glob form `node --test 'tools/sim/test/*.test.mjs'`; a bare directory is treated as a script to run.)
Expected: FAIL, cannot find module `../model/core.mjs`.

**Step 3: Minimal implementation**

```json
// package.json
{
  "name": "root-access-tools",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test 'tools/sim/test/*.test.mjs'" }
}
```

```js
// tools/sim/model/core.mjs
export const VERSION = '0.1.0';
```

`tools/sim/README.md`: one line, "Balance simulator. See docs/plans/2026-10-23-balance-sim-design.md until the README is written."

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: `# pass 1`.

**Step 5: Commit**

```bash
git add package.json tools/sim
git commit -m "sim: scaffold with node test runner"
```

---

### Task 2: Config schema, validator and the first preset

**Files:**
- Create: `tools/sim/model/config.mjs`
- Create: `tools/sim/presets/v2-2026-10-23.json`
- Test: `tools/sim/test/config.test.mjs`

The preset is the live game's numbers as of 2026-10-23 (see `docs/root-access-v2-spec.md`). Shape:

```json
{
  "schema": 1,
  "taps": { "enabled": true, "rate": 0.25, "minMoney": 1, "advance": 0.25 },
  "bar": { "enabled": true, "steps": 10, "bonusTaps": 15, "speed": 0.25, "speedDur": 12 },
  "jobs": {
    "enabled": true, "maxLevel": 25, "milestones": [25], "revealAt": 0.6,
    "list": [
      { "id": "wifi", "name": "Crack a Wi-Fi password", "time": 6, "pay": 3, "cost": 6, "r": 1.12, "rep": 3, "unlock": 0 },
      { "id": "ceo",  "name": "Steal a CEO's emails",   "time": 18, "pay": 45, "cost": 200, "r": 1.13, "rep": 9, "unlock": 25 },
      { "id": "dms",  "name": "Leak a politician's DMs","time": 36, "pay": 360, "cost": 3000, "r": 1.13, "rep": 30, "unlock": 400 },
      { "id": "bank", "name": "Drain a corrupt bank",   "time": 90, "pay": 3000, "cost": 40000, "r": 1.13, "rep": 90, "unlock": 6000 },
      { "id": "cams", "name": "Blind a city's cameras", "time": 180, "pay": 24000, "cost": 500000, "r": 1.12, "rep": 300, "unlock": 60000 },
      { "id": "sat",  "name": "Hijack a satellite",     "time": 360, "pay": 180000, "cost": 6000000, "r": 1.12, "rep": 900, "unlock": 350000 }
    ]
  },
  "rigs": { "enabled": true, "list": [
      { "job": "wifi", "name": "DeAuth-o-Matic 3000", "cost": 1000 },
      { "job": "ceo",  "name": "CEObuster 5000", "cost": 100000 },
      { "job": "dms",  "name": "DMscraper XL", "cost": 1300000 },
      { "job": "bank", "name": "BankDrainer Turbo", "cost": 16000000 },
      { "job": "cams", "name": "BlindSpot 9000", "cost": 200000000 },
      { "job": "sat",  "name": "SatJacker Ultra", "cost": 2700000000 } ] },
  "racks": { "enabled": true, "largeSlots": 3, "decorSlots": 3, "cost": 400, "r": 50, "holds": 3 },
  "items": {
    "enabled": true, "maxLevel": 25, "r": 1.5, "growPerLevel": 0.2, "techComfortFlat": true,
    "list": [
      { "id": "gpu", "type": "tech", "size": "large", "name": "GPU tower", "cost": 10000, "comfort": 1, "pay": 1.25 },
      { "id": "fiber", "type": "tech", "size": "small", "name": "Fiber modem", "cost": 1000000, "comfort": 2, "speed": 1.2 },
      { "id": "server", "type": "tech", "size": "large", "name": "Server tower", "cost": 25000000, "comfort": 3, "pay": 1.5 },
      { "id": "cooler", "type": "tech", "size": "large", "name": "Cooling unit", "cost": 400000000, "comfort": 4, "speed": 1.3 },
      { "id": "quantum", "type": "tech", "size": "small", "name": "Quantum card", "cost": 2500000000, "comfort": 5, "pay": 2 },
      { "id": "lamp", "type": "decor", "name": "Lava lamp", "cost": 2000, "comfort": 5, "event": { "boost": 10, "dur": 30 } },
      { "id": "plant", "type": "decor", "name": "Plant", "cost": 40000, "comfort": 10, "event": { "boost": 15, "dur": 45 } },
      { "id": "phones", "type": "decor", "name": "Headphones", "cost": 200000, "comfort": 15, "event": { "boost": 20, "dur": 40 } },
      { "id": "cat", "type": "decor", "name": "Cat", "cost": 5000000, "comfort": 25, "event": { "boost": 30, "dur": 45 } },
      { "id": "gf", "type": "decor", "name": "Girlfriend", "cost": 100000000, "comfort": 40, "event": { "boost": 60, "dur": 40 } }
    ]
  },
  "events": { "enabled": true, "window": 20, "first": 15, "min": 60, "max": 120, "acceptRate": 0.7 },
  "offline": { "enabled": true, "capHours": 8 }
}
```

**Step 1: Write the failing tests**

```js
// tools/sim/test/config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../model/config.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));

test('the v2 preset validates', () => {
  assert.deepEqual(validateConfig(preset), []);
});

test('unknown block is reported with its path', () => {
  const errs = validateConfig({ ...preset, bogus: {} });
  assert.ok(errs.some(e => e.path === 'bogus'));
});

test('wrong type is reported with its path', () => {
  const bad = structuredClone(preset); bad.jobs.list[0].cost = 'six';
  const errs = validateConfig(bad);
  assert.ok(errs.some(e => e.path === 'jobs.list[0].cost'));
});

test('rig must reference an existing job', () => {
  const bad = structuredClone(preset); bad.rigs.list[0].job = 'nope';
  assert.ok(validateConfig(bad).some(e => e.path === 'rigs.list[0].job'));
});
```

**Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL, cannot find `../model/config.mjs`.

**Step 3: Minimal implementation**

`tools/sim/model/config.mjs`: export `BLOCKS` (the list of known block names), `validateConfig(cfg)` returning `[{ path, message }]`. Implement with a small hand-written checker: a `shape` object describing each block (`number`, `boolean`, `string`, arrays of records with required keys and types), a recursive `check(value, shape, path, errs)`, plus the cross-reference rule for `rigs.list[].job`. Keep it under 120 lines; no library.

**Step 4: Run to verify pass**

Run: `npm test` — Expected: all pass.

**Step 5: Commit**

```bash
git add tools/sim/model/config.mjs tools/sim/presets tools/sim/test/config.test.mjs
git commit -m "sim: config schema validator and the v2 preset"
```

---

### Task 3: Model core — state, schedule, module registry, buying policy

**Files:**
- Modify: `tools/sim/model/core.mjs`
- Create: `tools/sim/model/registry.mjs`
- Create: `tools/sim/profiles/active.json`, `tools/sim/profiles/casual.json`
- Test: `tools/sim/test/core.test.mjs`

Profiles:

```json
// tools/sim/profiles/active.json
{ "id": "active", "sessions": { "day1": { "hour": 20, "minutes": 12, "tps": 2.5 },
  "later": [ { "hour": 8, "minutes": 5, "tps": 2.5 }, { "hour": 13, "minutes": 3, "tps": 2.5 }, { "hour": 21, "minutes": 8, "tps": 2.5 } ] },
  "policy": { "greedy": true, "saveForBigWithinMinutes": 30, "bigValueRatio": 1.5, "buyRigsWhenAffordable": true, "restartManualJobs": true } }
```
`casual.json`: day1 `{ hour 20, minutes 8, tps 1.5 }`, later `[ { hour 21, minutes 5, tps 1.5 } ]`, same policy.

Core API (export from `core.mjs`):

```js
export function run({ config, profile, days = 7, modules = defaultModules() }) → { summary, timeline, metrics, final }
```
- Builds the session list from the profile for `days`.
- `state = { t, day, credits: 0, log: [] }`; each module's `init(state, config)`.
- For each session: if a gap preceded it, call `offline(state, gapSeconds, ctx)` on modules that implement it and record `{ kind: 'offline', earned }`. Then loop in `dt = 1 / tps` steps: `ctx = collectMultipliers(modules, state)`, each module `tick(state, dt, ctx)`, once per simulated second run `shop(state, ctx)`.
- `shop`: gather `offers` from all modules, apply the profile policy: rigs first when affordable (if enabled), then best `gainPerSec / cost` affordable offer unless a bigger offer within reach (`cost ≤ credits + effectiveIncome × saveForBigWithinMinutes × 60`) has `value > best × bigValueRatio`; repeat up to 300 times per second.
- `summary`: one row per day with active minutes, end credits, end passive income, offline earned, active earned, purchases list.
- `metrics`: merged from each module's `metrics(state)` plus core ones: `firstEvent:<kind>` seconds of active play, `purchasesPerDay` array, `credits.final`, `income.final`.

`registry.mjs`: `defaultModules()` returns the ordered module list (filled in as modules are added; for now returns `[]`).

**Step 1: Write the failing tests**

```js
// tools/sim/test/core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, sessionsFor } from '../model/core.mjs';
import active from '../profiles/active.json' with { type: 'json' };

test('active profile yields 1 + 3×6 sessions over 7 days', () => {
  assert.equal(sessionsFor(active, 7).length, 19);
});

test('run with no modules returns 7 summary rows and zero credits', () => {
  const r = run({ config: { schema: 1 }, profile: active, modules: [] });
  assert.equal(r.summary.length, 7);
  assert.equal(r.final.credits, 0);
});

test('a stub module earns per tick and the shop buys its offer', () => {
  const stub = {
    id: 'stub', init: s => { s.stub = { lv: 0 }; },
    tick: (s, dt) => { s.credits += 10 * dt; },
    offers: s => s.stub.lv < 1 ? [{ id: 'stub:lv', cost: 5, gainPerSec: 1, kind: 'level' }] : [],
    buy: (s) => { s.credits -= 5; s.stub.lv = 1; },
    metrics: s => ({ 'stub.lv': s.stub.lv }),
  };
  const r = run({ config: { schema: 1 }, profile: active, days: 1, modules: [stub] });
  assert.equal(r.metrics['stub.lv'], 1);
  assert.ok(r.timeline.some(e => e.kind === 'level' && e.id === 'stub:lv'));
});
```

**Step 2: Run to verify failure** — `npm test`, expected FAIL on missing exports.

**Step 3: Implement** `core.mjs` as described (about 150 lines) and `registry.mjs` returning `[]`.

**Step 4: Run to verify pass** — `npm test`.

**Step 5: Commit** — `git commit -m "sim: model core with schedule, registry and buying policy"`.

---

### Task 4: Mechanic modules — jobs and taps

**Files:**
- Create: `tools/sim/model/mods/jobs.mjs`, `tools/sim/model/mods/taps.mjs`
- Modify: `tools/sim/model/registry.mjs`
- Test: `tools/sim/test/jobs.test.mjs`

Formulas (from the spec): level cost `cost × r^lv × (r^n − 1)/(r − 1)`; pay `pay × lv × 2^(milestones reached) × ctx.payMult × ctx.comfortMult`; a job runs `time / ctx.speedMult` seconds; manual jobs run once per start and are restarted by the profile policy each second; rigged jobs loop. Rep per run; unlock when `rep ≥ unlock`. Taps: `money = max(minMoney, rate × incomeOfRunningJobs) × comfortMult`; each tap advances running jobs by `advance` seconds. Taps module needs the tap cadence: core passes `ctx.tapsThisTick` (= 1 per dt step while in a session).

**Step 1: Failing tests**

```js
// tools/sim/test/jobs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../model/core.mjs';
import { jobs } from '../model/mods/jobs.mjs';
import { taps } from '../model/mods/taps.mjs';
import active from '../profiles/active.json' with { type: 'json' };
const cfg = JSON.parse(readFileSync(new URL('../presets/v2-2026-10-23.json', import.meta.url)));

test('wifi level cost matches the spec formula', () => {
  const s = {}; jobs.init(s, cfg);
  assert.equal(jobs.costN(s, cfg, 'wifi', 1), 6);          // level 1
  s.jobs.wifi.lv = 1;
  assert.ok(Math.abs(jobs.costN(s, cfg, 'wifi', 1) - 6 * 1.12) < 1e-9);
});

test('a job caps at maxLevel and doubles pay at 25', () => {
  const s = {}; jobs.init(s, cfg); s.jobs.wifi.lv = 25;
  assert.equal(jobs.offers(s, { payMult: 1, comfortMult: 1, speedMult: 1 }).filter(o => o.id === 'job:wifi:lv').length, 0);
  assert.equal(jobs.payFor(s, cfg, 'wifi', { payMult: 1, comfortMult: 1 }), 3 * 25 * 2);
});

test('first level-up happens within 90 s of active play', () => {
  const r = run({ config: cfg, profile: active, days: 1, modules: [jobs, taps] });
  assert.ok(r.metrics['firstEvent:level'] <= 90, String(r.metrics['firstEvent:level']));
});
```

**Step 2: Run** — FAIL (missing modules). **Step 3: Implement** both modules; register `[taps, jobs]`. **Step 4: Run** — PASS.

**Step 5: Commit** — `git commit -m "sim: jobs and taps mechanics"`.

---

### Task 5: Mechanic modules — bar, offline

**Files:**
- Create: `tools/sim/model/mods/bar.mjs`, `tools/sim/model/mods/offline.mjs`
- Modify: `tools/sim/model/registry.mjs`
- Test: `tools/sim/test/bar.test.mjs`

Bar: every `steps` taps pay `bonusTaps × tapMoney` and push a speed boost `{ until: t + speedDur }`; `speedMult` contribution `1 + speed × activeBoosts`; boosts clear on offline. Offline: for a gap, earn `passiveIncome × min(gap, capHours×3600)` and add rep for rigged jobs; record `{ kind: 'offline', earned, capped }`.

**Step 1: Failing tests** — after exactly 10 taps in a stub session, credits include a bonus of 15× tap money and `ctx.speedMult` is 1.25; offline of 10 h with cap 8 h earns `8 × 3600 × income` and sets `capped: true`.

**Step 2–5:** run, implement, run, commit `sim: bar bonus and offline mechanics`.

---

### Task 6: Mechanic modules — racks, rigs, items, events

**Files:**
- Create: `tools/sim/model/mods/racks.mjs`, `rigs.mjs`, `items.mjs`, `events.mjs`
- Modify: `tools/sim/model/registry.mjs`
- Test: `tools/sim/test/room.test.mjs`

Rules (spec section "The room"): large slots `racks.largeSlots`; a rack occupies a large slot and adds `holds` small slots; small items and rigs need a small slot; large items need a large slot; rack cost `cost × r^racksPlaced`; decor slots take decor. Items: level `lv` 1..maxLevel, `grow = 1 + (lv−1) × growPerLevel`, pay bonus `(pay−1) × grow`, speed likewise, comfort `round(comfort × grow)` for decor and flat for tech when `techComfortFlat`; upgrade cost `cost × r^lv`. Rigs: offer when job unlocked and a small slot is free; buying marks the job rigged. Events: contribute average extra comfort `Σ boost × dur × acceptRate / meanInterval` for placed decor (no randomness).

**Step 1: Failing tests** — a rig offer appears only after a rack is placed; the second rack costs 50× the first; a large item never fits a shelf; lamp comfort at L25 is 29; GPU comfort stays 1 at L25; `events` adds a positive, deterministic comfort with one lamp placed.

**Step 2–5:** run, implement, run, commit `sim: racks, rigs, items and events mechanics`.

---

### Task 7: Fixture test against the known pacing

**Files:**
- Create: `tools/sim/test/fixtures/v2-expected.json`
- Test: `tools/sim/test/pacing.test.mjs`

Purpose: lock in the behaviour so later refactors of the model are caught. Run the full default module set with the v2 preset for both profiles, and assert the coarse facts established during tuning: active profile gets the Wi-Fi rig inside the first session and the CEO rig by the end of day 2; casual gets the Wi-Fi rig inside the first session and at least one rig or item purchase on each of days 2–6; nobody is out of things to buy on day 7 (a purchase exists on day 7 or an affordable offer exists at the end). Store the exact per-day purchase lists produced by the first green run into the fixture, and assert equality against it so drift is visible; update the fixture deliberately when numbers change.

**Steps:** write test (FAIL: no fixture) → run once with `UPDATE_FIXTURE=1` to write it → run (PASS) → commit `sim: pacing fixture for the v2 preset`.

---

### Task 8: Targets and the evaluator

**Files:**
- Create: `tools/sim/model/targets.mjs`
- Create: `tools/sim/targets/seven-day-idle.json`
- Test: `tools/sim/test/targets.test.mjs`

Target format: `{ id, label, metric, op, value, profile: "all" | id, days?: [from, to] }`. Ops: `<=, <, >=, >, ==`. Metrics are resolved from `run().metrics`; `purchasesPerDay:min` with `days` resolves to the minimum over those days. `evaluate(targets, runsByProfile) → [{ id, profile, pass, actual, expected }]`.

Starter targets file:

```json
[
  { "id": "first-upgrade", "label": "First level-up within 90 s", "metric": "firstEvent:level", "op": "<=", "value": 90, "profile": "all" },
  { "id": "first-rig", "label": "First rig inside the first session", "metric": "firstEvent:rig", "op": "<=", "value": 720, "profile": "all" },
  { "id": "daily-purchase", "label": "A rig or item every day D2–D6", "metric": "purchasesPerDay:min", "op": ">=", "value": 1, "days": [2, 6], "profile": "all" },
  { "id": "d7-not-done", "label": "Something still to buy on day 7", "metric": "offersLeft.final", "op": ">=", "value": 1, "profile": "all" }
]
```

**Step 1: Failing tests** — evaluator passes a trivially true target, fails a false one with `actual` filled, expands `profile: "all"` to one verdict per profile, and the starter file validates against the v2 preset runs (all pass).

**Step 2–5:** run, implement, run, commit `sim: targets format and evaluator`.

---

### Task 9: CLI — run, validate

**Files:**
- Create: `tools/sim/cli.mjs`
- Test: `tools/sim/test/cli.test.mjs` (spawns the CLI with `node:child_process`)

Commands:
- `node tools/sim/cli.mjs validate --config <path>` → prints errors, exit 1 if any.
- `node tools/sim/cli.mjs run --config <path> --profile <id|path> [--profile …] [--days 7] [--targets <path>] [--json]` → human table by default, full JSON with `--json`; exit 1 when any verdict fails.

Argument parsing with `node:util` `parseArgs`. Profiles resolve by id from `tools/sim/profiles/` or by path.

**Step 1: Failing tests** — `validate` on the preset exits 0; `run --json` outputs parseable JSON with `summary.length === 7`; `run` with a target that cannot pass exits 1.

**Step 2–5:** run, implement, run, commit `sim: cli run and validate`.

---

### Task 10: CLI — sweep and convert

**Files:**
- Modify: `tools/sim/cli.mjs`
- Create: `tools/sim/model/sweep.mjs`, `tools/sim/model/convert.mjs`
- Test: `tools/sim/test/sweep.test.mjs`, `tools/sim/test/convert.test.mjs`

`sweep --config C --profile P --targets T --param jobs.list[wifi].cost --values 4,6,8 [--param2 … --values2 …]` → for each combination, run and evaluate; print a table (passes/total, first-rig time, D7 income) and `--json` for the raw grid. Param paths use the config's own shape; `list[wifi]` selects the array entry by id.

`convert --to js --in config.json --out config.js` writes `window.RA_CONFIG = <json>;` and `--to json` parses it back (regex-free: evaluate the file in a `node:vm` context like `tools/sim.js` already does).

**Step 1: Failing tests** — a sweep over two values yields two rows; convert round-trips the preset byte-for-byte as JSON.

**Step 2–5:** run, implement, run, commit `sim: sweep and config conversion`.

---

### Task 11: Game refactor — read `config.js` (separate repo, separate PR)

**Files (in `/Users/ugurkoc/repos/ugurkc.github.io/.worktrees/root-access-v2`, branch `root-access-v2-changes`, pulled level with `main` first):**
- Create: `public/root-access-v2/config.js` (generated: `node tools/sim/cli.mjs convert --to js --in tools/sim/presets/v2-2026-10-23.json --out <that path>`)
- Modify: `public/root-access-v2/index.html`: add `<script src="config.js"></script>` before the game script; replace the literal `JOBS`, `ITEMS`, `SLOTS` counts, `MS`, `MAX_LV`, `MAX_ITEM`, `ITEM_R`, `TAP_BOOST`, `BAR_*`, `OFFLINE_CAP`, `EV_*` definitions with reads from `window.RA_CONFIG` (a small adapter block that maps the JSON shape onto the existing constant names, so the rest of the game is untouched).

**Verification (no behaviour change):**
1. Before editing, save a run log: open the game, seed a save with $5M (same-origin trick in the spec), buy a rack, a rig, a lamp, level Wi-Fi to 25, then dump `localStorage['root-idle-v4']` and the rendered text of the page.
2. After editing, clear the save, repeat the exact sequence, dump again, and `diff` the two dumps: they must be identical.
3. `npm test` (27) and `npm run build`; `cmp dist/root-access-v2/index.html public/root-access-v2/index.html` identical; `dist/root-access-v2/config.js` present.

**Commit and PR:** `git commit -m "Root Access v2: read tunables from config.js"`; `gh pr create --base main` with a body stating "no behaviour change; tunables moved to config.js so the balance simulator and the game share one source of numbers". No attribution lines.

---

### Task 12: README for agents

**Files:**
- Modify: `tools/sim/README.md`

Contents: what the tool is; the JSON contract (`config`, `profile`, `targets`, `result`) with one short example each; every CLI command with a copy-pasteable invocation and sample output; how to add a mechanic (module interface, register it, add its config block to the validator and preset, write its test); how to snapshot a decision (`convert` from the game's `config.js` into `presets/<date>.json`, commit). Keep it under 200 lines.

**Steps:** write → read it back once as a stranger would → commit `sim: README with the agent contract`.

---

### Task 13: UI page — config editor and run

**Files:**
- Create: `tools/sim/index.html`, `tools/sim/ui/app.mjs`, `tools/sim/ui/editor.mjs`, `tools/sim/ui/style.css`
- Modify: `.claude/launch.json` (nothing to add: the existing `root-access` entry serves this repo on 8787; the page is at `http://localhost:8787/tools/sim/`)

Behaviour: on load, fetch `presets/v2-2026-10-23.json` and `profiles/*.json`; render the config as grouped forms (one fieldset per block, tables for `list` arrays, an `enabled` toggle per block); "Run" executes `run()` for each selected profile in the browser (same ES modules via `<script type="module">`); show the daily summary table per profile. Import/export buttons for config JSON (file input and download). Validation errors shown inline with the path.

**Verification:** `preview_start` the `root-access` server, open `/tools/sim/`, confirm the preset loads, edit `jobs.list[wifi].cost` to 8, run, and see the summary change; export and re-import round-trips. No console errors.

**Commit:** `sim: UI page with config editor and run`.

---

### Task 14: UI page — charts, targets checklist, sweep

**Files:**
- Modify: `tools/sim/index.html`, `tools/sim/ui/app.mjs`
- Create: `tools/sim/ui/charts.mjs`, `tools/sim/ui/targets.mjs`, `tools/sim/ui/sweep.mjs`

Charts: credits and passive income over simulated time, one line per profile, purchase markers from the timeline; use a pinned CDN build of a small chart library (e.g. `uplot` or `chart.js` at an exact version from cdnjs). Targets: load `targets/seven-day-idle.json`, editable rows (metric dropdown from the run's metric keys, op, value, profile, days), live verdicts after each run, import/export. Sweep: pick a param path and values, run the grid, show a table with pass counts and two chosen metrics; click a row to load that config into the editor.

**Verification:** in the preview, run both profiles; charts render; the four starter targets show pass; set `first-upgrade` to 1 s and see it fail; sweep `jobs.list[wifi].cost` over 4, 6, 8 and see three rows. No console errors.

**Commit:** `sim: charts, target checklist and sweep in the UI`.

---

### Task 15: Deploy and record the baseline

**Files:**
- Modify: `README.md` (link to the tool and to `tools/sim/README.md`)
- Create: `tools/sim/presets/README.md` (how presets are named and when to add one)

**Steps:** push `main`; wait for this repo's Pages deploy; open `https://ugurkc.github.io/root-access/tools/sim/` and repeat the Task 14 checks there (the page must work from a subpath, so all URLs in the UI are relative). Commit `sim: deploy notes and baseline preset`.

---

## Done when

- `npm test` passes with the fixture test green.
- `node tools/sim/cli.mjs run --config tools/sim/presets/v2-2026-10-23.json --profile active --profile casual --targets tools/sim/targets/seven-day-idle.json` exits 0 and prints verdicts.
- The game PR from Task 11 is merged and the live page behaves identically.
- The UI at `/root-access/tools/sim/` loads the preset, runs, charts, evaluates targets and sweeps without console errors.
