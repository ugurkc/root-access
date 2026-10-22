# Root Access v2 — mechanics and specification

State of the published prototype as of 2026-10-22 (ugurkc/ugurkc.github.io `main` at dd22708, after PRs #3 and #4). Written for agents continuing the work. Every number here is copied from the source; when the source and this file disagree, the source wins and this file should be updated.

## 1. Where things live

| What | Where |
|---|---|
| Live game | https://ugurkc.github.io/root-access-v2/ (unlisted, `noindex`) |
| Source | `public/root-access-v2/index.html` in repo `ugurkc/ugurkc.github.io` — one self-contained HTML file, no build step for the game itself |
| Deploy | The repo's Astro site; `.github/workflows/deploy.yml` runs `npm test` + `npm run build` and publishes `dist/` on every push to `main`. `public/` is copied verbatim, so the deployed file is byte-identical to the source |
| Working copy | Git worktree `/Users/ugurkoc/repos/ugurkc.github.io/.worktrees/root-access-v2`, branch `root-access-v2-changes`. The main clone of that repo stays on the owner's own branch; do not switch it |
| Local serve | From this repo: `.claude/launch.json` entry `root-access-v2` (python `http.server` on 8788 serving the worktree's `public/`); open http://localhost:8788/root-access-v2/ |
| Ship | Commit on the worktree branch, push, `gh pr create --base main`; merge triggers the deploy. There is no CI on pull requests, so run `npm test` (27 tests, none cover the game) and `npm run build` locally and say so in the PR |
| This repo | `ugurkc/root-access` is the older design bench (`index.html` + `config.js`, deployed at /root-access/). It is a different build; only `docs/` here relates to v2 |
| Design docs | Gate doc (targets, Turkish): https://claude.ai/artifact/3srWUYPuJfGGiPjqVY3X4C. Holy Trifecta deck (Unity slice systems, not in v2): https://claude.ai/artifact/QY9hn8Vk14xMzP6qM5xq2s. Original artifact export of the game: https://claude.ai/artifact/TE41Ji3nXgN8JAtxkaS3EE |

Testing a save in a browser: the game writes `localStorage` on `pagehide` and every 3 s, so seeding or clearing the save from the game page is overwritten on reload. Navigate to another page on the same origin (e.g. `/robots.txt`), edit `localStorage['root-idle-v4']` there, then navigate back.

## 2. Design intent

- Phone-first idle clicker about hacking from a bedroom. One dark theme by choice.
- Tuned for a **7-day idle curve**: the player should feel the benefit of tapping and of coming back at the same time. Each day should have a next purchase that overnight earnings roughly pay for, and a session of tapping should earn about what the night did.
- Gate doc targets for the slice: median first session ≥ 10 min, P25 ≥ 4 min, first upgrade ≤ 90 s, ≥ 60% "would reopen". The settings panel asks testers for screenshots on day 1, 3 and 7.
- Money must keep meaning: nothing scales forever (jobs cap at 25, items at 25), the room is cramped, and space is a real constraint.
- Simulated pacing with the current numbers (greedy player; "active" = 12 min day 1 then three short sessions a day at 2.5 taps/s, "casual" = 8 min then one 5 min session a day): first level-up in seconds, Wi-Fi rig at about minute 1 of the first session, CEO rig around minute 9 for active players, then roughly one rig and one item per day, satellite rig on day 5–7. Prices were lowered after this sim (PR #4), so expect everything slightly earlier. The simulator lived in a session scratchpad and is not in any repo; it modelled the formulas below.

## 3. Core loop

### Credits, taps, the HACK bar
- Currency is credits (`$`). Display uses `fmt`: K, M, B, T, Qa, Qi, Sx, Sp.
- **HACK button** (pointerdown, so rapid taps feel instant). Each tap:
  - pays `tapMoney = max(1, 0.25 × incomePerSec) × comfortMult`, where `incomePerSec` counts only jobs currently running;
  - advances every running job by `TAP_BOOST = 0.25 s`;
  - adds one step to the bar (`BAR_STEPS = 10`).
- **Full bar** (every 10 taps): pays `BAR_BONUS = 15` taps' worth of money, and grants a job speed bonus: `+25%` (`BAR_SPEED`) for `12 s` (`BAR_SPEED_DUR`). Bonuses stack linearly: `speed = 1 + 0.25 × (bars still active)`. Shown under HACK as "×1.25 speed 12s". The stack is cleared when offline earnings are simulated (it does not survive an absence). There is no instant skip any more.
- Tap income scales with income, so tapping stays worthwhile at every stage.

### Jobs
Six jobs, in `JOBS`. A job has levels `lv` (0 = not bought), and runs for `time` seconds; on finish it pays `payFor` and adds `rep`.

| id | Name | time (s) | pay at L1 | level 1 cost | cost growth r | rep / run | rep to unlock | rig (automation) | rig price |
|---|---|---|---|---|---|---|---|---|---|
| wifi | Crack a Wi-Fi password | 6 | $3 | $6 | 1.12 | 3 | 0 | DeAuth-o-Matic 3000 | $1,000 |
| ceo | Steal a CEO's emails | 18 | $45 | $200 | 1.13 | 9 | 25 | CEObuster 5000 | $100K |
| dms | Leak a politician's DMs | 36 | $360 | $3,000 | 1.13 | 30 | 400 | DMscraper XL | $1.3M |
| bank | Drain a corrupt bank | 90 | $3,000 | $40K | 1.13 | 90 | 6,000 | BankDrainer Turbo | $16M |
| cams | Blind a city's cameras | 180 | $24K | $500K | 1.12 | 300 | 60,000 | BlindSpot 9000 | $200M |
| sat | Hijack a satellite | 360 | $180K | $6M | 1.12 | 900 | 350,000 | SatJacker Ultra | $2.7B |

Formulas:
- Cost of the next `n` levels: `cost × r^lv × (r^n − 1) / (r − 1)`. The BUY toggle cycles ×1, ×10, ×100, MAX (max affordable, clamped to the cap).
- `MAX_LV = 25`. Milestones `MS = [25]`: pay doubles at level 25. At the cap the LEVEL UP button becomes a disabled MAXED button.
- `payFor = pay × lv × msMult(lv) × payMult × comfortMult` (room multipliers below).
- Job duration is divided by `speedMult`.
- A job is **unlocked** when `rep ≥ unlock` (or already owned). The next locked job shows as `???` with a rep bar; its name is revealed at 60% of the requirement (`REVEAL_AT`). After the last job the HUD says "All unlocked".
- Buying level 1 ("UNLOCK JOB") starts the job once. Without a rig the job runs one time per manual start: tap the ring or anywhere on a ready row ("RUN"). With a rig it repeats forever ("AUTO").
- Rep only ever goes up; it is earned per completed run, including offline.

### Rigs (automation)
- One rig per job, bought once, stored as `jobs[id].fixer = true` (the save field kept its old name).
- A rig is **small hardware** that must sit on a rack shelf (see Room). It appears in the room as a small box with a job-coloured LED.
- Purchase paths: (a) the rack's sheet → an empty shelf → ADD → the chooser lists the rigs of unlocked jobs that are not yet automated; (b) the guide line under the job row (below).
- **Guide line** under each unlocked, un-automated job:
  - a rack with a free shelf exists: "`<rig> · $price · add on rack`", enabled once affordable, opens that rack's sheet;
  - no free shelf but a free floor/wall slot: "`<rig> · $price · buy a rack ($rackPrice) to fit it`", always enabled, opens that slot's sheet (the rack is the last item there);
  - neither: "`… · no space`", disabled.
- Offline: only rigged jobs run while away. "Welcome back / Your rigs kept working" shows jobs completed and credits earned.

### Offline earnings
- On load or when a tick gap exceeds 60 s, `simulateOffline(min(away, OFFLINE_CAP))` runs the rigged jobs in 1 s steps. `OFFLINE_CAP = 8 h`; the modal says so when the absence was longer.

## 4. The room

An isometric bedroom drawn as SVG, rasterised to a small canvas and scaled up with hard pixels. Six fixed slots:

| id | type | size | position (SVG 390×320) |
|---|---|---|---|
| t1 | tech | large | floor (296, 224) |
| t2 | tech | large | wall (303, 62) |
| t3 | tech | large | floor (262, 244) |
| d1 | decor | — | shelf (148, 160) |
| d2 | decor | — | floor (205, 256) |
| d3 | decor | — | bed (122, 228) |

### Sizes and racks
- **Large** tech needs a floor/wall slot: GPU tower, Server tower, Cooling unit, Server rack.
- **Small** tech only fits a rack shelf: Fiber modem, Quantum card, all six rigs.
- A **Server rack** is a large item that adds three shelf slots stacked above it (ids `t1r0`…`t1r2` etc., generated by `slots()`). First rack costs $400; each further rack costs 50× the previous (`$400, $20K, $1M`). Up to three racks fit, which leaves no room for any tower; this is the intended choice.
- In the room a rack is one tappable object with a single pulsing "+" badge while it has a free shelf. Shelves are not individually tappable. Tapping the rack opens its sheet: "Server rack · n/3 shelves", one row per shelf (filled: item name and effect, AUTO for rigs, an upgrade button for cards/modems; empty: ADD). ADD opens the chooser for that shelf, which has a BACK button to the rack. Buying returns to the rack sheet.
- `fits(slot, item)`: same type, and for tech the same size.
- Nothing can ever be removed or moved. "Items stay in your room for good."

### Items
`ITEMS` (plus one generated entry per rig, key `rig:<jobId>`). Items can be placed once each (racks can be placed repeatedly).

| key | type | size | name | cost (L1) | comfort | effect at L1 |
|---|---|---|---|---|---|---|
| gpu | tech | large | GPU tower | $10K | +1 | all jobs pay +25% |
| fiber | tech | small | Fiber modem | $1M | +2 | all jobs 20% faster |
| server | tech | large | Server tower | $25M | +3 | all jobs pay +50% |
| cooler | tech | large | Cooling unit | $400M | +4 | all jobs 30% faster |
| quantum | tech | small | Quantum card | $2.5B | +5 | all jobs pay +100% |
| rack | tech | large | Server rack | $400 (×50 each) | — | holds 3 small upgrades |
| lamp | decor | — | Lava lamp | $2K | +5 | event: +10 comfort for 30 s |
| plant | decor | — | Plant | $40K | +10 | event: +15 for 45 s |
| phones | decor | — | Headphones | $200K | +15 | event: +20 for 40 s |
| cat | decor | — | Cat | $5M | +25 | event: +30 for 45 s |
| gf | decor | — | Girlfriend | $100M | +40 | event: +60 for 40 s |

Item levels (`MAX_ITEM = 25`, `ITEM_R = 1.5`), for everything except rigs and racks:
- `grow(lv) = 1 + (lv − 1) / 5`: level 1 is the base effect, each further level adds a fifth of it, so level 25 is 5.8× the base.
- Pay bonus: `1 + (pay − 1) × grow(lv)`; speed bonus: `1 + (speed − 1) × grow(lv)`.
- Comfort: decor `round(comfort × grow(lv))`; **tech comfort is flat** (`+1…+5`, no growth) so comfort stays decor's job.
- Upgrade from level `lv` costs `cost × 1.5^lv` (so the first upgrade is 1.5× the purchase price). Upgrades are bought in the item's sheet (tap the placed item) or, for shelf items, in the rack sheet. At 25 the button reads MAXED.

Multipliers (all multiplicative across placed items):
- `payMult = Π itemPay`, `speedMult = Π itemSpeed × barSpeed`, `comfortMult = 1 + comfort / 100` where `comfort = comfortBase + active event boosts`.
- `comfortMult` is applied inside `payFor` and again in `tapMoney` (intentional in the original code; taps lean on comfort twice).

### Decor events
- Every `EV_MIN…EV_MAX = 60…120 s` (first one 15 s after placing decor) one placed decor item asks for attention for `EV_WINDOW = 20 s`. Tapping the item or the bubble accepts it and adds the item's `boost` comfort for `dur` seconds on top of the permanent comfort. An item with an active boost does not ask again until it expires. Tapping an item with a pending event accepts the event instead of opening its sheet.

## 5. UI contract

Layout is one phone column: thin HUD (credits, +$/s over the last 15 s, rep bar to the next job, comfort bar with boost overlay, pay multiplier, settings gear), the room, the HACK button with its 10-segment bar and sub-line, then the JOBS dock (collapsible; its summary reads "n running · m auto", "idle", or "UPGRADE READY" when collapsed and something is affordable).

Each job row: ring (NEW / RUN / job code / AUTO, with progress), name and level, pay · time left · "2× at L25", the rig guide line (section 3), and the LEVEL UP / UNLOCK JOB / MAXED button with cost. Rows that are ready to run get `data-run` so a tap anywhere on them starts the job.

Sheets (bottom panels, one at a time): empty slot chooser, placed item (effect, upgrade row), rack (shelves), settings (playtest counters, Wipe save). Toasts for purchases and milestones. Money pops over the room; a shake and "BONUS +$… · ×1.25 SPEED" pop on a full bar.

All click actions are `data-action="<verb>:<arg>"`, parsed on the **first** colon only (item keys like `rig:wifi` contain one). Verbs: hack, dock, event, buyx, run, up, buy, upitem, shelf, openslot, closesheets, settings, reset, restart, close.

## 6. Save format

`localStorage['root-idle-v4']` (`SAVE_KEY`), JSON of the state `S`:

```
credits, rep, totalJobs, last (ms timestamp of last tick), bar (0–9), bars (expiry timestamps of active speed bonuses),
jobs:    { [jobId]: { lv, fixer } }
running: { [jobId]: { work, need } }          // need = job time; work advances by seconds × speedMult (+ tap boosts)
slots:   { [slotId]: itemKey }                 // includes shelf ids like "t1r0"; rigs are "rig:<jobId>", racks "rack"
itemLv:  { [slotId]: level }                   // missing = 1
cool:    {}                                    // legacy, unused
boosts:  [ { slot, key, amt, until, label } ]  // active decor event boosts
event:   { slot, key, until } | null, nextEvent
m:       { first, sessions, days[], taps, lastSession, bars }   // playtest counters shown in settings
```

Compatibility rules in `load()`: unknown item keys and job ids are dropped, job levels above 25 are clamped, item levels above 25 are clamped, missing `itemLv`/`bars` default. A save from before racks can have `fixer: true` with no rig in any slot; the job keeps running on its own and simply has no sprite. The key has never been bumped so testers keep progress across every tuning round.

## 7. Open questions and known gaps

- No way to move or sell items; a player who fills all three floor slots with towers can never place a rack (and so never automate). Current stance: it is a real choice, keep it, but watch tester feedback.
- Pre-rack saves with automation but no rig sprite (section 6).
- The 7-day numbers come from a formula simulator, not from testers. The gate doc's open question about currency thresholds is answered by this tuning but not yet validated.
- Not in v2 and out of scope unless asked: the Unity slice's bandwidth / trace / fatigue systems, family friction events, factions, moving fund, exploits as job-unlock costs.
- Telemetry is local only (the settings panel); the gate doc wants session events and a day-1 return signal.
