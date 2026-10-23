# Balance simulator — handoff

State of the work on 2026-10-23 for whoever continues it. Read this, then the two plan documents next to it: `2026-10-23-balance-sim-design.md` (what and why) and `2026-10-23-balance-sim.md` (task-by-task plan; Tasks 1–15 are done on the branch; the only step left is landing `balance-sim` on `main` and verifying the Pages deploy).

## Where the work is

- Repository `root-access`, branch `balance-sim`, checked out as a git worktree at `/Users/ugurkoc/repos/root-access/.worktrees/balance-sim`. The main checkout at `/Users/ugurkoc/repos/root-access` stays on `main` and must not be used for this work. `.worktrees/` is ignored through `.git/info/exclude`.
- 29 commits on top of `main` (4bcc970), all with plain messages. Nothing is pushed; `main` does not have any of it. `npm test` passes: 170 tests in about 1.3 s. Every task went through implementer → spec review → quality review → fixes → re-review; the final UI review approved e6a3721.
- Game side (Task 11, done): repository `ugurkc/ugurkc.github.io`, branch `root-access-v2-config` (worktree `/Users/ugurkoc/repos/ugurkc.github.io/.worktrees/root-access-v2`), pull request #6 stacked on PR #5 (`root-access-v2-changes`); retarget it to `main` once #5 merges. It adds `public/root-access-v2/config.js` (generated from the preset with `convert --to js`) and an adapter block in `index.html` that maps `window.RA_CONFIG` onto the game's old constant names. A 25-probe `node:vm` equivalence check found the derived constants identical to the old literals; the game's `grow` divides by `1/growPerLevel` to stay bit-identical with the old `/5`. The page was loaded in a browser after the change: no console errors, `config.js` served, same opening state.
- Rule for every commit and pull request from this user: no attribution lines of any kind (no Co-Authored-By trailer, no "Generated with" line, no session links). The global Claude settings enforce it; still, write plain messages.

## What exists

Everything lives under `tools/sim/`. Plain ES modules, Node 22, no npm dependencies. Model code (`tools/sim/model/**`) imports nothing from `node:` so it runs unchanged in a browser; only `cli.mjs` and tests use Node APIs.

| Path | Purpose |
|---|---|
| `model/config.mjs` | Config schema (`SHAPES`, `BLOCKS`, shape primitives `num pos bool str enumOf atLeast nonNegInt list record`), `validateConfig(cfg) → [{ path, message }]`, `SCHEMA = 1`. Rejects unknown keys, missing keys, wrong types, NaN, non-positive costs, bad enums, duplicate ids, rig→job references, tech items without a size, decor with one, `events.min + max ≤ 0`. |
| `model/core.mjs` | `run({ config, profile, days = 7, modules }) → { summary, timeline, metrics, final }` and `sessionsFor(profile, days)`. Tick loop with exact integer tick counts per session, per-second shop with the buying policy, gaps handled by calling each module's `offline()` in registry order with the ctx rebuilt per module. Core deducts purchase cost; modules only apply effects. |
| `model/registry.mjs` | The MODULE CONTRACT comment block (read it before writing a module) and `defaultModules()` = `[taps, bar, jobs, rigs, racks, items, events, offline]`. Only constraint in the order: bar before jobs. |
| `model/mods/*.mjs` | One module per mechanic: `taps` (tap money, job advance per tap), `bar` (HACK bar money bonus and stacking time-aware speed boost, cleared on absence), `jobs` (levels, cost/pay formulas, milestone doubling, manual vs rigged runs, offline earnings for rigged jobs; exports `levelOf setRigged isRigged advanceRunning runRate costN payFor runningIncome passiveIncome`), `rigs` (per-job automation on a rack shelf), `racks` (slot accounting, rack cost curve; exports `free*/take*`), `items` (placement and levels, pay/speed/comfort multipliers, memoised), `events` (deterministic average comfort from decor events), `offline` (counts gaps and capped seconds; exports `offlineCapSeconds`). |
| `model/targets.mjs` | Target format and `evaluate(targets, runsByProfile)`, `validateTargets`. Metrics: plain keys, `purchasesPerDay:min|max|sum`, `purchasesPerDay[rig,item]:min|max|sum`, `summary.<field>:dayN`; `days` ranges; error verdicts (`unknown metric`, `no value`, `no runs`, `days … exceed run length`). `KINDS = level itemLevel item rig rack`. |
| `model/profile.mjs` | `validateProfile(profile)`. |
| `model/sweep.mjs` | `getPath/setPath` with `jobs.list[wifi].cost` style paths (id, or `job` for rigs, or numeric index), `sweep({ config, profiles, targets, days, params })` over 1–2 params, clone and validate per combination. |
| `model/convert.mjs` | `toJs(cfg)` ↔ `fromJs(text)` for the game's `config.js` form (`window.RA_CONFIG = {...};`). |
| `cli.mjs` | `validate --config|--targets|--profile`, `run`, `sweep`, `convert`. Data to stdout, diagnostics to stderr, exit 0/1/2. `--json` gives agents `{ config, days, profiles: { id: { summary, timeline, metrics } }, verdicts }`. |
| `presets/v2-2026-10-23.json` | The live game's numbers on 2026-10-23 (jobs, rigs, racks, items, events, taps, bar, offline). |
| `profiles/active.json`, `profiles/casual.json` | Player behaviour: session schedule (day 1 session, later daily sessions with hour/minutes/taps per second) and buying policy. |
| `targets/seven-day-idle.json` | Five starter targets: first job level-up ≤ 90 s, first rig ≤ 480 s, a purchase every day D2–D6, something left to buy on D7, a rig or item every day D2–D6. |
| `test/*.test.mjs`, `test/fixtures/` | 136 tests. `pacing.test.mjs` locks the full model against `fixtures/v2-expected.json` (regenerate deliberately with `UPDATE_FIXTURE=1 npm test`; `fixtures/README.md` explains the layers and the baseline). |

