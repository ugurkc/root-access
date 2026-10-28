# Pacing fixture

`starter-expected.json` locks the behaviour of the full default module set against the default preset
(the first entry in `ui/manifest.json`, currently `presets/starter-2026-10-28.json`; the tests read it
through `test/default-preset.mjs`) for both profiles over 7 days. `test/pacing.test.mjs` checks it in
two layers. `starter-base.mjs` in this folder is something else: the hand-written schema-2 config the
unit tests build states from (`base()`), small and complete, distinct from the generated pacing fixture.

## Layer 1: coarse facts

Hand-stated in the test and expected to survive ordinary tuning. For both profiles: the shop never
hits its buy cap, the first job level-up lands within 90 s of active play, the first rig lands inside
the first session (720 s active, 480 s casual), at least one purchase happens on each of days 2–6,
loot has paid out by day 7 and every metric is finite. The active player owns three rigs (the rack is
full) by day 7. A failure here means the game's pacing changed in a way worth a look, whatever the intent.

## Layer 2: exact fixture

Per profile, the per-day purchase lists and closing credits from `summary` (credits rounded to 6
significant digits), plus `credits.final`, `offersLeft.final` and `firstEvent:rig`. Compared with
`deepEqual`, so any drift in the purchase order or the numbers is visible. A failure here means the
model's output changed; that is fine when a tuning or model change was deliberate, and a bug otherwise.

## Regenerating

    UPDATE_FIXTURE=1 npm test

rewrites the fixture from the current run (the test passes in that mode, so look at the diff before
committing). A fixture change must be deliberate: commit it alongside the preset or model change that
caused it and say why in the message. Never regenerate just to make the test green.

## Current baseline (2026-10-28)

Preset `starter-2026-10-28.json`: the starter home (six jobs with loot texts, one rig per job, a
one-tier rack with three slots, seven more room classes, loot 2 % × 12 runs). Draft numbers: the
whole room is bought in the first minutes of day 1 and the week after that is job levels only.

- Active: first rig (Wi-Fi) at 29.2 s, rack at 24 s of day 1; stream rig at 56 s, phone rig at 124 s,
  and every class at its last tier by 112 s (18 tiers, 8 classes, the tower included). Rigs per day
  `[3, 0, 0, 0, 0, 0, 0]`; the rack is full from 124 s, so the kebab, dentist and radio rigs are never
  offered and passive income plateaus at about $1.09K/s from day 2. `purchasesPerDay` is
  `[194, 79, 19, 7, 4, 3, 3]`, `offersLeft.final` 2 (dentist at 48, radio at 40; the other four jobs
  at 50), `loot.earned` about $79.5M (first loot card at 86.4 s), day-7 credits about $23.8M (down
  from $34.4M on day 6: a radio level costs tens of millions by then). Active play dominates: about
  $69M a day from taps, bar and loot in 16 minutes against $46.6M offline.
- Casual: rack at 27.3 s, Wi-Fi rig at 38 s, stream rig at 93 s, phone rig at 186 s, the room complete
  at 180 s of day 1. Rigs per day `[3, 0, 0, 0, 0, 0, 0]`, `purchasesPerDay` `[148, 86, 13, 28, 6, 4, 4]`,
  `offersLeft.final` 3 (kebab 48, dentist 38, radio 32), `loot.earned` about $26.9M (first card at
  124.7 s), day-7 credits about $329K, passive about $931/s.
- Both: 5 of the 6 targets pass (`first-upgrade`, `first-rig`, `daily-purchase`, `d7-not-done`,
  `first-loot`). `daily-rig-or-item` (a rig or room upgrade on each of days 2–6) fails for both with
  actual 0: everything big is bought on day 1. Recorded as a baseline finding of the draft numbers,
  not fixed. `shop.capHits` is 0 and every metric is finite for both.

Earlier baselines (`v2-2026-10-27`, `v2-2026-10-23`, schema 1) are in git history, last at commit
`65ac455`.
