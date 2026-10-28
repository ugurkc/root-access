# Starter home numbers — first sweep and the decision to take

Date 2026-10-28. The sim understands the starter home design (schema 2: classes with tiers, a rack that holds the rigs, loot drops). The draft preset `tools/sim/presets/starter-2026-10-28.json` was run against the seven-day targets and then swept. This note records what the sim says and the choice it leaves open. Nothing here is applied yet; the preset still holds the draft numbers.

## What the draft does

Both profiles, 7 days (`node tools/sim/cli.mjs run --config presets/starter-2026-10-28.json --profile profiles/<p>.json --targets targets/seven-day-idle.json`):

| | active | casual |
|---|---|---|
| rack bought | 24 s | 27 s |
| first rig | 29 s | 38 s |
| room complete (8 classes, 18 tiers, 3 rigs) | 112 s of day 1 | 180 s of day 1 |
| purchases per day | 194, 79, 19, 7, 4, 3, 3 | 148, 86, 13, 28, 6, 4, 4 |
| passive income from day 2 | $1.1K/s | $930/s |
| offline earned per day | $46.6M | $17.9M |
| loot earned over the week | $79.5M | $26.9M |
| credits on day 7 | $23.8M | $329K |
| targets | 5/6 | 5/6 |

Two findings:

1. **The room is over in three minutes.** Every class, every tier and all three rigs are bought on day 1; from day 2 the only thing left to buy is job levels. `daily-rig-or-item` (a rig or room upgrade every day D2–D6) fails with 0 for both profiles. Room prices are about two minutes of income.
2. **The money is not realistic.** Tens of millions a week, with a rigged Wi-Fi crack paying $100 every 6 seconds at level 50.

## Where the money comes from

With no level-ups at all (`jobs.maxLevel` 1) the week still makes $14M (active) / $3.3M (casual). So job levels are not the root cause. The scale is set by:

- **pay per run ÷ run time**, times the room multipliers (computer ×2, comfort ×1.5, tower ×2 on rigs), times
- **the offline window**: three rigged jobs run every 6 / 15 / 30 s for up to 8 h a night, about 4,800 Wi-Fi runs per night, and
- **taps**: tap money is 0.25 × running income, doubled by the desk, and the chair makes every full bar pay 45 taps; at 2.5 taps/s that is several times the running income on top.

Loot adds a flat 24 % on all of it (0.02 × 12 runs).

## Levers tried (active profile, 7 days)

| variant | change | credits d7 | passive $/s | targets | note |
|---|---|---|---|---|---|
| baseline | – | 23.8M | 1.1K | 5/6 | room done in 2 min |
| A | room prices ×10 | 17.3M | 1.1K | 5/6 | room done on day 1–2 |
| B | room prices ×30 | 34.8M | 1.1K | 5/6 active, 4/6 casual | casual's first rig at 607 s, too late |
| E | taps.rate 0.1, bar bonusTaps 5 | 14.9M | 1.1K | 5/6 | halves active income, nothing else |
| C | cap 10, r 1.5 | 137M | 217 | 3/6 | everything bought by day 3; credits pile up |
| D | cap 20, r 1.3 | 255M | 435 | 3/6 | same |
| I | cap 1 (no levels) | 14.1M | 22 | 3/6 | the floor: still millions |
| F | C + room ×10 + taps 0.1 + bar 5 | 85M | 217 | 3/6 | |
| M | F + long jobs (6 s, 30 s, 5 min, 30 min, 3 h, 12 h) | 20M | 82 | 3/6 | radio never bought by casual |
| N | F + medium jobs (6 s, 20 s, 2 min, 10 min, 45 min, 3 h) | 32M | 114 | 3/6 | |
| Q | N + rack holds 6 | 46M | 181 | 3/6 | all six jobs rigged |

Every variant that lowers the level cap fails `daily-purchase` and `d7-not-done`: with fewer, cheaper things to buy the shop is done by day 3 and credits pile up. So the fix is not one lever. The draft needs a different shape, and that shape is a design choice.

## The choice

The dollar scale and the idle loop pull against each other. A $2 job that takes 6 seconds earns $1,200 an hour; rigged for an 8-hour night that is $10K before any multiplier. There are three ways out.

**Direction 1 — realistic time, realistic money (recommended).** Make run times realistic for the late jobs and keep the pays as they are: Wi-Fi 6 s / $2 stays the tap toy; streaming 30 s / $8; phone 5 min / $30; kebab 30 min / $120; dentist 3 h / $500; radio 12 h / $2,000. Levels then add a small share of the base pay (for example +15 % per level, cap 10) instead of ×lv, which needs one new config knob, `jobs.levelGain`. Rigs run the job at a fraction of hand speed (for example 0.5×) and the Tower Unit restores it, which needs a second knob, `rigs.speed`. Taps advance jobs further (router) so an active player finishes a 5-minute phone job in a session; an idle player waits or comes back. Expected scale: a few thousand dollars in week one. This also fixes the room pacing: with income in the tens of dollars a minute, the draft room prices ($30 … $9,000) spread over the week by themselves.
Cost: two small model knobs (one line each in jobs.mjs and rigs.mjs plus schema entries), then a sweep. The first session changes feel: fewer, slower jobs; the tap loop matters more.

**Direction 2 — fantasy money, realistic names.** Keep the current pacing shape (seconds-long jobs, 50 levels, ×lv pay) and only scale the room prices up (×10 to ×30) and the taps down (rate 0.1, bar 5), accepting millions by day 7. The names are grounded, the numbers are not. Cheap: a config change. Variant A/E above show the result; `daily-rig-or-item` still needs the room to be priced in days, which variant B shows pushes the casual first rig past 10 minutes, so this direction also wants a tiered rack (2 → 3 → 4 slots) so the rack itself is a daily purchase.

**Direction 3 — a shorter idle window.** Keep everything and cut `offline.capHours` to 1–2 h. Variant K (cap 10, r 1.5, 2 h) still reaches $34M for active. Not enough on its own; listed for completeness.

## Recommendation

Direction 1. It is the only one where "realistic" holds for the numbers a tester sees, and it uses the mechanics the design already has (router taps, Tower Unit, the rack) as the levers of the loop. It needs two small knobs before the sweep can be run, so the next step is: add `jobs.levelGain` and `rigs.speed` to the model (with tests), set the long run times in the preset, then sweep `levelGain`, `rigs.speed`, `taps.advance` and the room prices against the targets.

If Direction 2 is preferred, the next step is a sweep over room price scale × rack tiers with the tap economy at 0.1 / 5, and the preset ships from that.

## Reproducing

The variants above were run with a scratch script that loads a preset, applies overrides through the sim's own `setAt`, runs both profiles and evaluates the targets; the CLI `sweep` command gives the same per-combination summary for one or two parameters. Baseline numbers are the pacing fixture `tools/sim/test/fixtures/starter-expected.json`.