Quick commands, from the worktree:

```bash
npm test
node tools/sim/cli.mjs run --config tools/sim/presets/v2-2026-10-23.json --targets tools/sim/targets/seven-day-idle.json
node tools/sim/cli.mjs run --config tools/sim/presets/v2-2026-10-23.json --profile casual --json
node tools/sim/cli.mjs sweep --config tools/sim/presets/v2-2026-10-23.json --targets tools/sim/targets/seven-day-idle.json --param 'rigs.list[wifi].cost' --values 500,1000,2000
node tools/sim/cli.mjs convert --to js --in tools/sim/presets/v2-2026-10-23.json --out /tmp/config.js
```

## Findings the model already produced

These are facts about the current preset, recorded as the baseline in `test/fixtures/README.md`. They are not tool bugs; whoever tunes next should look at them first.

- A greedy active player fills the three large slots with two racks and the GPU tower on day 1, has all five reachable rigs and all six jobs at level 25 by day 3, and buys the last upgrade on day 7. `offersLeft.final` is 0 for the active profile; the server, cooler, quantum card, cat, girlfriend and the satellite rig can never be bought. The casual profile ends day 7 with two offers left.
- The targets `d7-not-done` (active) and `daily-rig-or-item` (both profiles) fail on the preset; `run` with the starter targets exits 1 and prints 7 of 10 passing.
- First job level-up at 3.2 s (active) and 4 s (casual); first rig at 56 s and 89 s. Passive income plateaus around $240K/s (active) from day 4.
- The buying policy is naive on purpose (best gain per cost, save for a bigger offer when it is much better and within reach, rigs first). A real player who reserves a shelf or a large slot would not dead-end the same way; a policy option for that is a natural next addition to `profiles/*.json` and `core.mjs`'s `shop()`.

## Conventions that reviews settled

- Module contract: `init(state, config, profile)`, `tick(state, dt, ctx)`, optional `offline(state, seconds, ctx)`, `offers(state, ctx) → [{ id, cost, gainPerSec, kind }]` with finite numbers, `buy(state, offerId)` applies the effect only, `metrics(state, ctx)`, optional `multipliers(state)` returning finite partial `{ payMult, speedMult, comfortMult }`. `state.config` is set once by the core. A module's state slice is private; other modules use its exported helpers. Exported helpers take `cfg` explicitly.
- Purchase kinds: `level` (job level), `itemLevel`, `item`, `rig`, `rack`. `rig`, `item`, `rack` count as "big" for the save-for-big rule; `rig` is bought in a pre-pass when affordable.
- Validation belongs in `config.mjs`, not inside mechanics.
- Tests first; every behaviour change has a failing test before the fix. Fixture changes are deliberate and explained in the commit.

## How the work was run

Each plan task was implemented by a fresh subagent given the full task text, then reviewed twice: first for spec compliance, then for code quality, with the implementer fixing findings and the reviewer confirming. Review findings that would be copied by later modules were fixed immediately rather than deferred. Continue the same way if you can; otherwise at least run `npm test` and keep the fixture honest.

