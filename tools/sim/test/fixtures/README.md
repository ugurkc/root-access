# Pacing fixture

`v2-expected.json` locks the behaviour of the full default module set against the v2 preset
(`presets/v2-2026-10-23.json`) for both profiles over 7 days. `test/pacing.test.mjs` checks it in
two layers.

## Layer 1: coarse facts

Hand-stated in the test and expected to survive ordinary tuning. For both profiles: the shop never
hits its buy cap, the first job level-up lands within 90 s of active play, the first rig lands inside
the first session (720 s active, 480 s casual), at least one non-offline purchase happens on each of
days 2–6, and every metric is finite. The active player owns at least five rigs by day 7. A failure
here means the game's pacing changed in a way worth a look, whatever the intent.

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

## Current baseline (2026-10-23)

- Active: rack at 50 s, Wi-Fi rig at 56 s, first item at 93 s of day 1; all five rigs and every
  job maxed by day 3, only item levels left from day 4; the last upgrade (`itemlv:fiber`) falls on day 7, so
  `offersLeft.final` is 0 and `purchasesPerDay` is `[100, 124, 49, 5, 2, 1, 1]`. The room is
  full (2 racks, GPU in the large slots) from day 1. This day-7 dead end is a known finding of the
  current preset, recorded here as the baseline rather than fixed.
- Casual: Wi-Fi rig at 89 s of day 1, one rig a day through day 4, `offersLeft.final` is 2 and
  `purchasesPerDay` is `[72, 65, 48, 26, 47, 9, 5]`.
