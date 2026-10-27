# Pacing fixture

`v2-expected.json` locks the behaviour of the full default module set against the default preset
(the first entry in `ui/manifest.json`, currently `presets/v2-2026-10-27.json`; the tests read it
through `test/default-preset.mjs`) for both profiles over 7 days. `test/pacing.test.mjs` checks it in
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

## Current baseline (2026-10-27)

Preset `v2-2026-10-27.json`: the job ladder retune (no level-25 milestone, cost growth `r` 1.20 on
every job, level cap 50). Purchases now spread across the week instead of running dry on day 3.

- Active: rack at 81 s, Wi-Fi rig at 91 s, first item (`item:lamp`) at 180 s of day 1; all five
  reachable rigs by day 3 (wifi, ceo on day 1; dms, bank on day 2; cams on day 3), the room full
  (2 racks, GPU in the large slots) from day 2. The ladder is unfinished on day 7: wifi, ceo, dms
  and bank at level 50, cams at 44, sat at 34; `offersLeft.final` is 4 and `purchasesPerDay` is
  `[98, 156, 79, 36, 17, 10, 6]`. Passive income reaches about $194K/s on day 7.
- Casual: Wi-Fi rig at 146 s of day 1, one rig a day through day 4 and the fifth on day 6;
  `offersLeft.final` is 9 and `purchasesPerDay` is `[59, 40, 57, 41, 53, 12, 40]`.
- Both: `d7-not-done` now passes. The starter target `daily-rig-or-item` (a rig or item placed
  on each of days 2–6) still fails for both: rigs and items run out early, and from day 4 (active)
  or day 7 (casual) only job and item levels are bought. Recorded as a baseline finding of the
  preset, not fixed.

## Previous baseline (2026-10-23)

Preset `v2-2026-10-23.json` (milestone at 25, `r` 1.12–1.13, cap 25): active bought the last
upgrade on day 7 (`offersLeft.final` 0, `purchasesPerDay` `[100, 124, 49, 5, 2, 1, 1]`), casual
ended with 2 offers left (`[72, 65, 48, 26, 47, 9, 5]`); `d7-not-done` (active) and
`daily-rig-or-item` (both) failed, 7/10. Kept in git history, not in the fixture.