## What remains (plan Tasks 11–15)

11. **Done.** Game refactor, see "Where the work is". Original brief kept for reference: Repo `ugurkc/ugurkc.github.io`, worktree `/Users/ugurkoc/repos/ugurkc.github.io/.worktrees/root-access-v2` on branch `root-access-v2-changes` (pull it level with `main` first; its last PR, #5, may or may not be merged). Generate `public/root-access-v2/config.js` with `convert --to js` from the preset, add `<script src="config.js"></script>` before the game script in `public/root-access-v2/index.html`, and replace the literal constants (`JOBS`, `ITEMS`, `SLOTS` counts, `MS`, `MAX_LV`, `MAX_ITEM`, `ITEM_R`, `TAP_BOOST`, `BAR_*`, `OFFLINE_CAP`, `EV_*`) with a small adapter that maps `window.RA_CONFIG` onto the existing names. No behaviour change: dump a scripted play-through (seed a save from another same-origin page, buy a rack, a rig, a lamp, level Wi-Fi to 25, read `localStorage['root-idle-v4']` and the page text) before and after and diff them; `npm test` and `npm run build` there; the built file must still equal the source. Open the PR to `main` with a plain body.
12. **Done** (commit `sim: README with the agent contract`, 191 lines, reviewed for accuracy against real runs). Original brief: what the tool is, the JSON contract for config / profile / targets / result with one short example each, every CLI command with a copy-pasteable call and sample output, how to add a mechanic (contract, registry, validator block, preset, test), how to snapshot a decision (`convert` the game's `config.js` into `presets/<date>.json`). Under 200 lines.
13. **Done** (commit `sim: UI page with config editor and run`; 150 tests). `tools/sim/index.html` + `ui/app.mjs`, `ui/editor.mjs` (pure form helpers, tested), `ui/format.mjs` (shared `fmt`, the CLI imports it), `ui/manifest.json` (preset and profile filenames), `ui/style.css`. Serve this worktree locally with the `balance-sim` entry in the main checkout's `.claude/launch.json` (port 8789) and open `/tools/sim/`. Verified in a browser: edit → run → export → import → reset round trip, inline validation, no console errors. Known: results tables widen the page (fixed in Task 14). Original brief: loads the preset and profiles, renders the config as grouped forms from `SHAPES` (one fieldset per block, tables for lists, `enabled` toggles), runs `run()` in the browser for the selected profiles, shows the day table, imports and exports config JSON, shows validator errors inline by path. Serve with this repo's existing `root-access` launch entry (`python3 -m http.server 8787`) at `http://localhost:8787/tools/sim/`; the page must work from a sub-path, so keep URLs relative.
14. **Done** (commit `sim: charts, target checklist and sweep in the UI`; 168 tests; Chart.js 4.4.1 from cdnjs is the only external script; verified in a browser at 1280 px and 375 px, no horizontal scroll, 7/10 verdicts as the baseline, sweep rows load into the editor). Original brief: credits and passive income over time with purchase markers per profile (one pinned CDN chart library), editable target rows with live verdicts and import/export, a sweep panel that runs `sweep()` and loads a chosen row back into the editor.
15. **Prepared on the branch** (repo README link, `tools/sim/presets/README.md`, UI paragraph in the tool README). Remaining: merge `balance-sim` into `main`, push, wait for this repo's Pages deploy, verify `https://ugurkc.github.io/root-access/tools/sim/` loads and runs. Original brief: push, let this repo's Pages deploy, verify at `https://ugurkc.github.io/root-access/tools/sim/`, link the tool from `README.md`, add `tools/sim/presets/README.md` on naming presets by date.

**Landing it.** Everything is on the branch. Finish by merging `balance-sim` into `main` (or opening a pull request to `main`), pushing, waiting for this repo's Pages deploy, and checking that `https://ugurkc.github.io/root-access/tools/sim/` loads the preset, runs both profiles and shows the charts and verdicts. After that, the game-side PR #6 in `ugurkc/ugurkc.github.io` (stacked on #5) is what makes the game read the shared config; retarget it to `main` when #5 merges. Local serving of this worktree: the `balance-sim` entry in the main checkout's `.claude/launch.json` (port 8789); it can be removed once the branch is merged, since the `root-access` entry (port 8787) then serves the same files from `main`.
