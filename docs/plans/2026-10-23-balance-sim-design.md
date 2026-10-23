# Balance simulator — design

Approved 2026-10-23. A tool that runs the game's economy from one config file and reports whether a set of numbers meets the customer-journey targets we define. Humans use a static page; agents use a CLI with a JSON contract; the game reads the same config.

## Goals

- Answer "do these numbers give the journey we want?" in seconds, without playing.
- Survive future design decisions: a new mechanic is a new module and a config block, not a rewrite.
- Be usable by AI agents: JSON in, JSON out, non-zero exit on a failed target, one README that explains the contract.
- One source of truth for numbers: the live game, the UI and the CLI all read the same config.

## Non-goals

- Modelling UI feel (animations, taps-per-second limits of real thumbs). Profiles state taps per second as an assumption.
- Replacing playtests. The tool predicts pacing from formulas; testers validate.
- A build toolchain. Everything is plain ES modules that run in Node 22 and in a browser.

## Architecture

```
config.json ──► model (mechanic modules) ──► timeline + daily summary + metrics
   ▲                   ▲                                  │
   │                   │ profile.json (player behaviour)  ▼
 game reads it      scenario.json                 targets.json ──► evaluator ──► verdicts
                                                                        ▲
                               CLI (run, sweep)  ◄──────────────────────┘──►  static UI page
```

### Config
One JSON object, versioned with a `schema` field. Blocks per mechanic: `taps`, `bar`, `jobs`, `rigs`, `racks`, `items`, `events`, `offline`. A block may carry `enabled: false` to switch the mechanic off. The current game's numbers are the first preset. The validator rejects unknown blocks and wrong types with a path to the offending key.

The game loads the same data from `config.js` (a global `RA_CONFIG` object) next to its `index.html`, the pattern this repo's bench already uses, so it still runs from a static folder with no fetch. A tiny script converts between `config.json` and `config.js`; the content is identical.

### Model
A tick loop over a schedule. State is a plain object. Each mechanic is a module exporting:

- `id`: config block name.
- `init(state, config)`: set up its slice of state.
- `tick(state, dt, ctx)`: advance by `dt` seconds of active play; `ctx` carries derived multipliers from other modules (pay, speed, comfort) collected each tick.
- `offline(state, seconds, ctx)`: advance an absence; only mechanics that earn while away implement it.
- `offers(state, ctx)`: purchases available now, each `{ id, cost, gainPerSec, kind }`, so the buying policy stays in the profile, not in the mechanic.
- `buy(state, offerId)`: apply a purchase.
- `metrics(state)`: named numbers for targets, e.g. `rigs.count`, `jobs.wifi.level`.

The core composes modules in a fixed order, merges multipliers, runs the player's buying policy against the union of offers, and records events (`{ t, day, kind, id, cost }`) into a timeline. A module that is disabled in config is skipped everywhere.

Initial modules: `taps` (tap money, job advance per tap), `bar` (steps, money bonus, stacking speed bonus), `jobs` (levels, cost growth, milestones, rep, unlocks), `rigs` (per-job automation), `racks` (slots, sizes, shelves), `items` (placement, levels, pay/speed/comfort), `events` (decor comfort uptime, modelled as average), `offline` (cap, which mechanics run while away).

### Profiles
Player behaviour as data: a session schedule (day, hour, minutes, taps per second), a buying policy (greedy by gain-per-cost, save-for-big-purchase threshold, fixer priority), and manual-job restart behaviour. Two presets to start: `active` and `casual`, matching the assumptions used so far.

### Scenarios and targets
A scenario is `{ config, profiles[] , days }`. A target is `{ id, metric, op, value, profile, label }`, for example `{ metric: "firstEvent:levelup", op: "<=", value: 90, profile: "all" }` or `{ metric: "purchasesPerDay:min", op: ">=", value: 1, days: [2,6] }`. The evaluator returns one verdict per target and profile with the measured value. Targets are JSON so agents can commit them beside configs.

### CLI (agent API)
`node tools/sim/cli.mjs run --config X --profile Y [--targets T] [--days 7] [--json]` prints a result object: `{ summary: [per day], timeline: [events], metrics: {}, verdicts: [] }`; exits 1 when any verdict fails. `sweep --param jobs.wifi.fixer --values 500,1000,2000 [--param2 …]` prints a table of target pass counts and chosen metrics per combination. `validate --config X` checks the schema. `convert --to js|json` converts between the game's `config.js` and JSON. All documented in `tools/sim/README.md` with copy-pasteable examples.

### UI
`tools/sim/index.html`, vanilla JS modules, a chart library from a CDN pinned to a version. Three columns: config editor grouped by block with import/export; charts of credits, income and purchase markers over the run, one series per profile; target checklist with live verdicts and a sweep panel. Presets load from `tools/sim/presets/`. Served by this repo's Pages at `/root-access/tools/sim/` and by the existing local server entry.

## Decisions taken

- Mechanic modules with a registry, not a monolithic loop (approved over the flag-based alternative).
- The game is refactored to read config; the refactor is a separate pull request with no behaviour change, verified by diffing the page before and after.
- Decor events are modelled as average comfort uptime rather than a reaction minigame.
- Plain ES modules, Node's built-in test runner, no dependencies beyond a pinned chart CDN script in the page.
- Config snapshots are copied into `tools/sim/presets/` when a decision is made, named by date.

## Open questions

- Whether the published game URL should be loadable directly in the UI (cross-origin fetch is allowed from the same Pages host, so likely yes).
- How much of the UI's state (edited config, targets) should persist in the browser between visits.
